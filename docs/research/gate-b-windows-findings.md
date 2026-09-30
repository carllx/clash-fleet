# Gate B: Windows 平台差异与生效生命周期验证报告 (Windows Platform-Delta Findings)

- **调研角色**: Windows Platform Lead & Agentic Team
- **文档状态**: 调研成果持久化沉淀 (Durable Research Artifact - Revised)
- **基准提交 (Base)**: `main @ 4a75575af28422ce5888a9d768edbc09f53abe98`
- **对应分支 (Branch)**: `prototype/deploy-gate-windows`
- **已验收 macOS 参照基线**: `prototype/deploy-gate-macos @ 1385f5d39dd3403a22dd57da297fb1c259bc63e2`
- **日期**: 2026-09-30

---

## 1. 概述与核心证据清单 (Executive Summary & Evidence Bundle)

本报告聚焦回答 Mission Contract 明确界定的核心目标：
> **macOS 已确认的 CVR deploy/apply lifecycle，在 Windows 上有哪些真正的平台差异（Platform Delta）？**

### 核心判定与物证概览
| 验证维度 | 判定分类 / 结论 | 证据级别 | 核心实测 / 源码事实物证 |
|---|---|:---:|---|
| **CVR 源码版本同源性** | **`SOURCE_PARITY_IDENTICAL`** | Source-verified | 本地安装版本 2.5.6，对应官方发布提交 `b057bd964ccd156f68bc43a3a8ed66cf3cb1cd7b`；与主线 anchor `c4f9d65e07a9fad6d87fe1bbf8f0e90f5a3ebd84` 在 4 个核心生命周期文件中 100% blob-identical |
| **Windows 文件替换行为** | **`DIRECT_WRITE_OK`**<br>(同时支持 `ATOMIC_REPLACE_OK`) | Host-observed | CVR 运行时直接文件覆盖与 `os.replace` 原子替换均成功，**未遭遇 `ERROR_SHARING_VIOLATION` 或文件锁拦截**；CVR 常驻态不持有文件句柄 |
| **ACL 权限纪律** | **`REPORTED / NOT CAPTURED BY REPRODUCIBLE PROBE`** | Reported (Host PowerShell) | 现场 PowerShell `Get-Acl` 实测显示 `FullControl` SDDL 保持一致；但 probe 脚本内未做 Win32 自动化断言，按纪律降级标定 |
| **被动文件替换生命周期** | **`NO_AUTO_APPLY_OBSERVED`** | Host-observed | 外部静默更新 `profiles/Script.js` 后，5s 内 `clash-verge.yaml` 的 mtime 与 SHA 完全未动，未感知脚本更新，与 macOS 一致 |
| **确证的无头生效触发** | **`CONFIRMED_HEADLESS_TRIGGER = Elevated Process Restart`** | Host-observed / Source-verified | 因 `HKLM\...\AppCompatFlags\Layers` 配置了 `~ RUNASADMIN`，CVR GUI 运行于 High Integrity；普通进程无法 `taskkill`，外部拉起需管理员提权或提权计划任务 |
| **服务连续性差异 (Service Continuity Delta)** | **`SIDECAR_CORE_RESTART_OBSERVED`** | Host-observed (Sidecar) / Inferred (Service) | 本机未安装 CVR Service，运行于 **Sidecar 模式**（`verge-mihomo.exe` 为 GUI 进程直接子进程）；GUI 重启实测必然导致内核重启与 TUN 重建；Service Mode 零中断仅作为未来候选假说；macOS 虽确证 Service 拓扑，但 GUI 重启时内核连续性与零中断未直接测量 (NOT ESTABLISHED) |
| **非法脚本运行态测试** | **`NOT REQUIRED`** | Policy Rule | 安装版本与源码同源无分歧，共享 Boa `use_script` 降级逻辑已在 macOS 确证且源码支持，安全免除破坏性 live probe |
| **基线还原与网络验证** | **`PASS`** | Host-observed | byte-for-byte 还原原始 `Script.js`，SHA-256 强校验完全一致；live proxy 流量持续正常 (HTTP 204) |

---

## 2. 现场运行态身份与架构核实 (Runtime Identity)

经现场 Windows 环境直接探查，核实的技术参数如下：

