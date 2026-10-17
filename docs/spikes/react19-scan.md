# Spike：React 19 专属 API 扫描（Taro 路线可行性验证）

- 日期：2026-10-17
- 范围：`src/` 全仓库
- 方法：grep 静态扫描 + 逐条判定（只扫描，不改代码）
- 结论：**深度绑定 19 —— Taro 路线不可行，建议改道**

## 1. 判定标准

只把 React 18 **没有**的 API 计入「React 19 专属」：

| API | 归属 |
| --- | --- |
| `use()` | React 19 专属 |
| `useActionState` | React 19 专属 |
| `useFormStatus` | React 19 专属 |
| Form Actions（`<form action={...}>`、`formAction={...}`） | React 19 专属 |
| `<Context>` 直接渲染 / 去掉 `.Provider` | React 19 专属 |
| `ref` 作为普通 prop 传给组件（替代 `forwardRef`） | React 19 专属 |
| `useOptimistic` | **18.3 已有，不计入**（避免误报） |
| `useState` / `useEffect` / `useRef` / `useId` / `useTransition` / `Suspense` | React 18 已有，不计入 |

## 2. 命中清单

### 2.1 `useActionState`（React 19 专属，React 18 无稳定对应）

用途：配合 Server Action 表单做提交 `pending` / 结果 / 错误状态管理。18 个文件、47 处。

| 文件:行号 | 用途 |
| --- | --- |
| `src/components/PlacementForm.tsx:4,19,23` | 定级表单提交（self / override 两处） |
| `src/components/GoalForm.tsx:4,22` | 目标创建表单 |
| `src/components/knowledge/SourceManualAdd.tsx:3,9` | 原文手动摘录表单 |
| `src/components/knowledge/KnowledgeForm.tsx:4,30` | 知识条目表单 |
| `src/components/knowledge/KnowledgeFlowControls.tsx:4,16` | 知识流转控制（批量操作） |
| `src/components/knowledge/KnowledgeEditor.tsx:4,30` | 知识编辑表单 |
| `src/components/knowledge/ImportWizard.tsx:4,20,24` | 文件导入（preview / confirm 两段） |
| `src/components/knowledge/RelationForm.tsx:4,29` | 关系边表单 |
| `src/components/knowledge/PasteImportWizard.tsx:4,20,24` | 粘贴导入（extract / confirm 两段） |
| `src/components/knowledge/PoolBrowser.tsx:5,30,34` | 词库池（promote / bind 两处） |
| `src/components/goals/ScenarioManager.tsx:5,39,150,151,152` | 场景管理（create / update / delete / unbind） |
| `src/components/goals/WordlistGoalBinding.tsx:4,12` | 词表-目标绑定 |
| `src/components/goals/GoalStatusForm.tsx:4,20` | 目标状态变更 |
| `src/components/chat/ChatPanel.tsx:3,44,51` | 聊天提交 / 保存 |
| `src/components/learn/ActivityRunner.tsx:4,57,425,429` | 练习作答提交 / 反馈 / 纠错 |
| `src/components/home/IntentInput.tsx:3,15` | 首页意图输入 |
| `src/components/settings/DataControls.tsx:4,11,15` | 数据导出 / 删除 |
| `src/components/settings/NewWordBudgetForm.tsx:3,9` | 新词预算表单 |

### 2.2 Form Actions（React 19 专属：`<form action={...}>` / `formAction={...}`）

用途：把 Server Action 直接作为表单 `action` / 按钮 `formAction` 提交。29 个文件、62 处。

