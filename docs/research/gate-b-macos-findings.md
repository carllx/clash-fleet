# Clash Fleet — Gate B macOS 部署与生效生命周期调研与实测报告 (Gate B macOS Findings)

- **调研角色**: Browser Lead & Agentic Team
- **文档状态**: Gate B 原型实验与生命周期分析沉淀 (Gate B Verified Research Artifact)
- **基准提交**: `main @ 4a75575af28422ce5888a9d768edbc09f53abe98`
- **原型分支**: `prototype/deploy-gate-macos`
- **日期**: 2026-09-30

---

## 1. 核心问题与验证目标

在 Clash Fleet 部署链路中，客户端拉取器（Puller）或外部同步工具需要将构建完成的扩展脚本写入 Clash Verge Rev (CVR) 的配置目录（如 `profiles/Script.js`）。

> **核心问题**: **外部工具更新 `Script.js` 后，到底经过什么生命周期，CVR 才真正重新读取并执行它？**

本调研在真实 macOS Clash Verge Rev 运行环境下，通过源码剖析、无副作用的执行物证（Execution Witness）以及严格可恢复的自动化探针，回答：
1. raw external file replacement 是否会自动生效；
2. 如果不会，最小必要动作是什么；
3. CVR-owned save/apply path 与直接覆盖文件有什么差别；
4. invalid script 会发生什么；
5. backup / validation / rollback 的真实边界在哪里；
6. 哪些结论属于通用 CVR lifecycle，哪些仍需 Windows 验证。

---

## 2. 证据分级体系 (Evidence Discipline)

本报告严格区分三类结论：
- **Verified (本机实测验证)**: 在当前 macOS 真实运行环境中通过自动化探针直接观测到，具备明确命令、文件哈希、PID、时间戳与物证支撑；
- **Source-supported (一手源码支撑)**: 基于本地安装的 CVR v2.5.6（Git Commit `b057bd964ccd156f68bc43a3a8ed66cf3cb1cd7b`）以及主线源码的直接实现；
- **Inferred (架构推论)**: 根据实测与源码推演出的部署器设计建议，需在后续跨平台或多环境阶段进一步核验。

---

## 3. 运行环境与安装身份 (Runtime Identity & Parity)

经对当前 macOS 系统与 CVR 运行态的详尽核查，确认以下一手事实：

### 3.1 操作系统与硬件
- **OS**: macOS 26.6.2 (Darwin arm64)
- **Host**: Apple Silicon (MacBook/Mac)

### 3.2 Clash Verge Rev 安装事实
- **CVR 实际版本**: `2.5.6` (`CFBundleShortVersionString = 2.5.6`, `CFBundleVersion = 2.5.6`)
- **应用安装路径**: `/Applications/Clash Verge.app`
- **主二进制程序**: `/Applications/Clash Verge.app/Contents/MacOS/clash-verge`
- **内置 Mihomo 二进制**: `/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo` (`v1.19.31 darwin arm64 with go1.22.12`)
- **CVR App Home 目录**: `/Users/yamlam/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev`
- **Profiles 存储目录**: `.../io.github.clash-verge-rev.clash-verge-rev/profiles`
- **运行时渲染配置文件**: `.../io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml`
- **日志文件路径**: `.../io.github.clash-verge-rev.clash-verge-rev/logs/latest.log`

### 3.3 运行态进程架构
- **CVR 前端/GUI 主进程**: 以普通用户 (`yamlam`) 运行，由 Tauri 驱动；
- **Mihomo 核心进程**: 在当前 macOS 上由 Privileged Helper Tool (`clash-verge-service`) 托管运行于 Service 模式，内核工作目录为 `/Library/Application Support/clash-verge-service/users/501/runtime`；
- **控制通道 (External Controller)**: 在本机未开放公共 TCP 端口，监听本地 Unix Domain Socket: `/var/run/clash-verge-service/users/501/verge-mihomo.sock`。

### 3.4 源码版本与调研基准一致性 (Runtime / Source Parity)
- Architecture Survey 锚定主线提交: `c4f9d65e07a9fad6d87fe1bbf8f0e90f5a3ebd84` (锁定 `boa_engine = 0.22.0`)；
- 本地安装 v2.5.6 官方发布提交: `b057bd964ccd156f68bc43a3a8ed66cf3cb1cd7b` (发布于 2026-09-26)；
- **Parity 确认**: 两者在 `src-tauri` 核心链路（`enhance/mod.rs`、`enhance/script.rs`、`cmd/save_profile.rs`、`core/manager/lifecycle.rs`）上的逻辑与数据结构 100% 一致。

