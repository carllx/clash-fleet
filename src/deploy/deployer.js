import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { scanContentForSecrets } from '../release/packager.js';
import {
  validateScript,
  executeScriptWithBoa,
  assertBoaCompatibilityEngine,
} from '../harness/boa-harness.js';
import {
  GitHubReleaseSource,
  REQUIRED_RELEASE_ASSETS,
} from './release-source.js';
import {
  createByteIdenticalBackup,
  atomicReplaceFile,
  computeFileSha256,
} from './atomic-file.js';

/**
 * 严格解析并校验下载的 SHA256SUMS.txt
 *
 * @param {string} stagingDir 隔离暂存目录
 * @returns {Record<string, string>} 验证通过的文件名 -> SHA-256 哈希映射
 */
export function verifyDownloadedChecksums(stagingDir) {
  const sumsPath = path.join(stagingDir, 'SHA256SUMS.txt');
  if (!fs.existsSync(sumsPath)) {
    throw new Error('SHA256SUMS.txt not found in downloaded assets');
  }

  const sumsContent = fs.readFileSync(sumsPath, 'utf8');
  scanContentForSecrets(sumsContent, 'SHA256SUMS.txt');

  const lines = sumsContent.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    throw new Error('SHA256SUMS.txt is empty');
  }

  const checksumMap = {};
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 2) {
      throw new Error(`Malformed SHA256SUMS entry: "${line}"`);
    }
    const [expectedHash, filename] = parts;
    if (!/^[a-fA-F0-9]{64}$/.test(expectedHash)) {
      throw new Error(`Malformed SHA-256 hex in SHA256SUMS: "${expectedHash}"`);
    }
    checksumMap[filename] = expectedHash.toLowerCase();
  }

  // 必须至少包含关键交付构件
  const missingInSums = [];
  for (const req of REQUIRED_RELEASE_ASSETS) {
    if (req !== 'SHA256SUMS.txt' && !checksumMap[req]) {
      missingInSums.push(req);
    }
  }

  if (missingInSums.length > 0) {
    throw new Error(
      `SHA256SUMS.txt does not cover required build artifacts: [${missingInSums.join(', ')}]`
    );
  }

  // 逐一校验对应文件哈希严格匹配
  for (const [filename, expectedHash] of Object.entries(checksumMap)) {
    const filePath = path.join(stagingDir, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Referenced asset in SHA256SUMS.txt missing on disk: ${filename}`);
    }
    const actualHash = computeFileSha256(filePath);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Checksum mismatch for ${filename}: expected ${expectedHash}, computed ${actualHash}`
      );
    }
  }

  return checksumMap;
}

/**
 * 执行 Deployment Transaction 前半段流水线 (Steps 1–6)
 *
 * 流程：
 * Discover -> Fetch -> Checksum -> Boa Preflight -> Backup -> Atomic Replace
 *
 * 核心安全边界与保证：
 * 1. 目标目录完全零污染：所有下载与门禁预检在完全隔离的临时 staging 目录中进行；
 * 2. 任何前置失败 (网络/不存在/校验和/语法/AST/可调用沙箱) 均立即 Fail-Closed，且证明目标文件未变、备份未产生；
 * 3. 正常更新路径要求目标文件存在，并在替换前执行 byte-identical 备份及其哈希校验；
 * 4. 采用同目录原子 rename/replace 原语，保证原子落盘与异常防御；
 * 5. 替换完成后返回明确的 STAGED_NOT_APPLIED 状态，严禁越界触发运行时生命周期与网络探测。
 *
 * @param {object} options 部署选项
 * @param {string} options.version 目标发布版本 (如 "v0.1.0" 或 "0.1.0")
 * @param {string} options.target 目标 Script.js 路径
 * @param {object} [options.source] 依赖注入的发布源实例 (默认实例化 GitHubReleaseSource)
 * @param {string} [options.owner='carllx'] GitHub 仓库拥有者
 * @param {string} [options.repo='clash-fleet'] GitHub 仓库名称
 * @param {string} [options.token] GitHub 访问 Token
 * @param {string} [options.boaPath] 自定义 Boa 二进制路径
 * @param {string} [options.stagingBaseDir] 自定义暂存基准目录 (默认使用 os.tmpdir())
 * @returns {Promise<object>} 部署事务结果
 */