| 文件:行号 | 用途 |
| --- | --- |
| `src/components/PlacementForm.tsx:40,78` | 定级提交 |
| `src/components/GoalForm.tsx:36` | 目标提交 |
| `src/components/knowledge/SourceManualAdd.tsx:14` | 摘录提交 |
| `src/components/knowledge/KnowledgeForm.tsx:54` | 知识提交 |
| `src/components/knowledge/KnowledgeFlowControls.tsx:26` | 批量操作提交 |
| `src/components/knowledge/KnowledgeEditor.tsx:40` | 编辑提交 |
| `src/components/knowledge/ImportWizard.tsx:41,157` | 导入预览 / 确认 |
| `src/components/knowledge/RelationForm.tsx:43` | 关系提交 |
| `src/components/knowledge/PasteImportWizard.tsx:55,203` | 粘贴提取 / 确认 |
| `src/components/knowledge/PoolBrowser.tsx:48,79,88` | 池操作（promote / bind） |
| `src/components/goals/ScenarioManager.tsx:53,162,206,231` | 场景增删改 / 解绑 |
| `src/components/goals/AutoCalibrationPanel.tsx:33,64,71` | 自动校准 |
| `src/components/goals/WordlistGoalBinding.tsx:18` | 绑定提交 |
| `src/components/goals/GoalStatusForm.tsx:30` | 状态提交 |
| `src/components/goals/PhaseList.tsx:85,122,130,156` | 阶段推进 / 跳过 / 回滚 |
| `src/components/learn/WarmupRunner.tsx:81,88` | 热身推进 / 跳过 |
| `src/components/learn/ActivityRunner.tsx:226,262,325,470,480,490` | 练习作答 / 反馈 / 纠错 |
| `src/components/home/RecommendationCard.tsx:38,53` | 推荐开始 / 拒绝 |
| `src/components/home/IntentInput.tsx:27` | 意图提交 |
| `src/components/home/DailyPlan.tsx:34,77,86,92` | 每日计划恢复 / 开始 / 替换 / 休息 |
| `src/components/settings/DataControls.tsx:39,57` | 导出 / 删除 |
| `src/components/settings/NewWordBudgetForm.tsx:14` | 预算提交 |
| `src/app/placement/page.tsx:62` | 定级页 |
| `src/app/page.tsx:99,137,151` | 首页恢复 / 开始聊天 / 开始会话 |
| `src/app/chat/page.tsx:48` | 聊天页 |
| `src/app/chat/[sessionId]/page.tsx:52,63` | 纠错开关 / 暂停 |
| `src/app/learn/[sessionId]/page.tsx:59,220,299,306,312,318` | 练习页（放弃 / 开始 / 跳过 / 暂停 / 完成） |
| `src/app/knowledge/[id]/page.tsx:160,191` | 关系移除 / 删除知识 |
| `src/app/settings/page.tsx:109` | 记忆退休 |

### 2.3 明确排除（未命中，避免误报）

| API | 命中数 |
| --- | --- |
| `use()` | 0 |
| `useOptimistic` | 0（本身 18.3 已有，不误报） |
| `useFormStatus` / `useFormState` | 0 |
| `createContext` / `<Context>` 直接渲染 / `.Provider` | 0 |
| `forwardRef` | 0 |
| `ref` 作为普通 prop 传给组件 | 0（唯一 `ref` 用法 `ChatPanel.tsx:94` 绑在原生 `<div>` 上，React 18 同样支持） |

## 3. 结论：深度绑定 19

二选一判定：**深度绑定 19 —— Taro 路线不可行，建议改道。**

依据：

1. **`useActionState` 是 React 19 新增 hook，React 18 无稳定对应。** 本项目在 18 个组件文件、47 处使用，覆盖几乎全部交互表单（目标、知识、导入、场景、聊天、练习、首页、设置）。
2. **Form Actions（`<form action={serverAction}>`、`formAction={...}`）是 React 19 专属功能**，React 18 的 `<form>` 没有 `action` prop；本项目 29 个文件、62 处使用。
3. **二者与 Next.js App Router Server Actions 深度耦合**：7 个 `'use server'` 文件（`src/app/actions/`）通过 `getAppContext()` 访问大脑层，客户端组件直接把 server action 作为表单 action 传入。降级到 React 18 不是「换个 hook」，而是：
   - `useActionState` → 逐文件改写为 `useState` + `useTransition` + 手动状态管理（18 个文件）；
   - `<form action={serverAction}>` / `formAction` → 改为 `onSubmit` + 显式调用（React 18 下 server action 无法直接作为表单 action）；
   - **Taro 不运行 Next.js Server Actions**，皮肤层数据流需整体改为 REST/HTTP 接口再调用大脑层端口。
4. 综上，UI 深度绑定 React 19 专属 API，且该绑定与 Next.js 运行时不可分割。Taro（peerDep `^18`）无法承载本项目现有皮肤。

建议：**改道**。小程序皮肤不要走「复用现有 Taro 皮肤」路线；应把大脑层（domain/application，见 `storage-ports.md` 确认纯 TS 可复用）通过 REST/HTTP 暴露，小程序端用 React 18（或原生）独立实现数据流。

## 4. 附录：扫描命令（可复现）

```bash
# useActionState / useFormStatus / useOptimistic / useFormState
rg -n 'useActionState|useFormState|useFormStatus|useOptimistic' src

# use() 钩子
rg -n '\buse\(|\.use\(' src

# Form Actions
rg -n '<form\s+action=|formAction=' src

# Context 直接渲染 / forwardRef / ref-as-prop
rg -n 'createContext|\.Provider|<Context|forwardRef|\bref=\{' src
```
