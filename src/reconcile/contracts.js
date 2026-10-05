/**
 * 最小跨平台对账与状态契约 (Minimal Cross-Platform Reconciliation Contracts)
 *
 * 遵循 Canonical 契约规范：
 * - docs/spec/minimal-safe-apply-recovery-contract.md (#16)
 * - docs/spec/platform-contract-reconciliation.md (#17 Phase-A)
 *
 * 核心安全与证据纪律 (Fail-Closed)：
 * 1. 证据级别严格为 Verified | Reported | Inferred | Unknown (禁止使用 None)；
 * 2. 证据必须逐事实 (per-fact) 标注，禁止 bundle-wide certainty；
 * 3. 严格白名单 Schema 校验：拒绝任何未知或敏感凭据字段 (accessToken, apiKey, credentialRef 等)；
 * 4. 允许 authMode: 'token' 描述符，禁止任何真实 token 材料；
 * 5. 路径脱敏校验：严格拒绝未脱敏的系统私有绝对用户根路径；
 * 6. Digest 格式严格校验：必须为 64 位 SHA-256 十六进制；
 * 7. LogicalTarget 必须显式提供，严禁静默 fallback 到生产标识。
 */

export const EVIDENCE_LEVELS = Object.freeze([
  'Verified',
  'Reported',
  'Inferred',
  'Unknown',
]);

export const ATTEMPT_RESULTS = Object.freeze([
  'not_started',
  'awaiting_user',
  'submitted',
  'busy',
  'skipped',
  'failed',
  'no_response',
  'cancelled',
]);

export const ACTIVATION_OUTCOMES = Object.freeze([
  'Applied',
  'SavedOnly',
  'Conflict',
  'Unchanged',
  'Unknown',
]);

export const NEXT_ACTIONS = Object.freeze([
  'none',
  'reconcile',
  'manual_required',
  'guided_recovery',
]);

export const TOPOLOGY_MODES = Object.freeze([
  'SERVICE',
  'SIDECAR',
  'UNKNOWN',
]);

export const ASSERTION_TYPES = Object.freeze([
  'rule_present',
  'group_exists',
]);

const SHA256_HEX_REGEX = /^[a-fA-F0-9]{64}$/;

// 正则模式：检测未脱敏的私有用户绝对根路径
const UNSANITIZED_USER_PATH_REGEX = /(?:^|[/\\])(?:Users|home)[/\\][^/\\]+/i;
const UNSANITIZED_WIN_DRIVE_USER_REGEX = /^[a-zA-Z]:[/\\]Users[/\\][^/\\]+/i;

/**
 * 判断给定字符串是否为合规的 64 位 SHA-256 十六进制
 *
 * @param {string} str
 * @returns {boolean}
 */
export function isSha256Hex(str) {
  return typeof str === 'string' && SHA256_HEX_REGEX.test(str.trim());
}

/**
 * 校验哈希格式并 Fail-Closed 抛错
 *
 * @param {string} digest
 * @param {string} [fieldName='digest']
 */
export function assertSha256Hex(digest, fieldName = 'digest') {
  if (!isSha256Hex(digest)) {
    throw new Error(
      `Malformed SHA-256 hex in ${fieldName}: "${digest}". Must be exactly 64 hexadecimal characters.`
    );
  }
}

/**
 * 严格白名单字段校验 (Fail-Closed on unexpected keys)
 *
 * @param {object} obj
 * @param {string[]} allowedKeys
 * @param {string} structName
 */
function assertStrictKeys(obj, allowedKeys, structName) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`${structName} must be a plain object`);
  }
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(
        `Security violation: Unexpected or forbidden field "${key}" in ${structName}`
      );
    }
  }
}

/**
 * 校验路径是否完全合规脱敏 (Fail-Closed)
 *
 * @param {string} pathStr
 * @param {string} pathKey
 */
export function assertSanitizedPath(pathStr, pathKey = 'path') {
  if (typeof pathStr !== 'string') {
    throw new Error(`Sanitized path for "${pathKey}" must be a string`);
  }
  if (UNSANITIZED_USER_PATH_REGEX.test(pathStr) || UNSANITIZED_WIN_DRIVE_USER_REGEX.test(pathStr)) {
    throw new Error(
      `Security violation: Unsanitized user root path detected in "${pathKey}": "${pathStr}". Must use sanitized form (~/... or %APPDATA%\\...).`
    );
  }
}

/**
 * 构造合规的逐事实证据溯源对象 (Fact Evidence)
 *
 * @param {string} level 证据级别 (Verified | Reported | Inferred | Unknown)
 * @param {string} source 证据收集来源或探测方式
 * @param {string} [detail] 补充描述细节
 * @returns {{ level: string, source: string, detail?: string }}
 */