```yaml
Operating System:
  Caption: Microsoft Windows 11 Pro
  Version: 10.0.22621 (Build 22621)
  Architecture: AMD64 (x86_64)

Clash Verge Rev Installation:
  Display Name: Clash Verge
  Installed Version: 2.5.6 (FileVersion: 2.5.6, ProductVersion: 2.5.6)
  Install Directory: "C:\Program Files\Clash Verge"
  GUI Executable: "C:\Program Files\Clash Verge\clash-verge.exe"
  Core Executable: "C:\Program Files\Clash Verge\verge-mihomo.exe"

Application Data & Storage:
  AppData Directory: "C:\Users\carll\AppData\Roaming\io.github.clash-verge-rev.clash-verge-rev"
  Profiles Directory: "C:\Users\carll\AppData\Roaming\io.github.clash-verge-rev.clash-verge-rev\profiles"
  Active Script.js: "C:\Users\carll\AppData\Roaming\io.github.clash-verge-rev.clash-verge-rev\profiles\Script.js"
  Runtime YAML: "C:\Users\carll\AppData\Roaming\io.github.clash-verge-rev.clash-verge-rev\clash-verge.yaml"

Process Model & Topology:
  GUI Process: clash-verge.exe (PID 17868, High Mandatory Integrity Level / Elevated)
  Core Process: verge-mihomo.exe (PID 11224, ParentProcessId = 17868)
  Operating Mode: Sidecar Mode (Direct child process of CVR GUI)
  Service Status: No "clash-verge-service" installed or running.
                  (Note: Host had an unrelated, dormant legacy service "Clash Core Service" from CFW 0.20.27).

Network & Traffic Topology:
  TUN Adapter: "Meta Tunnel" (Interface: Mihomo, Status: Up, 100 Gbps)
  System Proxy: Enabled (ProxyServer: 127.0.0.1:7897)
  External Controller: Bound to Named Pipe (\\.\pipe\verge-mihomo-sidecar-release-...)
  Singleton IPC: Loopback HTTP 127.0.0.1:58966 (with x-instance-token header)
```

---

## 3. 源码一致性与可审计性 (Source Parity & Auditability)

- **本地安装版本**: Clash Verge Rev `2.5.6`；
- **官方发布对应 Ref**: `b057bd964ccd156f68bc43a3a8ed66cf3cb1cd7b` (发布于 2026-09-26)；
- **精确 Git Blob SHA 一致性 (Source-verified)**:
  与 Architecture Survey 锚定主线提交 `c4f9d65e07a9fad6d87fe1bbf8f0e90f5a3ebd84` 相比，CVR 在处理扩展脚本及保存校验的核心 Rust 代码在两个 refs 之间具有 **100% 精确 Git blob 一致性 (blob-identical)**：
  1. `src-tauri/src/enhance/mod.rs` $\to$ `02cc573203a5959ef25fa7a45a60486b3aadc4ba`
  2. `src-tauri/src/enhance/script.rs` $\to$ `2aaee11218ac3e7bcf601eac935d0596c68b0dac`
  3. `src-tauri/src/enhance/chain.rs` $\to$ `797b02cd713ef41b186ea9731379799ccf9e5d5c`
  4. `src-tauri/src/cmd/save_profile.rs` $\to$ `e1000847f673c683eb22837c38695cd6a48454e9`
- **跨平台同源判定**:
  配置流水线核心逻辑（读取 `profiles/Script.js` $\to$ Boa 解析 $\to$ 生成 `clash-verge.yaml`）在 Windows 与 macOS 上完全由相同 Rust 源码驱动。

---

## 4. Windows 文件替换行为实测 (File-Replacement Behavior)

Windows 平台由于 NTFS 驱动层与 Win32 文件共享模型的特殊性，进程在打开文件时通常默认施加排他或共享锁限制。为验证部署器能否在 CVR 运行态下无障碍替换 `Script.js`，设计并执行了受控测试：

### 4.1 基线保护与回滚保障
- 原始基线 `profiles/Script.js` SHA-256：
  `d3e3955588966758037c5a72753eb8cd4afdb72940d22d5d0abd0ad36aa10ba5`
- 写入前建立 byte-for-byte 镜像副本 `Script.js.baseline_backup`，SHA-256 校验一致。

### 4.2 受控测试结果
采用合规合成桩 `prototype/gate-b-windows/fixtures/valid_witness_script.js`：
1. **直接文件覆写 (Direct Write)**:
   - 采用标准文件写入流（truncate & overwrite）；
   - **结果**: `DIRECT_WRITE: SUCCESS`，未发生 `ERROR_SHARING_VIOLATION`（WinError 32）或 `Access is denied`；
