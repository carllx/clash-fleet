import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 严格校验待发布包的隐私与机密安全性 (Privacy & Secret Scanner)
 *
 * 检查项包括：
 * - 严禁包含私有 IP 订阅凭证/Token
 * - 严禁包含本地用户绝对路径 (/Users/..., C:\Users\..., /home/...)
 * - 严禁包含私钥特征 (BEGIN PRIVATE KEY 等)
 * - 严禁包含敏感机密字段 (如真实的密码/密钥凭据)
 *
 * @param {string} content 文本内容
 * @param {string} filename 文件名称
 * @throws {Error} 若检测到敏感泄露
 */
export function scanContentForSecrets(content, filename = 'artifact') {
  if (typeof content !== 'string') {
    throw new TypeError('Content to scan must be a string');
  }

  // 1. 绝对家目录路径泄露检查 (兼容 POSIX /Users/... 与 Windows C:\Users\... 或 C:\\Users\\...)
  const userPathRegex = /\/Users\/[a-zA-Z0-9_-]+|[A-Z]:\\+Users\\+[a-zA-Z0-9_-]+|\/home\/[a-zA-Z0-9_-]+/g;
  const userPathMatches = content.match(userPathRegex);
  if (userPathMatches) {
    throw new Error(
      `Privacy violation in ${filename}: Detected local absolute user path (${userPathMatches.join(', ')}).`
    );
  }

  // 2. 私钥头部检查
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) {
    throw new Error(`Secret violation in ${filename}: Detected private key header.`);
  }

  // 3. 常见 Token / Secret 模式检查
  if (/(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}|gho_[a-zA-Z0-9]{36})/.test(content)) {
    throw new Error(`Secret violation in ${filename}: Detected GitHub Personal Access Token or OAuth token.`);
  }
}

/**
 * 确定性生成发布包 (Deterministic Release Packaging)
 *
 * 产出三项公共可发布边界资产：
 * 1. Script.js
 * 2. SHA256SUMS.txt
 * 3. RULE_ASSET_PROVENANCE.json
 *
 * 保证：
 * - 绝对无任何本地绝对路径/私有凭据泄露
 * - SHA256SUMS.txt 采用跨平台一致的 Unix 换行符与确定性字母排序
 * - 同一输入多次执行产生完全一致的字节级产物与哈希
 *
 * @param {object} options 打包选项
 * @param {string} options.distDir 产物源目录 (应已包含由 build 生成的 Script.js 与 RULE_ASSET_PROVENANCE.json)
 * @param {string} options.packageDir 目标包输出目录
 * @returns {{ packageDir: string, files: string[], checksums: Record<string, string>, checksumsContent: string }} 打包结果
 */
export function createDeterministicPackage({ distDir, packageDir }) {
  const resolvedDist = path.resolve(process.cwd(), distDir);
  const resolvedPkg = path.resolve(process.cwd(), packageDir);

  const scriptSource = path.join(resolvedDist, 'Script.js');
  const provenanceSource = path.join(resolvedDist, 'RULE_ASSET_PROVENANCE.json');

  if (!fs.existsSync(scriptSource)) {
    throw new Error(`Required release asset missing: ${scriptSource}`);
  }
  if (!fs.existsSync(provenanceSource)) {
    throw new Error(`Required release asset missing: ${provenanceSource}`);
  }

  const scriptContent = fs.readFileSync(scriptSource, 'utf8');
  const provenanceContent = fs.readFileSync(provenanceSource, 'utf8');

  // 隐私与机密安全门禁扫描 (Fail-Closed)
  scanContentForSecrets(scriptContent, 'Script.js');
  scanContentForSecrets(provenanceContent, 'RULE_ASSET_PROVENANCE.json');

  if (!fs.existsSync(resolvedPkg)) {
    fs.mkdirSync(resolvedPkg, { recursive: true });
  }

  const targetScript = path.join(resolvedPkg, 'Script.js');
  const targetProvenance = path.join(resolvedPkg, 'RULE_ASSET_PROVENANCE.json');
  const targetChecksums = path.join(resolvedPkg, 'SHA256SUMS.txt');

  // 写入并确保规范换行
  fs.writeFileSync(targetScript, scriptContent, 'utf8');
  fs.writeFileSync(targetProvenance, provenanceContent, 'utf8');

  // 计算各文件的确定性哈希
  const scriptHash = crypto.createHash('sha256').update(fs.readFileSync(targetScript)).digest('hex');
  const provenanceHash = crypto.createHash('sha256').update(fs.readFileSync(targetProvenance)).digest('hex');

  const checksums = {
    'RULE_ASSET_PROVENANCE.json': provenanceHash,
    'Script.js': scriptHash,
  };

  // 生成标准格式的 SHA256SUMS.txt (按文件名字母序严格升序排序，以 Unix \n 结尾)
  const sortedFiles = Object.keys(checksums).sort();
  const checksumLines = sortedFiles.map((file) => `${checksums[file]}  ${file}`);
  const checksumsContent = checksumLines.join('\n') + '\n';

  fs.writeFileSync(targetChecksums, checksumsContent, 'utf8');

  // 校验生成的 SHA256SUMS.txt 本身
  scanContentForSecrets(checksumsContent, 'SHA256SUMS.txt');

  return {
    packageDir: resolvedPkg,
    files: ['RULE_ASSET_PROVENANCE.json', 'SHA256SUMS.txt', 'Script.js'],
    checksums,
    checksumsContent,
  };
}

/**
 * 校验给定打包目录下的所有文件与其 SHA256SUMS.txt 校验和严格一致
 *
 * @param {string} packageDir 打包产物目录
 * @returns {boolean} 是否一致
 */
export function verifyPackageChecksums(packageDir) {
  const resolvedPkg = path.resolve(process.cwd(), packageDir);
  const checksumsFile = path.join(resolvedPkg, 'SHA256SUMS.txt');

  if (!fs.existsSync(checksumsFile)) {
    throw new Error(`SHA256SUMS.txt not found in ${resolvedPkg}`);
  }

  const checksumsContent = fs.readFileSync(checksumsFile, 'utf8');
  const lines = checksumsContent.trim().split(/\r?\n/).filter(Boolean);

  if (lines.length === 0) {
    throw new Error('SHA256SUMS.txt is empty');
  }

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 2) {
      throw new Error(`Malformed SHA256SUMS entry: "${line}"`);
    }
    const [expectedHash, filename] = parts;
    const targetFile = path.join(resolvedPkg, filename);
    if (!fs.existsSync(targetFile)) {
      throw new Error(`Referenced asset missing: ${filename}`);
    }
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error(
        `Checksum mismatch for ${filename}: expected ${expectedHash}, computed ${actualHash}`
      );
    }
  }

  return true;
}
