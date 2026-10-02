# 架构说明（V0.2）

> 目的：让新开发者在 10 分钟内明白代码为什么这样组织，以及哪些边界不能破坏。

## 1. 分层与依赖方向

```
            ┌──────────────────────────────────────────┐
  UI        │ src/app（页面 + Server Actions）           │
            │ src/components、src/server                │
            └───────────────┬──────────────────────────┘
                            │ 只调用 application 服务
            ┌───────────────▼──────────────────────────┐
  Infra     │ src/infrastructure                        │
            │ Drizzle/SQLite、Repository 实现、          │
            │ LocalObjectStorage、LLM Provider、遥测     │
            └───────────────┬──────────────────────────┘
                            │ 实现 domain 定义的 ports
            ┌───────────────▼──────────────────────────┐
  App       │ src/application（编排、事务边界、幂等）      │
            │ src/agent（AI Router，只调用 application）  │
            └───────────────┬──────────────────────────┘
                            │
            ┌───────────────▼──────────────────────────┐
  Domain    │ src/domain（实体、枚举、ports、状态机）      │
  + 纯计算   │ src/learner、src/scheduler、src/assessment │
            │ src/nlu、src/language                      │
            └──────────────────────────────────────────┘
```

**强制手段**：`tests/architecture/boundaries.test.ts` 静态扫描 import，违反即测试失败。

被禁止的依赖：

| 层 | 不得导入 |
|---|---|
| `domain` | 除 `zod` 与自身相对路径外的一切 |
| `learner` / `scheduler` / `assessment` / `nlu` / `language` | react、next、drizzle、better-sqlite3、node:fs、任何 AI SDK、`@/infrastructure`、`@/app` |
| `application` | `@/infrastructure`、`better-sqlite3`（只依赖 ports） |
| `agent` | `@/infrastructure`、drizzle、数据库 |

另有一条测试断言：**Learner Model、Scheduler、Assessment、事件处理里不存在 `llm.complete(` 和 `fetch(`**。

## 2. 三个概念严格区分

| 概念 | 表 | 含义 | 可变性 |
|---|---|---|---|
| **Event** | `learning_events` | 发生过的事实 | 追加，不修改 |
| **State** | `learner_states` | 当前估计 | 由事件推导，可重算 |
| **Memory** | `memories` / `learning_preferences` | 值得长期保留的信息 | 有置信度、证据数，可被用户纠正 |
| **Operation Log** | `knowledge_operation_log` | 知识库、目标、场景的数据管理审计 | 追加；不参与 Learner Model |

`import_export_history` 记录每次导入/导出的元数据与统计，和学习事实、操作日志均分开。事件写入通过 `idempotencyKey` 唯一索引保证幂等：重复提交同一次作答不会产生第二条事件、第二个评估，也不会二次影响状态。

## 3. Learner Model（`src/learner`）

全部参数集中在 `params.ts`，任何 UI / Prompt / API handler 都不得复制这些数字。

```
mastery = recentScore   × 0.30
        + historicalScore × 0.20
        + stabilityScore  × 0.20
        + retrievalScore  × 0.20
        + exposureScore   × 0.10
```

关键设计：

- **recentScore**：最近 8 条证据，按「时间半衰期 14 天 × 位置衰减 0.85^i」加权，再向低先验（0.2，权重 1.5）收缩 → 单次正确不会让掌握度暴涨（实测 ≈ 0.33）。
- **historicalScore**：成功率向先验收缩（先验均值 0.2，权重 3）。
- **stabilityScore**：`1 - exp(-间隔天数 / 30)`，间隔由 SM-2 lite 维护。
- **retrievalScore**：`retrievalStrength × exp(-已过天数 / 间隔)`，体现遗忘。
- **exposureScore**：`1 - exp(-次数 / 8)`，权重仅 10% → **曝光次数不等于掌握度**。
- **confidence** 与 mastery 完全独立：由证据量（按模态饱和）、模态多样性、一致性、新鲜度合成。**重复同一种题型的边际价值迅速衰减**。
- **modalityStats** 只记录真正测过的维度（recognition / recall / production / listening / transfer），从而能识别「识别强、产出弱」这类错误模式。
- **transferScore / transferConfidence** 与 App 内 mastery 分开存储，只有真实迁移证据才会写入；自我报告的置信度上限更低。

用户说「这个我已经会了」：mastery 抬到下限 0.6、复习推迟 14 天，但 **confidence 被压到 ≤ 0.45** —— 尊重用户，同时不伪造确定性。

## 4. Scheduler（`src/scheduler`）

纯函数：`SchedulerSnapshot → ScoredCandidate[]`，同样的输入永远得到同样的排序。

```
score = 1.6·LearningValue + 1.8·Urgency + 1.2·GoalAlignment + 1.0·ContextFit
      + 1.5·DurationFit + 0.8·PreferenceFit + 0.4·Novelty
      − 1.0·RepetitionPenalty − 0.8·Friction
      (+10 当活动匹配用户明确表达的意图)
```

硬规则：