export function createFactEvidence(level, source, detail) {
  if (!EVIDENCE_LEVELS.includes(level)) {
    throw new Error(
      `Invalid evidence level: "${level}". Must be one of: ${EVIDENCE_LEVELS.join(', ')}`
    );
  }
  if (!source || typeof source !== 'string' || !source.trim()) {
    throw new Error('Fact evidence source must be a non-empty string');
  }

  const result = {
    level,
    source: source.trim(),
  };

  if (detail !== undefined && detail !== null) {
    result.detail = String(detail);
  }

  return Object.freeze(result);
}

/**
 * 校验事实证据结构合规性
 *
 * @param {object} evidence
 * @param {string} factName
 */
export function assertFactEvidence(evidence, factName = 'fact') {
  assertStrictKeys(evidence, ['level', 'source', 'detail'], `evidence for ${factName}`);
  if (!EVIDENCE_LEVELS.includes(evidence.level)) {
    throw new Error(`Evidence level for ${factName} is invalid: "${evidence.level}"`);
  }
  if (!evidence.source || typeof evidence.source !== 'string' || !evidence.source.trim()) {
    throw new Error(`Evidence source for ${factName} is required`);
  }
}

/**
 * 严格结构化校验平台观测数据包 (Fail-Closed)
 *
 * @param {object} bundle 待校验的观测数据包
 * @returns {object} 校验通过的观测数据包
 */
export function validateObservationBundle(bundle) {
  assertStrictKeys(
    bundle,
    ['platform', 'targetDigest', 'topologyMode', 'controllerEndpoint', 'sanitizedPaths'],
    'ObservationBundle'
  );

  if (bundle.platform !== 'darwin' && bundle.platform !== 'win32') {
    throw new Error(`Unsupported platform in observation bundle: "${bundle.platform}"`);
  }

  // 1. targetDigest 校验
  assertStrictKeys(bundle.targetDigest, ['value', 'exists', 'evidence'], 'targetDigest');
  assertFactEvidence(bundle.targetDigest.evidence, 'targetDigest');
  if (typeof bundle.targetDigest.exists !== 'boolean') {
    throw new Error('targetDigest exists must be a boolean');
  }
  if (bundle.targetDigest.exists === false && bundle.targetDigest.value !== null) {
    throw new Error('Contradictory observation: targetDigest exists is false but value is not null');
  }
  if (bundle.targetDigest.value !== null && bundle.targetDigest.exists !== true) {
    throw new Error('Contradictory observation: targetDigest value is present but exists is not true');
  }
  if (bundle.targetDigest.value !== null) {
    assertSha256Hex(bundle.targetDigest.value, 'targetDigest.value');
  }

  // 2. topologyMode 校验
  assertStrictKeys(bundle.topologyMode, ['value', 'evidence'], 'topologyMode');
  assertFactEvidence(bundle.topologyMode.evidence, 'topologyMode');
  if (!TOPOLOGY_MODES.includes(bundle.topologyMode.value)) {
    throw new Error(`Invalid topologyMode value: "${bundle.topologyMode.value}"`);
  }

  // 3. controllerEndpoint 校验 (可为 null)
  if (bundle.controllerEndpoint !== null && bundle.controllerEndpoint !== undefined) {
    const ep = bundle.controllerEndpoint;
    assertStrictKeys(
      ep,
      ['endpointType', 'sanitizedAddress', 'authRequired', 'authMode', 'evidence'],
      'controllerEndpoint'
    );
    const validTypes = ['unix_socket', 'named_pipe', 'http'];
    if (!validTypes.includes(ep.endpointType)) {
      throw new Error(`Invalid controllerEndpoint type: "${ep.endpointType}"`);
    }
    if (!ep.sanitizedAddress || typeof ep.sanitizedAddress !== 'string' || !ep.sanitizedAddress.trim()) {
      throw new Error('controllerEndpoint sanitizedAddress must be a non-empty string');
    }
    assertSanitizedPath(ep.sanitizedAddress, 'controllerEndpoint.sanitizedAddress');
    if (typeof ep.authRequired !== 'boolean') {
      throw new Error('controllerEndpoint authRequired must be a boolean');
    }
    const validAuthModes = ['none', 'token', 'opaque_local'];
    if (!validAuthModes.includes(ep.authMode)) {
      throw new Error(`Invalid controllerEndpoint authMode: "${ep.authMode}"`);
    }
    assertFactEvidence(ep.evidence, 'controllerEndpoint');
  }

  // 4. sanitizedPaths 字典及脱敏深度校验
  if (!bundle.sanitizedPaths || typeof bundle.sanitizedPaths !== 'object' || Array.isArray(bundle.sanitizedPaths)) {
    throw new Error('Observation bundle missing sanitizedPaths dictionary');
  }
  for (const [pathKey, pathVal] of Object.entries(bundle.sanitizedPaths)) {
    assertSanitizedPath(pathVal, pathKey);
  }

  return bundle;
}

/**
 * 创建合规的平台观测数据包
 *
 * @param {object} params
 * @returns {object}
 */
