# 现网行为保全与迁移矩阵 (Behavior Preservation Matrix)

- **文档状态**: 生产迁移基准规范 (Canonical Behavior Preservation Matrix)
- **迁移来源**: 本地现网扩展脚本 (Private Local Migration Oracle)
- **目标架构**: Clash Fleet V1 混合源码模型与三级分层拓扑架构
- **更新日期**: 2026-10-02

---

## 1. 概述与脱敏准则 (Overview & Sanitization Principles)

本矩阵用于记录从本地现网单体扩展脚本向 Clash Fleet 声明式架构迁移的全部行为映射。
严格执行以下脱敏与安全边界准则：

1. **零凭据、零机密 (Zero Secrets)**：矩阵中绝不包含任何订阅 URL、Token、节点密码、UUID、API Key 或商业代理提供商名称；
2. **零私有网段与私有域名 (Device-Local Boundary)**：用户个人内网 IP、专用网段及个人域名全部采用语义化描述归入 `DROPPED`（保留在设备本地），绝不持久化进公共 Git 仓库；
3. **语义保全而非逐字节相同 (Semantic Equivalence)**：不追求与旧版单体脚本的逐字节一致，以矩阵中明确标定的业务意图和策略行为保全为唯一验收基准。

---

## 2. 行为统计摘要 (Disposition Summary)

| 处置类别 (Disposition) | 条目数 | 说明 |
|---|:---:|---|
| **PRESERVED** | **15** | 公共安全行为，完全继承并在 Fleet 声明式目录与引擎中保全 |
| **INTENTIONAL ARCHITECTURE DELTA** | **7** | 用户意图完全保全，但因 Fleet 架构升级（三级拓扑、跨平台通用脚本）而调整实现形态 |
| **DROPPED** | **9** | 私有网段、个人域名、无用冗余规则、特定商业依赖或不符合版本溯源的规则集 |
| **总计 (Total)** | **31** | 全量覆盖旧版脚本的 194 条自定义规则与策略拓扑逻辑 |

---

## 3. 详细行为保全矩阵 (Detailed Matrix)

### 3.1 人工智能与认证依赖 (AI, LLM & OAuth Dependencies)

| 行为 ID | 现网意图 (Legacy Intent) | 处置 (Disposition) | Fleet 落地位置 | 验证证据 | 架构设计考量 / Delta 说明 |
|---|---|:---:|---|---|---|
| **BEH-AI-01** | OpenAI / ChatGPT 公共服务分流 | PRESERVED | `src/rules/ai-services.yaml` | `test/migration-behavior.test.js`, `test/legacy-oracle-comparison.test.js` | 包含 `openai.com`, `chatgpt.com`, `oaistatic.com` 等，路由至 `🤖 AI 服务`。 |
| **BEH-AI-02** | Anthropic / Claude 公共服务分流 | PRESERVED | `src/rules/ai-services.yaml` | `test/migration-behavior.test.js`, `test/legacy-oracle-comparison.test.js` | 包含 `anthropic.com`, `claude.ai` 等，路由至 `🤖 AI 服务`。 |
| **BEH-AI-03** | Google AI (Gemini, NotebookLM, DeepMind) 区域敏感分流 | PRESERVED | `src/rules/ai-services.yaml` | `test/migration-behavior.test.js`, `test/legacy-oracle-comparison.test.js` | 包含 `gemini.google.com`, `notebooklm.google.com`, `generativelanguage.googleapis.com` 等，严格指向 `🤖 AI 服务`。 |
| **BEH-AI-04** | Google AI 底层风控与通用基础设施协同分流 | PRESERVED | `src/rules/ai-services.yaml` | `test/migration-behavior.test.js` | 底层风控与状态同步 API 必须与 AI 业务同节点，防止 NotebookLM 认证中断。 |
| **BEH-AI-05** | Copilot / Perplexity / Grok 通用 AI 路由 | PRESERVED | `src/rules/ai-services.yaml` | `test/migration-behavior.test.js` | 包含 `copilot.microsoft.com`, `perplexity.ai`, `grok.com` 等主流 AI 平台。 |
| **BEH-AI-06** | Cursor 编辑器与周边服务路由 | PRESERVED | `src/rules/ai-services.yaml` | `test/migration-behavior.test.js` | 包含 `cursor.sh`, `marketplace.cursorapi.com`, `download.todesktop.com` 等，路由至 `🤖 AI 服务`。 |
| **BEH-AI-07** | Cursor API 直连绕过 | PRESERVED | `src/rules/ai-services.yaml` | `test/migration-behavior.test.js` | `DOMAIN,api2.cursor.sh,DIRECT` 严格置于 `DOMAIN-SUFFIX,cursor.sh` 之前，确保编辑时 indexing 直连低延迟。 |
| **BEH-AUTH-01** | Google OAuth 敏感认证分流 | PRESERVED | `src/rules/ai-services.yaml` | `test/migration-behavior.test.js` | `accounts.google.com` 与 `oauth2.googleapis.com` 强制走 `🤖 AI 服务`，先于任何通用直连与代理规则，避免 location=unsupported 风控。 |
| **BEH-AUTH-02** | Google OAuth 跨服务统一路由 | INTENTIONAL ARCHITECTURE DELTA | `src/rules/ai-services.yaml` | `test/migration-behavior.test.js` | 旧版脚本因业务组划分导致 OAuth 路由冲突；Fleet 将其统一归入 `🤖 AI 服务`，消除分流脑裂隐患。 |

