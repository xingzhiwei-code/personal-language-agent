# Personal Language Learning Agent — 产品总规划（Master Plan）

> 版本：v1.0 ｜ 成稿日期：2026-10-02
> 地位：本仓库产品方向的最高文档。描述"我们最终要做什么、为什么这样设计"。
> 注意：本规划描述长期方向，但**未来阶段的开发任务不能仅凭本规划自动启动**——每个阶段都需要独立的 PRD 与里程碑文档（见 `PRODUCT-DOCS-GUIDE.md`）。
> 来源：2026-09 用户与 ChatGPT 共 21 轮产品定义讨论（设计 deliberation 全记录），提炼收敛而成。

---

## 1. 产品一句话定义

一个知道你是谁、记得你学过什么、在你有空时用最合适方式帮你学语言的个人 Agent。

它不是课程 App（没有"第 1 课"），不是背单词软件，不是聊天机器人，不是游戏化学习产品。

---

## 2. 产品愿景

**短期**：一个真正懂你的英语私教 Agent——记住你的目标、弱点和犯过的错，用碎片时间帮你把英语用起来。

**长期**：Personal Learning OS——以学习者模型为核心的个人学习操作系统。语言是第一站（English First），架构上为更多语言、乃至语言之外的学习领域预留空间。

---

## 3. 产品宪法（10 条，任何开发不得违反）

| # | 条款 | 一句话 |
|---|------|--------|
| 01 | UX First | 用户体验是最高宪法，任何降低体验的技术选型一票否决 |
| 02 | User Agency | 用户拥有对学习节奏、内容、方式和是否学习的最终决定权；推荐 ≠ 命令 |
| 03 | Learning Effectiveness | 目标是提升真实世界能力，不是制造 App 内的"学习感" |
| 04 | AI Economy | 能不用大模型就不用；所有 AI 调用按 Level 0–3 分级（规则 → 开源/小模型 → 大模型 → 多模型协作） |
| 05 | Never Sacrifice UX for Cost | 省 token / 算力永远不能以降低用户体验为代价；省钱不能让用户感知到 |
| 06 | Language Agnostic | 核心学习系统与具体语言解耦；English First，Japanese / Korean Second |
| 07 | Learner Model First | AI 模型可以更换，但 Learner Model、Knowledge、Memory、Learning Events 是核心资产，永不丢失 |
| 08 | User Model Is a Hypothesis | 用户画像不是事实而是假设：必须带 confidence / evidence / lastObservedAt，随时间衰减，允许用户纠正 |
| 09 | Real-world Transfer | 学习效果以离开 Agent 后的真实能力为准；Transfer 是核心指标 |
| 10 | Agent Serves the User | Agent 是助手，不是老师/老板/监工；当"不打扰"更符合用户利益时，选择不打扰 |

---

## 4. 产品北极星

```
Real-world Capability
        ↑
Transfer
        ↑
Stable Mastery
        ↑
Effective Practice
```

**反模式（绝不优化）**：`App Engagement ← Notification ← Streak`——用打开率、打卡天数衡量成功，是本产品明确拒绝的异化方向。

---

## 5. 目标用户

- **第一用户**：开发者本人（程序员，日常接触英文技术内容）。
- **画像**：时间碎片化、有真实英语使用场景（读文档、开会、面试）、反感说教和游戏化绑架。
- **产品哲学**：不要"学英语"，要"用英语做真实的事"——输入真实、输出有压力、反馈即时、场景真实。

---

## 6. 核心用户闭环

```
创建学习目标
    ↓
首页推荐（Scheduler 生成，可解释）
    ↓
开始学习活动（Session：短、可暂停、可退出、可恢复）
    ↓
用户作答 / 对话
    ↓
Assessment（评估，确定性）
    ↓
LearningEvent（记录，不可变）
    ↓
LearnerState 更新
    ↓
下一次推荐发生变化 ← ★ 闭环成立的关键验证点
```

---

## 7. 版本与阶段

### 7.1 版本规则（避免混淆，请严格使用）

