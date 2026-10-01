# M0 — Repository Assessment（仓库侦察报告）

- 执行时间：2026-09-29
- 依据文档：`prd.md`（v1.1）、`development-milestones.md`（v1.1）

## 1. 仓库现状

| 项目 | 结果 |
|---|---|
| Git 状态 | 分支 `master`，**0 commit**，仅 2 个未跟踪文件 |
| 文件清单 | `prd.md`、`development-milestones.md` |
| `package.json` | 不存在 |
| 包管理器 | 无 lockfile；环境无 `pnpm` / `yarn`，仅 `npm 10.8.2` |
| 技术栈 | 无 |
| UI | 无 |
| 数据库 | 无 |
| API | 无 |
| 测试 | 无 |
| CI | 无 |
| 环境变量 | 无 `.env*` |
| AI Provider | 无 |
| 运行时 | Node `v20.17.0`，`cc/gcc` 可用（可编译 native 模块） |

结论：**这是一个纯文档仓库，不存在可复用代码**。因此 M0 的“复用评估”结论为：无既有实现可复用；全部能力需新增；不存在“为了架构漂亮而重写”的风险。

## 2. 基线（Baseline）

无法运行应用、无测试可跑——因为不存在任何源码。基线记录为：

```
git log        -> fatal: current branch 'master' does not have any commits yet
npm test       -> 无 package.json
```

这是 M0 的明确阻塞项，解决方式即 M1：建立可启动骨架。

## 3. 关键技术决策（已自行决定，无需产品决策）

| 决策 | 选择 | 原因 |
|---|---|---|
| 包管理器 | **npm** | PRD 推荐 pnpm，但本机无 pnpm。npm 已存在、可靠、零安装成本。PRD 允许“评估后决定”。切换到 pnpm 仅需删除 lockfile，无代码耦合。 |
| 仓库形态 | **单应用 + `src/` 内分层**（非 monorepo packages/） | PRD §10.2 明确“不要为了套用建议目录创建空包”。分层边界由**架构边界测试**强制，而不是由 workspace 强制。未来有真实拆包价值时再拆。 |
| 框架 | Next.js (App Router) + React + TypeScript | PRD §10.1 推荐栈 |
| 数据库 | SQLite via `better-sqlite3` + Drizzle ORM + drizzle-kit 迁移 | PRD §9.2 |
| 校验 | Zod | PRD §10.1 |
| 测试 | Vitest（unit/integration）+ Playwright（E2E） | PRD §10.1 |
| 样式 | Tailwind CSS v4 | 快速产出高质量 UI，无运行时依赖 |
| LLM 接入 | **无 SDK**，`fetch` 调用 OpenAI 兼容 endpoint | 避免 Domain/基础设施引入厂商 SDK；Provider 可替换；Key 仅来自环境变量 |
| ID | `crypto.randomUUID()` | 无需额外依赖 |

## 4. 目标架构与依赖方向

```
src/domain        纯 TypeScript（+zod）：实体、值对象、端口(ports)、不可变规则
src/learner       确定性 Learner Model（mastery / confidence / SRS）——纯函数
src/scheduler     确定性推荐评分——纯函数
src/agent         Agent 编排：意图 + 工具调用（只能调用 Application Service）
src/application   应用服务 / Agent Tools（唯一允许触达 Repository 的编排层）
src/infrastructure Drizzle schema、Repository 实现、LocalObjectStorage、AI Provider
src/app, src/components  Next.js UI（Server Actions / Route Handlers）
```

依赖方向：`Domain → Application → Infrastructure → UI`。

强制手段：`tests/architecture/boundaries.test.ts` 静态扫描 import，禁止：
- `src/domain`、`src/learner`、`src/scheduler` 导入 react/next/drizzle/better-sqlite3/node:fs/任何 AI SDK；
- `src/agent` 导入 `src/infrastructure` 或数据库；
- Learner/Scheduler/事件处理代码出现 LLM 调用。

## 5. PRD 与仓库的冲突

无冲突（仓库为空）。与 PRD 的**偏差**仅一处，已按“最小修改”原则处理并记录：

1. **包管理器 pnpm → npm**（原因见上）。
2. **`packages/*` monorepo → 单应用 `src/*` 分层**（PRD §10.2 本身允许）。

两者都不改变产品行为与架构边界。

## 6. 最小改造路径

1. M1 骨架 + 真实首页（空状态，不伪造数据）
2. M2 SQLite + 迁移 + Repository + ObjectStorage
3. M3 目标创建（自然语言输入，规则解析优先，不强制 LLM）
4. M4 Assessment → Event → LearnerState（确定性）
5. M5 Knowledge Graph + 确定性复习
6. M6 Scheduler + Context + 意图覆盖
7. M7 Session 状态机 + 恢复
8. M8 AI Router + Agent Tools + 降级
9. M9 E2E 闭环
10. M10 导出/删除/隐私/边界测试
11. M11 UX 打磨与发布准备

## 7. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `better-sqlite3` native 构建失败 | 阻塞 M2 | Node 20 有 prebuild；本机有 `cc` 可回退源码编译 |
| 无 AI Key 时功能不可用 | 影响 M8 | Provider 未配置时降级为确定性路径，核心闭环（复习/知识/历史/状态）完全不依赖 LLM |
| E2E 与本地 SQLite 状态污染 | 测试不稳定 | E2E 使用独立 `LLA_DB_PATH` 临时数据库 |