### 3.2 跨平台进程规则 (Cross-Platform Process Declarations)

| 行为 ID | 现网意图 (Legacy Intent) | 处置 (Disposition) | Fleet 落地位置 | 验证证据 | 架构设计考量 / Delta 说明 |
|---|---|:---:|---|---|---|
| **BEH-DEV-01** | macOS 开发者环境进程分流 | INTENTIONAL ARCHITECTURE DELTA | `src/rules/platforms/darwin.yaml` | `test/cross-platform-process.test.js` | 旧版绑定专属固定出口组；Fleet 标准化统一指向 Tier 1 `🤖 AI 服务`，并通过 Universal 机制与 Windows 规则共存。 |
| **BEH-DEV-02** | Windows 开发者环境进程分流 | INTENTIONAL ARCHITECTURE DELTA | `src/rules/platforms/win32.yaml` | `test/cross-platform-process.test.js` | 包含对应 `.exe` 进程，统一合入 Universal Script，在 Windows 宿主下无缝命中。 |
| **BEH-DEV-03** | macOS 国内办公协作进程直连 | PRESERVED | `src/rules/platforms/darwin.yaml` | `test/cross-platform-process.test.js` | 包含 `DingTalk.app`, `Dt WebView Helper.app`, `VooV Meeting`, `SunloginClient`，直连保障通讯低延迟。 |
| **BEH-DEV-04** | Windows 国内办公协作进程直连 | PRESERVED | `src/rules/platforms/win32.yaml` | `test/cross-platform-process.test.js` | 包含 `DingTalk.exe`, `SunloginClient.exe`，确保 Windows 环境下进程级直连生效。 |

### 3.3 媒体服务与学术/公共直连 (Media & Public Direct Services)

| 行为 ID | 现网意图 (Legacy Intent) | 处置 (Disposition) | Fleet 落地位置 | 验证证据 | 架构设计考量 / Delta 说明 |
|---|---|:---:|---|---|---|
| **BEH-MEDIA-01** | Spotify 媒体流服务分流 | INTENTIONAL ARCHITECTURE DELTA | `src/rules/media-services.yaml` | `test/migration-behavior.test.js`, `test/legacy-oracle-comparison.test.js` | 旧版使用专有服务名称；Fleet 抽象并标准化为 Tier 1 意图组 `🎵 媒体服务`，策略拓扑优先选择非港节点池以规避地区限制。 |
| **BEH-DIR-01** | 公共学术期刊、高校文献与开源镜像直连 | PRESERVED | `src/rules/direct.yaml` | `test/legacy-oracle-comparison.test.js` | 包含 CNKI 知网、万方、清华镜像源、ScienceDirect、OCLC、高校教务等，确定性直连保证学术文献畅通访问。 |
| **BEH-DIR-02** | 国内常用公共服务、协同工具及远程控制直连 | PRESERVED | `src/rules/direct.yaml` | `test/legacy-oracle-comparison.test.js` | 包含百度、钉钉、腾讯会议、工行、向日葵 (Oray)、Unity、TouchDesigner、本地 Web UI 等公共端点。 |

### 3.4 基础网络与策略拓扑 (Network Infrastructure & Policy Topology)

| 行为 ID | 现网意图 (Legacy Intent) | 处置 (Disposition) | Fleet 落地位置 | 验证证据 | 架构设计考量 / Delta 说明 |
|---|---|:---:|---|---|---|
| **BEH-NET-01** | 纯 IP 连接 SNI 域名嗅探 (DoH 漏网治理) | PRESERVED | `src/engine/sniffer.js` | `test/legacy-oracle-comparison.test.js` | 启用 `parse-pure-ip: true`，监听 443/8443 (TLS) 与 80/8080-8880 (HTTP)，解决 Chrome DoH 绕过 TUN 劫持的问题。 |
| **BEH-TOPO-01** | Tier 1 `🤖 AI 服务` 业务意图策略组 (含 Strict Region Lock) | INTENTIONAL ARCHITECTURE DELTA | `src/engine/topology.js` | `test/business-intent-topology.test.js` | 默认模式动态引用 US / JP / SG 地区池并以 HK 兜底；支持用户显式锁定 intended region (如 US/JP)，当锁定地区池缺失/被裁剪时严格 Fail-Closed 至 `REJECT`，绝不静默跨国家切换；不引入 sticky node/exact-IP；全无受支持地区时严格 Fail-Closed 至 `REJECT`（杜绝静默直连泄露凭据）。 |
| **BEH-TOPO-02** | Tier 1 `🎵 媒体服务` 业务意图策略组 | INTENTIONAL ARCHITECTURE DELTA | `src/engine/topology.js` | `test/business-intent-topology.test.js` | 动态引用非港有效地区池；若仅有 HK 则兜底至 HK；无节点时安全回退至 DIRECT。 |
| **BEH-TOPO-03** | Tier 1.5 `🚀 自动优选` 调度优选策略组 | PRESERVED | `src/engine/topology.js` | `test/topology.test.js` | 仅引用 Tier 2 地区池组名，严禁直接挂载物理节点；仅在有效地区池 >= 2 时按需生成。 |
| **BEH-TOPO-04** | Tier 2 物理地区池 (`url-test`) | PRESERVED | `src/engine/topology.js` | `test/topology.test.js` | 依据预置正则归类物理节点并执行单点健康探测；空地区自动动态裁剪，且同步净化上层引用。 |
| **BEH-TOPO-05** | 日本节点专属固定出口策略组 | INTENTIONAL ARCHITECTURE DELTA | `src/engine/topology.js` | `test/business-intent-topology.test.js` | 旧版独立硬编码组收敛至 Tier 1 `🤖 AI 服务`，用户可通过 `🤖 AI 服务` 的下拉选项手动指定 `🇯🇵 日本`，不增加冗余空转策略组。 |

