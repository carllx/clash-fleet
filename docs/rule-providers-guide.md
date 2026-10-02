# Rule Provider 声明与版本溯源维护规范

本文档指导如何在 Clash Fleet 中维护外部 Rule Provider 声明式配置及其版本溯源策略。

## 声明式文件位置

所有外部规则提供者（Rule Providers）均声明在：
`src/providers/rule-providers.yaml`

生产基线状态保持策略中立（默认 `providers: []`）。

## Schema 规范

每一个 Provider 条目必须声明如下属性：

```yaml
providers:
  - id: example-provider           # 唯一标识符 (必填，字符串，不允许重复)
    behavior: domain               # 规则集类型 (必填: domain | ipcidr | classical)
    format: yaml                   # 数据格式 (可选: yaml | text | mrs，默认 yaml)
    url: "https://example.com/..." # 来源 URL 快照 (必填)
    path: "./rule_providers/..."   # 本地缓存路径 (可选，默认 ./rule_providers/${id}.yaml)
    interval: 86400                # 刷新间隔秒数 (可选，dynamic 默认 86400)
    source:
      strategy: pinned | dynamic   # 来源权威策略 (必填: pinned 或 dynamic)
      revision:                    # 不可变版本修订 (当 strategy 为 pinned 时必填)
        kind: git-commit | release-asset
        value: "..."               # 40位 Git Commit SHA 或固定 Release 资产标签

## 来源策略分类 (Source Strategy)

构建系统严格区分以下两类依赖，并生成确定性的 `dist/RULE_ASSET_PROVENANCE.json`：

1. **固定不可变版本 (Pinned Rule Asset)**:
   - `strategy: pinned`
   - 必须提供显式类型的 `revision`:
     - `kind: git-commit`，`value` 必须为完整 40 位不可变 Commit SHA，且 URL 必须引用该 SHA，严禁指向 `main`/`master` 等分支路径；
     - `kind: release-asset`，`value` 为固定版本发布标识（如 `v1.2.3`），URL 严禁使用 `/latest/download/` 等浮动发布路径；
   - 严禁使用 `main`, `master`, `HEAD`, `latest` 作为 pinned 版本；
   - 运行时 URL 必须与不可变身份一致；
   - 在构建清单中标记为 `Pinned Rule Asset`，具备可精确回滚重现能力。

2. **动态外部依赖 (Dynamic External Dependency)**:
   - `strategy: dynamic`
   - 用于跟踪上游分支（如 `main`/`master`）；
   - 严禁虚假宣称完全可重现；构建系统在清单中显式标记为 `Dynamic External Dependency`，其回滚语义为 `partial / non-fully-reproducible`。

## 构建产物与审计

执行 `fleet build` 时，构建系统将输出：
- `dist/Script.js`: 编译后的扩展脚本；
- `dist/RULE_ASSET_PROVENANCE.json`: 确定性的规则资产溯源清单，包含全局状态（`NO_EXTERNAL_RULE_ASSETS` / `FULLY_PINNED_RULE_ASSETS` / `CONTAINS_DYNAMIC_EXTERNAL_DEPENDENCY`）与按字典序排布的规则源快照。
