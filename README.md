# Personal Language Learning Agent — V0.2

一个会适应你的个人语言学习系统：它记住你的目标、能力、知识、常见错误和当前处境，并用尽可能少的操作成本，帮你完成此刻最有价值的学习。

**不是**固定课程 App，**也不是**只会聊天的英语机器人。

- 产品需求：[`prd.md`](./prd.md)
- 开发里程碑：[`development-milestones.md`](./development-milestones.md)
- 仓库侦察报告：[`docs/repository-assessment.md`](./docs/repository-assessment.md)
- 架构说明：[`docs/architecture.md`](./docs/architecture.md)

---

## 1. 前置条件

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 20.9 | 已在 v20.17 验证 |
| npm | ≥ 10 | 仓库使用 npm（无 pnpm 时的可靠选择） |
| 编译工具链 | 可选 | `better-sqlite3` 优先使用预编译包；没有时需要 `cc/gcc` |

不需要数据库服务、不需要云账号、**不需要 AI Key 也能使用核心功能**。

## 2. 安装与启动

```bash
npm install   # 安装依赖（本仓库使用项目内 .npm-cache，避免全局缓存权限问题）
npm run dev   # http://localhost:3000
```

**不需要手动建库**：首次连接数据库时会自动按顺序执行 `drizzle/*.sql`，并记录在 `_migrations` 表中。
想显式执行（例如部署前）可以运行：

```bash
npm run db:migrate   # 幂等；已应用过的迁移会跳过
```

首次打开会引导你用一句话创建学习目标，例如「我想提高英语口语」。

### 导入词库

进入「知识库 → 导入词库」，可上传 UTF-8 编码的 CSV、JSON 或每行一词的 TXT 文件。系统会先展示前 20 条、总数和预计去重结果，只有确认后才事务性写入；重复上传同一文件不会新增数据。单次上限为 20,000 条、10 MB，导入内容先进入词库池，不会直接进入复习队列。

也可切换到「文本提炼」，粘贴不超过 8,000 字符的文本或字幕。配置 AI 后会返回结构化候选表达，必须由用户勾选、编辑并确认后才入库；未配置或 AI 暂不可用时仍会把原文保存到本机，可从「已保存原文」再次查看并手动摘录，不会报错或自动写入候选表达。

知识库页可将全部或当前搜索/状态/词库/标签筛选结果导出为 JSON（条目全字段）或 CSV（`word, definition, example, status, mastery`）。每次导入、导出及知识条目变更都可在「导入导出历史」和「操作日志」中追溯。

导入条目先进入词库池。可单条或每页批量加入学习；首页也会按设置中的每日新词预算（默认 10，范围 0–50）自动选择。选择使用确定性相关性规则，主目标绑定词库优先，并显示可解释原因。首页「今日计划」支持一键开始、确定性换一批和今日休息。

目标页支持多个目标、唯一主攻目标、词库绑定，以及用户手动声明的大/小场景。场景到期会自动归档；系统不会从对话中偷偷创建场景。

