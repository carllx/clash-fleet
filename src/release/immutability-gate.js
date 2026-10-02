/**
 * GitHub Immutable Releases 规范与不可变性门禁验证模块 (Release Immutability Gate)
 *
 * 遵循严格 Fail-Closed 原则：
 * 1. 绝不将 SemVer、标签或校验和本身视为不可变证明。
 * 2. 仓库设置必须经只读核实为 enabled === true；若为 disabled、返回空或异常，立即 fail-closed。
 * 3. 发布的 Release 实体必须且仅在 immutable === true 时方被认定通过门禁。
 * 4. 资产与哈希清单比对必须完全一致（零增删改）。
 */

/**
 * 校验仓库的不可变 Release 配置状态 (Fail-Closed)
 *
 * @param {object|null|undefined} settingResponse 从 GET /repos/{owner}/{repo}/immutable-releases 获取的响应对象
 * @returns {{ passed: boolean, enabled: boolean, detail: string }} 校验结果
 */
export function verifyRepoImmutableSetting(settingResponse) {
  if (!settingResponse || typeof settingResponse !== 'object') {
    return {
      passed: false,
      enabled: false,
      detail: 'Repository immutable-releases setting response is missing or malformed',
    };
  }

  if (settingResponse.enabled === true) {
    return {
      passed: true,
      enabled: true,
      detail: 'Repository immutable-releases setting is enabled',
    };
  }

  if (settingResponse.enabled === false) {
    return {
      passed: false,
      enabled: false,
      detail: 'Repository immutable-releases setting is disabled (fail-closed)',
    };
  }

  return {
    passed: false,
    enabled: false,
    detail: `Repository immutable-releases setting has unexpected value: ${JSON.stringify(settingResponse.enabled)}`,
  };
}

/**
 * 校验发布对象的不可变性契约 (Release Object Immutability Gate)
 *
 * 依据 GitHub Immutable Releases 规范：
 * - 只有发布后且具备 immutable === true 的 Release 对象才是不可变的。
 * - draft release 或常规未加固 release 的 immutable 字段为 false 或不存在，必须 fail-closed。
 *
 * @param {object|null|undefined} release 目标 Release 对象
 * @returns {{ passed: boolean, immutable: boolean, reason: string }} 校验结果
 */
export function verifyPublishedReleaseImmutability(release) {
  if (!release || typeof release !== 'object') {
    return {
      passed: false,
      immutable: false,
      reason: 'Release object is null or not an object',
    };
  }

  if (release.draft === true) {
    return {
      passed: false,
      immutable: false,
      reason: 'Release is still in draft state; immutable guarantees only apply after publication',
    };
  }

  if (release.immutable === true) {
    return {
      passed: true,
      immutable: true,
      reason: 'Release object is verified immutable (immutable: true)',
    };
  }

  return {
    passed: false,
    immutable: false,
    reason: `Release is not immutable: expected immutable === true, found ${JSON.stringify(release.immutable)}`,
  };
}

/**
 * 严格解析并校验 GitHub Release Asset 摘要 (Authoritative digest parser)
 *
 * GitHub REST API 规范 (apiVersion=2026-03-10):
 * - digest 形状为 "sha256:<64-hex>"
 * - 仅接受 sha256 算法；不支持算法（如 sha512:）必须抛出/返回错误
 * - 格式不合法或非 64 位十六进制必须 fail-closed
 *
 * @param {string|null|undefined} rawDigest 原始 digest 字符串 (如 asset.digest 或 asset.sha256)
 * @returns {{ valid: boolean, hash: string|null, error?: string }}
 */
export function parseAndValidateSha256Digest(rawDigest) {
  if (typeof rawDigest !== 'string' || !rawDigest.trim()) {
    return { valid: false, hash: null, error: 'Digest is missing or empty' };
  }

  const trimmed = rawDigest.trim();
  const colonIndex = trimmed.indexOf(':');

  if (colonIndex === -1) {
    // 缺失 algorithm prefix
    return { valid: false, hash: null, error: `Malformed digest (missing algorithm prefix): "${trimmed}"` };
  }

  const algorithm = trimmed.slice(0, colonIndex).toLowerCase();
  const hex = trimmed.slice(colonIndex + 1);

  if (algorithm !== 'sha256') {
    return { valid: false, hash: null, error: `Unsupported digest algorithm: "${algorithm}". Expected "sha256"` };
  }

  if (!/^[a-fA-F0-9]{64}$/.test(hex)) {
    return { valid: false, hash: null, error: `Malformed SHA-256 digest: expected 64 hex characters, got "${hex}"` };
  }

  return { valid: true, hash: hex.toLowerCase() };
}