---

## 4. 执行物证机制 (Execution Witness Design)

为了严格证明“**CVR 确实重新执行了扩展脚本**”，而非仅仅是下游重载了配置文件，实验建立了以下双重无副作用物证体系：

1. **配置注入物证 (Config Injection Witness)**:
   - 测试脚本在返回给 CVR 的 `config` 对象中注入唯一的良性键值对：
     `config["gate_b_witness"] = "CLASH_FLEET_GATE_B_<sequence>";`
   - **语义不变性**: 规则、节点、策略组拓扑、Rule Provider 等代理语义完全保持 100% 不变；
   - **Mihomo 兼容性验证**: 实测确认 Mihomo 核心对 YAML 顶层良性未知扩展字段表现为完全容忍（Validation Success: Exit 0）；
   - **确凿判定依据**: 只有当 CVR 重新执行了 `Script.js` 并完成 `enhance` 配置生成流水线时，该唯一 marker 才会出现在最终生成的 `clash-verge.yaml` 中，且其文件修改时间（mtime）被当次时间戳更新。

2. **日志与错误物证 (Log & Exception Witness)**:
   - 观测 `latest.log` 中记录的生命周期事件（如 `[Validate] 生成临时配置文件用于验证`、`[cmd配置save] 保存项影响当前运行时配置` 等）；
   - 在语法错误测试中，比对 Boa 引擎执行异常是否被捕获并触发日志。

3. **安全恢复保护 (Safety Isolation)**:
   - 探针通过 `SafeScriptContext` 上下文管理器建立内存与磁盘双重备份；
   - 无论发生何种意外，`finally` 块必须无条件回滚磁盘文件，并通过 SHA-256 比对严格校验基线一致性。

---

## 5. 实测结果与生命周期因果链 (Lifecycle Experiments)

### 5.1 Test A — 基线记录 (Baseline)
- **Script.js 初始 SHA-256**: `d3e3955588966758037c5a72753eb8cd4afdb72940d22d5d0abd0ad36aa10ba5`
- **Active Profile**: `RiDBcdvBOqRI` (CreamData)
- **Mihomo 运行时状态**: 核心运行中，`clash-verge.yaml` 顶层无任何 `gate_b_witness` 字段。

### 5.2 Test B — 纯外部文件覆盖实验 (Raw External Replacement)
- **实验动作**:
  1. 外部将含有 `CLASH_FLEET_GATE_B_01_RAW` 唯一物证标记的内容直接写入 `profiles/Script.js`；
  2. 不点击 GUI 界面；
  3. 不重启 CVR；
  4. 不向 Mihomo 发送 reload；
  5. 持续观测 10 秒。
- **实测现象**:
  - `clash-verge.yaml` mtime 完全未发生变化 (`mtime_changed = False`)；
  - `clash-verge.yaml` 中未出现任何物证标记 (`witness_observed = False`)；
  - `latest.log` 增量大小为 0 字节。
- **判定结果**: **`NO_AUTO_APPLY_OBSERVED` (Verified)**
- **根因分析 (Source-supported)**:
  审查 CVR `src-tauri` 源码全部依赖项与实现，确认 CVR **未集成任何基于 `notify` 或操作系统文件系统事件（fs-events）的 Watcher**。CVR 不会感知磁盘文件的被动修改。

### 5.3 负向对照实验 — Mihomo 内核单独重载 (Negative Control: Mihomo Reload)
- **实验目的**: 严禁将“Mihomo `/configs` reload”与“CVR 重新执行 Script.js”混淆。
- **实验动作**:
  1. 外部修改 `profiles/Script.js`，注入标记 `CLASH_FLEET_GATE_B_NEG_CTRL_MIHOMO_VALID_PATH`；
  2. 通过本地 Unix Domain Socket 向 Mihomo 发送 `PUT /configs?force=true`，指定当前允许的运行时路径；
  3. 观察 CVR 是否被动重新执行脚本。
