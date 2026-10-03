import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { scanMacosProcesses } from './macos-discovery.js';

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 默认生命周期超时窗口 (毫秒)
 */
export const DEFAULT_TERMINATION_TIMEOUT_MS = 5000;
export const DEFAULT_READINESS_TIMEOUT_MS = 10000;
export const DEFAULT_POLL_INTERVAL_MS = 200;

/**
 * 默认 macOS CVR 重启命令
 */
export const DEFAULT_MACOS_APP_NAME = 'Clash Verge';

/**
 * 执行受控无头重载并对进程生命周期转移执行有界观测 (Bounded Lifecycle Observation)
 *
 * 时序保证:
 * 1. 记录旧 CVR 进程 PID (oldPid);
 * 2. 普通权限向 oldPid 发送 SIGTERM 优雅退出信号;
 * 3. 有界时间内轮询确认 oldPid 已完全退出 (Old process termination);
 * 4. 执行应用重拉起指令 (open -a "Clash Verge");
 * 5. 有界时间内轮询确认新 CVR 实例就绪 (newPid 出现);
 * 6. 返回秒级受控连续性证据，严禁承诺零停机 (zero downtime).
 *
 * @param {object} options
 * @param {number} options.oldPid 待重载的旧 CVR 进程 PID
 * @param {string} [options.appName='Clash Verge'] macOS 应用名称
 * @param {number} [options.terminationTimeoutMs=5000] 退出等待超时时间
 * @param {number} [options.readinessTimeoutMs=10000] 启动就绪等待超时时间
 * @param {number} [options.pollIntervalMs=200] 轮询间隔
 * @param {Function} [options.killFn] 进程终止注入函数
 * @param {Function} [options.spawnFn] 进程启动注入函数
 * @param {Function} [options.scanFn] 进程扫描注入函数
 * @param {Function} [options.sleepFn] 延迟等待注入函数
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
export async function executeMacosLifecycleReload(options = {}) {
  const { oldPid } = options;
  if (!oldPid || typeof oldPid !== 'number') {
    throw new Error('Valid oldPid is required for lifecycle reload');
  }

  const appName = options.appName || DEFAULT_MACOS_APP_NAME;
  const termTimeout = options.terminationTimeoutMs || DEFAULT_TERMINATION_TIMEOUT_MS;
  const readyTimeout = options.readinessTimeoutMs || DEFAULT_READINESS_TIMEOUT_MS;
  const pollInterval = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;

  const killProcess = options.killFn || ((pid, signal) => process.kill(pid, signal));
  const spawnApp = options.spawnFn || (async () => {
    await execFileAsync('open', ['-a', appName, '--args', '--hidden']);
  });
  const scanProcesses = options.scanFn || (() => scanMacosProcesses());
  const waitMs = options.sleepFn || sleep;

  const startedAt = Date.now();

  // 1. 发送优雅终止信号 SIGTERM
  try {
    killProcess(oldPid, 'SIGTERM');
  } catch (err) {
    throw new Error(`Failed to send SIGTERM to old CVR process (PID ${oldPid}): ${err.message}`);
  }

  // 2. 有界轮询等待旧进程退出
  const termDeadline = Date.now() + termTimeout;
  let oldProcessExited = false;

  while (Date.now() < termDeadline) {
    await waitMs(pollInterval);
    const currentProcs = await scanProcesses();
    const stillAlive = currentProcs.some((p) => p.pid === oldPid);
    if (!stillAlive) {
      oldProcessExited = true;
      break;
    }
  }

  if (!oldProcessExited) {
    throw new Error(
      `Old CVR process (PID ${oldPid}) did not terminate within bounded timeout of ${termTimeout}ms (Fail-Closed)`
    );
  }

  // 3. 执行应用拉起
  try {
    await spawnApp();
  } catch (err) {
    throw new Error(`Failed to trigger application launch for "${appName}": ${err.message}`);
  }

  // 4. 有界轮询等待新 CVR 实例就绪
  const readyDeadline = Date.now() + readyTimeout;
  let newPid = null;

  while (Date.now() < readyDeadline) {
    await waitMs(pollInterval);
    const currentProcs = await scanProcesses();
    const newCvr = currentProcs.find((p) => {
      const isCvr = p.command.includes('clash-verge') && !p.command.includes('clash-verge-service');
      return isCvr && p.pid !== oldPid;
    });

    if (newCvr) {
      newPid = newCvr.pid;
      break;
    }
  }

  if (!newPid) {
    throw new Error(
      `New CVR process instance did not become ready within bounded timeout of ${readyTimeout}ms (Fail-Closed)`
    );
  }

  const completedAt = Date.now();
  const elapsedMs = completedAt - startedAt;

  return {
    success: true,
    oldPid,
    newPid,
    elapsedMs,
    elapsedSeconds: (elapsedMs / 1000).toFixed(2),
    continuityReport: 'CONTROLLED_SECONDS_LEVEL_TRANSITION',
    zeroDowntimeClaimed: false,
    evidenceLevel: 'Verified',
    detail: `Controlled reload succeeded: transition from PID ${oldPid} to new PID ${newPid} in ${elapsedMs}ms`,
  };
}