export function createPlatformObservationBundle(params) {
  const bundle = {
    platform: params.platform,
    targetDigest: {
      value: params.targetDigest?.value !== undefined ? params.targetDigest.value : null,
      exists: Boolean(params.targetDigest?.exists),
      evidence: params.targetDigest?.evidence || createFactEvidence('Unknown', 'unspecified'),
    },
    topologyMode: {
      value: params.topologyMode?.value || 'UNKNOWN',
      evidence: params.topologyMode?.evidence || createFactEvidence('Unknown', 'unspecified'),
    },
    controllerEndpoint: params.controllerEndpoint
      ? {
          endpointType: params.controllerEndpoint.endpointType,
          sanitizedAddress: params.controllerEndpoint.sanitizedAddress,
          authRequired: Boolean(params.controllerEndpoint.authRequired),
          authMode: params.controllerEndpoint.authMode || 'none',
          evidence: params.controllerEndpoint.evidence || createFactEvidence('Unknown', 'unspecified'),
        }
      : null,
    sanitizedPaths: Object.freeze({ ...(params.sanitizedPaths || {}) }),
  };

  return Object.freeze(validateObservationBundle(bundle));
}

/**
 * 校验并构造 ChangeOperation 实体 (Fail-Closed on missing logical target)
 *
 * @param {object} params
 * @returns {object}
 */
export function createChangeOperation(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('ChangeOperation parameters must be an object');
  }
  if (!params.operationId || typeof params.operationId !== 'string' || !params.operationId.trim()) {
    throw new Error('ChangeOperation operationId is required and must be non-empty string');
  }

  assertSha256Hex(params.candidateDigest, 'candidateDigest');
  assertSha256Hex(params.baseDigest, 'baseDigest');

  if (params.lastKnownGoodDigest) {
    assertSha256Hex(params.lastKnownGoodDigest, 'lastKnownGoodDigest');
  }

  // 核心约束：LogicalTarget 必须由调用方显式无歧义绑定，绝不隐式默认回生产标识
  if (!params.logicalTarget || typeof params.logicalTarget !== 'object') {
    throw new Error('ChangeOperation requires explicit logicalTarget object (Fail-Closed)');
  }
  const { appScope, profileId, artifactKind } = params.logicalTarget;
  if (!appScope || typeof appScope !== 'string' || !appScope.trim()) {
    throw new Error('logicalTarget.appScope is required and must be non-empty string');
  }
  if (!profileId || typeof profileId !== 'string' || !profileId.trim()) {
    throw new Error('logicalTarget.profileId is required and must be non-empty string');
  }
  if (!artifactKind || typeof artifactKind !== 'string' || !artifactKind.trim()) {
    throw new Error('logicalTarget.artifactKind is required and must be non-empty string');
  }

  const attemptResult = params.attemptResult || 'not_started';
  if (!ATTEMPT_RESULTS.includes(attemptResult)) {
    throw new Error(`Invalid attemptResult: "${attemptResult}"`);
  }

  const op = {
    operationId: params.operationId.trim(),
    changeIntent: {
      name: params.changeIntent?.name || 'anonymous_intent',
      description: params.changeIntent?.description || '',
      immediateActivationRequired: params.changeIntent?.immediateActivationRequired !== false,
    },
    logicalTarget: {
      appScope: appScope.trim(),
      profileId: profileId.trim(),
      artifactKind: artifactKind.trim(),
      expectedBaseDigest: params.baseDigest.toLowerCase(),
    },
    candidateDigest: params.candidateDigest.toLowerCase(),
    baseDigest: params.baseDigest.toLowerCase(),
    attemptResult,
    lastKnownGoodDigest: params.lastKnownGoodDigest ? params.lastKnownGoodDigest.toLowerCase() : null,
    closureMetadata: params.closureMetadata ? { ...params.closureMetadata } : null,
  };

  return Object.freeze(op);
}

/**
 * 校验声明式语义断言合规性
 *
 * @param {object} assertion
 * @returns {object}
 */
export function validateSemanticAssertion(assertion) {
  if (!assertion || typeof assertion !== 'object') {
    throw new Error('Semantic assertion must be an object');
  }
  if (!ASSERTION_TYPES.includes(assertion.assertion)) {
    throw new Error(
      `Invalid assertion type: "${assertion.assertion}". Must be one of: ${ASSERTION_TYPES.join(', ')}`
    );
  }

  if (assertion.assertion === 'rule_present') {
    if (!assertion.identity || typeof assertion.identity !== 'string' || !assertion.identity.trim()) {
      throw new Error('rule_present assertion requires string identity');
    }
    if (!assertion.expectedTarget || typeof assertion.expectedTarget !== 'string' || !assertion.expectedTarget.trim()) {
      throw new Error('rule_present assertion requires string expectedTarget');
    }
  } else if (assertion.assertion === 'group_exists') {
    if (!assertion.groupIdentity || typeof assertion.groupIdentity !== 'string' || !assertion.groupIdentity.trim()) {
      throw new Error('group_exists assertion requires string groupIdentity');
    }
  }

  return assertion;
}
