import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  computeFileSha256,
  createByteIdenticalBackup,
  atomicReplaceFile,
} from '../src/deploy/atomic-file.js';
import {
  GitHubReleaseSource,
  FixtureReleaseSource,
} from '../src/deploy/release-source.js';
import {
  executeDeploymentTransaction,
  verifyDownloadedChecksums,
} from '../src/deploy/deployer.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '../bin/fleet.js');

/**
 * 辅助函数：构造确定性有效的候选构件
 */
function createValidCandidateArtifacts() {
  const scriptContent = `
function main(config, profileName) {
  var cfg = config || {};
  cfg['x-fleet-version'] = 'v1.2.3';
  return cfg;
}
`;
  const provenanceContent = JSON.stringify(
    {
      version: '0.1.0',
      status: 'FULLY_PINNED_RULE_ASSETS',
      generated_at: '2026-10-03T00:00:00.000Z',
      providers: [],
    },
    null,
    2
  );

  const scriptHash = crypto.createHash('sha256').update(Buffer.from(scriptContent, 'utf8')).digest('hex');
  const provHash = crypto.createHash('sha256').update(Buffer.from(provenanceContent, 'utf8')).digest('hex');

  const sumsContent = [
    `${provHash}  RULE_ASSET_PROVENANCE.json`,
    `${scriptHash}  Script.js`,
  ].join('\n') + '\n';

  const sumsHash = crypto.createHash('sha256').update(Buffer.from(sumsContent, 'utf8')).digest('hex');

  const repoSetting = { enabled: true };
  const releaseObject = {
    id: 1001,
    tag_name: 'v1.2.3',
    draft: false,
    immutable: true,
    assets: [
      { name: 'Script.js', digest: `sha256:${scriptHash}` },
      { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${provHash}` },
      { name: 'SHA256SUMS.txt', digest: `sha256:${sumsHash}` },
    ],
  };

  const files = {
    'Script.js': scriptContent,
    'RULE_ASSET_PROVENANCE.json': provenanceContent,
    'SHA256SUMS.txt': sumsContent,
  };

  return {
    scriptContent,
    provenanceContent,
    sumsContent,
    scriptHash,
    provHash,
    sumsHash,
    repoSetting,
    releaseObject,
    files,
  };
}

test('Deployment Transaction Suite (Discover -> Fetch -> Checksum -> Boa Preflight -> Backup -> Atomic Replace)', async (t) => {
  // 建立隔离的测试根目录
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-deploy-test-'));

  t.after(() => {
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  await t.test('1. atomic-file primitives: backup and atomic replace', async (st) => {
    const targetFile = path.join(testRoot, 'Script.js');
    const initialContent = 'function main(config) { return config; }\n';
    fs.writeFileSync(targetFile, initialContent, 'utf8');
    const initialHash = computeFileSha256(targetFile);

    await st.test('creates byte-identical backup and verifies hash match', () => {
      const backupResult = createByteIdenticalBackup(targetFile);
      assert.equal(backupResult.backupPath, `${targetFile}.bak`);
      assert.equal(backupResult.sha256, initialHash);
      assert.equal(fs.readFileSync(backupResult.backupPath, 'utf8'), initialContent);
    });

    await st.test('fails closed if target does not exist for backup', () => {
      assert.throws(
        () => createByteIdenticalBackup(path.join(testRoot, 'non-existent.js')),
        /Target script not found/
      );
    });

    await st.test('atomicReplaceFile safely replaces target with candidate', () => {
      const candidateFile = path.join(testRoot, 'Candidate.js');
      const candidateContent = 'function main() { return { candidate: true }; }\n';
      fs.writeFileSync(candidateFile, candidateContent, 'utf8');
      const candidateHash = computeFileSha256(candidateFile);

      const res = atomicReplaceFile(targetFile, candidateFile);
      assert.equal(res.replaced, true);
      assert.equal(res.sha256, candidateHash);
      assert.equal(fs.readFileSync(targetFile, 'utf8'), candidateContent);
    });
  });

  await t.test('2. Happy path: full deployment transaction succeeds', async () => {
    const runDir = fs.mkdtempSync(path.join(testRoot, 'happy-path-'));
    const targetScript = path.join(runDir, 'Script.js');
    const originalTargetContent = 'function main(config) { return { old: true }; }\n';
    fs.writeFileSync(targetScript, originalTargetContent, 'utf8');
    const originalHash = computeFileSha256(targetScript);

    const fixture = createValidCandidateArtifacts();
    const source = new FixtureReleaseSource({
      repoSetting: fixture.repoSetting,
      releaseObject: fixture.releaseObject,
      files: fixture.files,
    });

    const result = await executeDeploymentTransaction({
      version: 'v1.2.3',
      target: targetScript,
      source,
    });

    assert.equal(result.status, 'STAGED_NOT_APPLIED');
    assert.equal(result.transaction, 'SUCCESS_PRE_LIFECYCLE');
    assert.equal(result.applied, false);
    assert.equal(result.lifecycleBoundary, 'PRE_RUNTIME_VERIFICATION');
    assert.equal(result.backup, `${targetScript}.bak`);
    assert.equal(result.backupSha256, originalHash);
    assert.equal(result.candidateSha256, fixture.scriptHash);

    // 验证备份内容为原始 target
    assert.equal(fs.readFileSync(result.backup, 'utf8'), originalTargetContent);
    // 验证 target 已被原子替换为 candidate
    assert.equal(fs.readFileSync(targetScript, 'utf8'), fixture.scriptContent);
  });

  await t.test('3. Release/Version discovery failures leave target unchanged and backup untouched', async (st) => {
    const runDir = fs.mkdtempSync(path.join(testRoot, 'disc-fail-'));
    const targetScript = path.join(runDir, 'Script.js');
    const originalContent = 'function main(config) { return config; }\n';
    fs.writeFileSync(targetScript, originalContent, 'utf8');
    const originalHash = computeFileSha256(targetScript);

    await st.test('fails closed when release is not found', async () => {
      const source = new FixtureReleaseSource({
        repoSetting: { enabled: true },
        releaseObject: null, // 无 release
        files: {},
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v9.9.9', target: targetScript, source }),
        /Release not found/
      );

      // 验证目标文件未被修改，备份未被创建
      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when repo immutable-releases setting is disabled', async () => {
      const fixture = createValidCandidateArtifacts();
      const source = new FixtureReleaseSource({
        repoSetting: { enabled: false }, // 禁用不可变
        releaseObject: fixture.releaseObject,
        files: fixture.files,
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Repository immutable check failed/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when release object is draft', async () => {
      const fixture = createValidCandidateArtifacts();
      const source = new FixtureReleaseSource({
        repoSetting: { enabled: true },
        releaseObject: { ...fixture.releaseObject, draft: true },
        files: fixture.files,
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Release immutability check failed/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when required asset is missing in release', async () => {
      const fixture = createValidCandidateArtifacts();
      const partialAssets = fixture.releaseObject.assets.filter((a) => a.name !== 'RULE_ASSET_PROVENANCE.json');
      const source = new FixtureReleaseSource({
        repoSetting: { enabled: true },
        releaseObject: { ...fixture.releaseObject, assets: partialAssets },
        files: fixture.files,
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Missing required build artifacts/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when required asset is missing authoritative digest in release', async () => {
      const fixture = createValidCandidateArtifacts();
      const assetsWithoutDigest = fixture.releaseObject.assets.map((a) =>
        a.name === 'Script.js' ? { name: a.name } : a
      );
      const source = new FixtureReleaseSource({
        repoSetting: { enabled: true },
        releaseObject: { ...fixture.releaseObject, assets: assetsWithoutDigest },
        files: fixture.files,
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Required build artifacts fail authoritative digest check|missing authoritative digest/i
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when required asset has malformed digest in release', async () => {
      const fixture = createValidCandidateArtifacts();
      const assetsWithBadDigest = fixture.releaseObject.assets.map((a) =>
        a.name === 'Script.js' ? { ...a, digest: 'sha256:not-a-valid-hex' } : a
      );
      const source = new FixtureReleaseSource({
        repoSetting: { enabled: true },
        releaseObject: { ...fixture.releaseObject, assets: assetsWithBadDigest },
        files: fixture.files,
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Malformed SHA-256 digest/i
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when required asset has unsupported digest algorithm', async () => {
      const fixture = createValidCandidateArtifacts();
      const assetsWithSha512 = fixture.releaseObject.assets.map((a) =>
        a.name === 'Script.js' ? { ...a, digest: `sha512:${'a'.repeat(128)}` } : a
      );
      const source = new FixtureReleaseSource({
        repoSetting: { enabled: true },
        releaseObject: { ...fixture.releaseObject, assets: assetsWithSha512 },
        files: fixture.files,
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Unsupported digest algorithm/i
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });
  });

  await t.test('4. Checksum verification failures leave target unchanged and backup untouched', async (st) => {
    const runDir = fs.mkdtempSync(path.join(testRoot, 'chk-fail-'));
    const targetScript = path.join(runDir, 'Script.js');
    const originalContent = 'function main(config) { return config; }\n';
    fs.writeFileSync(targetScript, originalContent, 'utf8');
    const originalHash = computeFileSha256(targetScript);

    /**
     * 辅助函数：构造特定 SHA256SUMS.txt 内容及其正确匹配的 release fixture
     */
    function createFixtureWithCustomSums(customSumsContent) {
      const fixture = createValidCandidateArtifacts();
      const sumsHash = crypto.createHash('sha256').update(Buffer.from(customSumsContent, 'utf8')).digest('hex');
      const assets = fixture.releaseObject.assets.map((a) =>
        a.name === 'SHA256SUMS.txt' ? { ...a, digest: `sha256:${sumsHash}` } : a
      );
      return new FixtureReleaseSource({
        repoSetting: fixture.repoSetting,
        releaseObject: { ...fixture.releaseObject, assets },
        files: { ...fixture.files, 'SHA256SUMS.txt': customSumsContent },
      });
    }

    await st.test('fails closed when asset digest in release mismatches downloaded content', async () => {
      const fixture = createValidCandidateArtifacts();
      const files = { ...fixture.files, 'Script.js': 'corrupted-content' };
      const source = new FixtureReleaseSource({
        repoSetting: fixture.repoSetting,
        releaseObject: fixture.releaseObject, // asset 上仍是原有 hash
        files,
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Asset "Script\.js" digest mismatch/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when downloaded Script.js matches asset digest but fails SHA256SUMS mismatch', async () => {
      // 保持所有文件的 asset.digest 严格合法匹配其实际下载内容；但在 SHA256SUMS.txt 中给出错误期望值
      const fixture = createValidCandidateArtifacts();
      const wrongHash = '0000000000000000000000000000000000000000000000000000000000000000';
      const customSums = `${fixture.provHash}  RULE_ASSET_PROVENANCE.json\n${wrongHash}  Script.js\n`;
      const source = createFixtureWithCustomSums(customSums);

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Checksum mismatch for Script\.js/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when SHA256SUMS.txt is empty', async () => {
      const source = createFixtureWithCustomSums('');

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /SHA256SUMS\.txt is empty/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed on malformed SHA256SUMS.txt entry', async () => {
      const source = createFixtureWithCustomSums('invalid-hash-entry\n');

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Malformed SHA256SUMS entry/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when SHA256SUMS contains relative path traversal (../outside-file)', async () => {
      const fixture = createValidCandidateArtifacts();
      const customSums = `${fixture.provHash}  RULE_ASSET_PROVENANCE.json\n${fixture.scriptHash}  ../outside-file\n`;
      const source = createFixtureWithCustomSums(customSums);

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Unsafe path in SHA256SUMS\.txt/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when SHA256SUMS contains absolute path', async () => {
      const fixture = createValidCandidateArtifacts();
      const customSums = `${fixture.provHash}  RULE_ASSET_PROVENANCE.json\n${fixture.scriptHash}  /etc/passwd\n`;
      const source = createFixtureWithCustomSums(customSums);

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Unsafe path in SHA256SUMS\.txt/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when SHA256SUMS contains path separators', async () => {
      const fixture = createValidCandidateArtifacts();
      const customSums = `${fixture.provHash}  RULE_ASSET_PROVENANCE.json\n${fixture.scriptHash}  sub/Script.js\n`;
      const source = createFixtureWithCustomSums(customSums);

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Unsafe path in SHA256SUMS\.txt/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when SHA256SUMS contains duplicate entries', async () => {
      const fixture = createValidCandidateArtifacts();
      const customSums = `${fixture.provHash}  RULE_ASSET_PROVENANCE.json\n${fixture.scriptHash}  Script.js\n${fixture.scriptHash}  Script.js\n`;
      const source = createFixtureWithCustomSums(customSums);

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Duplicate entry in SHA256SUMS\.txt/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when SHA256SUMS contains unexpected entries', async () => {
      const fixture = createValidCandidateArtifacts();
      const dummyHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const customSums = `${fixture.provHash}  RULE_ASSET_PROVENANCE.json\n${fixture.scriptHash}  Script.js\n${dummyHash}  extra.txt\n`;
      const source = createFixtureWithCustomSums(customSums);

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Unexpected entry in SHA256SUMS\.txt: "extra\.txt"/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when SHA256SUMS misses Script.js', async () => {
      const fixture = createValidCandidateArtifacts();
      const customSums = `${fixture.provHash}  RULE_ASSET_PROVENANCE.json\n`;
      const source = createFixtureWithCustomSums(customSums);

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Missing required entry in SHA256SUMS\.txt: "Script\.js"/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when SHA256SUMS misses RULE_ASSET_PROVENANCE.json', async () => {
      const fixture = createValidCandidateArtifacts();
      const customSums = `${fixture.scriptHash}  Script.js\n`;
      const source = createFixtureWithCustomSums(customSums);

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: targetScript, source }),
        /Missing required entry in SHA256SUMS\.txt: "RULE_ASSET_PROVENANCE\.json"/
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });
  });

  await t.test('5. Boa 0.22 preflight failures leave target unchanged and backup untouched', async (st) => {
    const runDir = fs.mkdtempSync(path.join(testRoot, 'boa-fail-'));
    const targetScript = path.join(runDir, 'Script.js');
    const originalContent = 'function main(config) { return config; }\n';
    fs.writeFileSync(targetScript, originalContent, 'utf8');
    const originalHash = computeFileSha256(targetScript);

    await st.test('fails closed when candidate contains syntax error', async () => {
      const badSyntaxCode = 'function main(config) { const invalid = ; return config; }\n';
      const provContent = '{}';
      const scriptHash = crypto.createHash('sha256').update(Buffer.from(badSyntaxCode)).digest('hex');
      const provHash = crypto.createHash('sha256').update(Buffer.from(provContent)).digest('hex');
      const sumsContent = `${provHash}  RULE_ASSET_PROVENANCE.json\n${scriptHash}  Script.js\n`;
      const sumsHash = crypto.createHash('sha256').update(Buffer.from(sumsContent)).digest('hex');

      const source = new FixtureReleaseSource({
        repoSetting: { enabled: true },
        releaseObject: {
          id: 2001,
          tag_name: 'v2.0.0',
          draft: false,
          immutable: true,
          assets: [
            { name: 'Script.js', digest: `sha256:${scriptHash}` },
            { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${provHash}` },
            { name: 'SHA256SUMS.txt', digest: `sha256:${sumsHash}` },
          ],
        },
        files: {
          'Script.js': badSyntaxCode,
          'RULE_ASSET_PROVENANCE.json': provContent,
          'SHA256SUMS.txt': sumsContent,
        },
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v2.0.0', target: targetScript, source }),
        /Candidate script failed Boa static preflight|syntax/i
      );

      // 证明：target Script.js 绝对未变，备份绝对未被创建
      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });

    await st.test('fails closed when candidate does not define callable main function', async () => {
      // 满足 static marker 检查但运行时 main 不是函数
      const nonCallableCode = 'function main() {}; main = 12345;\n';
      const provContent = '{}';
      const scriptHash = crypto.createHash('sha256').update(Buffer.from(nonCallableCode)).digest('hex');
      const provHash = crypto.createHash('sha256').update(Buffer.from(provContent)).digest('hex');
      const sumsContent = `${provHash}  RULE_ASSET_PROVENANCE.json\n${scriptHash}  Script.js\n`;
      const sumsHash = crypto.createHash('sha256').update(Buffer.from(sumsContent)).digest('hex');

      const source = new FixtureReleaseSource({
        repoSetting: { enabled: true },
        releaseObject: {
          id: 2002,
          tag_name: 'v2.0.1',
          draft: false,
          immutable: true,
          assets: [
            { name: 'Script.js', digest: `sha256:${scriptHash}` },
            { name: 'RULE_ASSET_PROVENANCE.json', digest: `sha256:${provHash}` },
            { name: 'SHA256SUMS.txt', digest: `sha256:${sumsHash}` },
          ],
        },
        files: {
          'Script.js': nonCallableCode,
          'RULE_ASSET_PROVENANCE.json': provContent,
          'SHA256SUMS.txt': sumsContent,
        },
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v2.0.1', target: targetScript, source }),
        /Callable global 'main' is not defined or not a function|Boa execution failed/i
      );

      assert.equal(computeFileSha256(targetScript), originalHash);
      assert.equal(fs.existsSync(`${targetScript}.bak`), false);
    });
  });

  await t.test('6. Production GitHub Release probe against current repository fails cleanly (Zero Tag/Release Guarantee)', async () => {
    // 仓库当前无 release/tag，对实际生产源探测必须干净失败，并且不能抛出未捕获异常崩溃
    const runDir = fs.mkdtempSync(path.join(testRoot, 'live-fail-'));
    const targetScript = path.join(runDir, 'Script.js');
    fs.writeFileSync(targetScript, 'function main(config) { return config; }\n', 'utf8');
    const originalHash = computeFileSha256(targetScript);

    // 默认 GitHubReleaseSource 访问 carllx/clash-fleet
    const liveSource = new GitHubReleaseSource({
      owner: 'carllx',
      repo: 'clash-fleet',
    });

    await assert.rejects(
      () => executeDeploymentTransaction({
        version: 'v0.0.0-nonexistent',
        target: targetScript,
        source: liveSource,
      }),
      (err) => {
        assert.match(
          err.message,
          /Release not found|Repository immutable check failed|Failed to query|Failed to fetch/i
        );
        return true;
      }
    );

    // 验证目标文件未变，备份未建
    assert.equal(computeFileSha256(targetScript), originalHash);
    assert.equal(fs.existsSync(`${targetScript}.bak`), false);
  });

  await t.test('7. CLI integration: fleet deploy command', async (st) => {
    const runDir = fs.mkdtempSync(path.join(testRoot, 'cli-deploy-'));
    const targetScript = path.join(runDir, 'Script.js');
    fs.writeFileSync(targetScript, 'function main(config) { return config; }\n', 'utf8');

    await st.test('fails closed when target script does not exist on disk for update path', async () => {
      const nonExistentTarget = path.join(runDir, 'NonExistentScript.js');
      const fixture = createValidCandidateArtifacts();
      const source = new FixtureReleaseSource({
        repoSetting: fixture.repoSetting,
        releaseObject: fixture.releaseObject,
        files: fixture.files,
      });

      await assert.rejects(
        () => executeDeploymentTransaction({ version: 'v1.2.3', target: nonExistentTarget, source }),
        /Target script does not exist for update/
      );
      assert.equal(fs.existsSync(`${nonExistentTarget}.bak`), false);
    });

    await st.test('atomic replace failure triggers fail-closed without reporting success', () => {
      // 模拟 candidate 不存在情况
      assert.throws(
        () => atomicReplaceFile(targetScript, path.join(runDir, 'missing-candidate.js')),
        /Candidate file not found for replacement/
      );
    });

    await st.test('fails when repo option has invalid format', async () => {
      await assert.rejects(
        () =>
          execFileAsync(process.execPath, [
            CLI_PATH,
            'deploy',
            'v1.0.0',
            '--target',
            targetScript,
            '--repo',
            'invalid-no-slash',
          ]),
        (err) => err.code !== 0 && /Invalid repository format/i.test(err.stderr || err.stdout)
      );
    });

    await st.test('fails when version is missing', async () => {
      await assert.rejects(
        () => execFileAsync(process.execPath, [CLI_PATH, 'deploy', '--target', targetScript]),
        (err) => err.code !== 0 && /Deployment version must be specified/i.test(err.stderr || err.stdout)
      );
    });

    await st.test('fails cleanly against production source when target is provided', async () => {
      await assert.rejects(
        () => execFileAsync(process.execPath, [CLI_PATH, 'deploy', 'v0.0.0-nonexistent', '--target', targetScript]),
        (err) => err.code !== 0
      );
    });

    await st.test('CLI respects FLEET_TARGET_SCRIPT environment variable when --target is omitted', async () => {
      await assert.rejects(
        () =>
          execFileAsync(
            process.execPath,
            [CLI_PATH, 'deploy', 'v0.0.0-nonexistent'],
            { env: { ...process.env, FLEET_TARGET_SCRIPT: targetScript } }
          ),
        (err) => err.code !== 0 && !/Target script path must be specified/i.test(err.stderr || err.stdout)
      );
    });
  });
});