export async function executeDeploymentTransaction(options = {}) {
  const {
    version,
    target,
    source,
    owner = 'carllx',
    repo = 'clash-fleet',
    token,
    boaPath,
    stagingBaseDir = os.tmpdir(),
  } = options;

  if (!version || typeof version !== 'string') {
    throw new Error('Deployment version must be a non-empty string');
  }

  if (!target || typeof target !== 'string') {
    throw new Error('Target script path must be provided');
  }

  const resolvedTarget = path.resolve(target);

  // 1. 初始化隔离的临时 Staging 目录
  const stagingPrefix = path.join(stagingBaseDir, 'fleet-deploy-staging-');
  const stagingDir = fs.mkdtempSync(stagingPrefix);

  try {
    // 2. Discover (发现与不可变性预审)
    const releaseSource =
      source ||
      new GitHubReleaseSource({
        owner,
        repo,
        token,
      });

    const { release, assets } = await releaseSource.discover(version);

    // 3. Fetch (拉取三大公共构件至隔离 staging 目录)
    for (const assetName of REQUIRED_RELEASE_ASSETS) {
      const assetObj = assets.get(assetName);
      if (!assetObj) {
        throw new Error(`Required asset "${assetName}" not found in discovered release assets`);
      }
      const destPath = path.join(stagingDir, assetName);
      await releaseSource.downloadAsset(assetObj, destPath);
    }

    // 4. Checksum (校验和严格比对与机密扫描)
    verifyDownloadedChecksums(stagingDir);

    const candidateScriptPath = path.join(stagingDir, 'Script.js');
    const candidateProvenancePath = path.join(stagingDir, 'RULE_ASSET_PROVENANCE.json');

    const candidateScriptCode = fs.readFileSync(candidateScriptPath, 'utf8');
    const candidateProvenanceCode = fs.readFileSync(candidateProvenancePath, 'utf8');

    scanContentForSecrets(candidateScriptCode, 'Script.js');
    scanContentForSecrets(candidateProvenanceCode, 'RULE_ASSET_PROVENANCE.json');

    // 5. Boa 0.22 Preflight (强制执行权威 Boa 0.22 门禁与运行时沙箱验证)
    await assertBoaCompatibilityEngine(boaPath);

    const staticReport = await validateScript(candidateScriptCode, { boaPath });
    if (!staticReport.valid) {
      const errList = staticReport.errors.map((e) => `  - ${e}`).join('\n');
      throw new Error(`Candidate script failed Boa static preflight:\n${errList}`);
    }

    // 沙箱执行验证：验证 global main(config, profileName) 为合规函数并可正常调用
    await executeScriptWithBoa(
      candidateScriptCode,
      { proxies: [], rules: [] },
      'default',
      { boaPath }
    );

    // 6. Backup (仅在全部前置校验 PASS 后，进入目标目录，要求 existing target 并创建校验 byte-identical 备份)
    if (!fs.existsSync(resolvedTarget)) {
      throw new Error(`Target script does not exist for update: ${resolvedTarget}`);
    }

    const backupResult = createByteIdenticalBackup(resolvedTarget);

    // 7. Atomic Replace (跨平台同目录原子替换)
    const replaceResult = atomicReplaceFile(resolvedTarget, candidateScriptPath);

    // 8. Explicit Lifecycle Boundary (明确声明构件已落地但未激活，等待后续生命周期触发)
    return {
      status: 'STAGED_NOT_APPLIED',
      transaction: 'SUCCESS_PRE_LIFECYCLE',
      target: resolvedTarget,
      backup: backupResult.backupPath,
      backupSha256: backupResult.sha256,
      candidateSha256: replaceResult.sha256,
      version: version,
      applied: false,
      lifecycleBoundary: 'PRE_RUNTIME_VERIFICATION',
      detail:
        'Target Script.js atomically replaced with verified candidate. ' +
        'CVR restart, Mihomo reloading, and network runtime verification have NOT been triggered.',
    };
  } finally {
    // 确定性清理临时 staging 目录 (保证无任何垃圾遗留)
    try {
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    } catch {
      // 忽略清理异常
    }
  }
}