/**
 * 校验 Release 上已发布的资产与本地确定性 Package 清单完全一致
 *
 * 保证：
 * 1. 资产文件集合与预期清单完全一一对应（零缺失、零冗余）；
 * 2. 若本地要求特定哈希 (expectedHash)，远程 asset 必须提供合法的 sha256: 摘要且严格匹配；
 * 3. 缺失摘要、格式不合法、非 SHA-256 算法或哈希不一致均严格 Fail-Closed。
 *
 * @param {Array<{ name: string, digest?: string, sha256?: string }>} releaseAssets GitHub Release 对象上的 assets 列表
 * @param {Record<string, string>|string[]} expectedAssets 本地确定的文件哈希映射表 ({ 'Script.js': '<sha256>', ... }) 或文件名称列表
 * @returns {{ passed: boolean, missing: string[], unexpected: string[], corrupted: string[], detail: string }}
 */
export function verifyReleaseAssetsParity(releaseAssets, expectedAssets) {
  if (!Array.isArray(releaseAssets)) {
    return {
      passed: false,
      missing: [],
      unexpected: [],
      corrupted: [],
      detail: 'Release assets is not an array',
    };
  }

  const checksumMap = Array.isArray(expectedAssets)
    ? Object.fromEntries(expectedAssets.map((name) => [name, null]))
    : (expectedAssets || {});

  const expectedNames = new Set(Object.keys(checksumMap));
  const assetMap = new Map();
  for (const asset of releaseAssets) {
    if (asset && asset.name) {
      assetMap.set(asset.name, asset);
    }
  }

  const missing = [];
  for (const name of expectedNames) {
    if (!assetMap.has(name)) {
      missing.push(name);
    }
  }

  const unexpected = [];
  for (const name of assetMap.keys()) {
    if (!expectedNames.has(name)) {
      unexpected.push(name);
    }
  }

  const corrupted = [];
  for (const [name, expectedHash] of Object.entries(checksumMap)) {
    if (expectedHash && assetMap.has(name)) {
      const asset = assetMap.get(name);
      const rawDigest = asset.digest || asset.sha256;

      if (!rawDigest) {
        corrupted.push(`${name} (missing digest on release asset, expected sha256:${expectedHash.toLowerCase()})`);
        continue;
      }

      const parsed = parseAndValidateSha256Digest(rawDigest);
      if (!parsed.valid) {
        corrupted.push(`${name} (${parsed.error})`);
        continue;
      }

      const normalizedExpected = expectedHash.toLowerCase();
      if (parsed.hash !== normalizedExpected) {
        corrupted.push(`${name} (expected sha256:${normalizedExpected}, got sha256:${parsed.hash})`);
      }
    }
  }

  if (missing.length > 0 || unexpected.length > 0 || corrupted.length > 0) {
    const errorParts = [];
    if (missing.length > 0) errorParts.push(`missing=[${missing.join(', ')}]`);
    if (unexpected.length > 0) errorParts.push(`unexpected=[${unexpected.join(', ')}]`);
    if (corrupted.length > 0) errorParts.push(`corrupted=[${corrupted.join(', ')}]`);
    return {
      passed: false,
      missing,
      unexpected,
      corrupted,
      detail: `Asset parity mismatch: ${errorParts.join('; ')}`,
    };
  }

  return {
    passed: true,
    missing: [],
    unexpected: [],
    corrupted: [],
    detail: 'Release assets match expected manifest exactly',
  };
}

/**
 * 完整的 Release Immutability 复合门禁 (Composite Immutability Gate)
 *
 * @param {object} params
 * @param {object} params.repoSetting 仓库设置响应
 * @param {object} params.releaseObject GitHub Release 响应
 * @param {Record<string, string>} params.expectedChecksums 预期确定的发布清单哈希
 * @throws {Error} 若门禁未能通过 (Fail-Closed)
 */
export function assertReleaseImmutabilityGate({ repoSetting, releaseObject, expectedChecksums }) {
  // 1. 仓库级设置验证
  const repoCheck = verifyRepoImmutableSetting(repoSetting);
  if (!repoCheck.passed) {
    throw new Error(`[immutability-gate] Repository check failed: ${repoCheck.detail}`);
  }

  // 2. 目标 Release 实体不可变性验证
  const releaseCheck = verifyPublishedReleaseImmutability(releaseObject);
  if (!releaseCheck.passed) {
    throw new Error(`[immutability-gate] Release check failed: ${releaseCheck.reason}`);
  }

  // 3. 资产完整性比对
  const assetsCheck = verifyReleaseAssetsParity(releaseObject.assets || [], expectedChecksums);
  if (!assetsCheck.passed) {
    throw new Error(`[immutability-gate] Assets parity check failed: ${assetsCheck.detail}`);
  }

  return {
    passed: true,
    repoSetting: repoCheck,
    release: releaseCheck,
    assets: assetsCheck,
  };
}
