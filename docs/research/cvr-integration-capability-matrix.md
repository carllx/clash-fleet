# CVR 能力与集成边界研究矩阵 (Capability & Integration Boundary Matrix)

**研究日期**：2026-10-04  
**工作单元**：Issue #13 `research(vNext): CVR capability & integration boundary`  
**证据基线**：
- 宿主实测只读快照：macOS arm64，CVR 2.5.7，Mihomo Meta v1.19.32
- 上游正式发布版：`clash-verge-rev/clash-verge-rev` tag `v2.5.7`（commit `ea509b82363a40c3c32e951d7ce9d66d66da411f`）
- 上游审查固定 Ref：`clash-verge-rev/clash-verge-rev@1a01844cb817c41e5e6b628d15e929787402187a`（领先 v2.5.7 共 11 commits，核心管理/脚本层 0 diff）

---

## 1. 证据分级说明 (Evidence Classification)

本报告严格区分四类事实与判断：
- **Verified (已核实)**：由本端只读命令直接读取的宿主系统元数据，或对固定 GitHub commit 源码逐行比对确认的实现逻辑；
- **Reported (已报告)**：上游 Issue、Release Notes 或前序审查记录中的事实陈述，本端已验证其上下文但未全部在线复现；
- **Inferred (已推断)**：由两个或以上 Verified 事实严格推导得出的架构约束或逻辑反例；
- **Unknown (未知项)**：缺乏代码或环境直接证据，不作臆测，明确留待后续探索。

---

## 2. 三版本环境与能力矩阵 (Version Capability Matrix)

### 2.1 版本与运行态快照 (Environment Snapshot)

| 维度 | A. 用户当前安装版 (Installed) | B. 当前正式稳定版 (Stable Release) | C. 已审查固定 Ref (Fixed Dev) |
|---|---|---|---|
| **CVR 版本 / Tag** | 2.5.7 | v2.5.7 | dev (`1a01844`) |
| **Git Commit SHA** | *(等价于 ea509b8)* | `ea509b82363a40c3c32e951d7ce9d66d66da411f` | `1a01844cb817c41e5e6b628d15e929787402187a` |
| **Mihomo 内核版本** | Meta v1.19.32 darwin arm64 | v1.19.32 附带打包 | 代码声明依赖 / 最新打包 |
| **Service 组件版本** | 2.5.7 (XPC LaunchDaemon) | 2.5.7 bundle | `clash-verge-service-ipc` 源码 |
| **当前运行模式** | **Service 模式** (PPID=18206 LaunchDaemon) | 支持 Service / Sidecar | 支持 Service / Sidecar |
| **构建 / 安装来源** | 官方 Release DMG 签名 (Mach-O thin arm64) | GitHub Releases | 源码仓库构建 |
| **凭证与证据来源** | `Info.plist`, `codesign`, `ps -Ao pid,ppid,command` | GitHub Release API, Git Tag Object | GitHub Git Commit Tree & Blob API |

### 2.2 核心能力与行为矩阵 (Capabilities & Semantics)

