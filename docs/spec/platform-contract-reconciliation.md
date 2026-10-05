# Issue #8 / #9 / #10 实施契约与责任对账报告 (Platform Contract Reconciliation)

**报告状态**：规范提案 (Implementation Contract)  
**基准锚点**：`main @ 02c5df3bb14934c7d7cc55e9c4e9b1dfc7580793`  
**上游依据**：`docs/spec/minimal-safe-apply-recovery-contract.md` (Issue #16)  
**支撑工作**：Issue #8 (macOS), Issue #9 (Windows), Issue #10 (Verification & Reconciliation), Issue #17 (Cross-Platform Acceptance)

---

## 1. 现有代码影响审计与资产盘点 (Current Code Inventory)

### 1.1 `main` 现有代码现状
- **`src/deploy/deployer.js`**:
  - 实现了 `executeDeploymentTransaction`（Steps 1–6：Discover -> Fetch -> Checksum -> Boa Preflight -> Backup -> Atomic Replace）。
  - 当前终态为 `status: 'STAGED_NOT_APPLIED'`，保留了清晰的生命周期边界；但在 #16 的 **User-Assisted Native Apply MVP** 模式下，单体式直接写目标文件需解耦为“由 Shared Change/Preparation Core 生成候选构件并由交付通道处理”。
- **`src/deploy/atomic-file.js`**:
  - 提供 `computeFileSha256`、`createByteIdenticalBackup`、`atomicReplaceFile`。
  - 保留底层哈希计算、byte-identical 快照及原子替换原语；可作为未来 Journal persistence 的底层候选原语，但**真正 durable persistence 必须在实现阶段验证平台对应的 flush / atomic replacement / crash-consistency semantics**，不可过度宣称现状已满足。
- **`src/deploy/release-source.js`**:
  - 纯发布源构件获取与校验，完全符合 #6，与本轮对账正交无冲突。
- **`src/cli/cli.js`**:
  - 仅包含 `fleet deploy` 单一子命令，尚未包含 #16 所需的 `prepare` / `reconcile` / `recover` / `status` 等原子概念入口。
- **`test/cross-platform-process.test.js`**:
  - 验证了跨平台进程规则（`.app` 与 `.exe`）在单一脚本中的共存与 Boa 运行，属于 Shared Core 规则装配，完全合规。

### 1.2 `feat/issue-8-macos-adapter` 分支候选代码 (`e978146`)
- 该分支为**未合并的历史候选代码**：
  - `src/deploy/platforms/macos-discovery.js`: 包含 `sanitizePath`（路径脱敏）、`parseProcessLine` / `scanMacosProcesses`（进程扫描）、`detectMacosTopology`（拓扑判定）等有效只读逻辑；
  - `src/deploy/platforms/macos-trigger.js` / `macos-adapter.js:executeStep7`: 包含通过 `SIGTERM` 强杀 CVR 并使用 `open -a` 重拉起的重启驱动逻辑。
  - **处置原则**：保留有价值的只读 discovery 行为；**对基于重启的 Step 7 / trigger 逻辑坚决不合并入 main (DO NOT MERGE / SUPERSEDED)**，避免为了“隔离死代码”而将死代码引入主线。

### 1.3 Windows 资产现状 (调研与原型)
- `main` 上无代码；调研报告 `docs/research/gate-b-windows-findings.md` 记录了受测宿主上的观察物证：
  - 在受测 Windows 宿主上观测到 CVR 运行于 High Integrity Level（管理员权限，`~ RUNASADMIN`），普通权限无权杀进程；
  - 在受测 Windows 宿主上观测到待机状态无持久文件锁，支持原子替换；
  - **明确边界**：上述均为 tested-host observations，绝非 Windows 通用硬编码假定。机械移植 macOS kill/start 会因权限不足导致 `Access is denied`。

### 1.4 验证与回滚资产现状 (原 #10 计划)
- 原 #10 计划依赖 `mtime` 刷新、GUI PID 变化和通用网络探测，且在失败时执行盲目回滚。
- #16 已明确：`mtime` 刷新 ≠ 生效、PID 重启 ≠ 生效、通用网络连通性 ≠ 语义激活。原计划需要彻底重写。

---

## 2. 资产处置矩阵 (KEEP / REWRITE / REMOVE / DO NOT MERGE)

| 组件 / 代码片段 | 处置动作 | 归属分类 | 处置理由与技术边界 |
|---|:---:|---|---|
| `macos-discovery.js:sanitizePath` | **KEEP behavior** | Platform / Shared | 保留脱敏行为；当 macOS/Windows 实际出现共享语义时再决定是否提取 shared helper，不提前过度抽象。 |
| `macos-discovery.js:scanMacosProcesses` | **KEEP** | Platform Adapter | 宿主只读进程观测能力，用于辅助确认拓扑事实。 |
| `macos-discovery.js:detectMacosTopology` | **KEEP & REFINE** | Platform Adapter | 核心拓扑识别算法有效；需将关注点调整为只读运行态证据提取。 |
| `macos-discovery.js:resolveMacosPaths` | **REWRITE** | Platform Adapter | 移除硬编码路径，重构为基于 `LogicalTarget` 的只读路径解析与 Fail-Closed 校验。 |
| `macos-trigger.js:executeMacosLifecycleReload` | **DO NOT MERGE** | Superseded | **历史分支代码，不合并入 main**；主流程废弃，未来仅在存在真实受支持场景与显式授权时再行设计。 |
| `macos-adapter.js:executeStep7` | **DO NOT MERGE** | Superseded | 废弃将部署绑定到进程重启的旧 Step 7，历史分支代码不合入 main。 |
| `src/deploy/deployer.js:executeDeploymentTransaction` | **REWRITE** | Shared Change Core | 解耦为 Preparation Core（生成 Candidate、不可变 Recovery Snapshot、落盘 Journal），交由调用者或适配器交付。 |
| `src/deploy/atomic-file.js` | **KEEP** | Shared Core | 保留底层哈希与原子替换原语；真机 durability 须在实现阶段单独验证。 |
| Windows 原型中的提权与 Kill/Start 逻辑 | **REMOVE** | Forbidden | 坚决禁止移植提权杀进程逻辑，Windows 严格遵循无害只读探测。 |
| 原 #10 基于 mtime 与通用 ping 的自动回滚 | **REMOVE** | Superseded | 彻底废除，以基于只读 Controller 证据的声明式语义断言与引导式恢复取代。 |

---

## 3. 修订后的 #8 macOS 实施契约 (Revised macOS Implementation Contract)

### 3.1 核心职责与边界 (收敛至只读观测与交付支持)
macOS Adapter 仅负责收集 macOS 宿主物理事实，不主导网络生效判定：
1. **宿主与能力发现 (动态发现，不假定 UDS 唯一性)**：
   - 识别 CVR 安装位置（`/Applications/Clash Verge.app` 或用户目录应用）；
   - 动态识别 Service 模式（`clash-verge-service` LaunchDaemon）与 Sidecar 模式；
   - **动态发现可用的 Mihomo 控制器 / 观测接口面**：在已受测的 Service 模式 macOS 宿主上观测到了 Unix Domain Socket (`<mihomo-uds>`)，但这仅是候选形式，生产适配器必须动态发现并在无法无歧义绑定时 Fail-Closed。
2. **逻辑目标绑定 (无需 Target 写权限)**：
   - 接收 `LogicalTarget`，执行稳定身份绑定（Stable Identity Binding）；
   - 验证目标实体存在性与**只读可读性**（Target exists & readable for digest/evidence）；
   - 存在歧义或不可读时严格 **Fail-Closed**；
   - *说明：近期 User-Assisted MVP 中 Fleet 不直接写真实 CVR 目标文件，物理变更由用户在 CVR 原生 UI 中保存完成。仅未来经授权的自动化 Seam 或引导式恢复才涉及 Fleet 写能力。*
3. **隐私安全观测物证**：
   - 提取目标文件当前的 SHA-256 物理摘要；
   - 所有输出路径执行 `~` 脱敏，清除任何系统用户名或凭据。
4. **User-Assisted 交付支持**：
   - 为用户提供就绪的 Candidate 构件路径，支持安全复制或交付至系统剪贴板。
5. **维护性重启兜底 (Maintenance Fallback Only)**：
   - 仅在未来独立显式维护子命令下、经用户显式授权后才可执行；自动化主流程绝不调用。

---

## 4. 修订后的 #9 Windows 实施契约 (Revised Windows Implementation Contract)

### 4.1 核心职责与边界 (动态发现与事实证据化)
Windows Adapter 遵循与 macOS 相同的观测契约，仅注入 Windows 物理事实，且严格避免将单机观测泛化为通用假定：
1. **动态宿主与能力发现 (Fail-Closed Discovery)**：
   - 生产适配器必须执行 `discover -> classify evidence -> fail closed`；
   - 测试机观测到的 `C:\Program Files\Clash Verge`、`%APPDATA%\...`、High Integrity Level (`~ RUNASADMIN`)、待机无持久文件锁及 Named Pipe 仅作为测试机物证与 fixture 候选，**Observed on tested Windows host != Windows universal fact**；生产适配器绝不硬编码这些假定，遇到歧义严格 Fail-Closed。
2. **逻辑目标绑定**：
   - 将 `LogicalTarget` 映射到 Windows 本地物理路径；
   - 验证目标存在性与只读可访问性，禁止模糊匹配，歧义时 Fail-Closed。
3. **Windows 专属文件事实与持久性校验**：
   - 动态验证待机状态句柄未锁，避免 `ERROR_SHARING_VIOLATION`；
   - 观测并报告 NTFS ACL 权限继承状态；若未来需要重新验证 durability/ACL，默认必须使用隔离的临时 fixture，不得直接覆写真实配置。
4. **隐私安全观测**：
   - 对 Windows 路径中包含的用户目录（如 `C:\Users\username\...`）执行通用脱敏（`%USERPROFILE%` 或 `~`）。
5. **“四不”安全铁律**：
   - **不**执行进程终止或拉起（No kill/start）；
   - **不**请求或触发 UAC 提权（No elevation）；
   - **不**修改系统网络适配器、TUN、系统代理（No network mutation）；
   - **不**发起真实外部网络探测或第三方账号请求。

---

## 5. 三层架构切分与收窄后的 #10 契约 (Three-Tier Architecture & Revised #10)

为避免 #10 膨胀为涵盖全生命周期的巨石模块（God Module），将职责清晰解耦为三个层次：

```text
┌────────────────────────────────────────────────────────────────────────┐
│               1. Shared Change / Preparation Core                      │
│  - Operation ID & Change Intent 管理                                    │
│  - base_digest / candidate_digest 独立追踪                             │
│  - Candidate Artifact 编译与确定性校验                                 │
│  - 不可变 Recovery Snapshot 捕获                                       │
│  - 本地 Durable Journal 生命周期与 Pre-Handoff 冲突检测                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ provides target & snapshot
       ┌────────────────────────────┴────────────────────────────┐
       ▼                                                         ▼
┌───────────────────────────────┐         ┌───────────────────────────────┐
│ 2. macOS Observation Adapter  │         │ 2. Windows Observation Adapter│
│              (#8)             │         │              (#9)             │
│ - Stable target resolution    │         │ - Dynamic target resolution   │
│ - Host capability facts       │         │ - Host capability & integrity │
│ - Source digest observation   │         │ - Source digest observation   │
│ - Dynamic controller discovery│         │ - Dynamic controller discovery│
│ - Privacy-safe observations   │         │ - Privacy-safe observations   │
└───────────────────────────────┘         └───────────────────────────────┘
       │                                                         │
       └────────────────────────────┬────────────────────────────┘
                                    │ delivers PlatformObservationBundle
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│            3. #10 Reconciliation / Verification Core                   │
│  - 声明式语义断言判定 (Semantic Assertions over rules & topology)       │
│  - 跨平台只读物证交叉合成 (Evidence Combination)                        │
│  - 激活状态裁决: Applied / SavedOnly / Conflict / Unchanged / Unknown   │
│  - 处置行动决策: none / reconcile / manual_required / guided_recovery   │
│  - 丢包/失联对账 (Lost-Response / No-Response Reconciliation)           │
│  - 恢复资格评估 (Recovery Eligibility) 与 GuidedRecoveryPlan 决策       │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.1 #10 Verification / Reconciliation Core 的最小核心责任
#10 **不**负责 Candidate 构建、全部 Journal 创建或平台路径扫描，仅专注于事实判定：
1. **语义激活断言引擎 (Semantic Assertion Engine)**：
   - Primary Evidence：只读查询 Mihomo External Controller（`/rules`, `/proxies`, `/configs`），验证意图要求的规则与拓扑是否存在；
   - Supplemental Evidence：CVR 运行日志仅作失败辅助归因（如定位 `use_script` 报错），绝不能单独作为终态依据；
   - Fail-Closed 原则：断言未完全满足或证据不足时，严格输出 `Unknown`。
2. **三维状态裁决模型**：
   - 结合 Attempt Result、源码摘要比对与语义断言，输出 `Activation Outcome` 与正交的 `Next Action`。
3. **关键处置与收敛规则**：
   - **SavedOnly 规则**：源码已保存但运行时未激活，默认系统未收敛，必须为 `next_action: manual_required`；仅当变更意图显式允许延迟激活时才允许为 `none`。
   - **取消收敛规则**：只有证明系统状态在取消前绝对未变，才允许为 `Unchanged` + `none`；否则保持 `Unknown` + `reconcile`。
   - **超时与掉线对账**：记录 `no_response` (`terminal: false`)，通过 `reconcile(op_id)` 进一步确认现场，绝不盲目重复下发变更。
4. **恢复协调决策 (Recovery Coordinator)**：
   - 评估恢复资格（归因一致、存在一致的 `last_known_good`、无外部冲突），生成 `GuidedRecoveryPlan`。

---

## 6. 逐事实证据溯源与凭据安全边界 (Per-Fact Evidence & Secret Boundary)

### 6.1 证据溯源结构 (Per-Fact Provenance)
为杜绝“一项事实 Verified 导致整个 Bundle 虚高为 Verified”的风险，每个事实字段独立携带 Provenance，证据级别严格保持：`Verified | Reported | Inferred | Unknown`（不使用 `None`）：

```typescript
type EvidenceLevel = 'Verified' | 'Reported' | 'Inferred' | 'Unknown';

interface FactEvidence {
  level: EvidenceLevel;
  source: string; // 证据来源，如 'file_sha256' | 'ps_scan' | 'controller_query' | 'tested_host_observation'
  detail?: string;
}

interface PlatformObservationBundle {
  platform: 'darwin' | 'win32';
  target_digest: {
    value: string | null;       // 目标物理文件当前 SHA-256，若不存在为 null
    exists: boolean;
    evidence: FactEvidence;
  };
  topology_mode: {
    value: 'SERVICE' | 'SIDECAR' | 'UNKNOWN';
    evidence: FactEvidence;
  };
  controller_endpoint: {
    endpoint_type: 'unix_socket' | 'named_pipe' | 'http';
    sanitized_address: string;  // 脱敏端点标识 (如 <mihomo-uds> 或 127.0.0.1:<port>)
    auth_required: boolean;
    auth_mode: 'none' | 'token' | 'opaque_local';
    evidence: FactEvidence;
  } | null;
  sanitized_paths: Record<string, string>;
}
```

> [!CAUTION] 凭据安全与隐私铁律
> 1. **严禁凭据泄漏**：Observation Bundle、日志及向外暴露的诊断信息中，**严禁包含明文凭据**（如 Mihomo secret、CVR singleton token、service session token），亦**严禁携带 `credential_ref` 或环境变量名**；
> 2. **职责正交解耦**：凭据解析与会话建立属于独立的 local access/session layer，绝不属于只读 observation evidence。

---

## 7. 最小测试接缝与验证矩阵 (Testing Seams & Verification Matrix)

### 7.1 完全合成测试 (Synthetic Tests - 跨平台 CI/本地无害运行)
1. **状态机与对账场景矩阵**：涵盖 #16 规范全部 8 大场景（A 到 H：正常、仅保存未生效、回包丢失、外部冲突、用户取消、远端宕机、脚本静默降级、掉线重连）；
2. **声明式断言引擎匹配测试**：输入合成的 `/rules` 与 `/proxies` JSON 快照，验证断言匹配算法；
3. **恢复资格评估测试**：测试已知良好快照丢失、哈希冲突、目标漂移等各种异常组合下的恢复资格判定；
4. **路径脱敏纯函数测试**：针对 POSIX 和 Windows 路径字符串的脱敏逻辑测试。

### 7.2 仅能由本机验证的宿主事实 (Host Facts - Read-Only / Isolated)
- **安全边界纪律**：真机验证严格遵循只读原则；若需测试耐久性/ACL，默认使用隔离临时 fixture，严禁直接覆写真实配置。
- **macOS 本机**：LaunchDaemon Service 与 GUI 进程的实际 PID/PPID 关系；只读探针下的端点通信与权限。
- **Windows 本机**：CVR 进程 High Integrity Level（`~ RUNASADMIN`）；Named Pipe 管道实测可达性；NTFS 写入与 ACL 继承。

---

## 8. 显式用户授权边界 (Explicit User Authorization Boundaries)

以下动作具有破坏性或系统级副作用，**严禁由自动化主流程静默执行，必须触发显式用户授权 (Explicit User Authorization)**：
1. **任何形式的进程终止或重启**（包括 macOS 的维护性重启兜底）；
2. **物理配置文件的覆写或外部还原**（User-Assisted MVP 下由用户自行在 CVR 中保存）；
3. **系统级网络状态变更**（开启/关闭系统代理、切换 TUN 虚拟网卡接口、修改 DNS 解析设置）；
4. **发送真实业务流量的连通性探测**（涉及特定第三方账号或可能触发地理风控的远端请求）；
5. **在检测到 `Conflict` 状态时强制覆盖**。

---

## 9. #17 跨平台验收依赖与最小 Tracer Path (Smallest Tracer Slice)

### 9.1 启动 #17 的最小 Tracer Path (Phase-A Smoke Tracer)
启动 #17 Cross-Platform Acceptance **不需要等待 #8、#9、#10 全部生产代码完工**。只需完成以下最小贯穿切片即可启动 Phase-A：

```text
[Step 1: 最小 Shared Change Operation 契约]
  │  定义统一的 candidate_digest、base_digest 与预期规则拓扑断言
  ▼
[Step 2: 双平台合成观测测试桩 (Fixtures)]
  ├─► macOS Synthetic Observation Fixture (模拟 Unix Socket & Service 拓扑)
  └─► Windows Synthetic Observation Fixture (模拟 Named Pipe & Elevated 事实)
  ▼
[Step 3: 共享 #10 对账核心 (Shared Reconciler Tracer)]
  │  纯逻辑判定引擎，输入双平台测试桩观测数据
  ▼
[Step 4: 双平台断言一致性验证]
  │  验证双平台在相同物理情景下输出 100% 一致的 Activation Outcome 与 Next Action
  ▼
[Step 5: #17 Phase-A tracer / smoke slice ready or PASS]
```

### 9.2 #17 验收完整覆盖面说明 (Full Acceptance Scope)
上述 Tracer 仅作为 #17 的**最小启动与贯穿证据**，不等于完整验收门禁已关闭。完整 #17 跨平台验收仍须逐步覆盖以下核心维度：
- CVR stable/dev capability 差异；
- target/profile/instance 标识不匹配；
- Busy / Skipped / Unknown 状态流转；
- 丢包 (lost response) 与 Agent transport 掉线恢复；
- 并发外部编辑冲突 (concurrent user/GUI edit)；
- 不可变恢复快照与 last-known-good 判定；
- 候选已保存但运行时未激活 (candidate saved but not active)；
- No-op apply 跳过判定；
- 恢复异常与失败 (recovery failure)。

### 9.3 启动前置依赖顺序 (Dependency Order)
1. **前置 1**：冻结共享数据契约（`ChangeOperation`, `PlatformObservationBundle`, `SemanticAssertion`）；
2. **前置 2**：构建 macOS 与 Windows 观测数据测试桩（Synthetic Fixtures）；
3. **前置 3**：实现纯逻辑的 `Shared Reconciler`（包含三维状态裁决与断言匹配）；
4. **触发点**：**此时 #17 即可正式启动 Phase-A 合成验收测试**；
5. **后续推进**：在 Phase-A 通过后，再分别接入 macOS 与 Windows 本机只读真实探针，执行最小受控真机观测。

---

## 10. 剩余未知项与风险登记 (Remaining Unknowns & Risks)

1. **Windows Named Pipe 的认证机制细节**：Windows 下 CVR 内核暴露的 Named Pipe 是否强制要求特定 ACL 或客户端 Token，需在 Windows 真机上进行受控只读拨号验证。
2. **CVR 跨平台日志格式一致性**：CVR 记录脚本异常（`use_script exception`）的日志文件路径与日志文本格式在 Windows 与 macOS 上是否存在平台差异，需要收集真实日志样本。
3. **本地 Journal 崩溃一致性**：当操作系统突然掉电或 Agent 进程被外部强杀时，文件系统上的 Journal 文件是否需要额外的预写日志 (WAL) 机制保证无损坏，待后续实现评估。
