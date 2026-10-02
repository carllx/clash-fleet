import YAML from 'yaml';
import fs from 'node:fs';

/**
 * Rule Provider 声明式模型与版本溯源清单生成器 (Build-time only)
 *
 * 负责解析、验证规则集来源定义并生成确定性的 Rule Asset Provenance Manifest。
 */

export const STATUS_NO_EXTERNAL = 'NO_EXTERNAL_RULE_ASSETS';
export const STATUS_FULLY_PINNED = 'FULLY_PINNED_RULE_ASSETS';
export const STATUS_CONTAINS_DYNAMIC = 'CONTAINS_DYNAMIC_EXTERNAL_DEPENDENCY';

export const CLASSIFICATION_PINNED = 'Pinned Rule Asset';
export const CLASSIFICATION_DYNAMIC = 'Dynamic External Dependency';

export const ROLLBACK_SEMANTICS_PINNED =
  'exact external revision preserved; reproducible rule-asset rollback';
export const ROLLBACK_SEMANTICS_DYNAMIC = 'partial / non-fully-reproducible';

export const STRATEGY_PINNED = 'pinned';
export const STRATEGY_DYNAMIC = 'dynamic';

export const VALID_BEHAVIORS = Object.freeze(['domain', 'ipcidr', 'classical']);

const MUTABLE_IDENTIFIERS = Object.freeze([
  'main',
  'master',
  'head',
  'latest',
  'trunk',
  'dev',
  'develop',
]);

const GIT_SHA_REGEX = /^[0-9a-fA-F]{40}$/;
const MUTABLE_BRANCH_PATH_REGEX = /(^|\/)(main|master|head)(\/|$)/i;
const FLOATING_RELEASE_PATH_REGEX = /(latest\/download|releases\/latest)/i;

/**
 * 校验并标准化 Pinned Provider 的不可变版本修订标识及其与运行时 URL 的一致性
 */
function validatePinnedRevision(rawRevision, id, url, sourceId) {
  if (!rawRevision) {
    throw new Error(
      `Pinned provider '${id}' must declare immutable 'revision' (e.g. commit SHA or fixed release tag) in ${sourceId}`
    );
  }

  let kind;
  let value;

  if (typeof rawRevision === 'string') {
    const trimmed = rawRevision.trim();
    if (!trimmed) {
      throw new Error(
        `Pinned provider '${id}' must declare immutable 'revision' (e.g. commit SHA or fixed release tag) in ${sourceId}`
      );
    }
    const lower = trimmed.toLowerCase();
    if (MUTABLE_IDENTIFIERS.includes(lower)) {
      throw new Error(
        `Pinned provider '${id}' revision cannot be a mutable branch or floating identifier '${trimmed}' in ${sourceId}`
      );
    }
    if (GIT_SHA_REGEX.test(trimmed)) {
      kind = 'git-commit';
      value = trimmed;
    } else {
      throw new Error(
        `Pinned provider '${id}' string revision must be a full 40-character commit SHA or an explicit { kind, value } object, got '${trimmed}' in ${sourceId}`
      );
    }
  } else if (typeof rawRevision === 'object' && rawRevision !== null) {
    if (rawRevision.kind !== 'git-commit' && rawRevision.kind !== 'release-asset') {
      throw new Error(
        `Pinned provider '${id}' revision.kind must be 'git-commit' or 'release-asset', got '${rawRevision.kind}' in ${sourceId}`
      );
    }
    if (typeof rawRevision.value !== 'string' || !rawRevision.value.trim()) {
      throw new Error(
        `Pinned provider '${id}' revision.value must be a non-empty string in ${sourceId}`
      );
    }
    kind = rawRevision.kind;
    value = rawRevision.value.trim();

    const lower = value.toLowerCase();
    if (MUTABLE_IDENTIFIERS.includes(lower)) {
      throw new Error(
        `Pinned provider '${id}' revision value cannot be a mutable branch or floating identifier '${value}' in ${sourceId}`
      );
    }

    if (kind === 'git-commit' && !GIT_SHA_REGEX.test(value)) {
      throw new Error(
        `Pinned git-commit provider '${id}' requires a full 40-character commit SHA, got '${value}' in ${sourceId}`
      );
    }
  } else {
    throw new Error(
      `Pinned provider '${id}' revision must be a string or { kind, value } object in ${sourceId}`
    );
  }

  // 校验运行时 URL 与不可变修订的一致性 (Fail-closed consistency check)
  if (MUTABLE_BRANCH_PATH_REGEX.test(url)) {
    throw new Error(
      `Locator URL contradicts immutable pinned identity in provider '${id}': contains mutable branch path in '${url}'`
    );
  }

  if (FLOATING_RELEASE_PATH_REGEX.test(url)) {
    throw new Error(
      `Locator URL contradicts immutable pinned identity in provider '${id}': contains floating latest release locator in '${url}'`
    );
  }

  if (!url.includes(value)) {
    throw new Error(
      `Locator URL contradicts immutable pinned identity in provider '${id}': URL does not reference declared revision '${value}'`
    );
  }

  return { kind, value };
}

