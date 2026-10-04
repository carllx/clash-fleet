# 遗留规则审计与薄服务画像规范 (Legacy Route Audit & Thin Service Profiles)

**研究日期**：2026-10-05  
**工作单元**：Issue #15 `research(vNext): Legacy route audit & thin service profiles`  
**证据基线与数据来源**：
- 现网规则库：`src/rules/ai-services.yaml`
- 现网行为矩阵：`docs/migration/behavior-preservation-matrix.md`
- 官方主数据源 (Primary Sources)：
  - [Google Gemini Web 官方可用地区列表](https://support.google.com/gemini/answer/13575153)（**Verified**：网页版当前支持国家与地区列表包含 Hong Kong）
  - [Google AI Pro 与 Gemini Notebook 官方可用地区说明](https://support.google.com/googleone/answer/14534406)（**Verified**：独立列表，当前支持国家与地区中不包含 Hong Kong）
  - [Google Gemini 隐私中心 / 位置数据说明](https://support.google.com/gemini/answer/13594961)（**Verified**：位置信号包含 IP、住宅/工作地址及设备定位）
  - [Google AI Studio / Gemini API 官方支持地区](https://ai.google.dev/gemini-api/docs/available-regions)（**Verified**）
  - [OpenAI 官方支持国家与地区列表](https://platform.openai.com/docs/supported-countries)（**Verified**：包含 US, JP, SG, TW, GB 等）
  - [OpenAI 官方 ChatGPT 网络配置建议文档](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps)（**Verified**：明确列出 ChatGPT Web 与 App 的核心端点、认证、人机验证及遥测域名）
  - [Google NotebookLM 帮助中心历史页面](https://support.google.com/notebooklm/answer/14273834)（Reported 二级引用，未做 Browser-Verified 标记）
- 审计准则：严格遵循 Issue 规范契约（仅使用标准枚举）；区分服务依赖角色与全局规则绑定决策；生产规则保持不动。

---

## 1. 规范分类枚举与修饰模型 (Canonical Enums & Qualifier Model)

为严格符合 Issue #15 规范定义，模型核心状态仅采用以下标准枚举，并在限定修饰字段中补充详细技术判断：

1. **证据状态 (Evidence State)**（标准枚举）：
   - `supported`：有第一方官方文档、协议规范或持续独立观察的一手依据；
   - `provisional`：基于局部观察或行业通用推断，缺乏官方绝对保证；
   - `contradicted`：证据已明确推翻原假设（例如推翻了“专属独占依赖”假设）；
   - `superseded`：有明确一手证据证明已被现代机制或新规范完全替代。

2. **迁移处置状态 (Migration Disposition)**（标准枚举）：
   - `migrated`：作为核心专属服务依赖，按规范纳入薄 Service Profile；
   - `changed`：规则范围、归属角色或分流策略发生变化，需调整后落地；
   - `dropped`：从服务知识中剔除。

3. **策略决策与证据修饰字段 (Policy Recommendation & Qualifier)**：
   - 记录细分建议（如 `candidate_remove_global_AI_binding`、`changed_pending_non_target_validation` 等），不破坏核心枚举契约。

---

## 2. 遗留高影响规则审计矩阵 (Legacy Route Audit Matrix)

### 2.1 Google / Gemini 家族（按产品独立界定）

| 规则目标 / 假设描述 | 历史假设 (Legacy Assumption) | Evidence State | Evidence Qualifier | Migration Disposition | Policy Recommendation | 审计事实与判定理由 |
|---|---|:---:|---|:---:|---|---|
| `gemini.google.com` | Gemini Web 主交互端点 | **supported** | 官方核心域名 | **migrated** | retain_in_profile | 官方核心业务端点。[Gemini 可用性页面 13575153](https://support.google.com/gemini/answer/13575153) 明确其支持列表当前包含 Hong Kong。 |
| `notebooklm.google.com`<br>`notebooklm.google` | NotebookLM 专属端点 | **supported** | 独立官方服务端点 | **migrated** | retain_in_profile | 官方核心端点。[Google AI Pro & Gemini Notebook 官方可用列表 14534406](https://support.google.com/googleone/answer/14534406) 显示当前列表中不包含 Hong Kong。 |
| `aistudio.google.com`<br>`generativelanguage.googleapis.com` | Google AI Studio 与 Gemini API | **supported** | 开发者 API 核心端点 | **migrated** | retain_in_profile | 开发者端点，由 [AI Studio 地区列表](https://ai.google.dev/gemini-api/docs/available-regions) 独立管辖。 |
| `alkalicore-pa.clients6.google.com`<br>`signaler-pa.clients6.google.com` | Gemini 网页底层信令与会话流式端点 | **provisional** | 本地采样观察到，但未获一手架构文档证明必选 | **migrated** | retain_as_provisional_core | 单次只读观察到其与 Gemini 会话相关，但不能证明为必选核心 RPC；在薄 Profile 中保持为 provisional core 角色。 |
| `accounts.google.com`<br>`oauth2.googleapis.com` | Google OAuth 认证必须与 AI 业务同节点 | **provisional** | 实测跨国出口仍能建立连接，同出口属于用户偏好假设 | **changed** | candidate_declare_auth_not_global_binding | 实测证实认证走 JP、业务走 US 依然可建立会话；服务端对多出口的具体风控机制保持 Unknown。作为薄 Profile 的可选 `auth` 依赖声明，不全局绑死。 |
| `www.google.com`<br>`apis.google.com`<br>`www.googleapis.com` | 属于 AI 业务必需的底层通用风控基础设施 | **contradicted** | 独占依赖假设被推翻；属于全网共享基础设施 | **changed** | candidate_remove_global_AI_binding | 广泛共享基础设施。将其全局绑定 AI 组会导致非目标普通搜索与系统 API 受 AI 出口制约。待评估非目标流量影响后处置，生产规则保持不动。 |
| `DOMAIN-KEYWORD,antigravity` | 宽松关键字匹配用于 IDE 流量兜底 | **provisional** | 宽泛关键字存在误伤风险 | **changed** | candidate_replace_with_process_rule | 关键字匹配过于宽泛，建议改用进程规则或显式端点。 |

### 2.2 OpenAI / ChatGPT 家族

| 规则目标 / 假设描述 | 历史假设 (Legacy Assumption) | Evidence State | Evidence Qualifier | Migration Disposition | Policy Recommendation | 审计事实与判定理由 |
|---|---|:---:|---|:---:|---|---|
| `chatgpt.com`<br>`openai.com`<br>`oaistatic.com`<br>`oaiusercontent.com` | ChatGPT 核心入口与静态资源 | **supported** | [OpenAI 官方网络建议 9247338](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps) 明确列出 | **migrated** | retain_in_profile | 第一方官方建议明确要求的核心业务端点与静态 CDN。 |
| `auth0.openai.com` | ChatGPT 身份认证端点 | **supported** | [OpenAI 官方网络建议 9247338](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps) 明确列出 | **migrated** | retain_in_profile_as_auth | 官方专有认证端点，非全局 `cdn.auth0.com`。 |
| `challenges.cloudflare.com` | 人机验证挑战端点 | **supported** | [OpenAI 官方网络建议 9247338](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps) 明确列出 | **changed** | candidate_profile_shared_infra_not_global | 第一方网络建议确实包含该端点（服务相关依赖）；但因其为通用共享基础设施，全局绑定 AI 组会波及其他网站，应解耦全局绑定。 |
| `o33249.ingest.sentry.io` | 客户端错误收集遥测 | **supported** | [OpenAI 官方网络建议 9247338](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps) 明确列出 | **changed** | candidate_profile_telemetry_not_global | 第一方网络建议确实包含该端点（属于遥测角色）；但全局强制走 AI 组属于过度路由，应归入薄 Profile 的 telemetry 角色管理。 |
| `openaicom-api-bdcpf8c6d2e9atf6.z01.azurefd.net` 等 | 历史临时 Azure CDN 别名 | **provisional** | 缺乏一手退休证据，但硬编码别名具有维护脆弱性 | **changed** | candidate_remove_brittle_alias | 无一手证明其已失效，但硬编码别名维护成本极高；应依赖官方规范主域名解析。 |

### 2.3 共享基础设施过度路由审计 (Shared Infrastructure Audit)

| 规则目标 | 现网配置 | Evidence State | Evidence Qualifier | Migration Disposition | Policy Recommendation | 审计事实与判定理由 |
|---|---|:---:|---|:---:|---|---|
| `api.github.com` | 绑死在 `🤖 AI 服务` | **contradicted** | 独占依赖假设被推翻；属于全局开发基础设施 | **changed** | candidate_remove_global_AI_binding | 全局绑定 AI 组会导致全主机 Git 同步与 CLI 被 AI 节点状态绑架。 |
| `cdn.auth0.com` | 绑死在 `🤖 AI 服务` | **contradicted** | 独占依赖假设被推翻；属于全网多租户 SaaS 认证 | **changed** | candidate_remove_global_AI_binding | 通用第三方身份验证 SaaS，非 OpenAI 或 Google 专有，强绑易引发跨站认证连带风险。 |

---

## 3. 薄服务画像规范 (Thin Service Profiles Specification)

薄服务画像仅记录作出路由、健康检查与恢复决策所需的最小元数据，不构建大而全的规则数据库。

### 3.1 Profile 1: Google Gemini Web (`google-gemini-web.yaml`)

```yaml
service_id: "google-gemini-web"
product_scope: ["Gemini Web (gemini.google.com)"]
primary_sources:
  - doc: "https://support.google.com/gemini/answer/13575153"
    role: "official_availability_list"
    fetched_date: "2026-10-05"
    note: "Official web list currently includes Hong Kong, US, JP, SG, etc."
  - doc: "https://support.google.com/gemini/answer/13594961"
    role: "privacy_location_data_provenance"
    fetched_date: "2026-10-05"
    note: "Explains location signals (IP, Home/Work, device location)"
provider_references: "none_selected" # 避免盲目复制未经核验的庞大社区列表
applicability_conditions:
  - "Browser or client accessing gemini.google.com directly"
dependency_roles:
  core:
    - "gemini.google.com"
    - "alkalicore-pa.clients6.google.com" # provisional
    - "signaler-pa.clients6.google.com"    # provisional
  auth:
    - "accounts.google.com" # optional co-egress user preference; server-side effect unknown
  shared_infra: [] # 显式排除 www.google.com, www.googleapis.com 等全局绑定
  optional_telemetry: []
official_availability_source: "https://support.google.com/gemini/answer/13575153"
fleet_candidate_egress_regions: ["US", "JP", "SG", "HK"] # 基于当前节点池与官方列表的候选交集
fleet_egress_policy_status: "not_canonicalized" # 非厂商强制要求，亦非唯一推荐代理出口
egress_constraints:
  prefer_stable_session: true # 减少在会话期间的节点切换
coarse_reachability_probe:
  endpoint: "https://gemini.google.com"
  expected_status: [200, 302]
  limitations: "仅作为粗粒度网络连通性探测，不能证明账号可用性、真实认证有效性或生成业务成功。"
conflict_revocation_condition:
  "若官方地区支持策略变更，或底层信令域名重命名，该 Profile 需更新。"
evidence_limitations: "信令端点基于局部抓包推断，属于 provisional 证据。"
review_date: "2026-10-05"
revalidation_due: "2026-11-05"
```

### 3.2 Profile 2: Google NotebookLM (`google-notebooklm.yaml`)

```yaml
service_id: "google-notebooklm"
product_scope: ["NotebookLM (notebooklm.google.com)"]
primary_sources:
  - doc: "https://support.google.com/googleone/answer/14534406"
    role: "official_availability_list"
    fetched_date: "2026-10-05"
    note: "Official Google AI Pro & Gemini Notebook list does NOT currently include Hong Kong."
provider_references: "none_selected"
applicability_conditions:
  - "Browser accessing notebooklm.google.com or notebooklm.google"
dependency_roles:
  core:
    - "notebooklm.google.com"
    - "notebooklm.google"
  auth:
    - "accounts.google.com" # server-side co-egress effect unknown
  shared_infra: []
  optional_telemetry: []
official_availability_source: "https://support.google.com/googleone/answer/14534406"
fleet_candidate_egress_regions: ["US", "JP", "SG"] # 严格区分：不包含 HK
fleet_egress_policy_status: "not_canonicalized"
egress_constraints:
  prefer_stable_session: true
coarse_reachability_probe:
  endpoint: "https://notebooklm.google.com"
  expected_status: [200, 302]
  limitations: "粗粒度连通性检查，不能替代真实 Google Workspace / 个人账号登录态验证。"
conflict_revocation_condition:
  "若官方独立支持列表加入 Hong Kong，可相应扩展 candidate regions。"
evidence_limitations: "核心业务依赖于独立官方名单，认证依赖于 shared auth 行为。"
review_date: "2026-10-05"
revalidation_due: "2026-11-05"
```

### 3.3 Profile 3: OpenAI ChatGPT (`openai-chatgpt.yaml`)

```yaml
service_id: "openai-chatgpt"
product_scope: ["ChatGPT Web (chatgpt.com)", "OpenAI Platform (platform.openai.com)"]
primary_sources:
  - doc: "https://platform.openai.com/docs/supported-countries"
    role: "official_supported_countries"
    fetched_date: "2026-10-05"
    note: "Official supported countries include US, JP, SG, TW, GB, etc."
  - doc: "https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps"
    role: "official_network_recommendations"
    fetched_date: "2026-10-05"
    note: "First-party network guidance explicitly listing core, auth, cloudflare challenge and sentry endpoints."
provider_references: "none_selected"
applicability_conditions:
  - "Browser or API client connecting to OpenAI endpoints"
dependency_roles:
  core:
    - "chatgpt.com"
    - "openai.com"
    - "oaistatic.com"
    - "oaiusercontent.com"
  auth:
    - "auth0.openai.com" # 专有 auth0 子域，排除全网 cdn.auth0.com
  shared_infra:
    - "challenges.cloudflare.com" # 官方网络建议明确列出，属于服务依赖，但不应全局绑定 AI 组
  optional_telemetry:
    - "o33249.ingest.sentry.io"   # 官方网络建议明确列出，属于遥测角色，不应全局绑定 AI 组
official_availability_source: "https://platform.openai.com/docs/supported-countries"
fleet_candidate_egress_regions: ["US", "JP", "SG", "TW", "GB"]
fleet_egress_policy_status: "not_canonicalized" # 支持国家列表不等同于指定代理节点
egress_constraints:
  egress_reputation_requirement: "unknown/not_canonicalized" # 不作未经证实的主观网络类型要求
coarse_reachability_probe:
  endpoint: "https://chatgpt.com"
  expected_status: [200, 302]
  limitations: "粗粒度连通性检查，不能证明 Cloudflare 挑战通过、账号封禁状态或对话生成语义正常。"
conflict_revocation_condition:
  "若官方主域名发生重组或 CDN 认证架构变更，需核对并调整。"
evidence_limitations: "出口信誉要求属于远端动态模型，本地无权威判定数据。"
review_date: "2026-10-05"
revalidation_due: "2026-11-05"
```

---

## 4. 结论与下阶段行动

1. **解耦产品地区政策**：本次审计通过第一方官方主数据源（Gemini Web `13575153` 与 Google AI Pro / Gemini Notebook `14534406`）严格证明了两者在可用地区上存在实质差异（前者官方支持含 HK，后者官方支持不含 HK）。
2. **规范化枚举与角色解耦**：将所有分类严格收敛至 Issue 原定义标准枚举（`supported`, `provisional`, `contradicted`, `superseded` 及 `migrated`, `changed`, `dropped`）；在 OpenAI 第一方网络指南支撑下，将“服务相关依赖（如 Cloudflare challenge, Sentry）”与“是否应该全局绑定 AI 组”清晰解耦。
3. **安全边界坚守**：本报告仅形成研究画像与候选建议，**生产规则 `src/rules/ai-services.yaml` 保持不动**。
