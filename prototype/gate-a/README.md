# Clash Fleet — Prototype Gate A (Build Gate)

本目录为 Clash Fleet Gate A（构建门禁）的可重复执行原型环境。

## 目标

验证多个模块化 JavaScript 源文件如何以最可靠、最纯净的方式打包为符合 **Clash Verge Rev (CVR)** 及 **Boa 0.22.0** 运行时合约的单一 `Script.js`。

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

### 3. 执行完整自动化测试套件
```bash
npm test
```
该命令会自动：
1. 分别以多种构建形态（Concat、esbuild、Rollup 等）构建单一产物；
2. 校验构建确定性（多次构建 SHA256 一致性）；
3. 模拟 CVR `validate.rs` 进行静态字符串与 Boa 语法校验；
4. 模拟 CVR `script.rs` 在实际 `boa 0.22.0` 沙箱中执行并比对输出结果；
5. 打印对比矩阵报告。
