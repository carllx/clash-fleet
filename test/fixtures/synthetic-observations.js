/**
 * macOS 与 Windows 跨平台合成观测测试夹具 (Synthetic Observation Fixtures)
 *
 * 遵循 Canonical 契约与安全纪律：
 * - docs/spec/platform-contract-reconciliation.md (#17 Phase-A)
 *
 * 铁律与边界：
 * 1. 本夹具为纯内存合成数据，绝不发起真实进程扫描、socket 监听、CVR 读取、文件写入或网络请求；
 * 2. 模拟的 Service/UDS 或 Sidecar/Named Pipe 仅作为受测宿主上的候选形态，明确标明不代表操作系统通用绝对不变式 (Tested-host candidate only, not universal invariant)；
 * 3. 严格遵循 per-fact provenance 纪律 (Verified | Reported | Inferred | Unknown)；
 * 4. 严禁携带明文凭据 (token/secret) 或未脱敏私有用户绝对路径。
 */

import {
  createFactEvidence,
  createPlatformObservationBundle,
} from '../../src/reconcile/contracts.js';

export const SYNTHETIC_BASE_DIGEST =
  '4a5b6c7d8e9f0123456789abcdef0123456789abcdef0123456789abcdef0123';

export const SYNTHETIC_CANDIDATE_DIGEST =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const SYNTHETIC_DRIFT_DIGEST =
  'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';

export const SYNTHETIC_LAST_KNOWN_GOOD_DIGEST =
  '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';

/**
 * 构造 macOS 合成观测数据包
 *
 * @param {object} [overrides]
 * @returns {object} PlatformObservationBundle
 */
export function createSyntheticMacosObservation(overrides = {}) {
  const targetDigestValue =
    overrides.targetDigest !== undefined ? overrides.targetDigest : SYNTHETIC_CANDIDATE_DIGEST;
  const exists = overrides.exists !== undefined ? overrides.exists : true;
  const targetEvidenceLevel = overrides.targetEvidenceLevel || (exists ? 'Verified' : 'Reported');

  const topologyValue = overrides.topologyMode || 'SERVICE';
  const topologyEvidenceLevel = overrides.topologyEvidenceLevel || 'Verified';

  const controllerEndpoint =
    overrides.controllerEndpoint !== undefined
      ? overrides.controllerEndpoint
      : {
          endpointType: 'unix_socket',
          sanitizedAddress: '<mihomo-uds>',
          authRequired: false,
          authMode: 'none',
          evidence: createFactEvidence(
            overrides.controllerEvidenceLevel || 'Reported',
            'synthetic_macos_uds_discovery',
            'Synthetic candidate UDS form observed on tested Service-mode host; not a macOS universal invariant'
          ),
        };

  return createPlatformObservationBundle({
    platform: 'darwin',
    targetDigest: {
      value: targetDigestValue,
      exists,
      evidence: createFactEvidence(
        targetEvidenceLevel,
        'synthetic_macos_file_read',
        'Synthetic target digest read from isolated mock target'
      ),
    },
    topologyMode: {
      value: topologyValue,
      evidence: createFactEvidence(
        topologyEvidenceLevel,
        'synthetic_macos_process_scan',
        'Synthetic Service mode under LaunchDaemon (tested-host candidate only, not macOS universal invariant)'
      ),
    },
    controllerEndpoint,
    sanitizedPaths: {
      dataDir: '~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev',
      targetScript:
        '~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/Script.js',
    },
  });
}

/**
 * 构造 Windows 合成观测数据包
 *
 * @param {object} [overrides]
 * @returns {object} PlatformObservationBundle
 */
export function createSyntheticWindowsObservation(overrides = {}) {
  const targetDigestValue =
    overrides.targetDigest !== undefined ? overrides.targetDigest : SYNTHETIC_CANDIDATE_DIGEST;
  const exists = overrides.exists !== undefined ? overrides.exists : true;
  const targetEvidenceLevel = overrides.targetEvidenceLevel || (exists ? 'Verified' : 'Reported');

  const topologyValue = overrides.topologyMode || 'SIDECAR';
  const topologyEvidenceLevel = overrides.topologyEvidenceLevel || 'Verified';

  const controllerEndpoint =
    overrides.controllerEndpoint !== undefined
      ? overrides.controllerEndpoint
      : {
          endpointType: 'named_pipe',
          sanitizedAddress: '\\\\.\\pipe\\verge-mihomo-synthetic',
          authRequired: false,
          authMode: 'none',
          evidence: createFactEvidence(
            overrides.controllerEvidenceLevel || 'Reported',
            'synthetic_win32_named_pipe_discovery',
            'Synthetic candidate Named Pipe form observed on tested Sidecar host; not a Windows universal invariant'
          ),
        };

  return createPlatformObservationBundle({
    platform: 'win32',
    targetDigest: {
      value: targetDigestValue,
      exists,
      evidence: createFactEvidence(
        targetEvidenceLevel,
        'synthetic_win32_file_read',
        'Synthetic target digest read from isolated mock target'
      ),
    },
    topologyMode: {
      value: topologyValue,
      evidence: createFactEvidence(
        topologyEvidenceLevel,
        'synthetic_win32_process_scan',
        'Synthetic Sidecar mode with elevated GUI (tested-host candidate only, not Windows universal invariant)'
      ),
    },
    controllerEndpoint,
    sanitizedPaths: {
      dataDir: '%APPDATA%\\io.github.clash-verge-rev.clash-verge-rev',
      targetScript:
        '%APPDATA%\\io.github.clash-verge-rev.clash-verge-rev\\profiles\\Script.js',
    },
  });
}