- **可行性门槛**：没有到期内容就不生成复习；没有 AI 就不生成对话/写作；V0.1 永远不生成听力和发音（没有素材与 STT/TTS，不做假功能）。
- **时长**：`available < minMinutes` 直接淘汰 —— 3 分钟绝不会被推 15 分钟的任务。
- **意图覆盖**：用户说「今天只想聊天」，+10 的意图权重让任何评分都无法把他拉回复习。
- **换批是确定性的**：今日计划的「换一批」把当前批次的真实 `subjectIds` 硬排除后重新评分；没有 subject 的活动按类型排除，不使用随机数，也不写长期偏好。
- **计划必须可执行**：推荐保存的 `subjectIds` 由服务端验证并优先用于 Session 选题，避免“计划说练 A、实际练 B”。

推荐结果附带 9 个因子分值和解释。首页把前三项包装为「今日计划」，展示总时长、任务列表、一键开始、换一批和今日休息；底层仍复用原有 scheduler。

词库池的新词相关性在独立的 `src/scheduler/relevance.ts` 计算，不修改活动 scheduler：

```
relevance = 6.0·主目标词库绑定 + 1.5·标签/场景匹配 + 1.0·技能缺口
          + 1.0·词频 + 0.5·近期图谱关联
```

主目标绑定权重大于其他项之和：候选充足时，绑定词库会稳定占据每日新词预算；无绑定/标签时退化为词频、创建时间和 ID 的稳定排序。每日预算默认 10、范围 0–50，以本地运行机器时区的自然日计数；提升在 SQLite 事务内同时写知识状态、SRS 初始状态、事件和操作日志。

## 5. AI 预算（AI Router，`src/agent/router.ts`）

优先级：确定性规则 → 本地算法 → 专用模型 → 小模型 → 通用 LLM。

**绝不调用 LLM 的路径**：LearnerState 计算、mastery、confidence、SRS、调度、词库相关性、去重、文件解析、推荐排序、事件处理、会话状态、知识查询、基础复习、判分、数据统计、目标解析、意图与命令识别。

**会调用 LLM 的路径**：自由对话、开放式语言解释、粘贴文本候选提炼。提炼输出必须通过结构化校验和原文片段核对，并由用户勾选/编辑/确认后才能入库；无 Key 时只保存原文。

用户输入先经过确定性 NLU（`src/nlu`）：命令（不要纠错 / 只想聊天 / 只有 N 分钟 / 保存这个 / 我已经会了 / 暂停 / 继续 …）在**本地毫秒级**完成并真正改变状态，不花一个 token，也不让用户多等。

发给模型的上下文被严格裁剪（`context-builder.ts`）：当前目标、相关技能、最近错误、相关知识、长期记忆、可用时间、当前意图、**最近 6 轮对话**。绝不发送整个数据库或全部聊天历史。

Provider 失败（超时 / 不可用 / 未配置）时：返回诚实的降级文案 + 可用替代入口（复习 / 知识库 / 历史），记录一条脱敏遥测，应用其他部分完全正常。

## 6. Agent 边界

Agent **不能** 碰数据库。它只能通过 `src/application/tools.ts` 暴露的工具：

```
getLearnerState  getGoals        getWeakSkills      getDueReviews
searchKnowledge  searchKnowledgeGraph               getUserContext
createSession    recordLearningEvent                submitAssessment
saveMemory       saveKnowledge   getLearningHistory getTransferEvidence
recordFeedback
```

每个工具用 zod 校验入参，越权或非法枚举直接抛错，永远不会把模型输出直接写进数据库。

## 7. 会话状态机（`src/domain/session-rules.ts`）

```
created ──▶ active ──▶ paused ──▶ active
   │           │          │
   └───────────┴──────────┴──▶ completed / abandoned（终态）
```

- 同状态重复提交是幂等的，不是错误。
- 退出**不是失败**：`abandoned` 与 `paused` 都可以在首页看到「继续上次学习」。
- 会话创建用 `clientToken` 幂等：双击不会产生两个会话。
- 作答用 `activity-answer:<activityId>` 幂等：刷新/重试不会重复计分。

一个 UI 细节被测试保护：当前题目通过 `?a=<activityId>` 固定在 URL 上，Server Action 触发的重新渲染不会把用户「弹」到下一题，用户**一定**能看到自己这题的反馈。

## 8. 知识是图，不是列表

- 唯一约束是 `(learner, language, type, normalizedText)` → `figure`（word）与 `figure out`（phrase）天然是两个条目。
- 关系：`related / derived_from / variant_of / contrasts_with / commonly_used_with / part_of / example_of`。
- 每条都保存来源：`origin`（authentic / user / ai_generated / system_generated）、`sourceType`、`sourceRef`、`aiGenerated` —— **AI 生成的内容不会伪装成真实语料**。

## 9. 存储

- SQLite（better-sqlite3 + Drizzle），WAL 模式，外键开启。
- 迁移由 `drizzle-kit` 从 `schema.ts` 生成，`scripts/migrate.ts` 按文件名顺序执行一次并记录在 `_migrations`，可重复执行、可在干净库上运行。
- 文件通过 `ObjectStorage` 端口访问，v0.2 唯一实现仍是 `LocalObjectStorage`（带路径穿越防护）；上传文件按 SHA-256 暂存并在确认时复核。**没有引入任何云存储 SDK**。

## 10. 语言可扩展性

领域层没有 `if (language === 'english')`。语言相关行为在 `src/language` 的 `LanguageCapability`（normalize / classify / tokenize / defaultSkills）后面。英语是完整实现，其他语言是通用回退——**不为未来语言过度工程**。
