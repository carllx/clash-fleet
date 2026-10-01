# 0001. 采用混合源码模型与只读构建产物

Clash Verge Rev 扩展脚本运行于无外部 I/O 且单文件加载的 Boa 0.22 引擎沙箱中，手工维护数百行单体 JavaScript 存在语法脆弱与无法模块化测试的问题；因此我们决定采用“纯数据声明 + 模块化 JavaScript 引擎”的混合源码模型（Hybrid Source Model），并通过 Rollup Flat 确定性编译出唯一的只读构建构件（Build Artifact）`Script.js`。

## Status

Accepted

## Considered Options

- **单体 JavaScript 源码直接维护**：保留现状直接手写 `Script.js`。代码膨胀严重，修改规则极易引发语法错误导致运行时静默降级。
- **纯声明式 YAML DSL + 解释器**：强行将所有逻辑 DSL 化。缺乏处理复杂节点过滤、动态分组算法的灵活性，且过度设计。
- **混合源码模型 (Hybrid Source Model)**：数据与行为分离。域名规则、服务声明与正则字典采用轻量声明式数据；动态节点清洗、策略拓扑组装采用模块化 JS；构建期通过 Scope Hoisting 编译为无辅助垫片的单一脚本。

## Consequences

- 日常规则与地区调整仅需修改声明式数据文件，规避代码级破坏；
- 生成的 `Script.js` 是 CI 构建产物，禁止人工直接在运行时目录编辑；
- 每次发布产物具备确定的 SHA-256 校验和，可在设备侧独立执行静态解析与冒烟验证。
