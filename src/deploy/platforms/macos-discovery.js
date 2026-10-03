import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

/**
 * 默认 macOS Clash Verge Rev 数据目录
 */
export const DEFAULT_MACOS_DATA_DIR_NAME = 'io.github.clash-verge-rev.clash-verge-rev';

/**
 * 脱敏路径，替换用户主目录为 "~" 避免本地路径信息泄露
 *
 * @param {string} rawPath 待脱敏路径
 * @param {string} [homeDir=os.homedir()] 主目录路径
 * @returns {string} 脱敏后的路径
 */
export function sanitizePath(rawPath, homeDir = os.homedir()) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  const normalizedRaw = rawPath.replace(/\\/g, '/');
  const normalizedHome = homeDir ? homeDir.replace(/\\/g, '/') : '';
  if (normalizedHome && normalizedRaw.startsWith(normalizedHome)) {
    return normalizedRaw.replace(normalizedHome, '~');
  }
  return normalizedRaw;
}

/**
 * 解析并确定 macOS 宿主上的 CVR 数据目录与目标 Script.js 路径
 *
 * @param {object} [options]
 * @param {string} [options.customDataDir] 自定义数据目录
 * @param {string} [options.homeDir=os.homedir()] 模拟/实际用户主目录
 * @param {typeof fs} [options.fsModule=fs] 文件系统模块接口 (用于测试注入)
 * @returns {{ dataDir: string, sanitizedDataDir: string, targetScript: string, exists: boolean }}
 */
export function resolveMacosPaths(options = {}) {
  const home = options.homeDir || os.homedir();
  const fsMod = options.fsModule || fs;

  const dataDir = options.customDataDir
    || process.env.FLEET_MACOS_DATA_DIR
    || path.join(home, 'Library', 'Application Support', DEFAULT_MACOS_DATA_DIR_NAME);

  const targetScript = path.join(dataDir, 'profiles', 'Script.js');
  const exists = fsMod.existsSync(targetScript);

  return {
    dataDir,
    sanitizedDataDir: sanitizePath(dataDir, home),
    targetScript,
    exists,
  };
}

/**
 * 解析一行 ps 输出
 * 格式期望: PID PPID USER COMMAND...
 *
 * @param {string} line ps 单行文本
 * @returns {{ pid: number, ppid: number, user: string, command: string } | null}
 */
export function parseProcessLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // 匹配前三项: pid, ppid, user，其余作为 command
  const match = trimmed.match(/^(\d+)\s+(\d+)\s+([^\s]+)\s+(.+)$/);
  if (!match) return null;

  return {
    pid: parseInt(match[1], 10),
    ppid: parseInt(match[2], 10),
    user: match[3],
    command: match[4],
  };
}

/**
 * 扫描当前 macOS 宿主正在运行的相关进程
 *
 * @param {Function} [execFn] 自定义执行函数 (用于测试注入，默认执行 ps)
 * @returns {Promise<Array<{ pid: number, ppid: number, user: string, command: string }>>}
 */
export async function scanMacosProcesses(execFn) {
  const execute = execFn || (async () => {
    const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid,ppid,user,command']);
    return stdout;
  });

  const rawOutput = await execute();
  const lines = rawOutput.split('\n');
  const processes = [];

  for (const line of lines) {
    const proc = parseProcessLine(line);
    if (!proc) continue;

    // 过滤出与 clash/verge/mihomo 相关的进程，排除 grep 自身
    const lowerCmd = proc.command.toLowerCase();
    if (
      (lowerCmd.includes('clash-verge') || lowerCmd.includes('verge-mihomo') || lowerCmd.includes('clash-core-service'))
      && !lowerCmd.includes('grep')
      && !lowerCmd.includes('ps -ax')
    ) {
      processes.push(proc);
    }
  }

  return processes;
}

/**
 * 动态判定 macOS 宿主上的 CVR / Mihomo 拓扑状态
 *
 * @param {Array<{ pid: number, ppid: number, user: string, command: string }>} processes 进程列表
 * @returns {{
 *   status: 'SERVICE' | 'SIDECAR' | 'NO_TOPOLOGY' | 'AMBIGUOUS',
 *   passed: boolean,
 *   evidenceLevel: 'Verified' | 'Reported' | 'Inferred' | 'None',
 *   cvrProcess: { pid: number, user: string, command: string } | null,
 *   mihomoProcess: { pid: number, ppid: number, user: string, command: string } | null,
 *   serviceProcess: { pid: number, user: string, command: string } | null,
 *   detail: string
 * }}
 */
