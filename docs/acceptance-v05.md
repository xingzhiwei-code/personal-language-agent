# V0.5 验收记录

对照 `docs/prd/prd-v0.5.md` §7 与项目 Definition of Done。最后执行时间：2026-10-17；运行环境：Node.js v20.17.0。

## 命令与结果

```text
node -v                    → v20.17.0
npm run import:word-relations → 107305 行（topic 100 + wordnet 107205），幂等重跑 total 不变
npm run verify             → typecheck 0 error；lint 0 error；221 tests passed（33 files）
npm run test:e2e           → 13 passed（Chromium，独立 SQLite，无 AI Key）
```

## 数据规模（W1）

| 指标 | 数值 |
|---|---|
| 锚点词（CET6 + IELTS 去重） | 7405 |
| 已学词补充锚点 | 2 |
| WordNet 3.1 synsets 解析 | 107074 |
| 锚点词命中 WordNet | 6635（89.6%） |
| 关系边（wordnet） | 107205 = synonym 39447 + antonym 4718 + word_family 63040 |
| 关系边（topic） | 100（沿用 v0.4 精选话题词表） |
| 表总行数 | 107305 |

License：Princeton WordNet License（允许免费使用/修改/分发，需保留版权声明），`scripts/data/wordnet-LICENSE.txt` 已保留。

## PRD v0.5 §7 验收标准

| # | 验收项 | 状态 | 自动化证据 |
|---|---|---|---|
| 1 | 导入脚本幂等：重跑行数不变 | ✅ | `tests/integration/wordnet-import.test.ts`「re-running does not double」；实测重跑 total 恒为 107305 |
| 2 | 锚点过滤：非锚点词无边 | ✅ | `tests/unit/wordnet.test.ts`「non-anchor has no edges」；`tests/integration/wordnet-import.test.ts`「never imports non-anchor」 |
| 3 | 主题词命中率：全量后 fallback 显著下降（目标 ≥50%） | ⚠️ 见下方诚实缺口 | 实测前后均为 16% |
| 4 | PR 贴锚点词数 / 关系边数 / license | ✅ | 上表 |
| 5 | W2 搭配（spike 通过才做） | ✅ 降级 | ADR-012：无 license 清晰的通用搭配词表 → 跳过 |
| 6 | W2 降级：无搭配逻辑残留 | ✅ | `wordRelationType` 未新增 `collocation`，无搭配代码 |
| 7 | W3 触发轻提示 + 三选一 / 不点不生效 | ✅ | `tests/integration/auto-calibration.test.ts`「reading never writes」「apply writes」 |
| 8 | 单次校准变化 ≤1.0 band | ✅ | `tests/unit/auto-calibration.test.ts`「caps a single step at ±1.0」 |
| 9 | 手动覆盖后自动校准暂停 | ✅ | `tests/integration/auto-calibration.test.ts`「manual override pauses」 |
| 10 | 校准历史时间线只读 + basedOn | ✅ | 目标页只读时间线；basedOn 由集中窗口确定性生成 |
| 11 | `npm run verify` 全过 + Playwright 回归 | ✅ | 221 tests + 13 e2e 全过 |

## 诚实缺口：主题词命中率未下降（验收 #3）

实测「主题词命中率」前后不变（约 16%），未达成 PRD 的「下降 ≥50%」预期，原因如下，据实说明、不编造：

- 主题词（topic 关系）来自 `scripts/data/ielts-topics.json`，是 v0.4 的精选话题词表（10 话题 × 10 词 = 100 词）。
- 全量 WordNet 导入（W1）只增加 `synonym / antonym / word_family` 关系，**不改变 topic 关系**；scheduler 的主题聚类只读 `relationType='topic'`（`getTopicLemmas` → `listByTopic`），与 wordnet 关系无关。
- 词库池（new 状态 970 词）中命中 100 个话题词的仅 16 个（16%），因此 fallback 率约 84%，全量导入前后一致。

要让「主题词命中率」真正下降，需要**扩展话题词表**（给锚点词批量打话题标签，覆盖 CET6/IELTS 词），而 PRD/任务书未提供该数据源，且无 license 清晰的公开话题词表（与 W2 搭配同类情况）。此项建议由 yiyi 决策：要么提供更大的话题词表，要么将验收 #3 调整为「关系边标签覆盖率提升」这类与 W1 实际交付一致的指标。

## 里程碑交付

| 里程碑 | 交付 | 状态 |
|---|---|---|
| M0 | 双 spike：WordNet license 通过、搭配降级（ADR-012） | ✅ |
| M1 | W1 全量 WordNet：锚点过滤导入 + 幂等/断点/校验 + 测试 | ✅ |
| M2 | W2 搭配：spike 不通过，降级跳过，无残留 | ✅ |
| M3 | W3 起点自动校准：`placements.auto_calibration` + 开关 + 时间线 + 轻提示 | ✅ |
| M4 | 全量验收（§7 十一项）+ 回归 | ✅（#3 诚实缺口见上） |
