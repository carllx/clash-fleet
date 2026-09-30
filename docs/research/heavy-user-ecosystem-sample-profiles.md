# Heavy-User Clash / Mihomo 生态项目样本深度调研附录 (Sample Profiles)

- **调研角色**: Lead Architect & Ecosystem Researcher
- **基准提交**: `main @ c38fe06ec55407754eabddeec3cdd0c9cbe778d2`
- **关联主报告**: [heavy-user-clash-ecosystem-survey.md](heavy-user-clash-ecosystem-survey.md)
- **文档性质**: 逐项目一手物证与技术事实档案 (Primary-Source Evidence Profiles)

---

## 1. 证据标准与评级体系

本档案遵循严格的一手证据纪律，所有关键技术结论标注三级可信度标签：
- **[Verified]**：经当前仓库源码、官方文档或本地环境实测直接验证的技术事实；
- **[Reported]**：由项目发布说明、社区讨论、Issue Tracker 记录或本地工作副本观察的事实；
- **[Inferred / Synthesized]**：基于项目演进路径与架构约束推导出的工程推论与架构综合假说。

---

## 2. 逐项目调研档案

### 2.1 clash-verge-rev/clash-verge-rev (CVR)
- **定位**: 现代跨平台 Mihomo GUI 客户端宿主（macOS / Windows / Linux）。
- **一手指针**:
  - `src-tauri/Cargo.toml`（锁定 `boa_engine = "0.22.0"`）[Verified]
  - `src-tauri/src/enhance/script.rs`（沙箱加载与 `main(config, profileName)` 调度）[Verified]
  - `src-tauri/src/enhance/mod.rs`（`CONTROL_PLANE_KEYS` 与 GUI 状态覆盖逻辑）[Verified]
- **核心模式**:
  - **Source/Artifact 分离**: 用户编辑扩展脚本，应用运行期合并订阅生成临时的最终 YAML 交由内核 [Verified]。
  - **控制面接管**: CVR-managed authoritative DNS/TUN subset 必须服从 CVR 并在配置流水线末端强行覆盖，属于客户端专有控制层 [Verified]。
  - **沙箱约束**: Boa 0.22 引擎无 Node.js/CommonJS 环境，无外部网络与文件系统 I/O；语言特性兼容边界以 Gate A 已验证结果为准 [Verified]。

### 2.2 Loyalsoldier/clash-rules
- **定位**: 纯粹的高性能规则数据构件分发库（采用量最大的轻量级规则集之一）。
- **一手指针**:
  - `.github/workflows/run.yml`（自动化拉取上游、转换、打包与发布流水线）[Verified]
  - 核心产物清单: `reject.txt`, `icloud.txt`, `apple.txt`, `proxy.txt`, `direct.txt`, `private.txt`, `telegramcidr.txt`, `cncidr.txt`, `lancidr.txt`, `applications.txt` [Verified]
- **核心模式**:
  - **Behavior 严格正交**: 明确区分 `domain`（域名列表）、`ipcidr`（CIDR网段）与 `classical`（混合规则）[Verified]。
  - **业务与数据彻底剥离**: 仓库不包含任何代理组名（如 Proxy、DIRECT），仅分发纯净的数据集，由客户端在声明 Rule Provider 时绑定目标策略组 [Verified]。
  - **双通道分发**: 通过 GitHub Release 和 `release` 分支双重分发，结合 Fastly/jsDelivr 等公共 CDN 实现高可用拉取 [Verified]。

### 2.3 blackmatrix7/ios_rule_script
- **定位**: 全平台超大型模块化规则与脚本矩阵（覆盖 Surge, Clash, Loon, Stash, QX）。
- **一手指针**:
  - 规则目录结构: `rule/Clash/<ServiceName>/<ServiceName>.yaml`（按服务/应用颗粒度切片）[Verified]
  - 自动化构建脚本: 针对上游域名列表做去重、清洗、分类，并转译为各平台适配文件 [Reported]
- **核心模式**:
  - **细粒度服务切片**: 拥有数千个独立服务子目录（如 OpenAI, YouTube, Netflix, Steam），每个服务提供 `domain`、`ip`、`classical` 等多种形态 [Verified]。
  - **过度路由与维护膨胀 (Anti-Pattern)**: 规则集切片过于细碎，极易诱导用户配置几十个业务策略组，导致配置极其臃肿，DNS 解析开销增加 [Inferred / Synthesized]。

### 2.4 SukkaW/Surge
- **定位**: 网络基础设施专家打造的极致性能与防 DNS 污染规则分发体系。
- **一手指针**:
  - 规则分发服务: `ruleset.skk.moe` 与 GitHub 源码仓库 `SukkaW/Surge` [Verified]
  - 核心规则排序哲学: `DOMAIN-SET` $\rightarrow$ `non_ip RULE-SET` $\rightarrow$ `ip RULE-SET` [Verified]
