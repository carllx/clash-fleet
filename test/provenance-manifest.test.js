import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runBuild } from '../src/cli/cli.js';
import { executeScriptWithBoa } from '../src/harness/boa-harness.js';
import {
  STATUS_NO_EXTERNAL,
  STATUS_FULLY_PINNED,
  STATUS_CONTAINS_DYNAMIC,
  CLASSIFICATION_PINNED,
  CLASSIFICATION_DYNAMIC,
  ROLLBACK_SEMANTICS_PINNED,
  ROLLBACK_SEMANTICS_DYNAMIC,
} from '../src/loader/rule-providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.resolve(__dirname, '../.tmp/test-manifest-build');
const SCRIPT_OUT = path.join(TMP_DIR, 'Script.js');
const MANIFEST_OUT = path.join(TMP_DIR, 'RULE_ASSET_PROVENANCE.json');

test('Rule Asset Provenance Manifest & Build Integration Suite', async (t) => {
  await t.test('canonical fleet build generates deterministic empty manifest alongside Script.js', async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    await runBuild({
      input: 'src/index.js',
      output: SCRIPT_OUT,
    });

    assert.ok(fs.existsSync(SCRIPT_OUT), 'Script.js must be generated');
    assert.ok(fs.existsSync(MANIFEST_OUT), 'RULE_ASSET_PROVENANCE.json must be generated');

    const manifestContent = fs.readFileSync(MANIFEST_OUT, 'utf8');
    const manifest = JSON.parse(manifestContent);

    assert.equal(manifest.status, STATUS_NO_EXTERNAL);
    assert.equal(manifest.summary.total_providers, 0);
    assert.equal(manifest.summary.pinned_providers, 0);
    assert.equal(manifest.summary.dynamic_providers, 0);
    assert.deepEqual(manifest.providers, []);

    // 验证没有时间戳或绝对路径泄露
    assert.equal(manifest.timestamp, undefined);
    assert.doesNotMatch(manifestContent, /\/Users\/|\/home\/|[A-Z]:\\\\/);

    // 证明 Canonical 构建下 Script.js 运行时不包含 Fleet 外部 provider
    const canonicalScript = fs.readFileSync(SCRIPT_OUT, 'utf8');
    const runtimeCanonical = await executeScriptWithBoa(
      canonicalScript,
      { proxies: [], rules: [] },
      'default'
    );
    assert.strictEqual(runtimeCanonical['rule-providers'], undefined);
  });

  await t.test('consecutive builds produce exact byte-identical Script.js and manifest hashes', async () => {
    const run1Dir = path.join(TMP_DIR, 'run1');
    const run2Dir = path.join(TMP_DIR, 'run2');

    const script1 = path.join(run1Dir, 'Script.js');
    const manifest1 = path.join(run1Dir, 'RULE_ASSET_PROVENANCE.json');
    const script2 = path.join(run2Dir, 'Script.js');
    const manifest2 = path.join(run2Dir, 'RULE_ASSET_PROVENANCE.json');

    await runBuild({ input: 'src/index.js', output: script1 });
    await runBuild({ input: 'src/index.js', output: script2 });

    const script1Hash = crypto.createHash('sha256').update(fs.readFileSync(script1)).digest('hex');
    const script2Hash = crypto.createHash('sha256').update(fs.readFileSync(script2)).digest('hex');
    assert.equal(script1Hash, script2Hash, 'Script.js must be byte-identical across runs');

    const manifest1Hash = crypto.createHash('sha256').update(fs.readFileSync(manifest1)).digest('hex');
    const manifest2Hash = crypto.createHash('sha256').update(fs.readFileSync(manifest2)).digest('hex');
    assert.equal(manifest1Hash, manifest2Hash, 'RULE_ASSET_PROVENANCE.json must be byte-identical across runs');
  });

  await t.test('build with mixed pinned and dynamic fixtures proves single provider authority and identical provider set', async () => {
    const fixtureDir = path.join(TMP_DIR, 'fixture-mixed');
    fs.mkdirSync(fixtureDir, { recursive: true });

    const fixedCommitSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    const mixedProvidersFile = path.join(fixtureDir, 'rule-providers.yaml');
    fs.writeFileSync(
      mixedProvidersFile,
      `
providers:
  - id: fixture-dynamic
    behavior: classical
    url: "https://raw.githubusercontent.com/example/rules/main/dynamic.yaml"
    interval: 86400
    source:
      strategy: dynamic
  - id: fixture-pinned
    behavior: domain
    url: "https://raw.githubusercontent.com/example/rules/${fixedCommitSha}/pinned.yaml"
    source:
      strategy: pinned
      revision:
        kind: git-commit
        value: "${fixedCommitSha}"
`,
      'utf8'
    );

    const outScript = path.join(fixtureDir, 'Script.js');
    const outManifest = path.join(fixtureDir, 'RULE_ASSET_PROVENANCE.json');

    await runBuild({
      input: 'src/index.js',
      output: outScript,
      providers: mixedProvidersFile,
    });

    // 1. 验证 Manifest 产物与分类
    const manifest = JSON.parse(fs.readFileSync(outManifest, 'utf8'));

    assert.equal(manifest.status, STATUS_CONTAINS_DYNAMIC);
    assert.equal(manifest.summary.total_providers, 2);
    assert.equal(manifest.summary.pinned_providers, 1);
    assert.equal(manifest.summary.dynamic_providers, 1);

    // 验证严格排序 (fixture-dynamic 字典序在 fixture-pinned 之前)
    assert.equal(manifest.providers[0].id, 'fixture-dynamic');
    assert.equal(manifest.providers[0].classification, CLASSIFICATION_DYNAMIC);
    assert.equal(manifest.providers[0].rollback_semantics, ROLLBACK_SEMANTICS_DYNAMIC);
    assert.equal(manifest.providers[0].revision, null);

    assert.equal(manifest.providers[1].id, 'fixture-pinned');
    assert.equal(manifest.providers[1].classification, CLASSIFICATION_PINNED);
    assert.deepEqual(manifest.providers[1].revision, {
      kind: 'git-commit',
      value: fixedCommitSha,
    });
    assert.equal(manifest.providers[1].rollback_semantics, ROLLBACK_SEMANTICS_PINNED);

    // 2. 核心证据：证明单一权威源 (Single Authority Invariant)
    // 运行当次生成的 Script.js，断言其内部注入的 rule-providers 与 Manifest 所述一致！
    const scriptCode = fs.readFileSync(outScript, 'utf8');
    const runtimeConfig = await executeScriptWithBoa(
      scriptCode,
      { proxies: [], rules: [] },
      'test-profile'
    );

    assert.ok(runtimeConfig['rule-providers'], 'Generated script must mount rule-providers');
    const runtimeProviderKeys = Object.keys(runtimeConfig['rule-providers']).sort();
    const manifestProviderKeys = manifest.providers.map((p) => p.id).sort();

    // 验证：Manifest 的 Provider ID 列表 == Script.js 运行期挂载的 Provider ID 列表
    assert.deepEqual(
      manifestProviderKeys,
      ['fixture-dynamic', 'fixture-pinned'],
      'Manifest must describe exactly the fixture provider IDs'
    );
    assert.deepEqual(
      runtimeProviderKeys,
      manifestProviderKeys,
      'Script.js runtime rule-providers MUST contain the exact same provider IDs as Manifest'
    );

    // 详细检查运行时配置的 URL 与行为
    assert.equal(
      runtimeConfig['rule-providers']['fixture-dynamic'].url,
      'https://raw.githubusercontent.com/example/rules/main/dynamic.yaml'
    );
    assert.equal(
      runtimeConfig['rule-providers']['fixture-pinned'].url,
      `https://raw.githubusercontent.com/example/rules/${fixedCommitSha}/pinned.yaml`
    );
  });

  await t.test('build fails closed on invalid provider configuration', async () => {
    const badDir = path.join(TMP_DIR, 'bad-providers');
    fs.mkdirSync(badDir, { recursive: true });

    const badFile = path.join(badDir, 'rule-providers.yaml');
    fs.writeFileSync(
      badFile,
      `
providers:
  - id: bad-pinned
    behavior: domain
    url: "https://example.com/rule.yaml"
    source:
      strategy: pinned
`,
      'utf8'
    );

    await assert.rejects(
      async () => {
        await runBuild({
          input: 'src/index.js',
          output: path.join(badDir, 'Script.js'),
          providers: badFile,
        });
      },
      /Pinned provider 'bad-pinned' must declare immutable 'revision'/
    );
  });
});