2. **原子替换 (Atomic Replace)**:
   - 写入临时文件 `Script.js.tmp_probe`，通过 Win32 `MoveFileExW` / `os.replace` 原子替换；
   - **结果**: `ATOMIC_REPLACE: SUCCESS`，原子落盘成功；
3. **ACL 权限与所有权继承纪律**:
   - **物证来源**: 在本次验证现场，交互式 PowerShell `Get-Acl` 探查对比了写入前与写入后的权限描述符（SDDL: `O:S-1-5-21-1143672239-3323692552-625498637-1001G:S-1-5-21-1143672239-3323692552-625498637-1001D:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;FA;;;S-1-5-21-1143672239-3323692552-625498637-1001)`），`BUILTIN\Administrators`、`NT AUTHORITY\SYSTEM` 及当前用户 `carllx` 的 `FullControl` 均保持不变；
   - **纪律标定**: 由于自动化脚本 `probe.py` 本身未集成针对 Win32 ACL 描述符的前后自动化断言，本报告严格将该项标定为：
     $$\mathbf{ACL\ Behavior} = \mathbf{REPORTED\ (Host\ PowerShell\ observed)\ /\ NOT\ CAPTURED\ BY\ REPRODUCIBLE\ PROBE}$$

### 4.3 判定结论
$$\mathbf{Windows\ Script.js\ Replacement} = \mathbf{DIRECT\_WRITE\_OK\ (and\ ATOMIC\_REPLACE\_OK)}$$

**根因剖析 (Source-verified)**:
CVR 在执行配置增强链时（`chain.rs`），仅使用 `std::fs::read_to_string(path)` 进行瞬间的只读式读取并立即关闭句柄，在日常待机状态下 **完全不长期持有 `Script.js` 的文件句柄（Handle）**。因此外部工具可以在任何运行态瞬间安全执行覆盖或原子替换。

---

## 5. 被动替换生命周期验证 (Raw Replacement Lifecycle)

在成功将 `profiles/Script.js` 替换为包含 `CLASH_FLEET_GATE_B_WINDOWS_BENIGN_WITNESS` 标记的脚本后：
- 不做任何 GUI 操作；
- 不重启任何进程；
- 不触发任何网络重载；
- 进行 5 秒受控静默观测。

### 实测物证：
- `clash-verge.yaml` 的修改时间 (mtime): `False` (保持 `2026-09-30T11:24:47.9684546+08:00`)；
- `clash-verge.yaml` 的 SHA-256: `False` (完全不变)；
- `clash-verge.yaml` 中的 Witness 标记: `False` (未出现)；

### 判定结论：
$$\mathbf{Raw\ Replacement\ Lifecycle} = \mathbf{NO\_AUTO\_APPLY\_OBSERVED}$$
Windows 表现与 macOS 100% 一致：**CVR 未对 `profiles/Script.js` 建立任何文件系统监视器（FileSystemWatcher / ReadDirectoryChangesW），纯文件替换绝对不会自动触发配置重新编译与生效。**

---

## 6. Windows 确证生效触发与权限边界 (Confirmed Headless Apply Trigger)

这是本次验证揭示的 **最重大 Windows 平台差异 (Primary Platform Delta)**。

### 6.1 权限与完整性级别差异 (Integrity Level & Elevation Delta)
在 macOS 上：
- CVR GUI 进程作为普通用户（Non-root, uid 501）运行；
- 外部 CLI / Headless 探针同样以普通用户身份运行，可直接发送 `SIGTERM` 并通过 `open -a` 重新拉起，全程无需 root 提权。

而在 Windows 上：
1. **强制管理员标记**:
   注册表键 `HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers` 将 CVR 可执行文件标记为：
   `C:\Program Files\Clash Verge\clash-verge.exe : ~ RUNASADMIN`
2. **高完整性级别运行**:
   CVR GUI 进程（PID 17868）以 **High Mandatory Integrity Level (Administrator / Elevated Token)** 运行；
3. **UIPI 与进程保护隔离**:
   - 普通非提权进程（Medium Integrity，如标准用户 PowerShell 或无提权的后台 Agent）试图终止 CVR 进程时，被 Windows 内核强制拦截：
     `Stop-Process: Cannot stop process "clash-verge (17868)": Access is denied.`
     `taskkill /pid 17868: Access is denied.`
   - 普通非提权进程试图通过 `CreateProcess` 启动带有 `~ RUNASADMIN` 的二进制时，直接抛出：
     `[WinError 50] The request is not supported / ERROR_NOT_SUPPORTED`；
   - 普通非提权进程通过 `EnumWindows` 枚举窗口时，受 UIPI 保护无法向高完整性窗口投递 `WM_CLOSE`。

