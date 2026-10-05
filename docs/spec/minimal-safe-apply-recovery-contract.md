# 最小安全应用与恢复契约规范 (Minimal Safe Apply & Recovery Contract)

**规范状态**：设计草案 (Design Proposal - Issue #16)  
**依赖基线**：
- 上游集成边界研读：`docs/research/cvr-integration-capability-matrix.md` (#13)
- 只读诊断观测基线：`docs/research/read-only-diagnostics-mvp.md` (#14)
- 规则审计与画像模型：`docs/research/legacy-route-audit-thin-profiles.md` (#15)
- 领域语言基线：`CONTEXT.md` (Change Operation, Logical Target, Reconciliation, Recovery Snapshot)

---

## 1. 范围与非目标 (Scope & Non-Goals)

### 1.1 设计范围 (In-Scope)
1. **策略变更事务模型**：定义一次网络策略变更从意图准备、用户交付、状态对账到恢复的完整确定性数据与生命周期模型；
2. **双层状态契约**：严格分离“动作执行结果 (Action / Attempt Result)”与“运行时激活判定 (Reconciled Activation Outcome)”；
3. **近线 MVP 流程**：规范以“Fleet prepare ➔ 用户在 CVR 原生 UI 中保存应用 ➔ Fleet 对账验证”为核心的安全闭环；
4. **并发防护与恢复界限**：规范基于前置版本比对 (pre-handoff compare) 与事后对账 (post-save reconciliation) 的并发防护、不可变恢复快照及有界恢复策略；
5. **后续工作单元消费指导**：为 #8 (macOS)、#9 (Windows) 及 #10 (语义对账) 提供固定输入契约。

### 1.2 非目标 (Non-Goals)
- **不编写生产代码**：本任务为纯设计规范，不实现代码抽象或适配器类层级；
- **不预制假想抽象**：未来受支持的 CVR API 属于潜在演进方向，不足以证明当前需要引入 `ApplyAdapter` 等虚构代码类层级；
- **不重蹈重启覆辙**：坚决不将杀 GUI / 重启 CVR 作为主力 Apply 手段；
- **不假定撤回已发出请求**：恢复机制不假定能倒流已经发往远端服务器的请求、DNS 缓存或中断的业务会话；
- **不决定具体生产路由策略**：本规范定义“如何执行与验证变更”，不裁决特定域名最终如何分流。

---

## 2. 领域术语与概念接缝 (Domain Terminology & Conceptual Seams)

遵循 `codebase-design` 原则，定义小接口、深内涵的概念接缝：

- **Change Intent (变更意图)**：调用者期望达成的一组业务网络目标声明。
- **Candidate Artifact (候选构件)**：Fleet 针对特定逻辑目标编译生成的确定性只读构件（如单一扩展脚本文本 `Script.js`）。
- **Logical Target (逻辑目标)**：变更所指向的持久化业务实体（由安装作用域、配置项种类及 Profile 标识界定），与底层路径及瞬态 PID 解耦。
- **Reconciliation (状态对账)**：在动作发生或结果未知后，基于逻辑目标源码摘要与内核实际运行态证据，重新确定真实激活状态的过程。
- **Recovery Snapshot (不可变恢复快照)**：变更发生前捕获的只读源文件副本，用于对账失配时的恢复参考；不自动等同于已知良好配置。
- **Accepted Artifact Snapshot (已接纳构件快照)**：在语义断言全部通过且激活状态确认为 `Applied` 后所保存的不可变基线。

概念操作接缝（Conceptual Seam）：
```text
prepare(change_intent)       -> PreparedOperation
reconcile(operation_id)      -> ReconciledOutcomeRecord
recover(operation_id)        -> GuidedRecoveryPlan
status(operation_id)         -> OperationStatusRecord
```

---

## 3. 责任划分边界 (Ownership & Responsibility Separation)

明确 CVR 原生与 Fleet 的权责划分，杜绝重复实现：

| 职责维度 | CVR 原生负责 (CVR-Owned) | Fleet 负责 (Fleet-Owned) |
|---|---|---|
| **配置生成与校验** | 执行完整 Enhancement Pipeline；语法与真实 YAML 校验 | 业务意图编译；确定性构建校验与 Boa 兼容性保护 |
| **特权资产与分发** | Service 模式特权目录 Staging (`/Library/Application Support/...`) | 不复制特权 staging 逻辑，向逻辑目标交付候选构件 |
| **核心生命周期** | 内核守护、配置热重载 (`/configs`)、异常时内核替换重启 | 不管理内核守护，不把杀进程作为默认 apply 机制 |
| **变更追踪与对账** | 提供原生 Profile/Script 编辑器与本地只读 Controller | 拥有 Operation ID、本地持久化 Journal、并发冲突检测 |
| **意图与语义验证** | 仅保证生成合法 YAML（main 异常时静默降级） | **拥有语义后置条件验证**，检测策略组结构与规则是否真实生效 |
| **恢复闭环** | 仅在保存失败时单次源文件覆写（不回滚 runtime） | **维护不可变恢复快照**，评估恢复资格并提供引导恢复方案 |

---

## 4. 近线 MVP 交互流程 (User-Assisted MVP Flow)

由于当前在所有检查过的 CVR 接口面中均未发现受支持的完整外部 Apply Seam，第一阶段采用 **User-Assisted Native Apply** 模式。

流程必须明确体现条件分支，**绝不能假设 CVR 保存必然触发配置重载**：

```text
Fleet prepare
  │  1. 捕获当前目标 Base Digest
  │  2. 创建不可变 Recovery Snapshot
  │  3. 编译生成 Candidate 构件并记录 Operation ID
  │  4. 本地持久化落盘 Journal (状态: awaiting_user)
  ▼
user applies through CVR native UI
  │  5. 用户在 CVR 原生编辑器中粘贴并保存
  ▼
CVR native save/validation succeeds
  │
  ├─ does CVR consider this source relevant to current runtime?
  │    ├─ yes     -> generation & apply may run (staging / core reload)
  │    ├─ no      -> source saved, but runtime remains unchanged (update_config_forced skipped)
  │    └─ unknown -> cannot be assumed; hand over to Reconciler
  ▼
Fleet reconcile
     6. 读取当前源文件摘要并比对 candidate
     7. 只读观测 Mihomo External Controller (规则/策略组拓扑)
     8. 交叉验证语义断言，输出确切的 Activation Outcome
```

**核心法则**：`native save success != Applied`。原生保存成功仅代表源码写入与语法合法，不代表运行时已激活新策略。

---

## 5. 操作数据模型与逻辑目标标识 (Operation Data Model & Target Identity)

### 5.1 身份标识原则 (Identity Rules)
- **Operation ID**：采用不透明的全局唯一标识符（Opaque Unique Identifier，如 `op_01J9X12345ABCDEF`）。**单调时钟与时间戳仅用于超时、耗时统计与超时死线，绝不作为全局正确性判定的唯一键**；
- **Content Digests**：内容哈希独立存储：`candidate_digest`（目标代码哈希）与 `base_digest`（预期变更前源哈希）。

### 5.2 逻辑目标标识与 Fail-Closed 门禁
逻辑目标标识必须从 CVR 元数据中具备稳定、可验证的身份时才可成立：
```yaml
logical_target:
  app_scope: "io.github.clash-verge-rev.clash-verge-rev"
  profile_id: "Script" # 或特定验证可用的 Profile UID
  artifact_kind: "global_script" # global_script | profile_script | merge
  expected_base_digest: "sha256:4a5b6c..."
```

**Fail-Closed 约束**：
- 如果 Fleet 无法无歧义地绑定 installation / profile / artifact_kind / expected_revision，自动化操作必须判定为 `unsupported`，设置 `next_action: manual_required`（纯人工操作模式）；
- **严禁**使用进程 PID、路径盲目猜测、“首个扫描到的 profile”、系统用户名或模糊命令行匹配来伪造持久身份。

---

## 6. 执行动作结果模型 (Action / Attempt Result)

记录“执行动作这一层发生了什么（与操作通道/适配方式解耦）”：

| 动作结果 (Attempt Result) | 含义与判定条件 |
|---|---|
| `not_started` | 事务刚创建，尚未向执行通道提交或交付用户。 |
| `awaiting_user` | （MVP 模式）候选构件已准备，等待用户在 CVR 原生编辑器中操作。 |
| `submitted` | 指令已交付执行通道，或用户已明确确认在 CVR 中完成保存。 |
| `busy` | 执行通道报告当前正在进行另一项更新，处于防抖或并发锁等待中。 |
| `skipped` | 因内容与 base 完全相同（No-op）或目标环境不可操作而主动跳过。 |
| `failed` | 执行动作本身报错（如文件读写受阻、原生保存明确拒绝）。 |
| `no_response` | 动作已触发但在指定预算时间内未收到回包（失联/丢包/超时）；非终态，必须通过对账推进。 |
| `cancelled` | 用户在交互中明确选择取消应用，操作正常终止。 |

---

## 7. 运行时激活与处置判定模型 (Reconciliation & Disposal Dimensions)

### 7.1 运行时激活判定模型 (Reconciled Activation Outcome)

严格只描述 Fleet 通过只读证据**最终对实际状态能够证明什么**，不与 Attempt Result 混淆：

| 激活状态 (Activation Outcome) | 含义与证据要求 |
|---|---|
| `Applied` | 源码摘要完全匹配 candidate，且内核运行态**经由正面证据完全证明满足预期的语义断言**。 |
| `SavedOnly` | 具备正面证据证明：① 源码摘要匹配 candidate；且 ② **运行时未反映 candidate 预期的语义断言**（例如 CVR 因 `profile_affects_runtime` 判定跳过 reload，或脚本运行时异常退回旧配置）。 |
| `Conflict` | 逻辑目标源码已被外部第三方修改，当前物理源码摘要既不等于 base，也不等于 candidate。 |
| `Unchanged` | 具备明确证据证明目标源码与运行时状态仍处于变更前 base 状态（例如在 `cancelled` 或明确 `failed` 之后，经确认系统未发生任何变化）。 |
| `Unknown` | 观测证据不足（例如 Controller 无法连接、断言仅部分验证、或无法查证当前运行时真实策略）。**严禁凭空猜测为 SavedOnly 或 Failed**。 |

### 7.2 后续处置行动维度 (Next Action Dimension)

`next_action` 是独立于动作执行状态 (`Attempt Result`) 与事实证明状态 (`Activation Outcome`) 的正交维度，形式化约束调用方与系统的后续控制流：

| 处置行动 (Next Action) | 含义与触发条件 |
|---|---|
| `none` | 变更已收敛，无需后续操作（例如已完成 `Applied`、确认无副作用的 `Unchanged` 或确定性跳过的 `skipped`）。 |
| `reconcile` | 状态处于未决、失联或超时中间态（例如 `no_response` 或刚完成 native 保存提交），必须调用状态对账确认实际运行态。 |
| `manual_required` | 检测到无法自动调和的冲突、未满足运行时激活要求或环境未满足 Fail-Closed 门禁（如 `Conflict`、`SavedOnly` 且需即时激活、目标标识无法绑定），必须由人工介入裁决。 |
| `guided_recovery` | 变更已发生且对账确认异常（如 `SavedOnly` 伴随脚本运行故障），且存在哈希一致的 `last_known_good` 基线，系统生成引导式恢复方案供用户操作。 |

**关键处置约束与收敛规则**：
- **SavedOnly 处置规则**：`SavedOnly` 明确代表候选源码已落盘但请求的运行时语义尚未生效，系统并未收敛。若 Change Intent 要求当前运行态立即激活，默认必须映射为 `next_action: manual_required`；仅当变更意图本身明确声明允许延迟激活（`save now / activate later`）时，才作为意图相关的特例（intent-dependent exception）允许收敛为 `next_action: none`。
- **取消与未决关闭规则**：对于 `cancelled` 场景，仅当正面证明取消发生在任何副作用动作之前且系统状态完全未变时，才允许 `activation: Unchanged` 且 `next_action: none`；若无法证明未变化，必须输出 `activation: Unknown` 且保持 `next_action: reconcile`。只有在用户或明确策略主动关闭未决操作时才允许终止后续对账，且该关闭必须记录为独立的操作关闭元数据（closure metadata），严禁通过 `next_action: none` 隐式表达。

---

## 8. 并发控制与冲突防护 (Concurrency & Conflict Rules)

明确基本事实：**Fleet 本机单写者锁仅能约束 Fleet 自身进程，无法原子阻止 CVR GUI、订阅自动更新或用户的手工编辑**。因此并发防护划分为三个明确阶段：

1. **Pre-Handoff Compare (交付前比对门禁)**：
   在把 candidate 交付用户前，检查目标当前摘要是否等于 `expected_base_digest`；若不匹配立即提示并终止，防止基于陈旧基线生成补丁。
2. **User-Controlled Mutation Window (用户操作窗口)**：
   在用户接管并于 CVR 中操作期间，外部环境仍可能并发修改配置，Fleet 在此阶段无法在底层物理层强制阻止外部并发。
3. **Post-Save Reconciliation Drift Detection (保存后对账漂移检测)**：
   重新读取源码摘要与运行时证据。一旦发现当前哈希非预期，立即标记为 `Conflict` 并阻断自动化逻辑，设置 `next_action: manual_required`。
4. **Pre-Recovery Compare (恢复前复核)**：
   在提供或执行恢复前，强制核验当前状态是否依然等于本次变更产生的 candidate。若已被外部再次修改，**严禁覆盖别人的修改**。

*注：只有在未来受支持的自动化 Seam 中，才可能在服务端原子完成 `expected_revision compare + mutate`。MVP 阶段严禁声称具有不可逾越的底层互斥能力。*

---

## 9. 语义激活后置条件引擎 (Semantic Activation Verification)

为彻底解决“CVR 脚本运行时抛错但静默退回前一阶段配置、生成合法 YAML 导致误报成功”的问题，验证引擎必须基于证据驱动：

### 9.1 声明式语义断言结构 (Neutral Semantic Assertions)
断言只表达“本次 Change Intent 所要求的结构与规则不变量”，不硬编码未定型的全局路由假定：
```yaml
expected_semantic_assertions:
  rules:
    - assertion: "rule_present"
      identity: "<intent-required-rule>"
      expected_target: "<intent-required-policy>"
  policy_topology:
    - assertion: "group_exists"
      group_identity: "<intent-required-group>"
```

### 9.2 证据分级与判定准则
1. **主证据源 (Primary Evidence)**：Mihomo External Controller 的只读快照（`/rules`, `/proxies`, `/configs`），用于验证断言是否满足；
2. **辅助证据源 (Supplemental Evidence)**：CVR 运行日志仅作为辅助参考（例如排查 `use_script exception` 的失败原因），**不能单独作为终态裁决依据**，必须与时间窗口和内核状态交叉比对；
3. **证据不足收敛**：若观测证据缺失，统一输出 `Unknown`，绝不允许由于语法检查合法就推定生效。

---

## 10. 恢复资格与恢复权限 (Recovery Eligibility & Recovery Authority)

### 10.1 核心概念分离
- **Recovery Snapshot**：变更发生前捕获的源文件只读副本，携带内容哈希，**绝对不可变 (Immutable)**；
- **Accepted Artifact Snapshot**：仅在 candidate 经过验证且 `activation == Applied` 后，将其内容归档为新的不可变基线；
- **last_known_good**：仅为本地 Journal 中的元数据指针，**只能指向一个已经被历史验证通过的 Accepted Artifact Snapshot**。严禁将变更前的 Recovery Snapshot 混淆为新的 known-good。

### 10.2 User-Assisted MVP 下的恢复权限界限
由于用户主导了 Apply 动作，**Fleet 默认不自动执行静默文件覆盖回滚**：
1. **触发门禁 (Recovery Eligibility)**：
   - 必须同时满足：① 异常明确可归因于本次变更；② 存在有效且哈希一致的 `last_known_good` 基线；③ 目标未发生新的外部并发冲突；
2. **恢复形式**：
   - Fleet 生成带校验的引导恢复方案与恢复代码包（Guided Recovery Plan），提示用户在 CVR 原生界面中还原；
   - 仅在未来获授权的受限自动化通道下，才考虑受控的自愈执行。

---

## 11. Agent 掉线与本机持久化模型 (Agent Transport Independence)

为防止“网络闪断 ➔ Agent 丢失连接 ➔ 重连后重复发送指令”的风险：

1. **持久化先于副作用**：在把控制权交付外部通道或用户前，**本地操作状态必须先完成可靠持久化落盘 (Durable Local Persistence)**。跨平台实现应采用平台对应的持久落盘机制（如 POSIX 平台刷盘或等价机制），确保掉电或断网不丢失状态；
2. **重连只对账不重发**：Agent 重连后，严格通过 `reconcile(op_id)` 读取本地 Journal 检查现场；若处于非终态，仅执行当前状态观测，**绝不盲目重复下发变更**；
3. **有界时间预算与非终态对账**：每个动作阶段维护基于单调时钟的 deadline。超时后 Attempt Result 记录为 `no_response`，但**绝不标记为终态 (`terminal: false`)**，而是标记 `reconciliation_required: true` 与 `next_action: reconcile`，指示必须通过后续对账（如 `reconcile(op_id)`）推进实际状态，禁止在证据不足时强行截断为终态。

---

## 12. 隐私边界与本地持久化格式 (Privacy & Local Storage Boundaries)

- **存储规范**：操作日志持久化于本地工作区私有运行时目录（`.fleet/journal/operations/<op_id>.json`），**严格列入 `.gitignore`，绝不提交至 Git 仓库**；
- **脱敏准则**：Journal 中记录逻辑目标、内容哈希、语义断言与脱敏后的执行日志，**严禁持久化明文凭据、订阅 URL 或未脱敏的用户私有网段**；
- **对外导出**：任何向外暴露的诊断报告必须经过字段白名单清洗。

---

## 13. 实战场景矩阵与合同验证 (Scenario Table)

| 场景 ID | 场景描述 | 过程行为 (Attempt Result) | 最终对账状态 (Activation Outcome) | 后续处置 (Next Action) | 恢复与处置原则 (Disposition & Recovery) |
|---|---|---|---|---|---|
| **A. 正常应用** | 用户在 CVR 保存且生效 | `awaiting_user` ➔ `submitted` | **`Applied`** | `none` | 事务顺利归档，本次 candidate 被归档为新的 `Accepted Artifact Snapshot` 并更新 `last_known_good` 指针。 |
| **B. 仅保存未生效** | 当前 Profile 挂接独立脚本，修改全局脚本时 CVR save-time 的 `profile_affects_runtime("Script")` 返回 false，跳过 `update_config_forced()` | `awaiting_user` ➔ `submitted` | **`SavedOnly`** | `manual_required` (默认) / `none` (允许延迟激活特例) | global Script source 已保存，但 save-time `affects-runtime` 判断跳过了当前 regenerate/apply；global Script 仍会参与未来实际发生的 enhancement pipeline。若变更意图要求当前立即生效，因请求的运行时语义尚未激活，系统未收敛，默认设为 `next_action: manual_required`；只有在 Change Intent 显式允许延迟激活（`save now / activate later`）时，才作为特例收敛为 `none`。 |
| **C. 回包丢失** | 外部通道发出请求后网络中断，未收到响应 | `submitted` ➔ `no_response` | **`Applied`** | `none` (对账前为 `reconcile`) | 超时后状态记录为 `no_response` (`terminal: false`)。通过后台对账探针发现内核规则与候选哈希均已更新，自动校准为 `Applied`，处置行动收敛为 `none`，不重复下发。 |
| **D. 外部编辑冲突** | Prepare 后，用户在 GUI 或外部工具中修改了目标源 | `awaiting_user` | **`Conflict`** | `manual_required` | 检测到当前文件哈希与 `expected_base_digest` 不符，立即阻断自动化流程，严禁覆写他人修改，转入人工介入裁决。 |
| **E. 用户主动取消** | 用户决定放弃本次推荐调整 | `awaiting_user` ➔ `cancelled` | **`Unchanged`** (已证明未变) / **`Unknown`** (未证明未变) | `none` (已证明未变) / **`reconcile`** (未证明未变) | 记录取消意图。若能正面证明取消发生在任何副作用动作之前且目标源码与运行时未发生变化，则裁定为 `Unchanged` 且处置行动为 `none`；若无法证明未变，激活状态保持 `Unknown`，处置行动必须保持 `reconcile` 以追踪真实影响。仅在用户或策略主动关闭未决操作时才终止对账，且需记录独立 closure 元数据，严禁通过 `none` 隐式表达已收敛。 |
| **F. 远端服务故障** | 本地配置正确生效，但 OpenAI/Google 远端服务器自身宕机 | `submitted` | **`Applied`** | `none` | 语义断言验证策略已装载。业务端连通性告警，但**严禁触发自动回滚**（非本次变更引入的本地故障）。 |
| **G. 脚本静默降级** | 脚本中 `main()` 抛错，CVR 记录异常并退回上一阶段配置输出合规 YAML | `submitted` | **`SavedOnly`** (证据充分) / **`Unknown`** | `guided_recovery` (有基线) / `manual_required` | 源码匹配 candidate 但运行时未反映新策略；辅助日志关联到脚本异常并在 failure_cause 中记录 `script_runtime_exception`。不误报 Applied；若具备合格基线则生成引导恢复方案。 |
| **H. Agent 掉线重连** | 本机事务落盘后 Agent 断网，重连恢复 | `submitted` | **`Applied`** (或视现场对账) | `reconcile` ➔ 收敛为 `none` | 重连后调用 `reconcile(op_id)` 读取本地 Journal 现场比对，避免重复写入。 |

---

## 14. 未来自动化 Seam 需求规范 (Future Automation Seam Requirements)

为未来与上游 CVR 或平台级受控接口对接预留标准协议规范（**保持传输中立，不绑定特定技术选型**）：

1. **调用者鉴权与最小权限**：必须实现受鉴权的本地调用者识别 (authenticated local caller)；在支持的平台上绑定同一操作系统用户或授权主体；严禁暴露任意文件写权限；
2. **目标与前置版本绑定**：调用必须显式传入 `logical_target` 与 `expected_base_digest`，服务端校验版本不匹配时拒绝；
3. **幂等性与重放防护**：请求必须携带 `operation_id`，支持重复查询而不产生重复副作用；
4. **结构化细分响应**：服务端必须区分返回清晰状态（如 Accepted, Busy, Skipped, Invalid 等），避免黑盒超时；
5. **协议中立性考量**：HTTP 端点、Unix Domain Socket、Windows Named Pipe、XPC 均保留为备选方案。**若最终采纳 HTTP，必须单独严格评估浏览器同源策略突破与 CSRF 跨域暴露面风险**。

---

## 15. 对现有 Issue 的实施映射指导 (Impact on Downstream Issues)

| 关联 Issue | 原状态与问题 | 本契约实施后的新角色与裁剪指引 |
|---|---|---|
| **#8 (macOS Adapter)** | 原计划依赖 `SIGTERM -> open -a` 重启 GUI，存在进程冒充与状态丢失缺陷 | **彻底降级重构**。保留其只读 discovery（修复进程误判与脱敏），废除主流程中的 GUI 强杀重启；后续仅作为消费本契约的平台宿主探测与辅助通知执行器，重启仅留作显式授权的维护兜底。 |
| **#9 (Windows Adapter)** | 原计划直接移植 macOS 的 kill/start 逻辑 | **重写并解耦**。仅实现 Windows 环境下的只读进程与配置目录探测，不实现 Windows 进程强杀重启，统一等待消费本契约。 |
| **#10 (Deployment Verification)** | 原计划依靠文件 mtime 刷新与简单的连通性 ping 测试判定成功 | **重写验证核心**。全面升级为实现本契约第 9 节的**声明式语义断言引擎**（查询规则结构与拓扑），负责驱动对账与失联恢复逻辑。 |