- **实测现象**:
  - Mihomo 外部控制接口返回 **`HTTP 204 No Content`**（内核成功完成配置热重载）；
  - 但 CVR 的 `clash-verge.yaml` 的 mtime 毫秒未动；
  - `clash-verge.yaml` 中完全不存在该 marker。
- **判定结果**: **`VERIFIED NEGATIVE CONTROL` (Verified)**
- **架构定论**:
  Mihomo 内核处于配置生成流水线的下游末端，只负责消费 YAML。内核 reload 是单向只读动作，绝不会反向唤醒上游 CVR 重新执行 Boa 脚本。

### 5.4 Phase 4 — 寻找最小必要生效动作 (Minimum Confirmed Apply Trigger)

在已证明外部纯文件替换不自动生效后，对多种候选触发动作进行了梯级验证：

| 候选动作 | 动作机制 | 是否需用户交互 | 实测结果 | 耗时与开销 | 判定 |
|---|---|:---:|:---:|:---:|:---:|
| **Candidate 1: 单例唤醒 (Singleton Wake-up)** | 调用 `GET /commands/visible` | 否 | **无效** (`DOES_NOT_APPLY`) | ~50ms | 仅激活窗口，不跑配置流水线 |
| **Candidate 2: 重新选择当前 Profile (In-App)** | 界面点击或托盘选择 Profile | **是** (需 UI/托盘) | **有效** (`APPLY_CONFIRMED`) | 即时 (<100ms) | 应用内最小交互动作 |
| **Candidate 3: 优雅重启 CVR 进程 (Headless)** | 发送 `SIGTERM` 后通过 `open` 重新拉起 | **否** (全自动) | **有效** (`RESTART_CONFIRMED`) | ~1.5s ~ 2.0s | **外部工具无头生效的最小动作** |

#### 深度解析：
1. **进程级最小动作（Headless）**:
   - 当外部工具更新 `profiles/Script.js` 后，执行：
     ```bash
     kill -15 <CVR_PID> && sleep 0.5 && open -a "Clash Verge"
     ```
   - **生命周期因果链**:
     `SIGTERM` 触发 `feat::quit` 优雅清理资源退出 $\to$ 重新启动触发 `resolve_setup_async` $\to$ 调用 `Config::init_runtime_config()` $\to$ 调用 `Config::generate_and_validate()` $\to$ 调用 `enhance::enhance(profiles)` $\to$ `chain.rs` 实时读取磁盘上的 `profiles/Script.js` $\to$ Boa 引擎执行 `main(config, profileName)` $\to$ 写入 `clash-verge.yaml` $\to$ 内核应用。
   - **实测物证**: 启动后在 `clash-verge.yaml` 中成功捕获到 `gate_b_witness: CLASH_FLEET_GATE_B_TEST_STEP`！
2. **应用内最小动作（In-App）**:
   - 若用户正在前台操作，在 Profiles 列表中重新点击当前选中的 Profile，CVR 内部调用 `patch_profiles_config` $\to$ `update_config_forced()`，实时从磁盘重新加载并执行 `Script.js`，无需重启应用。

---

## 6. 非法脚本与回滚边界 (Invalid Script & Failure Boundary)

### 6.1 路径对比：Raw Replacement vs CVR-Owned Save

| 属性维度 | CVR 官方路径 (`save_profile_file`) | 外部文件直接覆盖 (Raw Replacement) |
|---|---|---|
| **校验时机** | **保存瞬间立即执行** (`CoreConfigValidator`) | **写入时不校验**；延迟至下次配置生成时 |
| **静态 Main 检查** | 检查包含 `function main`/`const main`/`let main` | 无前置检查 |
| **Boa 语法解析** | 在保存阶段即执行语法 AST 解析 | 无前置解析 |
| **校验失败行为** | **CVR 自动调用 `restore_original` 回滚磁盘文件** | **损坏文件直接永久留在磁盘上** |
| **自动备份 (AutoBackup)** | 校验成功后触发 `AutoBackupManager::trigger_backup` | **完全不触发** CVR 自动备份机制 |
| **运行态降级保护** | 阻止配置落地，维持现有核心配置 | `use_script` 捕获异常，**降级为未经脚本处理的基础配置** |
| **客户端恢复职责** | CVR 自闭环保护 | **必须由外部工具自行实现备份与回滚** |

