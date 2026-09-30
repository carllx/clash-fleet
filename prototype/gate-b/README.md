# Gate B — macOS Deploy & Apply Lifecycle Prototype

## 目标与定位

本目录包含 Gate B（macOS 部署与生效生命周期验证）的自动化测试探针与合成 Fixture。

核心验证问题：
> **外部工具更新 `Script.js` 后，到底经过什么生命周期，CVR 才真正重新读取并执行它？**

## 结构

- `probe.py`: 自动化生命周期探测脚本，内置 `SafeScriptContext` 强制安全恢复与 SHA-256 比对机制。
- `fixtures/valid_witness_script.js`: 合法的合成测试脚本，注入良性 `gate_b_witness` 标识。
- `fixtures/invalid_syntax_script.js`: 带有故意语法错误的合成测试脚本，用于验证失败边界与回滚行为。

## 复现方式

```bash
# 1. 检查基线状态
python3 prototype/gate-b/probe.py --mode baseline

# 2. 验证纯外部文件替换（观察 10s）
python3 prototype/gate-b/probe.py --mode raw-replace

# 3. 验证确证的无头生效触发动作（优雅重启 CVR）
python3 prototype/gate-b/probe.py --mode restart-trigger

# 4. 验证负向对照（Mihomo /configs reload）
python3 prototype/gate-b/probe.py --mode mihomo-neg-ctrl
```

## 安全与隔离性说明

- 探针运行属于**受控可逆现网路径探测 (Controlled Reversible Live-path Probe)**；
- 严禁修改或提交用户真实生产代理凭据与订阅 URL；
- 探针运行中修改的 `Script.js` 在退出时必须无条件恢复并比对 SHA-256。
