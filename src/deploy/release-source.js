import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  verifyRepoImmutableSetting,
  verifyPublishedReleaseImmutability,
  parseAndValidateSha256Digest,
} from '../release/immutability-gate.js';

export const REQUIRED_RELEASE_ASSETS = [
  'Script.js',
  'SHA256SUMS.txt',
  'RULE_ASSET_PROVENANCE.json',
];

/**
 * 校验 Release 对象及其资产是否满足核心不可变性与必要构件存在契约
 *
 * @param {object} repoSetting 仓库不可变设置响应
 * @param {object} releaseObject GitHub Release 对象
 * @returns {Map<string, object>} 必需资产名称与对应 asset 对象的映射
 */
export function validateReleaseContract(repoSetting, releaseObject) {
  // 1. 仓库不可变设置门禁 (Fail-Closed)
  const repoCheck = verifyRepoImmutableSetting(repoSetting);
  if (!repoCheck.passed) {
    throw new Error(`[release-source] Repository immutable check failed: ${repoCheck.detail}`);
  }

  // 2. Release 对象不可变性门禁 (Fail-Closed)
  const releaseCheck = verifyPublishedReleaseImmutability(releaseObject);
  if (!releaseCheck.passed) {
    throw new Error(`[release-source] Release immutability check failed: ${releaseCheck.reason}`);
  }

  // 3. 校验必需资产存在性 (Script.js, SHA256SUMS.txt, RULE_ASSET_PROVENANCE.json)
  const assets = Array.isArray(releaseObject.assets) ? releaseObject.assets : [];
  const assetMap = new Map();
  for (const asset of assets) {
    if (asset && asset.name) {
      assetMap.set(asset.name, asset);
    }
  }

  const missingAssets = [];
  for (const requiredName of REQUIRED_RELEASE_ASSETS) {
    if (!assetMap.has(requiredName)) {
      missingAssets.push(requiredName);
    }
  }

  if (missingAssets.length > 0) {
    throw new Error(
      `[release-source] Missing required build artifacts in release: [${missingAssets.join(', ')}]`
    );
  }

  return assetMap;
}

/**
 * 基于 GitHub REST API 的正式生产发布源 (GitHub Releases Authority)
 */
export class GitHubReleaseSource {
  /**
   * @param {object} options
   * @param {string} [options.owner='carllx'] 仓库所有者
   * @param {string} [options.repo='clash-fleet'] 仓库名称
   * @param {string} [options.token] GitHub 个人访问令牌
   * @param {string} [options.baseUrl='https://api.github.com'] GitHub API 基地址
   * @param {typeof fetch} [options.fetchFn=globalThis.fetch] 自定义 fetch 函数
   */
  constructor(options = {}) {
    this.owner = options.owner || 'carllx';
    this.repo = options.repo || 'clash-fleet';
    this.token = options.token || process.env.GITHUB_TOKEN || null;
    this.baseUrl = (options.baseUrl || 'https://api.github.com').replace(/\/+$/, '');
    this.fetch = options.fetchFn || globalThis.fetch;

    if (typeof this.fetch !== 'function') {
      throw new Error('Global fetch is not available in the current environment');
    }
  }

  /**
   * 构造标准请求头
   *
   * @param {Record<string, string>} [extraHeaders]
   * @returns {Record<string, string>}
   */
  #buildHeaders(extraHeaders = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'clash-fleet-deployer',
      'X-GitHub-Api-Version': '2026-03-10',
      ...extraHeaders,
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * 发现并校验目标版本 Release
   *
   * @param {string} version 目标版本号 (如 "v0.1.0" 或 "0.1.0")
   * @returns {Promise<{ release: object, assets: Map<string, object> }>}
   */
  async discover(version) {
    if (!version || typeof version !== 'string') {
      throw new Error('Version must be a non-empty string');
    }

    const tag = version.startsWith('v') ? version : `v${version}`;

    // 1. 查询仓库 immutable-releases 状态
    const repoSettingUrl = `${this.baseUrl}/repos/${this.owner}/${this.repo}/immutable-releases`;
    let repoSettingRes;
    try {
      repoSettingRes = await this.fetch(repoSettingUrl, {
        headers: this.#buildHeaders(),
      });
    } catch (err) {
      throw new Error(`Failed to query repository immutable-releases setting: ${err.message}`);
    }

    if (!repoSettingRes.ok) {
      throw new Error(
        `Failed to fetch repo immutable-releases setting (HTTP ${repoSettingRes.status} ${repoSettingRes.statusText})`
      );
    }
    const repoSetting = await repoSettingRes.json();

    // 2. 查询指定 tag 的 Release
    const releaseUrl = `${this.baseUrl}/repos/${this.owner}/${this.repo}/releases/tags/${encodeURIComponent(tag)}`;
    let releaseRes;
    try {
      releaseRes = await this.fetch(releaseUrl, {
        headers: this.#buildHeaders(),
      });
    } catch (err) {
      throw new Error(`Failed to query release for tag "${tag}": ${err.message}`);
    }

    if (releaseRes.status === 404) {
      throw new Error(`Release not found for version "${version}" (tag "${tag}") in repository ${this.owner}/${this.repo}`);
    }

    if (!releaseRes.ok) {
      throw new Error(
        `Failed to fetch release for version "${version}" (HTTP ${releaseRes.status} ${releaseRes.statusText})`
      );
    }

    const releaseObject = await releaseRes.json();

    // 3. 校验不可变性契约与必需资产
    const assetMap = validateReleaseContract(repoSetting, releaseObject);

    return {
      release: releaseObject,
      assets: assetMap,
    };
  }

