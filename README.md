# Personal Language Learning Agent — V0.1

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
- 首页推荐与调度（完全不调用 LLM）
- 学习历史、数据导出与删除
- 会话内命令：「不要纠正我的语法」「我只有 3 分钟」「把这个保存起来」等

只有**自由对话**和**复杂语言解释**需要 LLM；不可用时会明确告知并给出可用替代，不会整体崩溃。

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
- 只有在你使用对话/解释时，才会把**当前目标、相关技能、最近错误、相关知识、最近几轮对话**发送给你配置的服务商——**不会**发送整个数据库或全部聊天历史。
- 设置页可以导出全部数据（可读 JSON）或删除本地数据（需输入确认短语）。
- 日志不记录 API Key；遥测只保留延迟、失败次数、Token 计数等诊断信息。

## 7. V0.1 已知限制

- **单用户**：本地一个 learner，没有登录与多租户。
- **没有语音**：不含 STT/TTS，因此不提供听力和发音活动（不会用假内容冒充）。
- **没有内容导入**：网页/PDF/YouTube/播客导入属于后续里程碑。
- **写作/对话需要 AI**：没有 Key 时首页不会推荐它们。
- **语言支持**：英语是唯一完整实现；日/韩/法/德/西目前只有通用回退（存储与复习可用，但没有语言特有分析）。
- **没有云同步**：`ObjectStorage` 端口已预留，V0.1 只有 `LocalObjectStorage`。
- **没有游戏化**：没有连续打卡、金币、排行榜、惩罚——这是有意的产品选择。

## 8. 常见问题

**`npm install` 报 EACCES / 缓存权限错误**
本仓库的 `.npmrc` 已将 npm 缓存指向项目内 `./.npm-cache`，无需 `sudo`。

**`better-sqlite3` 安装失败**
确认 Node 版本 ≥ 20.9；必要时安装 Xcode Command Line Tools（`xcode-select --install`）后重试。

**首页一直显示「还没有可以安排的练习」**
说明知识库还是空的。去「知识库 → 添加知识条目」加几条你最近遇到的表达，或直接开始一次对话。

**改了数据库 schema 之后**
`npm run db:generate` 生成新的迁移文件，下次启动会自动应用（也可以 `npm run db:migrate` 立即应用）。
迁移按文件名顺序执行且只执行一次。

**想从头开始**
删除 `./data` 目录，或在设置页使用「删除本地学习数据」。