export function detectMacosTopology(processes) {
  if (!Array.isArray(processes) || processes.length === 0) {
    return {
      status: 'NO_TOPOLOGY',
      passed: false,
      evidenceLevel: 'None',
      cvrProcess: null,
      mihomoProcess: null,
      serviceProcess: null,
      detail: 'No running Clash Verge Rev or Mihomo processes detected on macOS host',
    };
  }

  const CVR_EXE_REGEX = /(?:^|\/|\s)clash-verge(?:\s|$)/;
  const SERVICE_EXE_REGEX = /(?:^|\/|\s)clash-verge-service(?:\s|$)/;
  const MIHOMO_EXE_REGEX = /(?:^|\/|\s)(?:verge-mihomo|mihomo|clash-meta)(?:\s|$)/;

  // 1. 识别 CVR GUI 主应用进程 (排除 service bundle)
  const cvrProcesses = processes.filter((p) => {
    return CVR_EXE_REGEX.test(p.command) && !SERVICE_EXE_REGEX.test(p.command);
  });

  // 2. 识别 Privileged Helper Service 进程
  const serviceProcesses = processes.filter((p) => {
    return SERVICE_EXE_REGEX.test(p.command);
  });

  // 3. 识别 Mihomo 内核进程
  const mihomoProcesses = processes.filter((p) => {
    return MIHOMO_EXE_REGEX.test(p.command);
  });

  // 边界校验：无 CVR 进程
  if (cvrProcesses.length === 0) {
    return {
      status: 'NO_TOPOLOGY',
      passed: false,
      evidenceLevel: 'None',
      cvrProcess: null,
      mihomoProcess: mihomoProcesses[0] || null,
      serviceProcess: serviceProcesses[0] || null,
      detail: 'Clash Verge Rev GUI main application is not running',
    };
  }

  // 边界校验：存在多个歧义 CVR 实例
  if (cvrProcesses.length > 1) {
    return {
      status: 'AMBIGUOUS',
      passed: false,
      evidenceLevel: 'Inferred',
      cvrProcess: cvrProcesses[0],
      mihomoProcess: mihomoProcesses[0] || null,
      serviceProcess: serviceProcesses[0] || null,
      detail: `Multiple Clash Verge Rev GUI processes found (PIDs: ${cvrProcesses.map((p) => p.pid).join(', ')})`,
    };
  }

  const cvrProc = cvrProcesses[0];
  const serviceProc = serviceProcesses[0] || null;
  const mihomoProc = mihomoProcesses[0] || null;

  // 边界校验：CVR 存在但未找到任何运行中的内核进程
  if (!mihomoProc) {
    return {
      status: 'NO_TOPOLOGY',
      passed: false,
      evidenceLevel: 'Reported',
      cvrProcess: cvrProc,
      mihomoProcess: null,
      serviceProcess: serviceProc,
      detail: 'Clash Verge Rev is running, but no Mihomo core process was found',
    };
  }

  // 4. 判断 Service 托管模式
  // 特征 A: 存在 clash-verge-service 进程
  // 特征 B: verge-mihomo 进程的命令行包含 clash-verge-service 运行时路径或 unix-socket
  // 特征 C: verge-mihomo 进程为 root 权限且 ppid 指向 service 或由 launchd 托管
  const isServiceHosted = (
    serviceProc !== null
    && (
      mihomoProc.command.includes('clash-verge-service')
      || (serviceProc && mihomoProc.ppid === serviceProc.pid)
      || (mihomoProc.user === 'root' && serviceProc.user === 'root')
    )
  );

  // 5. 判断 Sidecar 模式
  // 特征 A: 不存在 clash-verge-service
  // 特征 B: verge-mihomo 进程的 ppid 指向 CVR GUI 主进程，或由同一普通用户直接运行
  const isSidecar = (
    serviceProc === null
    && (mihomoProc.ppid === cvrProc.pid || mihomoProc.user === cvrProc.user)
    && !mihomoProc.command.includes('clash-verge-service')
  );

  if (isServiceHosted && !isSidecar) {
    return {
      status: 'SERVICE',
      passed: true,
      evidenceLevel: 'Verified',
      cvrProcess: { pid: cvrProc.pid, user: cvrProc.user, command: cvrProc.command },
      mihomoProcess: { pid: mihomoProc.pid, ppid: mihomoProc.ppid, user: mihomoProc.user, command: mihomoProc.command },
      serviceProcess: serviceProc ? { pid: serviceProc.pid, user: serviceProc.user, command: serviceProc.command } : null,
      detail: 'Verified Service mode: Core is managed under Privileged Helper Tool (clash-verge-service)',
    };
  }

  if (isSidecar && !isServiceHosted) {
    return {
      status: 'SIDECAR',
      passed: true,
      evidenceLevel: 'Verified',
      cvrProcess: { pid: cvrProc.pid, user: cvrProc.user, command: cvrProc.command },
      mihomoProcess: { pid: mihomoProc.pid, ppid: mihomoProc.ppid, user: mihomoProc.user, command: mihomoProc.command },
      serviceProcess: null,
      detail: 'Verified Sidecar mode: Core is managed directly as a child/user process by Clash Verge Rev',
    };
  }

  // 若特征混杂或矛盾，严格 Fail-Closed
  return {
    status: 'AMBIGUOUS',
    passed: false,
    evidenceLevel: 'Inferred',
    cvrProcess: cvrProc,
    mihomoProcess: mihomoProc,
    serviceProcess: serviceProc,
    detail: 'Ambiguous process topology: Conflicting Service and Sidecar characteristics detected',
  };
}