| 能力维度 | A. 用户当前安装版 (2.5.7) | B. 稳定版 (v2.5.7) | C. 固定 Dev (1a01844) | 证据级别与 Primary Source |
|---|---|---|---|---|
| **Script/Profile 保存与文件校验** | 具备（内置 Boa 语法与顶层执行） | 具备 | 具备 | **Verified**: `src-tauri/src/cmd/save_profile.rs#L19-L83` |
| **脚本执行业务正确性验证** | **不具备**（仅语法校验，main 报错静默回退） | **不具备** | **不具备** | **Verified**: `src-tauri/src/enhance/script.rs#L21-L68` |
| **运行时配置生成 (Generate)** | 具备（内存合并增强链生成 YAML） | 具备 | 具备 | **Verified**: `src-tauri/src/core/manager/config.rs#L270-L284` |
| **Service 运行时 Staging** | 具备（特权目录资产打包） | 具备 | 具备 | **Verified**: `src-tauri/src/core/service.rs#L805-L847` |
| **Mihomo 热重载 (Reload)** | 具备（优先 Unix Socket / HTTP reload） | 具备 | 具备 | **Verified**: `src-tauri/src/core/manager/config.rs#L349-L380` |
| **Core 重启兜底 (Restart Fallback)**| 具备（由 Service 或 Manager 替换 core） | 具备 | 具备 | **Verified**: `src-tauri/src/core/manager/config.rs#L364,L390` |
| **运行配置观测 (Observation)** | 仅限本地 Controller / 日志 | 仅限本地 Controller | 仅限本地 Controller | **Verified**: Mihomo `/configs`, `/rules` 端点 |
| **操作状态感知 (Busy / Skipped)** | 内部支持（防抖/并发锁返回 Outcome） | 内部支持 | 内部支持 | **Verified**: `src-tauri/src/core/manager/config.rs#L160-L181` |
| **丢包与失联对账 (Reconciliation)**| **不具备**（内部异步通知，无持久事务收据）| **不具备** | **不具备** | **Verified**: 缺乏持久事务与查询机制 |
| **原子回滚语义 (Rollback)** | 局部（仅源文件覆盖；runtime 已落盘不回滚）| 局部 | 局部 | **Verified**: `src-tauri/src/cmd/save_profile.rs#L93-L103` |
| **外部调用者鉴权 / 授权** | 仅单例 Token（无外部 Apply 接口） | 仅单例 Token | 仅单例 Token | **Verified**: `src-tauri/src/utils/server.rs#L163,L201` |
| **外部受支持 Apply 接口** | **无 (None)** | **无 (None)** | **无 (None)** | **Verified**: `src-tauri/src/utils/server.rs#L189-L280` |

---

## 3. 上游核心源码关键发现与疑点验证

### 3.1 疑点深度验证：Profile 专属脚本与全局 Script 保存时的判定失配

**问题陈述**：当当前 Profile 启用了专属 profile Script 时，修改并保存全局 `Script.js`，CVR 是否会将其判定为影响当前运行时并触发 apply？

