import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createDeterministicPackage,
  verifyPackageChecksums,
  scanContentForSecrets,
} from '../src/release/packager.js';
import { runBuild, runPackage } from '../src/cli/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.resolve(__dirname, '../.tmp/test-deterministic-package');

test('Deterministic Package and Boundary Verification Suite', async (t) => {
  await t.test('createDeterministicPackage produces exact boundary files and matching SHA256SUMS.txt', async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    const distDir = path.join(TMP_DIR, 'dist');
    const pkgDir = path.join(TMP_DIR, 'package');

    await runBuild({
      input: 'src/index.js',
      output: path.join(distDir, 'Script.js'),
    });

    const result = createDeterministicPackage({ distDir, packageDir: pkgDir });

    assert.equal(fs.existsSync(path.join(pkgDir, 'Script.js')), true);
    assert.equal(fs.existsSync(path.join(pkgDir, 'RULE_ASSET_PROVENANCE.json')), true);
    assert.equal(fs.existsSync(path.join(pkgDir, 'SHA256SUMS.txt')), true);

    // 验证文件清单
    assert.deepEqual(result.files.sort(), [
      'RULE_ASSET_PROVENANCE.json',
      'SHA256SUMS.txt',
      'Script.js',
    ]);

    // 验证自验逻辑
    assert.equal(verifyPackageChecksums(pkgDir), true);

    // 验证换行符是纯 Unix \n
    const sumsContent = fs.readFileSync(path.join(pkgDir, 'SHA256SUMS.txt'), 'utf8');
    assert.ok(!sumsContent.includes('\r\n'), 'SHA256SUMS.txt must use Unix line endings');
  });

  await t.test('consecutive package runs from fixed source produce byte-identical packages and checksums', async () => {
    const pkg1Dir = path.join(TMP_DIR, 'pkg1');
    const pkg2Dir = path.join(TMP_DIR, 'pkg2');

    const distDir = path.join(TMP_DIR, 'dist');

    createDeterministicPackage({ distDir, packageDir: pkg1Dir });
    createDeterministicPackage({ distDir, packageDir: pkg2Dir });

    for (const filename of ['Script.js', 'RULE_ASSET_PROVENANCE.json', 'SHA256SUMS.txt']) {
      const buf1 = fs.readFileSync(path.join(pkg1Dir, filename));
      const buf2 = fs.readFileSync(path.join(pkg2Dir, filename));
      const hash1 = crypto.createHash('sha256').update(buf1).digest('hex');
      const hash2 = crypto.createHash('sha256').update(buf2).digest('hex');
      assert.equal(hash1, hash2, `Asset ${filename} must be byte-identical across package runs`);
    }
  });

  await t.test('verifyPackageChecksums fails closed on tampered asset', async () => {
    const tamperedDir = path.join(TMP_DIR, 'tampered');
    createDeterministicPackage({ distDir: path.join(TMP_DIR, 'dist'), packageDir: tamperedDir });

    // 篡改 Script.js
    fs.appendFileSync(path.join(tamperedDir, 'Script.js'), '\n// tampering comment');

    assert.throws(
      () => verifyPackageChecksums(tamperedDir),
      /Checksum mismatch for Script.js/
    );
  });

  await t.test('scanContentForSecrets rejects private user paths, tokens, and private keys', () => {
    // 正常公开内容
    assert.doesNotThrow(() => {
      scanContentForSecrets('const a = 1; function test() { return "hello"; }', 'clean.js');
    });

    // 本地家目录路径
    assert.throws(
      () => scanContentForSecrets('const p = "/Users/secretuser/workspace";', 'leak.js'),
      /Privacy violation.*local absolute user path/
    );

    // Windows 用户路径
    assert.throws(
      () => scanContentForSecrets('const p = "C:\\\\Users\\\\secretuser\\\\workspace";', 'leak.js'),
      /Privacy violation.*local absolute user path/
    );

    // 私钥泄露
    assert.throws(
      () => scanContentForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE...', 'secret.key'),
      /Secret violation.*private key/
    );

    // GitHub PAT 泄露
    assert.throws(
      () => scanContentForSecrets('const token = "ghp_123456789012345678901234567890123456";', 'config.js'),
      /Secret violation.*GitHub Personal Access Token/
    );
  });

  await t.test('cli runPackage command executes successfully', async () => {
    const cliPkgDir = path.join(TMP_DIR, 'cli-package');
    const result = await runPackage({
      distDir: path.join(TMP_DIR, 'dist'),
      packageDir: cliPkgDir,
    });
    assert.equal(result.packageDir, cliPkgDir);
    assert.ok(fs.existsSync(path.join(cliPkgDir, 'SHA256SUMS.txt')));
  });
});