### 6.2 单例机制与候选通道分析 (Singleton IPC & Candidate Channels)
探查 CVR 内置机制：
1. **Loopback 单例服务器 (`127.0.0.1:<random_port>`)**:
   - CVR 启动时在 `singleton-instance.json` 记录动态监听端口与 32 字节随机 `token`；
   - 经逆向 CVR `server.rs` 源码，该服务暴露的路由仅为：
     - `GET /commands/visible`: 仅恢复窗口显示，实测 **不触发配置流水线**；
     - `GET /commands/pac`: PAC 内容代理；
     - `GET /commands/scheme`: 仅解析 `clash://` 协议订阅导入；
     - `POST /commands/dev/quit`: 退出路由仅在编译了 `verge-dev` 特性时开放，正式生产发布版返回 `404 Not Found`。
2. **计划任务 (`\Clash Verge`)**:
   - 系统存在计划任务 `\Clash Verge`（触发 `C:\Program Files\Clash Verge\clash-verge.exe`）；
   - 普通权限执行 `schtasks /run /tn "Clash Verge"` 虽可成功唤起，但由于 CVR 单例锁机制，新实例仅向旧实例发送 `/commands/visible` 后静默退出，无法强行重载配置。

### 6.3 确证的无头生效触发动作规范 (Confirmed Headless Apply Trigger)
$$\mathbf{CONFIRMED\_HEADLESS\_TRIGGER} = \mathbf{Elevated\ Process\ Restart\ (taskkill\ /F\ \to\ Launch\ with\ Elevation)}$$

- **命令机制**:
  当外部部署器具备管理员权限（Elevated Context / Scheduled Task with Highest Privileges / Service Context）时，执行：
  ```powershell
  # 1. 终止 CVR GUI 进程 (由于是管理员身份，不受 Access Denied 限制)
  Stop-Process -Name clash-verge -Force
  
  # 2. 以管理员权限重新拉起 CVR
  Start-Process "C:\Program Files\Clash Verge\clash-verge.exe" -WorkingDirectory "C:\Program Files\Clash Verge"
  ```
- **参数与单例行为**:
  - 必须确保旧实例完全退出释放 `singleton-instance.lock`（Win32 `LockFile`），否则新实例将误判为 Secondary 并退出；
  - 启动参数无需附加额外标志，CVR 启动流自动读入磁盘最新 `profiles/Script.js` 并编译输出 `clash-verge.yaml`。

---

## 7. 服务连续性差异分析 (Service Continuity Delta)

这是 Windows 平台区别于 macOS 的关键拓扑差异：

### 7.1 拓扑模式对比：Sidecar vs Service Mode

| 拓扑属性 | macOS 现状 (`prototype/deploy-gate-macos`) | Windows (当前主机现场) | Windows (理论 Service Mode) |
|---|---|---|---|
| **核心管理模式** | **Service 模式** (`clash-verge-service`) [Host-observed] | **Sidecar 模式** [Host-observed] | Windows Service 模式 [Inferred] |
| **内核进程父级** | `launchd` / Privileged Helper Tool 托管 | `clash-verge.exe` 直接衍生 (`ParentProcessId = 17868`) | `clash-verge-service` (SYSTEM 托管) |
| **控制通道** | 本地 Unix Domain Socket (`/var/run/.../verge-mihomo.sock`) | Windows 命名管道 (`\\.\pipe\verge-mihomo-sidecar-...`) | IPC / 本地管道 |
| **GUI 重启对核心影响** | **未直接测量 PID 连续性** (源码推论解耦，未测定) | **核心随之重启** (GUI 进程退出带走子进程) [Host-observed] | **预期核心保持存活** (待未来实测验证) [Inferred] |
| **TUN 适配器状态** | 未专门观测 TUN 瞬时状态 (NOT DIRECTLY MEASURED) | 瞬时重建 ("Meta Tunnel" 重启) [Host-observed] | 预期由系统服务持有不中断 [Inferred] |
| **网络中断感知 (Outage)** | **零中断结论未确立 (NOT ESTABLISHED)** | **实测短暂抖动 (~1.5s ~ 2.0s)** [Host-observed] | **假说: 零流量中断** (Inferred) |

