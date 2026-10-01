# V0.1 验收记录

对照 `prd.md` §12「测试与验收场景」与 `development-milestones.md` 的 Definition of Done。
最后执行时间：2026-10-01。

## 命令与结果

```
npm run typecheck   → 通过（0 error）
npm run lint        → 通过（0 error, 0 warning）
npm test            → 97 passed (8 files)
npm run test:e2e    → 9 passed（连续两轮一致，无 flaky）
npm run build       → 通过
npm run db:migrate  → 在空目录上从零建库通过
```

路由冒烟（dev 模式，真实数据库）：`/`、`/knowledge`、`/history`、`/goals`、`/settings`、
`/chat`、`/api/export` 均 200；`/learn/<不存在>` 返回 404（走 `not-found` 边界）。

## PRD §12 场景对照

| # | 场景 | 状态 | 证据 |
|---|---|---|---|
| 1 | 新用户建目标：输入「我想提高英语口语」，创建目标 + 低置信度初始状态 | ✅ | `tests/e2e/core-loop.spec.ts:36`、`tests/integration/vertical-loop.test.ts`「creates a goal with low-confidence initial state」 |
| 2 | 三分钟学习：声明只有 3 分钟 → 活动时长匹配 | ✅ | E2E「我只有 3 分钟 → 推荐时长匹配」、`vertical-loop`「matches a declared 3-minute window」、`unit/scheduler`「never recommends an activity longer than the available time」 |
| 3 | 学习闭环：活动 → 评估 → 事件 → LearnerState → 后续推荐受影响 | ✅ | E2E「完成一次复习 → 看到反馈 → 学习状态更新 → 推荐变化」、`vertical-loop`「runs the whole loop and changes the next recommendation」 |
| 4 | 用户覆盖推荐：「今天只想聊天」不被调度器改道 | ✅ | `unit/scheduler`「lets an explicit "I just want to chat" intent win」、`integration/agent`「chat_only」路由 |
| 5 | 关闭与恢复：中途退出后首页提供恢复入口且状态正确 | ✅ | E2E「中断后可以从首页恢复」、`vertical-loop`「supports pause, resume and skip without losing progress」 |
| 6 | 纠错控制：关闭纠错后会话不再主动纠错 | ✅ | E2E「自由聊天：关闭纠错真的生效」、`integration/agent`「"don't correct my grammar" really changes the session, with zero LLM calls」 |
| 7 | 掌握反馈：「这个我已经会了」被记录且状态调整 | ✅ | `integration/agent`「records "I already know this"」、`knowledge-and-data`「lets the user mark an item as known or irrelevant」；UI：练习反馈区与知识详情页 |
| 7b | 用户纠正系统判分：「我其实答对了」 | ✅ | E2E「用户纠正系统」、`vertical-loop`「accepts "I was actually right"」「is idempotent」「records the correction as an auditable event」 |
| 7c | 「这条不相关」后不再安排复习 | ✅ | E2E「这条不相关：不再安排复习」、`knowledge-and-data`（`nextReviewAt` 置空） |
| 8 | AI 故障：友好反馈，历史/知识库/基础复习仍可用 | ✅ | E2E 全程在无 AI Key 下运行；`integration/agent`「degrades gracefully on provider failure」 |
| 9 | 重复请求不产生重复事件/会话 | ✅ | `vertical-loop`「never double counts a resubmitted answer」「never creates two sessions for the same client token」「completing twice is idempotent」 |
| 10 | 数据管理：导出可读、删除有确认 | ✅ | E2E「数据导出与删除」、`knowledge-and-data`「exports readable JSON」「requires the confirmation phrase」 |
| 11 | 架构边界：Domain 不导入 UI/DB/Provider/云 SDK | ✅ | `tests/architecture/boundaries.test.ts`（12 项） |
| 12 | 来源可追踪：AI 生成与真实来源可区分 | ✅ | `knowledge-and-data`「marks AI-generated entries distinctly」；UI 在列表/详情显示来源与「AI 生成」标记 |

## 里程碑对照

| 里程碑 | 交付 | 状态 |
|---|---|---|
| M0 仓库侦察 | `docs/repository-assessment.md`、基线与最小改造路径 | ✅ |
| M1 骨架与首页 | 可启动应用、导航、响应式、空/载入/错误状态 | ✅ |
| M2 持久化与领域基础 | SQLite + 可重复迁移 + Repository + ObjectStorage | ✅ |
| M3 目标创建 | 一句话建目标、去重、可查看/暂停/归档 | ✅ |
| M4 事件/评估/Learner Model | 确定性掌握度与置信度、模态证据、幂等 | ✅ |
| M5 知识库与复习 | 9 种类型、7 种关系、来源追踪、识别/回忆/产出复习 | ✅ |
| M6 Scheduler 与 Context | 9 因子评分、时长硬约束、意图覆盖、可解释理由 | ✅ |
| M7 Session Engine | 状态机、暂停/恢复/退出、摘要、幂等 | ✅ |
| M8 AI Router 与 Agent | 确定性优先路由、最小上下文、工具边界、超时与降级 | ✅ |
| M9 端到端闭环 | Playwright 覆盖核心场景 | ✅ |
| M10 数据与隐私 | 导出/删除、隐私说明、遥测脱敏、架构边界测试 | ✅ |
| M11 UX 打磨与发布 | 移动端布局、空/错/载入状态、README、已知限制 | ✅ |

## E2E 过程中发现并修复的真实缺陷

| 缺陷 | 影响 | 修复 |
|---|---|---|
| 提交答案后 Server Action 重新校验 `/learn/[id]`，页面直接跳到下一题 | 用户**看不到自己这一题的反馈**，等于白做 | 当前题目固定在 URL（`?a=<activityId>`），提交后不再 revalidate 学习页；由用户点「下一个」才推进 |
| 答完最后一题立刻自动完成会话 | 最后一题的反馈被总结页吞掉 | `submitActivityAnswer` 不再自动完成；由学习页在用户推进时幂等地完成会话 |

两者都由 E2E 断言「必须看到反馈」暴露出来，不是靠人工点击发现的，因此已被测试长期保护。

## 性能实测（本机 dev 模式）

| 目标 | 实测 | 说明 |
|---|---|---|
| 首屏 < 2s | 冷启动首次编译后 `GET /` 约 1.1–1.9s | 生产构建更快；dev 首次编译有额外开销 |
| 本地交互 < 100ms | 命令识别/判分/状态更新均为本地纯函数 | 97 项单元+集成测试总耗时 < 0.7s |
| 确定性推荐 < 500ms | `generateRecommendations` 在集成测试中单次 < 20ms | 本地 SQLite 查询 + 纯函数评分 |
| E2E 全链路 | 9 个场景 37s | 完全不依赖任何 AI Provider |

## 刻意未做（与 PRD §2.2 一致）

语音（STT/TTS）、听力与发音活动、内容导入（网页/PDF/YouTube）、云同步与 COS/S3/R2、
强化学习与 Bandit、多用户/教师后台、游戏化（连续打卡、金币、排行榜、惩罚）。
