# Clash Fleet — Prototype Gate A (Build Gate)

本目录为 Clash Fleet Gate A（构建门禁）的可重复执行原型环境。

## 目标

验证多个模块化 JavaScript 源文件如何以最可靠、最纯净的方式打包为符合 **Clash Verge Rev (CVR)** 及 **Boa 0.22.0** 运行时合约的单一 `Script.js`。

## Harness 范围与定义 (Bounded CVR Compatibility Harness)

本 Harness 是一套 **Bounded CVR Compatibility Harness**，仅模拟 Gate A 所需的 observable contract：
- Boa 0.22.0 沙箱下的单脚本 parse / eval 语法合法性；
- CVR static main marker (`validate.rs`: 字符串包含 `function main` / `const main` / `let main`)；
- 全局作用域 callable `main(config, profileName)` 运行时调用；
- 无 CommonJS loader / require 宿主泄漏；
- Fixture 处理结果与预期 JSON 深度相等 (Deep Equal)。

它不是 CVR 运行时的完整 emulator（CVR 生产运行时的 execution timeout、loop limits、log/output limits、config lowercasing、error fallback 及 result mapping 等全量控制面行为不属于 Gate A 范围）。

## 运行与复现步骤

### 1. 准备 Boa 0.22.0 运行时环境
```bash
./bin/setup-boa.sh
```
该脚本会自动拉取并验证对应系统平台官方发布的 `boa 0.22.0` 二进制文件（支持 macOS aarch64 及 Linux x86_64）。

### 2. 安装构建依赖
```bash
npm install
```

### 3. 执行完整自动化测试套件 (Fail-Closed)
```bash
npm test
```
该命令会自动：
1. 分别以多种构建形态（Concat、esbuild、Rollup 等，包含负向对照组）构建单一产物；
2. 校验构建确定性（多次构建 SHA-256 位级一致性）；
3. 执行 Bounded CVR 静态 Marker 校验与 Boa 0.22.0 语法解析；
4. 在实际 `boa 0.22.0` 沙箱中执行全局 `main(config, profileName)` 并比对输出结果；
5. 执行 **Fail-Closed Gate 断言**：任何与预期矩阵不符的指标均会导致 `npm test` 以非零状态码退出。
