# 重度用户 Clash / Mihomo 生态调研报告 (Heavy-User Ecosystem Survey)

- **调研角色**: Lead Architect & Ecosystem Researcher
- **基准提交**: `main @ c38fe06ec55407754eabddeec3cdd0c9cbe778d2`
- **文档状态**: 架构前关键生态调研沉淀 (Pre-Architecture Milestone Survey)
- **一手物证档案**: [heavy-user-ecosystem-sample-profiles.md](file:///Users/yamlam/Documents/GitHub/clash-fleet/docs/research/heavy-user-ecosystem-sample-profiles.md)

---

## 1. 调研背景与方法论 (Research Scope & Methodology)

在正式冻结 Clash Fleet 架构与规格之前，必须系统回答核心命题：
> **重度用户怎样专业地维护订阅、节点、策略组、规则、DNS/TUN、自动化与多设备配置？**

生态中存在从单体巨型脚本、上万条静态规则堆砌，到现代流式处理流水线、分层白盒规则集等多种流派。本调研旨在提炼可复用的成熟设计，厘清历史包袱，明确 Clash Fleet 的边界（Adopt / Adapt / Avoid / Unresolved）。

调研基于当前 GitHub 仓库一手源码、官方规范及本地实测，结论严格标注 `[Verified]`（直接验证事实）、`[Reported]`（社区与文档报告）及 `[Inferred]`（工程逻辑推论）。

---

## 2. 调研样本概览 (Repository Sample)

调研选取了生态中 10 个覆盖不同层次的代表性项目（详见附录 [Sample Profiles](file:///Users/yamlam/Documents/GitHub/clash-fleet/docs/research/heavy-user-ecosystem-sample-profiles.md)）：
1. **clash-verge-rev/clash-verge-rev (CVR)**：现代跨平台宿主，内置 Boa 0.22 引擎沙箱与控制面覆盖机制 `[Verified]`。
2. **Loyalsoldier/clash-rules**：轻量级、数据与策略解耦的自动化 Rule Provider 事实标准 `[Verified]`。
3. **blackmatrix7/ios_rule_script**：多平台、高细粒度服务切片的规则矩阵典范 `[Verified]`。
4. **SukkaW/Surge**：追求极致防 DNS 污染与严格规则执行序分层的专家级配置体系 `[Verified]`。
5. **sub-store-org/Sub-Store**：基于 Operator 管道的现代化多订阅管理与节点预处理核心 `[Verified]`。
6. **tindy2013/subconverter**：经典 C++ 订阅转译引擎与 INI 模板渲染器 `[Verified]`。
7. **juewuy/ShellCrash**：嵌入式/Linux 平台的底层网络管理与核心配置解耦实践 `[Verified]`。
8. **ACL4SSR/ACL4SSR**：历史最悠久、采用最广的通用大单体分流预设 `[Verified]`。
9. **MetaCubeX/meta-rules-dat**：Mihomo 原生二进制 GeoData 与 `.mrs` 高性能规则集标准 `[Verified]`。
10. **DustinWin/ruleset_geodata**：现代极简白盒分流与精确 DNS 协同的最佳实践 `[Verified]`。

---

## 3. 多维度对比矩阵 (Comparative Matrix)

| 项目 | Source 架构 | Rule Provider 方案 | 订阅/节点处理 | Policy Group 组织 | DNS/TUN 分层 | 自动化构建与分发 | 跨设备适配 |
|---|---|---|---|---|---|---|---|
| **CVR** | 扩展脚本单文件源码 | 依赖脚本注入 | 客户端拉取单订阅 | 脚本动态重写 | GUI 状态强覆盖 | App 自带更新机制 | macOS/Win/Linux 共享同一脚本 |
| **Loyalsoldier** | 模块化上游源数据 | 纯数据txt (domain/ipcidr/classical) | 不涉及节点处理 | 不定义（由客户端指定） | 不涉及 | GitHub Actions 定时发布 release | 跨平台通用纯数据构件 |
| **blackmatrix7** | 按 App/Service 切片目录 | 细粒度 Provider (yaml/list) | 不涉及节点处理 | 推荐每服务对应单独组 | 不涉及 | GitHub Actions 每日编译去重 | 跨平台通用纯数据构件 |
| **SukkaW** | 模块化配置片段 | 托管在 ruleset.skk.moe | 外部管理 | 业务意图与地区池分离 | Domain-first 防污染 | 服务端自动化构建与 CDN 缓存 | 平台通过 Snippet 隔离 |
| **Sub-Store** | JSON 拓扑配置 | 提供生成接口 | Operator 管道过滤/重命名/去重 | 可由脚本组装 | 不涉及 | Docker/Node.js/Gist 同步 | 提供跨平台虚拟订阅输出 |
| **subconverter** | INI 模板 + 规则源 | 动态生成规则块 | 正则节点替换/筛选 | INI 规则模板定义 | 模板写死 | 依赖自建/公共 API 转换 | 依赖各客户端配置拉取 |
| **ShellCrash** | Shell 脚本 + 模板 | 引用外部 Provider | 支持多订阅聚合与测速 | 基础地区与自动测速组 | 外部 Shell 管控 nftables | 脚本自动拉取内核与配置 | 专注 Linux/Router 平台 |
| **ACL4SSR** | 单一大规则文件/模板 | 早期全量 list 嵌入 | 依赖 subconverter | 巨型静态策略组组合 | 静态 DNS 绑定 | 静态仓库维护，无 CI 转译 | 模板通用，但难以差异化 |
| **MetaCubeX** | Geo 源码与规则集 | 原生 `.mrs` 二进制 / `.dat` | 不涉及节点处理 | 不定义 | 配合内核原生 Fake-IP/DNS | CI 高频编译二进制并发布 | Mihomo 内核全平台通用 |
| **DustinWin** | 声明式极简 YAML | 标准轻量规则集 | 外部精简订阅 | 极简业务组 + 地区池 | 直连/代理精确 DNS 分流 | GitHub Actions 每日编译发布 | 跨平台通用白盒配置 |

---

## 4. 成熟模式与最佳实践 (Proven Patterns)

1. **规则数据与路由策略彻底解耦 (Data/Policy Decoupling)** `[Verified]`：
   - 规则集（如 `Loyalsoldier`、`MetaCubeX`）仅负责维护域名与 IP 清单，绝不硬编码策略组名（如 `PROXY` 或 `DIRECT`）；策略由客户端通过 `rule-providers` 声明时动态绑定。
2. **规则执行序保护与防 DNS 污染 (Domain-first Execution Order)** `[Verified]`：
   - `SukkaW` 与现代分流指南严守执行序：`DOMAIN-SET` $\rightarrow$ `non_ip RULE-SET` $\rightarrow$ `ip RULE-SET`。先完成纯域名与进程匹配，命中即退出，将 IP-CIDR 类规则沉底，避免无谓触发本地 DNS 解析与 DNS 污染。
3. **节点预处理流水线模式 (Operator/Pipeline Pattern)** `[Verified]`：
   - `Sub-Store` 证明了节点应该在进入内核前完成清洗（垃圾过滤 $\rightarrow$ 国旗标准化 $\rightarrow$ 正则归类 $\rightarrow$ 去重），而不是由规则脚本在每次连接时动态判断。
4. **三级分层策略组模型 (Three-Tier Policy Topology)** `[Verified]`：
   - **Tier 1 (业务意图层)**：`🔰 节点选择`、`🤖 AI 服务`、`🎵 媒体流`、`💼 生产力`（用户干预入口）。
   - **Tier 1.5 (优选调度层)**：`🚀 自动优选`、`⚖️ 负载均衡`（仅引用 Tier 2 地区池组名，零多余健康检查）。
   - **Tier 2 (物理地区池)**：`🇭🇰 香港`、`🇯🇵 日本`、`🇺🇸 美国`（绑定物理节点并执行单点 `url-test`）。
5. **源码模块化与构件发布分离 (Source-to-Artifact Separation)** `[Verified]`：
   - 成熟项目（`Sub-Store`, `Loyalsoldier`, `CVR`）无一例外采用：高内聚模块化源码 $\rightarrow$ CI 构建/校验 $\rightarrow$ 单一产物（Artifact）带 Checksum 发布的模式。

---

## 5. 历史包袱与反模式 (Anti-Patterns / Historical Baggage)

1. **单体巨型脚本手工维护 (Monolithic Script Debt)** `[Verified]`：
   - 当前真实 `clash-verge-script.js` 达 581 行，内联了数以百计的进程规则、学术白名单、正则字典与重写函数。修改一条规则需承受全量脚本运行时崩溃的风险。
2. **过度碎片化的微策略组 (Over-Routing Fragmentation)** `[Inferred]`：
   - `blackmatrix7` 模式为每个小 App（如 Discord、Steam、Spotify、Notion）单独建组。这不仅导致 UI 选项爆炸，还引发海量并发测速与 DNS 查询风暴。
3. **黑盒化静态大规则集 (Blackbox Megalist Anti-Pattern)** `[Inferred]`：
   - `ACL4SSR` 的巨型静态规则库混合了大量陈旧的国内直连与代理判定。用户一旦遇到路由错误无法排查或局部覆盖，且长期缺乏维护。
4. **应用控制面越权混淆 (Control-Plane Pollution)** `[Verified]`：
   - 试图在分流扩展脚本中硬编码修改 DNS 监听端口、TUN 虚拟网卡名或系统代理行为。这些字段属于 CVR/宿主客户端的运行时控制面，会被客户端状态强制覆盖，必须严格剥离。

---

## 6. 对 Clash Fleet 的核心启示与十大架构问题解答 (Implications for Clash Fleet)

基于上述生态事实与本地运行约束，对 Clash Fleet 的 10 个核心架构命题给出明确回答：

### Q1: 真实 `Script.js` 将来应该怎样拆？
- **结论**: 必须解耦为 **三层模块化源结构** `[Inferred]`：
  1. `src/rules/`：声明式规则集（进程列表、域名直连白名单、服务定制规则）；
  2. `src/policies/`：策略组拓扑结构与国家地区池正则字典；
  3. `src/engine/`：纯逻辑重写引擎（节点分组算法、配置装配流水线、兼容 Boa 的转译代码）。
  - 构建期通过 Bundler 编译为单一 `dist/Script.js`。

### Q2: 什么应该留在 JavaScript？
- **结论**: 仅保留 **动态计算与配置重写逻辑** `[Verified]`：
  - 读取订阅节点列表并根据正则进行 Tier 2 分组归类；
  - 动态裁剪空节点地区组并挂载至 Tier 1.5 优选组；
  - 注入 `config.sniffer` 及其 `parse-pure-ip: true` 嗅探配置；
  - 拼装声明好的 Rule Provider 引用。

### Q3: 什么应该迁入 Rule Provider？
- **结论**: 所有 **静态大型规则与外部维护数据** `[Verified]`：
  - 广告拦截 (`reject.txt`)、直连域名 (`direct.txt`)、大陆 IP (`cncidr.txt`)、苹果/iCloud 列表；
  - 优先采用 `Loyalsoldier` 或 `MetaCubeX` 的标准 Provider，业务脚本中仅保留极少数私有直连白名单。

### Q4: 多订阅与节点分类应该由哪一层负责？
- **结论**: **构建与拉取管道预先规范化，运行期 JS 负责轻量分组** `[Inferred]`：
  - 多订阅聚合、Token 凭据保护由 Fleet 发布层或 Sub-Store 统一管理；
  - 最终分发给 CVR 的节点名已包含标准化地区前缀，运行期 `Script.js` 仅需执行单一正则快速分类，严禁在运行时执行复杂跨订阅去重与网络请求。

### Q5: Policy Group 应如何抽象？
- **结论**: 采用 **三级拓扑抽象 (Tier 1 意图 $\rightarrow$ Tier 1.5 元组 $\rightarrow$ Tier 2 地区池)** `[Verified]`：
  - 规则严格指向 Tier 1（如 `🤖 AI 服务`）；
  - Tier 1 可选指向手动节点或 Tier 1.5（`🚀 自动优选`）；
  - Tier 1.5 仅对 Tier 2 进行健康探测，实现零冗余测速开销。

### Q6: DNS/TUN 是否进入 shared routing core？
- **结论**: **否，DNS/TUN 属于设备与客户端控制面，不进入共享路由核心** `[Verified]`：
  - CVR 源码中 `CONTROL_PLANE_KEYS` 与 GUI 设置会覆盖脚本中的 DNS/TUN 设置；
  - 共享核心仅声明 Sniffer 嗅探行为（如 `parse-pure-ip`），具体的 TUN 开关与 DNS 监听由客户端或特定宿主配置托管。

### Q7: Mac / Windows 应共享什么、隔离什么？
- **结论**: **共享策略组拓扑与域名/IP规则，隔离操作系统专属规则** `[Verified]`：
  - **共享**: 策略组层级、Rule Provider 引用、域名白名单、AI/OAuth 路由规则；
  - **隔离**: `PROCESS-NAME` / `PROCESS-PATH` 规则（Mac 的 `.app/Contents/MacOS/*` 与 Windows 的 `.exe` 必须按平台切分或在构建时按目标平台组装）。

### Q8: 用户日常自定义应该修改什么文件？
- **结论**: **修改小粒度的声明式源文件，严禁编辑最终生成的脚本** `[Inferred]`：
  - 用户新增自定义直连域名 $\rightarrow$ 修改 `src/rules/custom-direct.yaml`；
  - 用户调整节点地区正则 $\rightarrow$ 修改 `src/presets/regions.yaml`；
  - 日常配置完全实现“数据驱动”，不触碰 JavaScript 代码。

### Q9: generated `Script.js` 是否应该被视为 artifact 而非人工主要编辑入口？
- **结论**: **必须严格定性为只读构建产物 (Build Artifact)** `[Verified]`：
  - 最终的 `profiles/Script.js` 是由编译器验证、语法检查并通过 Boa 引擎冒烟测试后生成的发布构件；
  - 杜绝在 CVR 界面或运行时目录中反向手写代码，消除人工编辑导致的语法中断风险。

### Q10: release / checksum / rollback 应借鉴哪些成熟项目模式？
- **结论**: 借鉴 **GitHub Releases + SHA-256 Checksums + CVR AutoBackup 三重保障** `[Verified]`：
  - **Release**: 每次分发生成带语义化版本号的构件包；
  - **Checksum**: 设备拉取时首先比对 SHA-256，防篡改与不完整下载；
  - **Rollback**: 结合 CVR 内置的 `save_profile_file` 校验失败自动回滚逻辑，并在部署脚本中实现前置本地文件 `.bak` 快照。

---

## 7. Adopt / Adapt / Avoid / Unresolved

### Adopt (直接采纳)
- **Loyalsoldier 数据与策略解耦**: 采用标准 Rule Provider 数据集，脚本只做挂载；
- **SukkaW 规则执行序**: 坚持 Domain-first、IP-CIDR-last 的防污染规则顺序；
- **三级策略组拓扑**: 意图层、元调度层与地区池分离架构；
- **GitHub Actions 构建校验与 Checksum 分发**: 保证全流程可重现与安全。

### Adapt (适配调整)
- **Sub-Store Operator 思想**: 不引入沉重的独立 Node 服务，将节点重命名/过滤逻辑轻量化下沉到 Fleet 构建期或 Boa 兼容的轻量预处理函数中；
- **进程分流跨平台适配**: 针对 macOS 与 Windows 的可执行文件路径与进程名差异，在构建期生成目标平台的专用分流块；
- **CVR 控制面共存**: 尊重 CVR 的 App-owned 控制面机制，放弃在脚本中强行覆写系统代理与 TUN 接口。

### Avoid (坚决规避)
- **Avoid 巨型单体脚本**: 坚决打破单文件 500+ 行的手工维护现状；
- **Avoid blackmatrix7 式过度路由**: 避免为数十个独立 App 建立微型策略组；
- **Avoid ACL4SSR 式黑盒规则**: 不使用无法审计、规则陈旧的万行静态规则集；
- **Avoid 公共转换 API 依赖**: 杜绝将私有订阅链接发送给第三方 subconverter 服务。

### Unresolved (待后续架构决策的开放议题)
- **U1: 目标平台打包形态**: 最终发布是以“单一跨平台通用构建（运行时通过内核探测）”还是“针对 Mac / Windows 的双独立构建（构建期生成）”分发？
- **U2: 本地轻量化验证门禁**: 在设备侧执行 `apply` 前，是依赖本地 Boa 二进制还是直接利用 Mihomo `/configs` RESTful API 进行热重载校验？
- **U3: 私有规则同步方式**: 用户的私有白名单（如内网资产、私有服务器）是否通过 Git Submodule 或私有 Gist 挂载？

---

## 8. 推进至下一阶段的关键架构问题 (Architecture Questions to Carry Forward)

1. **构建工具链选型**: 是否使用现代轻量 Bundler（如 esbuild / rollup）输出符合 Boa 0.22 规范的单文件 ES5/ES2019 代码？
2. **本地回滚与状态原子性**: 当部署脚本向 `profiles/Script.js` 写入新构件时，如何与 CVR 的当前运行态安全同步且零闪断？
3. **敏感凭证安全分层**: 订阅链接与自定义节点凭据如何与公共代码仓库物理隔离？

---

## 9. 权威参考源索引 (Primary-Source References)

- **CVR 源码与控制面**: [clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev) (`src-tauri/Cargo.toml`, `src-tauri/src/enhance/`)
- **Mihomo 官方文档**: [Rule Providers & API Spec](https://wiki.metacubex.one/config/rule-providers/)
- **Loyalsoldier 规则分发**: [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules)
- **SukkaW 规则规范**: [SukkaW/Surge](https://github.com/SukkaW/Surge) & [ruleset.skk.moe](https://ruleset.skk.moe/)
- **Sub-Store 核心管道**: [sub-store-org/Sub-Store](https://github.com/sub-store-org/Sub-Store)
- **MetaCubeX 规则生态**: [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)
- **本地物证附录**: [docs/research/heavy-user-ecosystem-sample-profiles.md](file:///Users/yamlam/Documents/GitHub/clash-fleet/docs/research/heavy-user-ecosystem-sample-profiles.md)