### 7.2 现场证据剖析与结论分级
1. **macOS Gate B 参照结论精准分级**:
   - **macOS Service topology**: **`Host-observed`** (已确证运行于 `clash-verge-service` Privileged Helper Tool 托管的 Service 模式)；
   - **GUI/core continuity during GUI-only restart**: **`NOT DIRECTLY MEASURED in accepted macOS Gate B`** (macOS 实验重点在于优雅重启触发 Boa 脚本执行，未专门采样 GUI 重启前后 Mihomo 内核的 PID 连续性)；
   - **预期解耦与连续性收益 (Reduced coupling / continuity benefit)**: **`Source-supported / Inferred`** (源自 CVR 源码中服务托管进程模型的架构分析)；
   - **零中断声明 (Zero-outage claim)**: **`NOT ESTABLISHED`** (在已验收 macOS Gate B 中未作为测量事实确立)。
2. **Windows Sidecar 现场实测事实 (Host-observed)**:
   - 当前 Windows 主机运行于 **Sidecar 模式**，`clash-verge-service` 未安装；
   - `verge-mihomo.exe` (PID 11224) 显式为 `clash-verge.exe` (PID 17868) 的直接子进程；
   - 在此模式下，GUI 进程重启与核心进程重启强耦合：**GUI restart $\to$ core restart**；
   - 伴随产生 **TUN reset** ("Meta Tunnel" 瞬时重建) 与代理端口 (7897) 临时连接断开，观测到 **~1.5–2.0s observed outage** (路由重置抖动)。
3. **Windows Service Mode 架构假说 (Inferred / Future Verification Candidate)**:
   - 理论上，若 Windows 主机安装并启用 CVR 官方 `clash-verge-service`（运行于 LocalSystem），Mihomo 将被服务独立接管；
   - **纪律约束**: 由于本次验证的主机现场未安装 CVR Service，"Windows Service Mode 下 GUI 重启核心完全不掉线 / 零中断" **尚未在 Windows 现场实测验证**，明确归类为 **`Inferred / future verification candidate`**，不能作为当前 Gate B 的 Verified 事实。

---

## 8. 非法脚本策略说明 (Invalid-Script Policy)

根据 Mission Contract 约束：
- Windows 本地安装的 CVR 2.5.6 与 accepted source 具有 100% blob 一致性；
- CVR `enhance/script.rs` 中的 `use_script` 属于纯跨平台 Rust 业务代码，无操作系统差异；
- 失败降级语义（Boa 语法报错后返回未加工基础配置，维持内核运行但分流失效）已在 macOS 现场探针中获得充分验证。

$$\mathbf{Invalid\text{-}script\ Windows\ runtime\ probe} = \mathbf{NOT\ REQUIRED}$$

---

## 9. 基线状态恢复与验证 (Baseline Restoration)

所有受控探针执行完成后，严格执行了环境清理与强校验：

```text
[Baseline Restore Verification]
Original Script.js SHA256 : D3E3955588966758037C5A72753EB8CD4AFDB72940D22D5D0ABD0AD36AA10BA5
Restored Script.js SHA256 : D3E3955588966758037C5A72753EB8CD4AFDB72940D22D5D0ABD0AD36AA10BA5
Verification Outcome      : BASELINE_RESTORE_PASS (Exact Match)
Temporary Fixtures        : Cleaned up
Live Connectivity Test    : HTTP/1.1 204 No Content via 127.0.0.1:7897 (PASS)
```

---

## 10. 对下游部署器的工程建议 (Downstream Deployer Guidance)

基于本次 Windows 现场发现的 Platform Delta，Clash Fleet 客户端部署器针对 Windows 平台应落实以下规范：

1. **落盘策略 (Write Strategy)**:
   采用 `write to Script.js.tmp` $\to$ `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` 原子替换，利用 `ATOMIC_REPLACE_OK` 特性，规避任何潜在读取冲突；
2. **提权感知与权限分级 (Elevation Awareness)**:
   - 部署器必须清晰识别：Windows 上 CVR 重启**必须在管理员提权上下文**下执行；
   - 若部署器作为后台非提权服务运行，无法直接杀死高完整性 CVR 进程；应建议将部署器调度包装为具有最高权限的系统任务（Task Scheduler with `RunLevel: HighestAvailable`）或作为独立 Windows 服务运行；
3. **单例退出轮询 (Singleton Exit Polling)**:
   部署器终止 CVR 后，必须轮询等待 `singleton-instance.lock` 释放（最多 5s），再拉起新实例，杜绝并发启动冲突；
4. **服务模式建议 (Future Optimization)**:
   针对追求高可用无感重载的用户，建议后续探索与验证 CVR "Service Mode" 配置，使内核脱离 GUI 独立运行。