### 6.2 异常实测现场剖析 (Phase 5 实测)
我们写入了包含非法语法的脚本：
```javascript
function main(config, profileName) {
    this is an intentional syntax error !!!
    return config;
}
```
并重启 CVR 验证生命周期：
1. **系统可用性**: CVR 进程正常存活启动，未发生崩溃或 Panic；
2. **内核可用性**: Mihomo 核心正常启动，网络服务未中断；
3. **分流逻辑失效**: 由于 `use_script` 的设计合约是：
   > *"Never fails: exceptions are logged and the input config is returned unchanged."*
   Boa 语法解析报错后，`use_script` 返回了未经脚本修改的裸输入配置。所有用户自定义分流规则、策略组拓扑全部失效，静默退化为机场订阅默认规则；
4. **磁盘状态**: 磁盘上的 `profiles/Script.js` 仍然保持为损坏内容，CVR 并未自动恢复。

**架构结论**:
**外部工具绝不能寄希望于 CVR 的自动防护机制。外部部署器必须在写入前完成严谨的本地 Pre-flight 验证（如 Gate A 验证器），并在写入失败或运行时异常时自主执行原子回滚。**

---

## 7. 通用生命周期与跨平台差异 (Cross-Platform Parity)

### 7.1 通用 CVR 生命周期事实（跨平台同源）
以下结论源自 CVR 核心 Rust 业务代码，在 macOS 与 Windows 上完全一致：
- `profiles/Script.js` 无文件监控，外部文件直接覆盖不会自动生效；
- Mihomo `/configs` reload 与 CVR 脚本执行不存在逆向触发关系；
- CVR 内部 `use_script` 异常时的静默降级行为一致；
- `patch_profiles_config`（Profile 切换）触发 `update_config_forced` 的链路一致。

### 7.2 仍需 Windows 现场验证的关键点 (Future Windows Frontier)
1. **文件锁机制 (File Locking)**:
   Windows 对正在被其他进程以共享读打开的文件存在严格的独占锁限制。当 CVR 正在运行并读取 `Script.js` 时，外部写入是否会被 `ERROR_SHARING_VIOLATION` 拦截；
2. **重启生命周期与进程模型**:
   - 在 Windows 上，CVR 提供 Service 模式与 Sidecar 模式；
   - 重启 CVR GUI 是否会导致 Service 模式下的 Mihomo 核心短暂掉线或 TUN 适配器重置；
3. **无头重启调度命令**:
   Windows 下外部工具触发优雅重启的命令实现差异（如 `Stop-Process` / `taskkill` 与拉起参数）。

---

## 8. Gate B 最终结论与工程指导

### 8.1 决策判定分类 (Verdict)
**Gate B macOS 判定结果**: **`REQUIRES_RESTART` (对于完全无头/无人值守部署工具)** / **`REQUIRES_CVR_ACTION` (对于有人值守或前台辅助场景)**。

### 8.2 对下游部署器（Deployer）的硬性架构规格指引
基于 Gate B 实测证据，Clash Fleet 的客户端部署器必须遵循以下流水线规范：

$$\text{Pull} \to \text{Pre-flight Validate (Local Boa)} \to \text{Backup (Disk Snapshot)} \to \text{Atomic Write} \to \text{Trigger Apply} \to \text{Verify Witness} \to \text{Rollback on Failure}$$

1. **写前验证 (Pre-flight Validation)**:
   客户端在将脚本写入 `profiles/Script.js` 之前，必须在本地使用与 CVR 相同的 Boa 运行时解析脚本语法，并断言 callable global `main` 存在。杜绝任何 invalid script 落盘。
2. **自主备份 (Client-side Backup)**:
   部署器在写入前将当前 `profiles/Script.js` 备份为 `profiles/Script.js.bak`。
3. **原子应用与触发 (Atomic Apply & Trigger)**:
   - 无头模式下：完成写入后，发送进程信号优雅重启 CVR；
   - 验证 `clash-verge.yaml` 的 mtime 刷新与 witness marker 出现；
4. **验证失败回滚 (Auto-Rollback)**:
   若超时未观测到 witness 或内核未就绪，部署器立即还原备份脚本并再次重启恢复基线。