- **核心模式**:
  - **规则执行序保护 (Execution-Order Discipline)**: 强行将无需解析 IP 的纯域名匹配置顶，将需要嗅探或触发 DNS 解析的 IP-CIDR 规则沉底，最大限度避免无谓的本地 DNS 污染与时延 [Verified]。
  - **集中托管构件**: 配置源中仅保留规则集 URL 引用，实际百万级域名数据由 CDN/服务端编译缓存 [Verified]。

### 2.5 sub-store-org/Sub-Store
- **定位**: 现代高级订阅管理、多源聚合与节点流式处理中间件。
- **一手指针**:
  - 核心架构: 采用 Operator（流式处理器）模式，提供 `filter`、`rename`、`sort`、`script`、`dedup` 处理管道 [Verified]
  - 持久化配置: 采用 JSON 格式将订阅源与 Operator 拓扑持久化存储 [Verified]
- **核心模式**:
  - **节点预处理管道**: 统一在订阅拉取阶段完成节点去重、国旗补全、正则分类与垃圾节点过滤（如流量通知），使内核层拿到的是高度规范化的干净节点 [Verified]。
  - **安全与凭据解耦**: 订阅 URL 与 Token 存放在私有持久化层，对客户端仅暴露虚拟聚合端点或静态导出 [Verified]。

### 2.6 tindy2013/subconverter
- **定位**: 经典基于 C++ 的通用订阅转译与策略组模板渲染引擎。
- **一手指针**:
  - 核心配置文件: `pref.ini` 与自定义规则模板 `base/` [Verified]
  - 规则注入机制: 基于 INI 键值对将远端 Rule Provider 拼装进 Clash 配置 [Verified]
- **核心模式与历史包袱**:
  - **历史包袱**: INI 配置模板语法晦涩、嵌套表达力弱，正则替换逻辑与业务规则深度耦合 [Inferred / Synthesized]。
  - **隐私风险**: 依赖公共托管后端（如公共托管的 subconverter API）存在严重的订阅泄露与安全隐患 [Reported]。

### 2.7 juewuy/ShellCrash
- **定位**: 路由器与 Linux 嵌入式设备上的 Clash/Mihomo 自动化部署与透明代理管理工具。
- **一手指针**:
  - 核心管理代码: Shell 脚本交互管理（管理内核下载、systemd/tproxy/tun 服务）[Verified]
  - 架构切分: 区分底层网络转发（iptables/nftables/路由表）与内核配置模板 [Verified]
- **核心模式**:
  - **网络层与策略层解耦**: 将与特定操作系统/内核紧密关联的透明代理转发逻辑封装在外围控制脚本中，Mihomo 自身配置保持通用 [Verified]。

### 2.8 ACL4SSR/ACL4SSR
- **定位**: 历史最悠久、国内用户量最大的分流规则预设集合。
- **一手指针**:
  - 规则仓库结构: `Clash/Ruleset/*.list` 与 `Clash/config/*.ini` [Verified]
  - 预设策略模式: ACL4SSR_Online, ACL4SSR_Online_Full, ACL4SSR_Online_Mini 等多种打包组合 [Verified]
- **核心模式与历史包袱**:
  - **单体规则黑盒**: 规则集包含成千上万条静态域名，缺乏精细的验证与淘汰机制，充斥着大量过时直连与代理判定 [Inferred / Synthesized]。
  - **缺乏动态性**: 静态大规则导致配置调试极其困难，一旦某域名被误判直连或代理，用户难以局部覆盖 [Inferred / Synthesized]。

### 2.9 MetaCubeX/meta-rules-dat
- **定位**: 专为 Mihomo (原 Clash.Meta) 打造的现代二进制 GeoData 与 Rule-Set 官方生态。
- **一手指针**:
  - 核心二进制产物: `geoip.dat`, `geosite.dat`, `country.mmdb`, 及专有 `.mrs` (Mihomo Rule-Set) 构件存在 [Verified]
  - Mihomo 官方配置指令: 支持 `format: mrs`，对应 `behavior: domain` 与 `behavior: ipcidr` [Verified]
- **核心模式**:
  - **Mihomo 原生二进制规则集支持**: `.mrs` 构件作为专有二进制 rule-set 格式由生态项目分发，Mihomo 原生支持声明 `format: mrs` 挂载使用 [Verified]；其相对于纯文本规则集的体积压缩比与加载性能优势属于基于二进制结构的推论 [Inferred / Synthesized]。

### 2.10 DustinWin/ruleset_geodata (现代极简白盒配置模式)
- **定位**: 现代 Mihomo / Sing-box 极简白盒分流与 DNS 分流实践标杆。
- **一手指针**:
  - 架构主张: 弃用多达数十个琐碎策略组，收敛至“最小必要规则集 + 基础国家地区池 + 兜底匹配” [Verified]
  - DNS 协同: 严格分离直连 DNS（国内权威解析）与代理 DNS（防污染 Fake-IP），配合 GeoSite 快速决断 [Verified]
- **核心模式**:
  - **白盒可调试性**: 保持配置精简，使用户清楚知道每一笔连接命中的规则原因，杜绝庞大黑盒规则带来的偶发网络故障 [Verified]。