仓库仅提供手写示例：`data/samples/sample-wordlist.csv` 和 `data/samples/sample-wordlist.json`。如需大规模英语词典数据，可自行下载并确认遵守 [ECDICT](https://github.com/skywind3000/ECDICT) 等开源词源的许可证；仓库不内置第三方词库。

生产构建：

```bash
npm run build
npm start
```

## 3. 配置（全部可选）

复制 `.env.example` 为 `.env.local`：

```bash
cp .env.example .env.local
```

| 变量 | 默认 | 作用 |
|---|---|---|
| `LLA_DB_PATH` | `./data/app.db` | SQLite 文件位置 |
| `LLA_STORAGE_DIR` | `./data/objects` | 本地对象存储目录（导出文件等） |
| `LLA_LLM_BASE_URL` | 空 | 任意 **OpenAI 兼容** 的 `/chat/completions` 端点 |
| `LLA_LLM_API_KEY` | 空 | 留空即运行在「无 AI 模式」 |
| `LLA_LLM_MODEL` | `gpt-4o-mini` | 模型名 |
| `LLA_LLM_TIMEOUT_MS` | `20000` | 单次请求超时 |

**密钥只从环境变量读取**，不会写进代码、数据库或日志。

### 没有 AI Key 时仍然可用

- 创建/管理目标（自然语言解析是本地规则）
- 知识库：增删改查、关系图、来源追踪
- 确定性复习（识别 / 回忆 / 产出）与判分
- 学习事件、评估、Learner Model 更新
- 今日计划、词库池相关性排序与每日新词预算（完全不调用 LLM）
- 学习历史、数据导出与删除
- 会话内命令：「不要纠正我的语法」「我只有 3 分钟」「把这个保存起来」等

只有**自由对话**、**复杂语言解释**和**粘贴文本提炼**需要 LLM；不可用时会明确告知并保留核心能力，粘贴原文仍会保存到本机。

## 4. 测试

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest：单元 + 集成 + 架构边界
npm run test:e2e     # playwright（会自行启动 dev server，使用独立的 .e2e-data 数据库）
npm run verify       # typecheck + lint + 单元/集成测试
```

E2E 首次运行需要浏览器：`npx playwright install chromium`。

测试分层：

- `tests/unit` — Learner Model（掌握度/置信度/SRS）、调度评分、判分、复习生成、NLU、会话状态机
- `tests/integration` — 目标→推荐→会话→评估→事件→状态→推荐变化的真实闭环、幂等、Agent 路由与降级、知识图谱、导出/删除
- `tests/architecture` — 依赖方向与「不许调用 LLM」的静态约束
- `tests/e2e` — 真实浏览器中的 PRD 验收场景

## 5. 项目结构

```
src/
  domain/          纯领域：实体、枚举、端口(ports)、会话状态机、错误
  learner/         Learner Model：mastery / confidence / SRS / 错误模式（纯函数）
  scheduler/       确定性推荐：候选生成 + 评分 + 意图覆盖（纯函数）
  assessment/      判分与复习题生成（纯函数，无 LLM）
  nlu/             确定性自然语言理解：意图、命令、时长、目标解析
  language/        语言能力层（English 完整实现，其他语言为通用回退）
  application/     应用服务：目标、知识、会话、评估、推荐、记忆、数据管理、Agent 工具
  agent/           AI Router + 上下文构建 + 对话编排（只能调用 application 服务）
  infrastructure/  Drizzle/SQLite、Repository 实现、本地对象存储、LLM Provider、遥测
  app/             Next.js App Router 页面 + Server Actions
  components/      UI 组件
  server/          服务端胶水（错误映射、上下文获取）
drizzle/           迁移 SQL（由 drizzle-kit 从 schema 生成）
scripts/migrate.ts 迁移执行器（可重复执行）
```

依赖方向：`Domain ← Application ← Infrastructure ← UI`，由 `tests/architecture/boundaries.test.ts` 强制。

## 6. 数据与隐私

- 全部学习数据保存在本机 SQLite 文件（默认 `./data/app.db`）。
- 使用对话/解释时，会发送裁剪后的当前目标、相关技能、最近错误、相关知识和最近几轮对话；使用文本提炼时，会发送你本次主动粘贴的文本。**不会**发送整个数据库或全部聊天历史。
- 设置页可以导出全部数据（可读 JSON）或删除本地数据（需输入确认短语）。
- 日志不记录 API Key；遥测只保留延迟、失败次数、Token 计数等诊断信息。

## 7. V0.2 已知限制

- **单用户**：本地一个 learner，没有登录与多租户。
- **没有语音**：不含 STT/TTS，因此不提供听力和发音活动（不会用假内容冒充）。
- **外部内容范围有限**：当前支持本地 CSV/JSON/TXT 词库导入；网页/PDF/YouTube/播客导入不在 v0.2 范围内。
- **写作/对话需要 AI**：没有 Key 时首页不会推荐它们。
- **语言支持**：英语是唯一完整实现；日/韩/法/德/西目前只有通用回退（存储与复习可用，但没有语言特有分析）。
- **没有云同步**：`ObjectStorage` 端口已预留，v0.2 仍只使用 `LocalObjectStorage`。
- **没有游戏化**：没有连续打卡、金币、排行榜、惩罚——这是有意的产品选择。

## 8. 常见问题

**`npm install` 报 EACCES / 缓存权限错误**
本仓库的 `.npmrc` 已将 npm 缓存指向项目内 `./.npm-cache`，无需 `sudo`。

**`better-sqlite3` 安装失败**
确认 Node 版本 ≥ 20.9；必要时安装 Xcode Command Line Tools（`xcode-select --install`）后重试。

**首页一直显示「还没有可以安排的练习」**
说明知识库和词库池都没有可学习内容。去「知识库 → 导入词库」上传 CSV/JSON/TXT，或粘贴真实文本；也可以手动添加表达。

**改了数据库 schema 之后**
`npm run db:generate` 生成新的迁移文件，下次启动会自动应用（也可以 `npm run db:migrate` 立即应用）。
迁移按文件名顺序执行且只执行一次。

**想从头开始**
删除 `./data` 目录，或在设置页使用「删除本地学习数据」。
