/**
 * 跨平台宿主能力矩阵测试桩 (Cross-Platform Capability Fixtures)
 *
 * 基于 Issue #13, #14, #15 调研事实，构建机器无关的双平台能力矩阵。
 * 核心目标：表达平台事实能力与约束，坚决不以特定进程重启配方作为成功标准。
 *
 * 注意：本文件包含测试模拟路径与脱敏标识，不含任何真实机器的硬编码绝对用户名路径。
 */

/**
 * macOS 典型能力测试桩
 */
export const MACOS_CAPABILITY_FIXTURES = Object.freeze({
  /**
   * macOS Sidecar 稳定版拓扑：普通用户权限运行 GUI 与内置 Mihomo
   */
  SIDECAR_STABLE: {
    platform: 'darwin',
    cvrIdentity: {
      version: 'v2.0.0-stable',
      channel: 'release',
    },
    topologyMode: 'SIDECAR',
    controllerEndpoint: {
      type: 'unix_socket',
      address: '~/.config/clash-verge/mihomo.sock',
      reachable: true,
    },
    observationSurfaces: ['external_controller', 'process_scan', 'app_log'],
    targetIdentityCertainty: 'HIGH',
    privilegeFacts: {
      userRole: 'standard_user',
      serviceModeActive: false,
      elevationPermitted: false,
    },
    nativeApplyCapability: 'SUPPORTED',
    realHostActionAuthorization: 'UNAUTHORIZED',
  },

  /**
   * macOS Service 模式开发版拓扑：受特权 Helper 守护
   */
  SERVICE_DEV: {
    platform: 'darwin',
    cvrIdentity: {
      version: 'v2.0.1-fixed-dev',
      channel: 'development',
    },
    topologyMode: 'SERVICE',
    controllerEndpoint: {
      type: 'unix_socket',
      address: '/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/mihomo.sock',
      reachable: true,
    },
    observationSurfaces: ['external_controller', 'process_scan', 'app_log', 'service_status'],
    targetIdentityCertainty: 'HIGH',
    privilegeFacts: {
      userRole: 'standard_user',
      serviceModeActive: true,
      elevationPermitted: false,
    },
    nativeApplyCapability: 'SUPPORTED',
    realHostActionAuthorization: 'UNAUTHORIZED',
  },

  /**
   * 目标存在歧义的异常 macOS 配置
   */
  AMBIGUOUS_PROFILE: {
    platform: 'darwin',
    cvrIdentity: {
      version: 'v2.0.0-stable',
      channel: 'release',
    },
    topologyMode: 'SIDECAR',
    controllerEndpoint: {
      type: 'unix_socket',
      address: '~/.config/clash-verge/mihomo.sock',
      reachable: true,
    },
    observationSurfaces: ['process_scan'],
    targetIdentityCertainty: 'AMBIGUOUS',
    privilegeFacts: {
      userRole: 'standard_user',
      serviceModeActive: false,
      elevationPermitted: false,
    },
    nativeApplyCapability: 'UNSUPPORTED',
    realHostActionAuthorization: 'UNAUTHORIZED',
  },
});

/**
 * Windows 典型能力测试桩
 */
export const WINDOWS_CAPABILITY_FIXTURES = Object.freeze({
  /**
   * Windows 典型提权 (High Integrity Level / ~ RUNASADMIN) 稳定版
   * 特点：无提权权限直接杀进程，待机状态无文件锁，通过 Named Pipe 观测
   */
  ELEVATED_STABLE: {
    platform: 'win32',
    cvrIdentity: {
      version: 'v2.0.0-stable',
      channel: 'release',
    },
    topologyMode: 'SIDECAR',
    controllerEndpoint: {
      type: 'named_pipe',
      address: '\\\\.\\pipe\\verge-mihomo-controller',
      reachable: true,
    },
    observationSurfaces: ['external_controller', 'process_scan', 'app_log'],
    targetIdentityCertainty: 'HIGH',
    privilegeFacts: {
      integrityLevel: 'High',
      requiresElevationForProcessControl: true,
      elevationPermitted: false, // 遵循“不申请 UAC 提权”铁律
    },
    nativeApplyCapability: 'SUPPORTED',
    realHostActionAuthorization: 'UNAUTHORIZED',
  },

  /**
   * Windows 开发版：通过本地 Loopback HTTP 观测
   */
  LOOPBACK_DEV: {
    platform: 'win32',
    cvrIdentity: {
      version: 'v2.0.1-fixed-dev',
      channel: 'development',
    },
    topologyMode: 'SERVICE',
    controllerEndpoint: {
      type: 'http',
      address: 'http://127.0.0.1:9097',
      token: 'secret-token-fixture',
      reachable: true,
    },
    observationSurfaces: ['external_controller', 'app_log'],
    targetIdentityCertainty: 'HIGH',
    privilegeFacts: {
      integrityLevel: 'High',
      requiresElevationForProcessControl: true,
      elevationPermitted: false,
    },
    nativeApplyCapability: 'SUPPORTED',
    realHostActionAuthorization: 'UNAUTHORIZED',
  },

  /**
   * 目标标识无法绑定的未受支持环境
   */
  UNSUPPORTED_TARGET: {
    platform: 'win32',
    cvrIdentity: {
      version: 'unknown',
      channel: 'unknown',
    },
    topologyMode: 'UNKNOWN',
    controllerEndpoint: {
      type: 'named_pipe',
      address: '',
      reachable: false,
    },
    observationSurfaces: [],
    targetIdentityCertainty: 'UNRESOLVABLE',
    privilegeFacts: {
      integrityLevel: 'Medium',
      requiresElevationForProcessControl: false,
      elevationPermitted: false,
    },
    nativeApplyCapability: 'UNSUPPORTED',
    realHostActionAuthorization: 'UNAUTHORIZED',
  },
});

/**
 * 平台能力评估函数
 * 验证宿主环境在不依赖进程重启的情况下，是否具备执行契约对账所需的最小观测能力
 *
 * @param {object} profile 平台能力测试桩
 * @returns {{ compatible: boolean, supportsObservation: boolean, requiresManualOnly: boolean, reasons: string[] }}
 */
export function evaluatePlatformObservationCapability(profile) {
  const reasons = [];

  // 1. 目标标识清晰度检查 (Fail-Closed 约束)
  if (profile.targetIdentityCertainty !== 'HIGH') {
    reasons.push(`Target identity certainty is ${profile.targetIdentityCertainty}, requires manual operation`);
  }

  // 2. Controller 观测端点有效性
  const hasController = Boolean(
    profile.controllerEndpoint &&
    profile.controllerEndpoint.reachable &&
    profile.controllerEndpoint.address
  );
  if (!hasController) {
    reasons.push(`Controller endpoint is not reachable or unconfigured (${profile.platform})`);
  }

  // 3. 跨平台特权安全检查（必须满足不申请提权且不依赖强杀）
  if (profile.platform === 'win32' && profile.privilegeFacts.elevationPermitted) {
    reasons.push('Violation: Windows platform must not rely on UAC elevation');
  }

  const compatible = reasons.length === 0;

  return {
    compatible,
    supportsObservation: hasController,
    requiresManualOnly: profile.targetIdentityCertainty !== 'HIGH',
    reasons,
  };
}