  /**
   * 下载目标资产文件至本地指定路径
   *
   * @param {object} asset 目标 asset 对象
   * @param {string} destinationPath 保存文件路径
   */
  async downloadAsset(asset, destinationPath) {
    const downloadUrl = asset.browser_download_url || asset.url;
    if (!downloadUrl) {
      throw new Error(`Asset "${asset.name}" does not have a download URL`);
    }

    // 若通过 asset.url (API endpoint) 下载，需要 Accept: application/octet-stream
    const headers = this.#buildHeaders();
    if (downloadUrl === asset.url) {
      headers.Accept = 'application/octet-stream';
    }

    let response;
    try {
      response = await this.fetch(downloadUrl, { headers });
    } catch (err) {
      throw new Error(`Network failure downloading asset "${asset.name}": ${err.message}`);
    }

    if (!response.ok) {
      throw new Error(
        `Failed to download asset "${asset.name}" (HTTP ${response.status} ${response.statusText})`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 校验 asset 自带的权威 SHA-256 摘要 (Fail-Closed)
    assertAssetBufferDigest(asset, buffer);

    fs.writeFileSync(destinationPath, buffer);
  }
}

/**
 * 校验下载内容与 asset 元数据声明的权威 SHA-256 摘要完全一致 (Fail-Closed)
 *
 * @param {object} asset 目标资产对象
 * @param {Buffer} buffer 下载的二进制内容
 */
export function assertAssetBufferDigest(asset, buffer) {
  const rawDigest = asset.digest || asset.sha256;
  if (!rawDigest) return;

  const parsedDigest = parseAndValidateSha256Digest(rawDigest);
  if (!parsedDigest.valid) {
    throw new Error(`Invalid asset digest for "${asset.name}": ${parsedDigest.error}`);
  }
  const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== parsedDigest.hash) {
    throw new Error(
      `Asset "${asset.name}" digest mismatch: expected sha256:${parsedDigest.hash}, downloaded sha256:${actualHash}`
    );
  }
}

/**
 * 确定性内存/隔离测试发布源 (Deterministic Test Release Source Seam)
 * 供单元测试与离线模拟使用，不依赖生产网络且完全遵循生产门禁契约
 */
export class FixtureReleaseSource {
  /**
   * @param {object} options
   * @param {object} options.repoSetting 模拟仓库配置 (例如 { enabled: true })
   * @param {object} options.releaseObject 模拟 Release 对象 (包含 tag_name, immutable: true, assets 列表)
   * @param {Record<string, string|Buffer>} options.files 文件名与内容映射表
   */
  constructor(options = {}) {
    this.repoSetting = options.repoSetting ?? { enabled: true };
    this.releaseObject = options.releaseObject ?? null;
    this.files = options.files ?? {};
  }

  async discover(version) {
    if (!this.releaseObject) {
      throw new Error(`Release not found for version "${version}"`);
    }

    const assetMap = validateReleaseContract(this.repoSetting, this.releaseObject);
    return {
      release: this.releaseObject,
      assets: assetMap,
    };
  }

  async downloadAsset(asset, destinationPath) {
    if (!(asset.name in this.files)) {
      throw new Error(`Asset file content missing from fixture: "${asset.name}"`);
    }

    const rawContent = this.files[asset.name];
    const buffer = Buffer.isBuffer(rawContent) ? rawContent : Buffer.from(String(rawContent), 'utf8');

    // 校验 asset 自带的权威 SHA-256 摘要 (Fail-Closed)
    assertAssetBufferDigest(asset, buffer);

    fs.writeFileSync(destinationPath, buffer);
  }
}
