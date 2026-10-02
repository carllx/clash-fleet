# Clash Fleet

Clash Fleet 是用于 Clash Verge Rev / Mihomo 的多设备配置分发、部署与诊断工具链。

## 快速上手与环境准备 (Fresh Checkout Setup)

在全新拉取的代码仓库中，通过以下步骤准备运行环境：

```bash
# 1. 安装项目依赖
npm install

# 2. 准备精确的 Boa 0.22.0 引擎二进制 (Fail-Closed 审计门禁)
npm run setup:boa

# 3. 运行完整测试套件 (包含静态 Marker、AST 解析与沙箱契约)
npm test

# 4. 执行确定性单文件构建
npm run build
```

### 引擎环境变量覆盖

若运行在未包含预编译二进制的平台，可自行编译 `boa_engine = "0.22.0"` 并指定环境变量：

```bash
export BOA_PATH="/path/to/custom/boa"
```

## CLI 工具用法

Clash Fleet 提供了原生 CLI 命令：

```bash
# 构建 Script.js 并生成 RULE_ASSET_PROVENANCE.json (默认自动开启 Boa 0.22 门禁)
node bin/fleet.js build

# 自定义入口与输出
node bin/fleet.js build --input src/index.js --output dist/Script.js

# 单独对目标脚本执行 Boa 0.22 兼容性门禁校验
node bin/fleet.js verify dist/Script.js
```

## 声明式 Rule Provider 维护与版本溯源

外部 Rule Provider 统一在 `src/providers/rule-providers.yaml` 声明。构建时会自动生成不可变性与回滚语义审计清单 `dist/RULE_ASSET_PROVENANCE.json`。详细配置规范详见 [Rule Provider 维护指南](docs/rule-providers-guide.md)。

