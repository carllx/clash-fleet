# Issue #8 macOS 平台适配器架构设计与实现计划

## 1. 目标与定位

实现 Deployment Transaction 第 7 步在 macOS 平台下的 Platform Adapter：
`Topology / Path / Process Discovery → Controlled Lifecycle Trigger → Lifecycle Evidence`

严格遵守：
- Universal `Script.js` 跨平台唯一；所有 macOS 专有逻辑完全封装在 Platform Adapter 中。
- 动态识别 Service 拓扑与 Sidecar 拓扑，不将历史测试机现状作为系统静态预设。
- 复用 Issue #7 已规范化的 Deployment Core（`executeDeploymentTransaction` 流程中第 1–6 步），不重复实现构件拉取、校验、Boa 预检、备份和原子替换。
- 为未来 Issue #10 提供干净统一的生命周期触发/回滚重触发 seam。
- 绝不承诺 `zero downtime`，仅报告秒级受控重载事实。
- 零私有主机信息泄露（路径脱敏，隐去用户名与订阅机密）。
- CI 全环境可在无真实 CVR 进程环境下通过确定性 Fixture 运行并通过。

---

## 2. 模块架构设计

文件规划（严格控制各模块预算 `<= 400 行`）：

```text
src/deploy/platforms/
├── macos-adapter.js       # macOS 适配器入口与高层生命周期编排
├── macos-discovery.js     # 路径与进程拓扑动态探测器
└── macos-trigger.js       # 受控生命周期触发与有界等待观测器
test/
└── macos-adapter.test.js  # 平台适配器确定性集成与单元测试套件
```

### 2.1 路径与拓扑探测 (`macos-discovery.js`)
1. **数据目录发现**:
   - 默认候选：`~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev`
   - 支持通过选项注入 `appDataDir` 或环境变量 `FLEET_MACOS_DATA_DIR`
   - 检查 `profiles/Script.js` 目标文件存在性
2. **进程发现**:
   - CVR 主进程：扫描 `clash-verge` 或 `/Applications/Clash Verge.app/Contents/MacOS/clash-verge`
   - Mihomo 核心进程：扫描 `verge-mihomo`
   - Privileged Helper 进程：扫描 `clash-verge-service`
3. **拓扑判定状态机**:
   - `SERVICE`:
     - 存在运行中的 `clash-verge-service`
     - 且 `verge-mihomo` 处于运行中，其参数中带有 `/clash-verge-service/` 相关 runtime 路径或 unix socket
   - `SIDECAR`:
     - 不存在 `clash-verge-service` 托管
     - `verge-mihomo` 正在运行，且其父进程为 CVR 主进程或在同用户下由 CVR 直接子进程持有
   - `NO_TOPOLOGY` (Fail-Closed):
     - 未发现运行中的 CVR 主进程或核心进程
   - `AMBIGUOUS` (Fail-Closed):
     - 存在相互矛盾的进程关系（例如多个不同 CVR 实例或进程关系冲突）
4. **证据级别标注**:
   - `Verified`: 本机实时进程与文件系统直接捕获的事实
   - `Reported`: 第三方/上游 API 声明但未由 OS 直接验证
   - `Inferred`: 依据已知规则推断但缺乏底层唯一凭据

### 2.2 受控生命周期触发与观测 (`macos-trigger.js`)
1. **触发动作选择**:
   - 标准普通权限无头重载：向 CVR 主进程发送优雅退出信号 `SIGTERM`，随后使用 macOS 原生 `open -a "Clash Verge" --args --hidden`（或配置的自定义命令）重新拉起。
2. **触发执行抽象与 Seam**:
   - 支持注入 `execFn` / `killFn`，便于测试及未来 Issue #10 回滚重载复用。
3. **有界时间窗口观测 (Bounded Observation)**:
   - 记录旧 CVR PID；
   - 轮询等待旧 PID 终止（默认超时 5 秒）；
   - 执行拉起命令；
   - 轮询等待新 CVR PID 出现并处于稳定运行状态（默认超时 10 秒）；
   - 记录生命周期重载总耗时（精确毫秒与秒级连续性报告）；
   - 超时则 Fail-Closed 并返回清晰诊断信息。

### 2.3 适配器集成入口 (`macos-adapter.js`)
暴露标准 `MacOSPlatformAdapter` 类：
- `probe()`: 只读非破坏性探测，返回当前拓扑、路径、运行进程清单与证据级别。
- `triggerLifecycleReload(probeResult, options)`: 执行受控重启并捕获观测证据。
- `executeStep7(deployResult, options)`: 衔接 Issue #7 的部署结果，执行完整的 Step 7 并返回增强部署结果：
  ```javascript
  {
    status: 'RELOAD_TRIGGERED', // 从 STAGED_NOT_APPLIED 升级
    lifecycleBoundary: 'LIFECYCLE_TRIGGERED_NOT_VERIFIED', // 明确移交 Issue #10
    topology: 'SERVICE' | 'SIDECAR',
    oldPid: number,
    newPid: number,
    elapsedMs: number,
    continuityReport: 'CONTROLLED_SECONDS_LEVEL_TRANSITION',
    ...
  }
  ```

---

## 3. 测试矩阵与确定性 Fixtures

编写 `test/macos-adapter.test.js`，通过纯内存/进程抽象注入：
1. **Service 模式探测**: 模拟 Helper + Service-hosted Mihomo + CVR GUI。
2. **Sidecar 模式探测**: 模拟 CVR GUI 直接持有子进程 Mihomo。
3. **No Topology 探测**: 模拟空进程列表，断言 Fail-Closed。
4. **Ambiguous 拓扑探测**: 模拟冲突进程特征，断言 Fail-Closed。
5. **触发动作选择**: 验证基于探测结果生成的终止信号与重启命令行。
6. **优雅退出超时**: 模拟进程卡死不退出，断言超时 Fail-Closed。
7. **新实例启动超时**: 模拟拉起后新进程未出现，断言超时 Fail-Closed。
8. **成功生命周期转换**: 模拟旧 PID 退出、拉起新 PID，断言耗时与证据完整性。
9. **脱敏保护**: 断言生成的证据结构中不包含任何当前用户的私有绝对路径与敏感信息。
10. **与 Issue #7 部署结果组合**: 验证状态从 `STAGED_NOT_APPLIED` 正确流转至 `LIFECYCLE_TRIGGERED_NOT_VERIFIED`。

---

## 4. 阶段边界执行步骤 (Run-to-Gate)

- **Gate A (自治完成)**:
  1. 编码实现 `macos-discovery.js`, `macos-trigger.js`, `macos-adapter.js`；
  2. 编写并运行全部单测与集成测试；
  3. 执行 `npm run lint` 与 `npm test`；
  4. 执行本机当前环境的只读非破坏性探测；
  5. 停在 `IMPLEMENTATION_READY / HOST_RESTART_AUTHORIZATION_REQUIRED` 向用户请求重启授权。
- **Gate B (用户授权后)**:
  1. 得到明确授权后执行真实受控重启并捕获物证；
  2. 运行完整测试与 lint；
  3. 提交、推送、CI 通过；
  4. 执行最终 Matt `/code-review` 并输出最终 Consolidated Evidence Bundle。
