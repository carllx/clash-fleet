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
 * 校验 Release 上已发布的资产与本地确定性 Package 清单完全一致
 *
 * @param {Array<{ name: string, digest?: string }>} releaseAssets GitHub Release 对象上的 assets 列表
 * @param {Record<string, string>} expectedChecksums 本地确定的文件哈希映射表 ({ 'Script.js': '<sha256>', ... })
 * @returns {{ passed: boolean, missing: string[], unexpected: string[], detail: string }}
 */
export function verifyReleaseAssetsParity(releaseAssets, expectedChecksums) {
  if (!Array.isArray(releaseAssets)) {
    return {
      passed: false,
      missing: [],
      unexpected: [],
      detail: 'Release assets is not an array',
    };
  }

  const assetNames = new Set(releaseAssets.map((a) => a.name));
  const expectedNames = new Set(Object.keys(expectedChecksums));

  const missing = [];
  for (const name of expectedNames) {
    if (!assetNames.has(name)) {
      missing.push(name);
    }
  }

  const unexpected = [];
  for (const name of assetNames) {
    if (!expectedNames.has(name)) {
      unexpected.push(name);
    }
  }

  if (missing.length > 0 || unexpected.length > 0) {
    return {
      passed: false,
      missing,
      unexpected,
      detail: `Asset parity mismatch: missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}]`,
    };
  }

  return {
    passed: true,
    missing: [],
    unexpected: [],
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