- **V0**：产品验证阶段。目标是验证"用户是否愿意把碎片时间交给 Agent，个性化学习闭环是否有效"。包含 V0.1 及按验证结果决定的后续迭代（是否需要 V0.2 由真实使用证据决定，不预先承诺）。
- **V0.1**：V0 阶段内的第一个可运行版本。交付：目标创建 → 推荐 → 学习 → 评估 → 事件 → 状态更新的真实闭环。当前的 `prd.md` 明确属于这一版本。
- **V1**：核心价值验证通过后，扩展为成熟的个人语言学习体验（手机 App、语音、真实内容导入、多设备同步、日/韩 LanguagePack，各项能力分别评估、逐步推进）。
- **V2**：长期探索——语音优先、主动但克制的情境感知、可穿戴设备。仅当 V1 价值被验证后再规划。

### 7.2 V0 成功标准

真实用户连续使用 14 天，不需要每天自行规划学习，系统能利用历史证据调整学习活动。（14 天是验证目标，不是已证明结果；"打开 14 天"本身不算成功。）

### 7.3 阶段推进机制（门控）

```
V0.1 开发完成
    ↓ 落地检查：闭环是否真实跑通（非 mock、非手动改库）
V0 真实使用验证
    ↓ 观察：推荐是否有帮助、画像是否收敛、Transfer 是否有证据
决策点：继续迭代 V0，还是进入 V1
    ↓ 每个 V1 能力单独评估，不一次全上
V1 逐步推进 → V2 仅作方向探索
```

---

## 8. 长期架构

```
              USER
               │
         当前意图 / 当前状态
               ↓
        Context Engine
               ↓
        AGENT（Observe → Understand → Plan → Act → Assess → Remember）
               ↓
           AI ROUTER（Level 0 规则 / Level 1 开源·小模型 / Level 2 大模型 / Level 3 多模型协作）
               ↓
         LEARNING CORE（语言无关）
           ├── Learner Model（含 Mastery / Confidence / Failure Pattern / Transfer）
           ├── Knowledge Graph（含来源归属：真实内容 / 用户内容 / AI 生成必须标识）
           ├── Memory（短期 / 长期 / 关键事件）
           ├── Assessment（确定性，禁止 LLM）
           ├── Scheduler（确定性，Advisor 而非 Controller）
           └── Learning Events（不可变，唯一事实来源）
               ↓
         LANGUAGE LAYER（English / Japanese / Korean / …，LanguagePack 接口隔离）
```

**外围护栏**：UX Constitution、Token/Compute Economy、User Intent Priority、Zero-Friction Exit、Privacy、Source Attribution、AI Failure Recovery。

**交互形态**：大脑（Brain）/ 嘴巴耳朵（Interface）/ 皮肤（Skin）三层分离。V0 只做网页皮肤；加新皮肤时大脑代码零修改。

**存储策略**：V0 全本地（SQLite + 本地文件），`ObjectStorage` 接口预留，暂不上 COS/S3；学习数据默认不出设备，上云需用户明确同意，一键导出/删除。

---

## 9. 关键产品决策索引

"为什么这样设计"的 deliberation 记录在 `docs/decisions/`（ADR 格式），被否掉的选项同样保留：

| ADR | 决策 |
|-----|------|
| ADR-001 | 产品定位：私教 Agent，不做"更好的多邻国" |
| ADR-002 | 架构原则：复用开源生态，Agent 做编排 |
| ADR-003 | 交互形态：大脑/皮肤分离；V0 只做网页版 |
| ADR-004 | 存储：V0 全本地；ObjectStorage 接口预留，不上 COS |
| ADR-005 | AI 经济性：Level 0–3 分级；省 token 绝不牺牲 UX |
| ADR-006 | 多语言：LanguagePack 架构；English First |
| ADR-007 | V0 不做清单：游戏化、社交、黑盒发音打分 |

---

## 10. 给执行者的最高指令

1. 先读本规划建立全局观，再读当前版本 PRD 与里程碑执行当前任务。
2. 当前只实施当前版本（如 V0.1），不得提前实现 V1/V2 能力。
3. 先跑通纵向闭环（§6），再完善外围；每个 Milestone 必须交付真实可运行能力。
4. 宪法（§3）是红线；北极星（§4）是方向；DoD 见里程碑文档。
