# Spike：存储层端口抽象确认（大脑层跨端复用验证）

- 日期：2026-10-17
- 范围：`src/` 全仓库（`scripts/` 仅备注）
- 方法：grep 静态扫描 + 逐条归属判定（只确认，不重构）
- 结论：**是——大脑层（domain/application）零直连，端口覆盖完整，无旁路**

## 1. 判定标准

- `src/infrastructure/` 内出现 `better-sqlite3` / `node:` / `drizzle-orm` 导入 = **允许**（驱动实现所在地）。
- `src/domain/`、`src/application/` 内出现上述任何导入 = **违规**。
- 目标：书面确认「所有数据访问都经过 `src/domain/ports.ts` 的 repository 端口」，并核实 `src/infrastructure/repositories/sqlite.ts` 是否为唯一需换驱动的文件。

## 2. 全仓库 `better-sqlite3` / `node:` 导入清单（逐条判定归属）

`src/` 内共 6 处：

| 文件 | 导入 | 用途 | 判定 |
| --- | --- | --- | --- |
| `src/infrastructure/db/client.ts` | `better-sqlite3`、`node:fs`、`node:path` | DB 连接（drizzle-orm/better-sqlite3） | ✅ infrastructure，允许 |
| `src/infrastructure/system/clock.ts` | `node:crypto`（randomUUID） | ID 生成器 | ✅ infrastructure，允许 |
| `src/infrastructure/storage/local-object-storage.ts` | `node:fs/promises`、`node:path` | 对象存储（本地磁盘实现） | ✅ infrastructure，允许 |
| `src/data/wordnet.ts` | `node:crypto`（createHash） | WordNet 关系 ID 的 sha256（纯函数，运行时 scheduler 不 import） | ✅ 非数据访问、非大脑运行时 |
| `src/app/actions/import.ts` | `node:crypto`（createHash） | 导入文件指纹幂等（file hash） | ✅ skin/服务端，非数据访问旁路 |
| `src/app/samples/sample-wordlist.csv/route.ts` | `node:fs/promises`、`node:path` | 返回静态示例 CSV | ✅ skin/路由，非数据访问 |

备注：`scripts/dev.mjs`、`scripts/import-word-relations.ts`、`scripts/build-wordnet-relations.ts` 也含 `node:` 导入，均属离线脚本（开发/数据构建），非运行时大脑，不计入违规。

## 3. domain / application 直连检查

| 目录 | `better-sqlite3` / `node:` / `drizzle-orm` / `getDb` / infrastructure 导入 | 判定 |
| --- | --- | --- |
| `src/domain/` | 0 处 | ✅ 通过 |
| `src/application/` | 0 处 | ✅ 通过 |
| `src/agent/`（编排，大脑一部分） | 0 处 | ✅ 通过 |

补充：全文扫描中 domain/application/agent 命中的 `SQLite` / `database` / `process.` 字样均为**注释或 `process.env` 读配置**（后者在 `src/infrastructure/` 内），无任何数据访问旁路。例证：

- `src/application/scenarios.ts:162` —— 注释「SQLite returns by id index」
- `src/agent/context-builder.ts:29` —— 注释「whole database」
- `src/application/tools.ts:33` —— 注释「agent NEVER touches the database」

## 4. repository 端口覆盖核对

`src/domain/ports.ts` 定义 `Repositories` 接口，数据访问端口清单（26 个 repository 字段 + 1 个聚合方法）：

`users`、`goals`、`targets`、`knowledge`、`relations`、`states`、`events`、`assessments`、`sessions`、`sessionStarts`、`activities`、`chat`、`memories`、`preferences`、`contexts`、`recommendations`、`transfer`、`content`、`wordlists`、`importExportHistory`、`operationLog`、`scenarios`、`fileImports`、`knowledgePool`、`dataExport`、`placements`、`goalPhases`、`wordRelations`、`deleteAllForLearner`。

另含非数据端口：`Clock`、`IdGenerator`、`ObjectStorage`、`LLMProvider`、`SttProvider`、`TtsProvider`、`EmbeddingProvider`、`TelemetrySink`。

核对结果：

- 数据访问**唯一实现文件**：`src/infrastructure/repositories/sqlite.ts` 的 `createSqliteRepositories(db): Repositories`，是 `Repositories` 端口的唯一实现；返回类型由 TypeScript 强约束（缺任一字段无法编译，`npm run typecheck` 通过即完整）。
- 组合根 `src/infrastructure/container.ts` 是唯一把具体基础设施绑定到端口的位置（`repos: createSqliteRepositories(db)`）。
- **无旁路**：domain/application 不 import 任何 infrastructure，只能通过注入的 `Repositories` 端口访问数据。

## 5. 驱动替换点结论

`src/infrastructure/repositories/sqlite.ts` 是 repository 端口的**唯一实现文件（端口集中点）**，但严格说「换驱动」不是只改这一个文件——SQLite 特有耦合还分布在：

| 文件 | 需改动内容 |
| --- | --- |
| `src/infrastructure/repositories/sqlite.ts` | 全部 `drizzle-orm` SQLite 方言查询（`onConflictDoUpdate`、`like`、`inArray` 等） |
| `src/infrastructure/db/client.ts` | `better-sqlite3` 连接 + `drizzle-orm/better-sqlite3` 方言 |
| `src/infrastructure/db/schema.ts` | `drizzle-orm/sqlite-core` schema |
| `src/infrastructure/db/mappers.ts` | 行 ↔ 实体映射（依赖目标库类型，可能需微调） |
| `src/infrastructure/container.ts` | 组合根一行绑定（`createSqliteRepositories` → 新实现） |

即换驱动的改动面 = `src/infrastructure/db/`（3 文件）+ `src/infrastructure/repositories/sqlite.ts` + `container.ts` 一行绑定。**全部位于 `src/infrastructure/` 内，domain/application 零改动。**

因此：大脑层（`src/domain/`、`src/application/`、`src/agent/`）确认为纯 TS、可跨端复用；存储层端口抽象成立，换驱动（如小程序本地存储 / 远端数据库）只需替换 infrastructure 内上述文件。

## 6. 违规清单

无。
