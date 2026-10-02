# 产品文档管理规则（PRODUCT-DOCS-GUIDE）

> 目的：明确本仓库四层产品文档各自的职责，防止文档之间相互冲突、防止执行者（Claude Code 等）因看到长期规划而提前过度开发。

---

## 1. 四层文档分工

| 文档 | 回答的问题 | 读者 | 更新频率 |
|------|-----------|------|---------|
| `product/product-master-plan.md` | 我们最终要做什么、为什么这样设计 | 所有人（含新加入的开发者/Agent） | 低：方向变化时才改 |
| `product/prd-vX.Y.md`（当前为根目录 `prd.md`，即 v0.1） | 当前版本具体做什么功能 | 执行开发的 Agent | 中：每版本一份，不修改已发布版本 |
| `product/milestones-vX.md`（当前为根目录 `development-milestones.md`） | 按什么顺序做、每个阶段的验收标准 | 执行开发的 Agent | 中：随开发进展更新进度 |
| `product/validation-plan-v0.md`（待建） | 当前阶段如何验证价值 | 决策者 | 每阶段一份 |

**一句话**：master-plan 管方向，PRD 管做什么，里程碑管怎么做，验证计划管"怎么算成"。

---

## 2. 仓库文档布局（建议）

```
personal-language-agent/
├── README.md                        # 项目入口：是什么、怎么跑
├── prd.md                           # 当前版本 PRD（v0.1；未来版本改名为 prd-vX.Y.md 归档）
├── development-milestones.md        # 当前版本里程碑（未来版本改名为 milestones-vX.md 归档）
├── product/
│   ├── product-master-plan.md       # 全产品规划（本仓库产品方向最高文档）
│   ├── PRODUCT-DOCS-GUIDE.md        # 本文件
│   ├── validation-plan-v0.md        # V0 验证计划（V0.1 落地后建立）
│   └── decisions/  →  ../docs/decisions/  # 也可以放在 docs/decisions，见第 5 节
├── docs/
│   ├── architecture.md
│   ├── acceptance.md
│   ├── repository-assessment.md
│   └── decisions/                   # ADR：关键产品与架构决策记录
│       ├── README.md
│       └── ADR-001.md … ADR-00N.md
└── src/ …
```

> 注：`docs/decisions/` 与 `product/decisions/` 二选一即可，本仓库采用 `docs/decisions/`。

---

## 3. 给执行 Agent 的阅读顺序

1. 先读 `product/product-master-plan.md`——建立全局观，理解最终方向与宪法红线。
2. 再读当前版本 PRD（如 `prd.md`）——明确本次要交付的功能边界。
3. 再读当前里程碑文档（如 `development-milestones.md`）——按顺序执行，每步验证。
4. 遇到"为什么这样设计"的疑问 → 查 `docs/decisions/`。

**关键约束**：读完 master-plan 后，**只实施当前版本 PRD 的范围**。看到 V1/V2 的长期规划时，不得提前实现其中的能力。

---

## 4. 冲突解决规则

1. 若 PRD 与 master-plan 冲突：以 master-plan 的宪法为准，PRD 中冲突部分按"最小修改"处理并记录原因，不得擅自扩大范围。
2. 若里程碑与 PRD 冲突：以 PRD 的功能边界为准。
3. 若 ADR 与 PRD 冲突：ADR 记录的是决策理由，PRD 是执行依据；执行按 PRD，理由不一致时提出并记录，不得静默偏离。
4. 已发布的版本文档（`prd-v0.1.md` 等）**永不修改**，只追加新版本文档。

---

## 5. 未来版本文档命名规范

- 新版本 PRD：`product/prd-v1.0.md`（从仓库根目录移入并改名归档旧版本）
- 新版本里程碑：`product/milestones-v1.md`
- 新版本验证计划：`product/validation-plan-v1.md`
- 每个阶段必须有独立的 PRD + 里程碑 + 验证计划，**不得仅凭 master-plan 自动启动下一阶段开发**。