/**
 * 解析并校验 Rule Provider 声明式配置
 *
 * @param {string|object} content YAML 文本或已解析对象
 * @param {string} [sourceId] 数据来源标识 (供错误溯源)
 * @returns {Array<object>} 验证通过并标准化的 provider 定义列表
 */
export function parseRuleProvidersYaml(content, sourceId = 'rule-providers') {
  const parsed = typeof content === 'string' ? YAML.parse(content) : content;

  if (!parsed || !Array.isArray(parsed.providers)) {
    throw new Error(`Invalid rule-providers schema in ${sourceId}: expected top-level 'providers' array`);
  }

  const seenIds = new Set();
  const validated = [];

  for (let i = 0; i < parsed.providers.length; i++) {
    const entry = parsed.providers[i];
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Malformed provider entry at index ${i} in ${sourceId}`);
    }

    // 1. 唯一标识符校验
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new Error(`Provider entry at index ${i} in ${sourceId} must have non-empty string 'id'`);
    }
    const id = entry.id.trim();
    if (seenIds.has(id)) {
      throw new Error(`Duplicate rule-provider id '${id}' found in ${sourceId}`);
    }
    seenIds.add(id);

    // 2. Behavior 校验 (与 Mihomo 数据格式强绑定)
    if (typeof entry.behavior !== 'string' || !VALID_BEHAVIORS.includes(entry.behavior)) {
      throw new Error(
        `Invalid behavior '${entry.behavior}' in provider '${id}' (${sourceId}): expected one of ${VALID_BEHAVIORS.join(', ')}`
      );
    }

    // 3. URL 必填校验
    if (typeof entry.url !== 'string' || !entry.url.trim()) {
      throw new Error(`Provider '${id}' must specify a valid 'url' in ${sourceId}`);
    }
    const url = entry.url.trim();

    // 4. Source 溯源策略校验
    if (!entry.source || typeof entry.source !== 'object') {
      throw new Error(`Provider '${id}' must define a 'source' object in ${sourceId}`);
    }

    const strategy = entry.source.strategy;
    if (strategy !== STRATEGY_PINNED && strategy !== STRATEGY_DYNAMIC) {
      throw new Error(
        `Unknown source.strategy '${strategy}' in provider '${id}' (${sourceId}): expected 'pinned' or 'dynamic'`
      );
    }

    let revision = null;
    if (strategy === STRATEGY_PINNED) {
      revision = validatePinnedRevision(entry.source.revision, id, url, sourceId);
    } else {
      // 动态依赖严禁虚假宣称完全可重现
      const source = entry.source;
      if (
        source.reproducible === true ||
        (typeof source.reproducibility === 'string' &&
          /^(fully[-_]?reproducible|reproducible)$/i.test(source.reproducibility.trim()))
      ) {
        throw new Error(
          `Dynamic provider '${id}' cannot claim reproducibility (found contradictory reproducibility claim in dynamic strategy)`
        );
      }
    }

    validated.push({
      id,
      behavior: entry.behavior,
      url,
      format: typeof entry.format === 'string' ? entry.format.trim() : 'yaml',
      path: typeof entry.path === 'string' ? entry.path.trim() : `./rule_providers/${id}.yaml`,
      interval: typeof entry.interval === 'number' ? entry.interval : (strategy === STRATEGY_DYNAMIC ? 86400 : undefined),
      source: {
        strategy,
        revision,
        description: typeof entry.source.description === 'string' ? entry.source.description.trim() : undefined,
      },
    });
  }

  return validated;
}

/**
 * 从本地文件加载 Rule Provider 声明式配置
 *
 * @param {string} filePath 文件绝对路径
 * @returns {Array<object>} 验证通过的 provider 列表
 */
export function loadRuleProvidersFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return parseRuleProvidersYaml(content, filePath);
}

/**
 * 生成确定性的 Rule Asset Provenance Manifest 审计清单
 *
 * @param {Array<object>} providers 经过校验的 provider 列表
 * @returns {object} 确定性清单对象
 */
export function generateProvenanceManifest(providers) {
  const safeProviders = Array.isArray(providers) ? [...providers] : [];

  // 严格按 provider.id 正序排列，确保字节输出绝对确定
  safeProviders.sort((a, b) => a.id.localeCompare(b.id));

  let pinnedCount = 0;
  let dynamicCount = 0;

  const manifestProviders = safeProviders.map((p) => {
    const isPinned = p.source.strategy === STRATEGY_PINNED;
    if (isPinned) {
      pinnedCount++;
    } else {
      dynamicCount++;
    }

    return {
      id: p.id,
      classification: isPinned ? CLASSIFICATION_PINNED : CLASSIFICATION_DYNAMIC,
      behavior: p.behavior,
      url: p.url,
      strategy: p.source.strategy,
      revision: isPinned ? p.source.revision : null,
      rollback_semantics: isPinned
        ? ROLLBACK_SEMANTICS_PINNED
        : ROLLBACK_SEMANTICS_DYNAMIC,
    };
  });

  let status;
  if (manifestProviders.length === 0) {
    status = STATUS_NO_EXTERNAL;
  } else if (dynamicCount > 0) {
    status = STATUS_CONTAINS_DYNAMIC;
  } else {
    status = STATUS_FULLY_PINNED;
  }

  return {
    manifest_version: '1.0.0',
    status,
    summary: {
      total_providers: manifestProviders.length,
      pinned_providers: pinnedCount,
      dynamic_providers: dynamicCount,
    },
    providers: manifestProviders,
  };
}

/**
 * 将清单对象序列化为确定性的 JSON 字符串 (无随机内容，2空格缩进，末尾换行)
 *
 * @param {object} manifest 清单对象
 * @returns {string} 确定性格式化 JSON 字符串
 */
export function serializeProvenanceManifest(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * 校验构建产物运行时挂载的 Rule Providers 与清单声明的权威数据集严格恒等 (Fail-Closed)
 *
 * 保证对每一次成功的构建：
 * 权威 Manifest 所述 Provider 集合 == Script.js 运行时真实挂载的 Fleet Provider 集合。
 *
 * @param {object|null|undefined} runtimeOutput Boa 0.22 执行返回的配置对象
 * @param {Array<object>} validatedProviders 当次构建全局唯一的权威 providers 数据集
 */
export function assertProviderParity(runtimeOutput, validatedProviders) {
  const safeProviders = Array.isArray(validatedProviders) ? validatedProviders : [];
  const expectedMap = new Map();
  for (let i = 0; i < safeProviders.length; i++) {
    expectedMap.set(safeProviders[i].id, safeProviders[i]);
  }

  const effectiveProviders =
    runtimeOutput && runtimeOutput['rule-providers'] && typeof runtimeOutput['rule-providers'] === 'object'
      ? runtimeOutput['rule-providers']
      : {};

  const runtimeIds = Object.keys(effectiveProviders).sort();
  const expectedIds = Array.from(expectedMap.keys()).sort();

  // 1. 数量与 ID 集合严格恒等 (Bi-directional Set equality)
  if (runtimeIds.length !== expectedIds.length) {
    throw new Error(
      `Provider provenance/runtime parity violation: manifest declares ${expectedIds.length} provider(s) [${expectedIds.join(', ')}], but generated Script.js runtime exposed ${runtimeIds.length} provider(s) [${runtimeIds.join(', ')}]`
    );
  }

  for (let i = 0; i < expectedIds.length; i++) {
    const id = expectedIds[i];
    if (!Object.prototype.hasOwnProperty.call(effectiveProviders, id)) {
      throw new Error(
        `Provider provenance/runtime parity violation: provider '${id}' is declared in manifest but missing from runtime Script.js`
      );
    }

    const expected = expectedMap.get(id);
    const runtime = effectiveProviders[id];

    // 2. Behavior 强比对
    if (runtime.behavior !== expected.behavior) {
      throw new Error(
        `Provider provenance/runtime parity violation for '${id}': expected behavior '${expected.behavior}', but runtime Script.js has '${runtime.behavior}'`
      );
    }

    // 3. URL 强比对
    if (runtime.url !== expected.url) {
      throw new Error(
        `Provider provenance/runtime parity violation for '${id}': expected url '${expected.url}', but runtime Script.js has '${runtime.url}'`
      );
    }
  }
}
