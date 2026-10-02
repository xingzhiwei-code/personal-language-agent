# V0.2 验收记录

对照 `docs/prd/prd-v0.2.md` §6–§8 与项目 Definition of Done。最后执行时间：2026-10-02；运行环境：Node.js v20.17.0。

## 命令与结果

```text
node -v             → v20.17.0
npm run db:migrate  → 0001–0005 成功应用；旧库冲突夹具升级通过；再次执行 database is up to date
npm run verify      → typecheck 0 error；lint 0 error；155 tests passed（17 files）
npm run test:e2e    → 13 passed（Chromium，独立 SQLite，无 AI Key）
npm run build       → Next.js production build 通过
```

性能实测：10,000 条 TXT 在临时 SQLite 中完成解析、事务写入、历史与逐条操作日志约 5–7 秒（门槛 30 秒）；第 200 页读取 50 条低于 1 秒。具体机器性能会不同，测试持续保护 30 秒/1 秒上限。

## PRD v0.2 验收标准

| # | 验收项 | 状态 | 自动化证据 |
|---|---|---|---|
| 1 | 导入 4,000 词，数量正确、全部进池、不进 SRS | ✅ | `tests/integration/importer.test.ts` 提升为 10,000 条性能验收；`v02-data-model.test.ts` 验证池隔离 |
| 2 | 同一文件二次导入 0 新增，历史可见重复 | ✅ | `importer.test.ts` 文件 hash 幂等；E2E「文件导入」 |
| 3 | 约 2,000 字文本提炼 ≥10 条，取消 2 条后只入库 8 条 | ✅ | `tests/integration/paste-import.test.ts`「extracts 10 candidates…imports only 8」 |
| 4 | 无 Key 时原文可保存且不报错 | ✅ | `paste-import.test.ts` 无 Key 降级；E2E「无 Key 文本导入」 |
| 5 | JSON 导出后导入空库，条目内容一致 | ✅ | `tests/integration/knowledge-export.test.ts` round-trip |
| 6 | 手动删除、修改都有包含前后差异的操作日志 | ✅ | `tests/integration/audit.test.ts` |
| 7 | 主目标绑定词库候选充足时，新词 ≥80% 来自该词库，reason 可解释 | ✅ | `pool-and-daily-plan.test.ts` 并发预算测试；`unit/relevance.test.ts` 主目标绑定权重大于其他项之和 |
| 8 | 无目标绑定/无标签时仍有确定性 fallback | ✅ | `tests/unit/relevance.test.ts` 词频 + 创建时间 + ID 稳定排序 |
| 9 | 每日预算连续 3 天各不超上限，复习不占预算 | ✅ | `pool-and-daily-plan.test.ts` 连续 UTC 自然日测试；预算仅统计 automatic promotion event |
| 10 | 手动加入学习立即生效且不受预算限制 | ✅ | `pool-and-daily-plan.test.ts` budget=0 后手动提升；Pool UI E2E |
| 11 | 主目标切换后计划刷新且只存在一个 primary | ✅ | `goals-and-scenarios.test.ts`；E2E「多目标主次切换」 |
| 12 | AI 生成条目统一带 `ai_generated=true` 与来源 | ✅ | `paste-import.test.ts` 来源、source span、AI 标识断言 |
| 13 | 场景到期自动归档并停止作为活跃场景 | ✅ | `goals-and-scenarios.test.ts` 自动归档、事件和日志幂等 |

## 里程碑交付

| 里程碑 | 交付 | 状态 |
|---|---|---|
| M1 | v0.2 数据模型、迁移、池/SRS 隔离、历史/日志/场景/预算端口 | ✅ |
| M2 | CSV/JSON/TXT 上传、前 20 条预览、目标绑定、事务导入、文件 hash 幂等、手写 sample | ✅ |
| M3 | 导入导出历史页、全操作日志页、类型筛选、手动增改删审计 | ✅ |
| M4 | 文本/字幕保存、结构化 LLM 提炼、原文核对、强制人工确认、场景标签、无 Key 降级 | ✅ |
| M5 | 全量/当前筛选 JSON 与 CSV 导出、round-trip、空库导入引导、v0.1 唯一目标迁移 | ✅ |
| M6 | 多目标唯一主攻、词库绑定、场景树 CRUD/期限/归档、覆盖率与准备度 | ✅ |
| M7 | 今日计划、一键开始、确定性换批、今日休息、独立相关性评分、每日预算、池分页与批量流转 | ✅ |

## 架构核验

- Scheduler 原有活动候选与评分未重写；新增 `src/scheduler/relevance.ts`，五因子权重集中配置。
- 去重、文件解析、相关性、预算与调度全部为确定性规则，不调用 LLM。
- LLM 仅参与文本候选提炼；输出经 Zod 结构校验和 `source_span` 原文核对，确认前知识库新增为 0。
- 文件导入通过 SQLite 单事务写入词库、知识条目、历史和操作日志；池提升通过事务同时写状态、SRS、事件与日志。
- `LearningEvent` 继续只表达学习/系统事实；`knowledge_operation_log` 只做数据管理审计。
- 推荐持久化的 `subjectIds` 经服务端归属和状态校验后优先用于 Session 选题，计划与实际任务一致。
- 架构边界测试继续通过；无云 SDK、无付费基础设施、无 V1 视频/网页/PDF pipeline。

## 真实浏览器覆盖

13 个 Playwright 场景全部通过，包括 v0.1 学习闭环回归，以及：

- 文件导入、预览、确认、词库池和同文件幂等；
- 历史、操作日志、JSON/CSV 下载；
- 无 Key 文本保存降级；
- 多目标主次切换、词库目标绑定、大/小场景创建；
- 每日预算设置、今日计划、换一批、今日休息持久化、恢复计划、池中手动加入学习、一键开始。

## 已知边界

- 每日预算和今日休息按本地运行机器的系统时区计算自然日；本地优先单用户部署下与用户时区一致。
- 一键开始从今日计划第一项进入现有 Session；完成后首页基于最新学习事件重新生成后续计划，不新增 V1 范围外的 plan-group 模型。
- 场景只由用户手动创建；文本提炼的 `scenario_hint` 只有与用户已有活跃场景同名时才绑定，不会偷偷新建场景。
- 单用户、本地 SQLite、无云同步；网页/PDF/视频/播客导入仍在 V1 范围外。