**源码比对与分析**：
1. **保存判定**：[`src-tauri/src/cmd/save_profile.rs#L105-L124`](https://github.com/clash-verge-rev/clash-verge-rev/blob/1a01844cb817c41e5e6b628d15e929787402187a/src-tauri/src/cmd/save_profile.rs#L105-L124)：
   ```rust
   fn profile_affects_runtime(profiles: &IProfiles, index: &str) -> bool {
       ...
       let Ok(item) = profiles.get_item(current_uid) else { return false; };
       [
           item.current_merge().map_or("Merge", String::as_str),
           item.current_script().map_or("Script", String::as_str),
           ...
       ].contains(&index)
   }
   ```
   - 若当前 Profile 绑定了专属脚本 `item.current_script() == Some("custom-script-id")`，数组计算结果为 `["...", "custom-script-id", ...]`, **完全不包含 `"Script"`**。
   - 当保存全局扩展脚本（`index == "Script"`）时，`profile_affects_runtime()` 返回 **`false`**。
   - 结果：`handle_saved_profile_file` 中的 `affects_runtime` 为 `false`，**完全跳过 `ConfigManager::update_current_runtime()`**。

2. **运行时增强执行**：[`src-tauri/src/enhance/mod.rs#L205-L287`](https://github.com/clash-verge-rev/clash-verge-rev/blob/1a01844cb817c41e5e6b628d15e929787402187a/src-tauri/src/enhance/mod.rs#L205-L287)：
   ```rust
   // collect_profile_items 无论 profile 是否有独立脚本，均读取 global_script:
   chain_item_or_default(profiles.get_item("Script").ok(), ...)
   // process_global_items 总是无条件执行全局脚本:
   if let ChainType::Script(script) = global_script.data {
       let (res_config, changed_keys, mut logs) = use_script(script, config, ...).await;
   }
   ```
   - 增强流水线中，全局脚本始终在专属脚本前执行。

**判决 (Verified & Inferred)**：
- **存在严重状态失步**。当 profile 绑定专属脚本时，保存全局 `Script.js` 会被 CVR 视为“与当前运行时无关”，产生 **静默不触发 Apply**；但一旦后续发生重启或 profile 切换，该全局脚本又会被实际运行。
- 这证明：**绝不能把“向文件写入脚本”或“调用原生 save”当成确定性更新当前网络的手段。**

### 3.2 脚本执行与验证边界：Valid 不等于业务成功

- **语法与运行时分离**：[`src-tauri/src/core/validate.rs#L247-L336`](https://github.com/clash-verge-rev/clash-verge-rev/blob/1a01844cb817c41e5e6b628d15e929787402187a/src-tauri/src/core/validate.rs#L247-L336) 仅检查脚本是否声明 `main` 函数并在 Boa 中执行顶层语句，**不传入真实 profile 数据执行 `main(config)`**。
- **静默降级逻辑**：[`src-tauri/src/enhance/script.rs#L21-L68`](https://github.com/clash-verge-rev/clash-verge-rev/blob/1a01844cb817c41e5e6b628d15e929787402187a/src-tauri/src/enhance/script.rs#L21-L68) 中，若 `main()` 执行抛错、超时或返回非法数据，CVR 会在日志中记录异常，但**继续保留输入的上阶段配置输出**。
- **结论 (Inferred)**：一个含有致命运行时错误的脚本可以顺利通过 CVR 保存验证，并在静默降级后仍然生成合法的 YAML 配置并成功 Reload。CVR 的 `ValidationOutcome::Valid` **不能作为 Fleet 策略生效的充要证明**。

---

## 4. 潜在集成缝隙 (Integration Seams) 详细调研

### 4.1 Mihomo External Controller (HTTP / Unix Socket)
- **支持能力**：
  - 查询当前运行态配置 (`GET /configs`)、版本信息 (`GET /version`)；
  - 查询生效规则 (`GET /rules`)、规则集状态 (`GET /providers/rules`)；
  - 查询与切换代理组 (`GET/PUT /proxies/{group}`)、实时连接快照 (`GET /connections`)；
  - 动态重载 YAML 配置 (`PUT /configs?force=true`)。
- **明确不支持能力**：
  - **无法执行 JS 扩展脚本增强**（Mihomo 为 Go 核心，完全无 JS/Boa 执行能力）；
  - **无法管理 CVR Profile 集合与订阅元数据**；
  - **无法处理 Service 模式的特权资产 Staging**；
  - **无法同步 CVR 托管字段**（TUN、系统代理状态、GUI DNS）。直接向其推送 YAML 会导致与 CVR 状态严重撕裂。

### 4.2 Tauri Commands (Tauri IPC)
- **定义位置**：[`src-tauri/src/lib.rs#L126-L327`](https://github.com/clash-verge-rev/clash-verge-rev/blob/1a01844cb817c41e5e6b628d15e929787402187a/src-tauri/src/lib.rs#L126-L327)
- **性质判断**：通过 `tauri::generate_handler!` 注册，仅能由 CVR Webview 前端通过 `window.__TAURI__.core.invoke` 触发。**属于内部私有前端接口，不向操作系统其他进程开放，不可作为外部缝隙**。

### 4.3 CVR 本地 HTTP / Singleton Server
- **定义位置**：[`src-tauri/src/utils/server.rs#L159-L280`](https://github.com/clash-verge-rev/clash-verge-rev/blob/1a01844cb817c41e5e6b628d15e929787402187a/src-tauri/src/utils/server.rs#L159-L280)
- **实际路由盘点**：
  1. `POST /commands/dev/quit`：受 Token 保护，但仅在 `verge-dev` feature 下编译，正式 Release 版不存在；
  2. `GET /commands/visible`：唤醒窗口前台显示；
  3. `GET /commands/pac`：返回动态生成的 PAC 文件；
  4. `GET /commands/scheme?param=...`：解析 deep link（`clash://install-config` 等订阅导入，异步且无事务结果）。
- **结论 (Verified)**：**不存在任何 Profile 保存、代码校验、配置 Apply 或状态查询的 HTTP 接口。**

### 4.4 clash-verge-service 特权 IPC
- **通讯方式**：Unix Domain Socket（macOS `/var/run/clash-verge-service/service.sock`）/ Windows Named Pipe
- **安全与权限模型** (从二进制 strings 及源码证实)：
  - **Peer Credential 检查**：强制匹配 Unix transport 的内核 UID；
  - **Session Token 鉴权**：必须附带 64 位十六进制 owner session token；
  - **资产受限 Staging**：仅允许将已认证 application root 内部的相对路径文件打包至 staging；
- **第三方调用风险**：第三方进程既无权限亦无法获取 CVR GUI 持有的 session token，直接调用会触发 `ServiceError::Unauthorized` 或状态死锁。

---

## 5. 核心问题明确解答 (Mandatory Direct Answers)

1. **用户当前安装版有没有可用的正式 external apply seam？**  
   **答：没有 (None)。**
2. **stable release 有没有？**  
   **答：没有 (None)。**
3. **fixed dev 有没有？**  
   **答：没有 (None)。**
4. **哪些只是 CVR 内部能力？**  
   **答：** Script/Profile 保存校验、Boa 增强执行、配置 YAML 拼装、Service 资产 staging、协调 Service 重载/替换 core、Profile 切换回滚。全部为 CVR 内部私有实现。
5. **Mihomo API 可以替我们解决哪些问题？**  
   **答：** 运行态观测（实际规则命中、代理组选择、活动连接、内核版本）与只读诊断；以及在免重启场景下手动调整节点/触发 rule-provider 刷新。
6. **哪些事情必须经过 CVR 才能正确完成？**  
   **答：** 扩展脚本运行与策略注入（Boa 引擎）、CVR 托管字段注入（TUN、GUI DNS）、以及 Service 模式下的特权 runtime staging 与进程生命周期。
7. **Fleet 是否仍需要直接写 `profiles/Script.js`？**  
   **答：** 在推荐的 MVP 路径下**不需要**（由用户在原生 UI 中粘贴保存）；若走过渡期无缝写入模式，则需要，但必须明确该写入无法保证自动热重载，需配合用户手动触发或辅助通知。
8. **GUI restart 应定性为何种角色？**  
   **答：`maintenance fallback`（明确授权下的维护兜底手段）。** 坚决废除将其作为首选生产 apply 机制的定位。
9. **是否值得向 CVR upstream 提交一个小接口？**  
   **答：非常值得。** 见第 6 节最小 API 提议。
10. **在 upstream 接口不存在期间，最安全的 MVP 是否应该是 `Fleet diagnose/generate patch → 用户通过 CVR 原生 UI 保存 → Fleet verify`？**  
    **答：是 (Yes)。** 这是目前唯一完全符合 CVR 内部事务边界、零系统破坏性、架构最干净的路径。
11. **#8、#9、#10 分别应该怎样重新定义？**  
    - **#8 (macOS Adapter)**：降级重构。剥离并固化只读 discovery（修复进程误判与脱敏问题），剔除 GUI kill/open 生产主流程，转为可选的 maintenance fallback。
    - **#9 (Windows Adapter)**：重写并拆分。优先实现 Windows 只读能力与进程状态探测，暂不移植 kill/start 逻辑。
    - **#10 (Deployment Verification)**：重构目标。从“检验 PID/文件 mtime”升级为“检验业务语义后置条件与 Mihomo 实际运行状态”，并具备检测 CVR 静默降级的能力。

---

## 6. 最小上游接口提议草案 (Minimal Upstream API Proposal)

为未来与上游 CVR 协作，建议在 CVR 内置 loopback server（`server.rs`）中新增最小受限 Apply 契约：

- **端点**：`POST /commands/profile/apply`
- **认证**：标头携带 `x-instance-token`（复用现有单例 token），同操作系统用户限制；
- **请求负载 (Request Body)**：
  ```json
  {
    "profile_id": "Script",
    "expected_digest": "sha256:...",
    "content": "...",
    "force_apply": true,
    "request_id": "req-20261004-001"
  }
  ```
- **响应契约 (Response Contract)**：
  - `Applied`: 配置生成、校验成功，Service staging 并 reload 完成；
  - `Busy`: CVR 正在执行另一次更新；
  - `Skipped`: 防抖抑制或当前退出中；
  - `Invalid`: 语法或 YAML 校验失败（附带脱敏错误信息）；
  - `Unknown`: 已触发但核心未能确认响应。
- **状态对账端点**：`GET /commands/profile/status?request_id=...`，确保网络波动或客户端失联时可幂等恢复。

---

## 7. 结论与下阶段行动

1. **架构收敛**：确认 CVR 缺乏外部正式 Apply seam。Clash Fleet vNext 确定采用 **“只读诊断 + 原生 UI 交付/辅助通知 + Mihomo 语义验证”** 为核心闭环。
2. **遗留问题解冻**：
   - #8 终止 B2，按只读 discovery 裁剪；
   - 启动 #14 (只读网络诊断 MVP) 与 #15 (规则审计与薄 Service Profile) 作为主攻方向。