### 3.5 废弃、私有及本地边界项 (Dropped & Local Boundary Items)

| 行为 ID | 现网意图 (Legacy Intent) | 处置 (Disposition) | Fleet 落地位置 | 验证证据 | 架构设计考量 / Delta 说明 |
|---|---|:---:|---|---|---|
| **BEH-DROP-01** | 虚拟网关 IP-CIDR 直连 | DROPPED | 无 (设备本地管辖) | 代码库无任何该 IP 记录 | Fake-IP 网关段由 CVR 权威控制面（Authoritative Control Plane）与 TUN 模块接管，配置脚本无需越权持有。 |
| **BEH-DROP-02** | 私有服务机房 IP-CIDR 直连 | DROPPED | 无 (设备本地管辖) | 私有数据泄漏扫描 PASS | 私有机房网段，属于明确的个人网络资产凭据，严格执行 Device-Local Boundary，禁止入库。 |
| **BEH-DROP-03** | 私有园区局域网 IP-CIDR 直连 | DROPPED | 无 (设备本地管辖) | 私有数据泄漏扫描 PASS | 私有局域网网段，归入设备侧本地规则，不纳入公共 Canonical 交付。 |
| **BEH-DROP-04** | 个人私有主域名直连 | DROPPED | 无 (设备本地管辖) | 私有数据泄漏扫描 PASS | 个人私有域名，不具有公共普适性，按照隐私第一原则隔离在本地。 |
| **BEH-DROP-05** | 私有开发/测试业务域名直连 | DROPPED | 无 (设备本地管辖) | 私有数据泄漏扫描 PASS | 私有业务域名，属于本地专用条目，不进入公共开源代码仓库。 |
| **BEH-DROP-06** | 冗余默认代理规则 (设计软件/云笔记/素材站) | DROPPED | 无 (自然命中兜底) | 规则精简与去冗余 | 原规则明确指定为 `🔰 节点选择`，与 Clash 下游兜底规则完全重叠，剔除后无任何分流行为变化。 |
| **BEH-DROP-07** | 过期临时媒体/CDN 直连域名 | DROPPED | 无 | 规则精简 | 属于过期临时性第三方流媒体 CDN，不再具备长效维护价值。 |
| **BEH-DROP-08** | 第三方动态 Rule Provider 规则源引用 | DROPPED | `src/providers/rule-providers.yaml` (保持骨架) | `test/provenance-manifest.test.js` | 旧版第三方引用为可变动态源且无法验证版本不可变性。遵循 Issue #4 规范与“不在此 Ticket 中虚构替代上游源”原则，暂时保持 `providers: []`，待后续专属采购票处理。 |
| **BEH-DROP-09** | 跨层节点级直连特定国家地区池 | DROPPED | 无 | 遵循三级分层架构 | 域名规则直连特定 Tier 2 地区池违背了分层解耦原则。如需特定地区服务，建议通过 Tier 1 业务组或由下游订阅规则代理。 |

---

## 4. 结论与验收依据 (Conclusion & Acceptance Baseline)

本矩阵以**行为意图保全 (Behavior Preservation)** 为最高准则：
1. 核心 AI（ChatGPT, Claude, Gemini, NotebookLM）及风控底层域名得到 100% 完整继承，支持 Strict Region Lock 严格区域锁定（缺失时 Fail-Closed），且敏感 AI/OAuth 规则优先于通用平台 PROCESS 规则；
2. 跨平台 macOS (`.app`) 与 Windows (`.exe`) 进程分流规则共存于同一 Universal Script，Boa 0.22 沙箱执行零报错；
3. 私有 IP 与个人域名 100% 从公共仓库剔除，测试夹具与代码库保持绝对零机密。
