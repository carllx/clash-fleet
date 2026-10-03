import {
  resolveMacosPaths,
  scanMacosProcesses,
  detectMacosTopology,
} from './macos-discovery.js';
import {
  executeMacosLifecycleReload,
} from './macos-trigger.js';

/**
 * macOS 平台部署适配器 (macOS Platform Adapter)
 *
 * 承担职责:
 * 1. 动态发现 macOS 下 CVR 数据目录与有效 Script.js 路径;
 * 2. 动态扫描进程并判定 Service 托管模式 vs Sidecar 托管模式;
 * 3. 边界防御: 无进程或多实例歧义时严格 Fail-Closed;
 * 4. 普通权限下执行受控无头重载, 有界观测旧实例终止与新实例就绪;
 * 5. 将部署事务状态自 STAGED_NOT_APPLIED 安全流转至 LIFECYCLE_TRIGGERED_NOT_VERIFIED.
 */
export class MacOSPlatformAdapter {
  /**
   * @param {object} [options]
   * @param {string} [options.customDataDir] 自定义数据目录
   * @param {string} [options.appName] CVR 应用名称
   * @param {Function} [options.execFn] ps 命令执行注入
   * @param {Function} [options.killFn] 进程终止注入
   * @param {Function} [options.spawnFn] 进程启动注入
   * @param {Function} [options.sleepFn] 延迟等待注入
   * @param {typeof import('node:fs')} [options.fsModule] 文件系统模块注入
   */
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * 执行只读、非破坏性的 macOS 宿主路径与拓扑探测
   *
   * @returns {Promise<{
   *   platform: 'darwin',
   *   paths: { dataDir: string, sanitizedDataDir: string, targetScript: string, exists: boolean },
   *   topology: 'SERVICE' | 'SIDECAR' | 'NO_TOPOLOGY' | 'AMBIGUOUS',
   *   topologyPassed: boolean,
   *   evidenceLevel: 'Verified' | 'Reported' | 'Inferred' | 'None',
   *   processes: {
   *     cvr: { pid: number, user: string, command: string } | null,
   *     mihomo: { pid: number, ppid: number, user: string, command: string } | null,
   *     service: { pid: number, user: string, command: string } | null,
   *   },
   *   detail: string
   * }>}
   */
  async probe() {
    const paths = resolveMacosPaths({
      customDataDir: this.options.customDataDir,
      fsModule: this.options.fsModule,
    });

    const processes = await scanMacosProcesses(this.options.execFn);
    const topologyResult = detectMacosTopology(processes);

    return {
      platform: 'darwin',
      paths,
      topology: topologyResult.status,
      topologyPassed: topologyResult.passed,
      evidenceLevel: topologyResult.evidenceLevel,
      processes: {
        cvr: topologyResult.cvrProcess,
        mihomo: topologyResult.mihomoProcess,
        service: topologyResult.serviceProcess,
      },
      detail: topologyResult.detail,
    };
  }

  /**
   * 执行受控生命周期优雅重载 (Step 7 Trigger)
   *
   * @param {object} probeResult 先前 probe() 返回的探测结果
   * @param {object} [triggerOptions]
   * @returns {Promise<{
   *   success: boolean,
   *   oldPid: number,
   *   newPid: number,
   *   elapsedMs: number,
   *   elapsedSeconds: string,
   *   continuityReport: string,
   *   zeroDowntimeClaimed: boolean,
   *   evidenceLevel: string,
   *   detail: string
   * }>}
   */
  async triggerLifecycleReload(probeResult, triggerOptions = {}) {
    if (!probeResult || !probeResult.topologyPassed || !probeResult.processes?.cvr?.pid) {
      const reason = probeResult?.detail || 'Invalid or missing CVR process in probe result';
      throw new Error(`Cannot trigger lifecycle reload: ${reason} (Fail-Closed)`);
    }

    const oldPid = probeResult.processes.cvr.pid;

    return executeMacosLifecycleReload({
      oldPid,
      appName: this.options.appName,
      killFn: this.options.killFn,
      spawnFn: this.options.spawnFn,
      scanFn: async () => scanMacosProcesses(this.options.execFn),
      sleepFn: this.options.sleepFn,
      ...triggerOptions,
    });
  }

  /**
   * 衔接并执行 Deployment Transaction 的 Step 7 (平台生命周期触发)
   *
   * @param {object} deployResult Issue #7 产生的 Step 1–6 部署事务结果
   * @param {object} [triggerOptions] 触发控制选项
   * @returns {Promise<object>} 流转至 Step 7 后的增强部署结果
   */
  async executeStep7(deployResult, triggerOptions = {}) {
    if (!deployResult || deployResult.status !== 'STAGED_NOT_APPLIED') {
      throw new Error(
        `Invalid deployment result state for Step 7: expected status "STAGED_NOT_APPLIED", got "${deployResult?.status}"`
      );
    }

    // 1. 执行动态拓扑探测
    const probeResult = await this.probe();
    if (!probeResult.topologyPassed) {
      throw new Error(`Platform adapter probe failed before Step 7: ${probeResult.detail} (Fail-Closed)`);
    }

    // 2. 执行受控生命周期重载
    const reloadEvidence = await this.triggerLifecycleReload(probeResult, triggerOptions);

    // 3. 返回安全流转状态 (严格止步于 Step 7，不越界实现 Step 8 验证)
    return {
      ...deployResult,
      status: 'RELOAD_TRIGGERED',
      lifecycleBoundary: 'LIFECYCLE_TRIGGERED_NOT_VERIFIED',
      platform: 'darwin',
      topology: probeResult.topology,
      evidenceLevel: reloadEvidence.evidenceLevel,
      lifecycleEvidence: reloadEvidence,
      detail: `Deployment Transaction Step 7 completed: ${reloadEvidence.detail}`,
    };
  }
}
