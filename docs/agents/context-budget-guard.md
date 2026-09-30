# Context Budget & 600-Line Guard

上下文预算管理与 600 行代码/文档审查护栏规范。

---

## 1. 核心目标：保护模型上下文与推理质量

随着代码库演进，Agent 面向的核心文档和手写实现文件如果无节制膨胀，会严重挤占大模型的上下文窗口（Context Window），稀释注意力并降低推理与执行的精确度。

本规范设立明确的文件行数梯度与审查机制，确保文件保持高内聚、易维护和对 Agent 友好。

---

## 2. 600 行强制审查阈值 (Mandatory Review Threshold)

- **核心定性**：**600 行是强制审查阈值（Mandatory Review Threshold），而非机械的截断硬限制（Not a mechanical hard limit）**。
- **触发范围**：
  - 手写源代码（handwritten source code）；
  - 自动化脚本与工具（scripts）；
  - Agent 面向的核心文档（Agent-facing core documentation，如 `AGENTS.md`、`docs/agents/*`）；
  - 作为单一上下文整体读取的大型调研与规格文档（large research / spec documents）。
- **触发动作**：
  - 当文件接近或达到约 **600 行**时，Agent **必须立即停止无序追加内容**；
  - 必须系统性评估该文件是否存在自然的解耦或拆分边界（natural decomposition boundary）。

---

## 3. 常见拆分与重构策略 (Decomposition Actions)

当触发 600 行审查时，应优先考虑以下重构方案：

1. **提取高内聚模块 (Extract Cohesive Module)**：将可独立复用的业务逻辑、工具函数或类型定义下沉为子模块。
2. **剥离参考附录 (Split Reference Appendix)**：将详细的枚举清单、配置对照表或备查附录从核心流程中拆出为独立附录文件。
3. **摘要加指针 (Summary + Pointer)**：保留核心决策与不变式，细节通过指针链接（Context Pointer）指向专项文档。
4. **按平台隔离 (Separate Platform Deltas)**：将跨平台的差异实现（如 macOS 与 Windows 专有适配）拆分到各自独立的子文档或适配器中。
5. **历史证据与当前规范解耦 (Separate History from Guidance)**：将历史实验物证、过程探针记录与长期有效的架构规范分离，避免单体文档承载过多一次性沉淀。

---

## 4. 推荐的前置工程预算 (Preferred Earlier Budgets)

为了避免文件被动累积至 600 行临界点才进行重构，工程上倡导以下前置健康预算（作为工程推荐目标，非硬性报错）：

| 文件类型 | 推荐健康预算 | 治理建议 |
|---|:---:|---|
| **Agent 入口与引导文件** (如 `AGENTS.md`) | **`<= ~250 行`** | 严格遵循 Pointer-first 原则，仅保留一级索引与不变式 |
| **常规手写源码与脚本** (如 `src/*`, `scripts/*`) | **`<= ~400 行`** | 关注单职责原则，超过 400 行时预先规划模块划分 |
| **大型调研/规范文档** (如 `docs/research/*`) | **`<= ~600 行`** | 达到 ~600 行必须触发拆分审查；若保持单体需提供充分理由 |

---

## 5. 免除例外与工程审慎原则 (Exceptions & Prudence)

### 免除范围
以下类型的文件不受 600 行阈值限制：
- 机器自动生成的文件（generated files）；
- 包管理器依赖锁定文件（lockfiles）；
- 第三方引入代码（vendored code）；
- 测试快照、测试固定数据与机器生成的 fixtures。

### 审慎原则
- **严禁为了凑数而机械拆分**：切忌单纯为了迎合行数计数器而将高内聚、不可分割的代码或逻辑切得支离破碎。
- **保留完整性声明**：如果经过审查，文件确实属于高内聚核心且拆分会破坏上下文理解，允许保留并在提交说明中明确陈述保留理由。

---

## 6. 指针优先原则 (Pointer-First Principle)

- Agent 启动与入口文档（如 `AGENTS.md`）应始终保持紧凑精炼；
- 优先采用“简明不变式 + 权威文件指针”的组合形式，引导 Agent 按需读取更专注的目标文件；
- 避免在单一顶层入口文档中层层堆积全量项目历史与细枝末节。
