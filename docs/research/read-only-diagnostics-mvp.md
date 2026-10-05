# 只读网络诊断 MVP 研究报告 (Read-Only Network Diagnostics MVP)

**研究日期**：2026-10-05  
**工作单元**：Issue #14 `research(vNext): Read-only network diagnostics MVP`  
**证据基线与数据来源**：
- 宿主系统只读探针：macOS 15+ (Darwin arm64)，Wi-Fi (`en0`)（**Local observed / Reported to Browser**）
- 代理控制面：CVR 2.5.7，Service 模式 (XPC LaunchDaemon)，Mihomo Meta v1.19.32
- 观测通讯渠道：用户属主 Unix Domain Socket (`<mihomo-uds>`)
- 官方主数据源 (Primary Sources)：
  - [Google Gemini Web 官方可用地区列表](https://support.google.com/gemini/answer/13575153)（**Verified**：网页版支持列表包含 Hong Kong）
  - [Google Gemini 隐私中心 / 位置数据说明](https://support.google.com/gemini/answer/13594961)（**Verified**：说明位置信号综合了 IP、Google 账号住宅/工作地址及设备精确定位）
- 安全与隐私边界：
  - **已完全脱敏**：无任何私有 IP、真实公网 IP、真实 UID、真实 PID、完整 Socket 路径、真实节点名称、订阅凭据或具体本地 MixedPort；
  - **零变更承诺**：零配置修改、零进程重启、零网络拦截/篡改、零账号登入/登出测试。

---

## 1. 核心问题回答：关于 Gemini 稳定性的只读诊断基线与假设

> **面向用户的分析解答 (Current Baseline & Hypotheses)**：  
> 
> 本次只读诊断在**未发生真实故障**的当前网络环境下建立了一个非故障基线快照 (Current Non-Failure Baseline Snapshot)。结合底层只读观测到的事实，关于“Gemini 潜在不稳定或未来可能发生异常的技术诱因”，提出以下经过证据边界界定的候选假设：
>
> 1. **当前观察到的多出口状态 (Observed Egress Split)**：  
>    - **观察事实 (Local observed)**：在当前采样时刻，Google 账号登录与认证端点（`accounts.google.com`）的活动连接经由 `JP egress node`，而 Gemini 主会话端点（`gemini.google.com`）经由 `US egress node`。  
>    - **候选假设 (Hypothesis)**：跨地区出口分裂可能与部分依赖严格会话一致性的账号状态有关。  
>    - **未知项 (Unknown)**：Google 服务端对出口 IP 地理位置跳变的风控判定阈值属于远端黑盒逻辑，且 Google 官方隐私中心文档明确说明其位置判定综合了网络 IP、账号住宅/工作地址及设备定位（网络出口非唯一信号）。**在本次只读采样期间，未观察到伴随该出口分裂发生的真实 Gemini 业务失败。**
> 2. **流量嗅探状态与纯 IP 候选风险 (Sniffer Status & Pure-IP Candidate Risk)**：  
>    - **观察事实 (Local observed)**：Mihomo 内核运行配置返回 `"sniffer": null`，即流量嗅探未启用。  
>    - **候选假设 (Hypothesis)**：如果用户浏览器独立启用了安全 DNS (DoH) 或某些应用自行解析了纯 IP，数据包在穿过 TUN 虚拟网卡时可能无法被还原出域名，从而跳过特定域名规则落入兜底规则。  
>    - **证据局限 (Insufficient evidence)**：本次采样未观测浏览器 DoH 的启用状态、未观测内核 fake-IP 映射表、亦未捕获到跳过规则落入兜底出口的纯 IP 流。因此将纯 IP 漏网定性为**潜在风险假设 (Candidate Risk)**，非已证实故障。
> 3. **节点组动态优选的可能影响 (Proxy Group Selection Dynamics)**：  
>    - **观察事实 (Local observed)**：AI 意图策略组下游引用了包含自动延迟测试的策略组。  
>    - **候选假设 (Hypothesis)**：若底层节点因延迟超时发生主备切换，切换将影响**之后建立或重新建立的连接**。  
>    - **未知项 (Unknown)**：节点切换是否会立即强行重置既有已建立的 TCP/HTTP2 长连接，在本次工作中未直接观测，保持 Unknown。

---

## 2. 宿主实测只读快照 (Host Read-Only Facts)

通过用户属主 Unix Domain Socket (`<mihomo-uds>`) 及只读系统查询，在当前时点记录以下脱敏事实（**Local observed / Reported to Browser**）：

### 2.1 系统网络接入与控制面现状
- **系统代理与 TUN 状态**：
  - 系统 PAC 处于启用状态 (`ProxyAutoConfigEnable: 1`)，PAC URL 指向本地服务 `http://127.0.0.1:<local-pac-port>/commands/pac`（将匹配流量引导至 MixedPort `<mixed-port>`）；
  - TUN 虚拟网卡独立处于启用状态 (`tun.enable: true`, 设备 `<tun-device>`)，配置了 `auto-route: true` 与 `dns-hijack: ["any:53"]`；
  - 接入路径定性：**系统 PAC 与 TUN 同时处于启用状态**；具体应用程序的实际接入方式（走代理端口还是走 TUN 虚拟网卡）取决于其自身网络实现。
- **系统 DNS 配置**：
  - 系统解析器主 nameserver 指向 `<lan-resolver>`；TUN 通过内核 `dns-hijack` 截获 53 端口流量，未直接修改系统级 `/etc/resolv.conf`。
- **内核配置特征**：
  - `mode: "rule"`, `mixed-port: <mixed-port>`；
  - `"sniffer": null`（流量嗅探未激活）。

### 2.2 策略组当前指向快照 (Policy Group Snapshot)
- `🤖 AI 服务` (Selector) ➔ 当前指向：`US egress group` ➔ 当前活动出口：`US egress node`
- `🇯🇵 Anti Gravity` (Selector) ➔ 当前指向：`JP egress group` ➔ 当前活动出口：`JP egress node`
- `🔰 节点选择` (Selector) ➔ 当前指向：`JP egress group`
- `🚀 自动优选` (Fallback) ➔ 当前活动出口：`HK egress node`

### 2.3 活动连接观测样本 (Live Connection Sample)
在本次采样时刻，只读抓取 `/connections` 记录到以下链路状态：
- `gemini.google.com` ➔ 命中规则 `Domain` ➔ 路由链：`[US egress node, US egress group, 🤖 AI 服务]`；
- `accounts.google.com` ➔ 命中规则 `Domain` ➔ 路由链：`[JP egress node, 🇯🇵 Anti Gravity]`；
- `google.com` ➔ 命中规则 `RuleSet(proxy)` ➔ 路由链：`[JP egress node, JP egress group, 🔰 节点选择]`；
- `language_server` (进程) ➔ 命中规则 `ProcessName` ➔ 路由链：`[JP egress node, 🇯🇵 Anti Gravity]`。

---

## 3. 问题分级与只读判定树 (Four-Scope Diagnostic Tree)

只读诊断必须遵循严格的影响范围分级逻辑，避免把单一服务问题无差别升级：

```text
[用户反馈网络或服务异常]
            │
      ┌─────┴─────┐
      ▼           ▼
[基础网络可达?] [局域网解析正常?]
      │ (否 -> 全机网络 / 物理链路 / LAN 网关故障)
      ▼ (是)
[其他常规外部站点可达?]
      │ (否 -> 代理核心 / 端口监听 / TUN 网卡状态异常)
      ▼ (是: 仅 AI / 某特定产品异常)
[单一服务故障 vs 单一应用故障?]
      │
      ├─► [单一应用故障] (如某 IDE 报错但 Web 正常):
      │     └─► 只读比对: 进程规则 (ProcessName) 与该应用代理环境变量
      │
      └─► [单一服务故障] (如仅 Gemini 报错):
            │
            ├─► 检查 1: 当前各依赖连接是否存在多出口分裂？(Observed: JP vs US)
            ├─► 检查 2: 当前出口是否落在该服务官方支持区域之外？(参考官方可用页面 13575153)
            ├─► 检查 3: 核心 sniffer 状态是否导致纯 IP 逃逸风险？
            └─► 检查 4: 底层节点是否在会话期间发生了状态变更？
```

---

## 4. 最小诊断报告格式规范 (Diagnostic Report Schema)

Fleet 只读诊断模块生成的脱敏报告结构规范如下：

```yaml
# diagnostics-report-spec
timestamp: "2026-10-05T00:30:00+08:00"
target_service: "google-gemini"
assessment_scope: "single_service" # single_service | single_app | whole_host | lan
observed_facts:
  ingress_state: "PAC and TUN both active"
  sniffer_active: false
  auth_observed_egress: "JP egress"
  app_observed_egress: "US egress"
  active_split_observed: true
candidate_hypotheses:
  - id: "H-01"
    name: "egress_split_account_sensitivity"
    description: "当前观察到认证与主业务出口分属不同国家，可能与会话稳定性相关。"
    evidence: "Sampled connections: accounts.google.com -> JP, gemini.google.com -> US."
    status: "provisional_hypothesis (no correlated failure observed in this session)"
  - id: "H-02"
    name: "sniffer_null_pure_ip_risk"
    description: "sniffer 未启用，若应用使用 DoH 将存在纯 IP 绕过域名分流的潜在风险。"
    evidence: "Runtime config sniffer is null."
    status: "candidate_risk (browser DoH / fake-ip miss not directly observed)"
unknowns:
  - "Google 远端风控对多出口 IP 与地理位置跳变的判定敏感度与超时时间。"
  - "节点策略组切换对存量已建立长连接的具体影响机制。"
next_safest_action:
  "保持当前网络与配置不动；当下一次自然出现服务异常时，以完全相同的只读方式提取 failure-time 快照，并与本次 non-failure baseline 执行比对。"
```

---

## 5. 结论

本次只读诊断 MVP 表明：**在不修改任何系统配置、不重启任何进程、不发起任何破坏性或有账号风险的探测的前提下，只读诊断工具链能够建立清晰的 host/runtime 非故障基线快照 (current non-failure baseline snapshot)，并将可能的技术诱因收敛为若干具有明确证据边界的候选假设。**
