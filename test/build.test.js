import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildFlatScript } from '../src/build/rollup-flat.js';
import { executeScriptWithBoa } from '../src/harness/boa-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ENTRY = path.resolve(__dirname, 'fixtures/modular/index.js');
const OUTPUT_DIR = path.resolve(__dirname, '../.tmp/test-build');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'Script.js');

test('Rollup Flat deterministic build suite', async (t) => {
  await t.test('builds modular sources into a single clean Script.js and proves symbol collision safety', async () => {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });

    const result = await buildFlatScript({
      input: FIXTURE_ENTRY,
      output: OUTPUT_FILE,
    });

    assert.equal(fs.existsSync(OUTPUT_FILE), true, 'Output file must exist');
    const content = fs.readFileSync(OUTPUT_FILE, 'utf8');

    // 1. 验证原生顶层可调用函数声明
    assert.match(content, /function main\s*\(/, 'Must expose top-level function main');

    // 2. 验证 export 关键字已完全剥离
    assert.doesNotMatch(content, /\bexport\s*\{/, 'Export statement must be stripped');
    assert.doesNotMatch(content, /\bexport\s+function\b/, 'Export function must be stripped to plain function');

    // 3. 验证零 CommonJS 宿主垫片与泄漏
    assert.doesNotMatch(content, /\brequire\s*\(/, 'Must not contain require()');
    assert.doesNotMatch(content, /\bprocess\./, 'Must not contain process references');
    assert.doesNotMatch(content, /__toCommonJS|__copyProps|__defProp/, 'Must not contain esbuild-style helper layer');

    // 4. 文本层验证：两处同名 private symbol 分别生成了独立的绑定声明，杜绝语法重定义
    const hasOriginalTag = /const\s+TAG\s*=\s*['"]\[(?:utils|rules)\]['"]/.test(content);
    const hasRenamedTag = /const\s+TAG[\w$]+\s*=\s*['"]\[(?:utils|rules)\]['"]/.test(content);
    assert.ok(hasOriginalTag && hasRenamedTag, 'Must contain both original and safely renamed TAG declarations');

    // 5. 核心：通过可观测的运行时行为 (Observable Runtime Behavior) 证明符号隔离
    // 两个源模块均使用同名 private TAG，运行必须能区分 [utils] 和 [rules] 两个独立值
    const runtimeOutput = await executeScriptWithBoa(
      content,
      { rules: ['DOMAIN,example.com', 'IP-CIDR,1.1.1.1/32'] },
      'my-profile'
    );

    assert.equal(runtimeOutput.profile, 'my-profile');
    assert.equal(runtimeOutput.meta.label, '[utils] my-profile', 'utils 模块的私有 TAG 必须独立保留');
    assert.equal(runtimeOutput.meta.ruleTag, '[rules]', 'rules 模块的私有 TAG 必须独立保留');
    assert.equal(runtimeOutput.meta.directCount, 1);
  });

  await t.test('produces byte-identical build output for identical inputs (deterministic build)', async () => {
    const file1 = path.join(OUTPUT_DIR, 'build1.js');
    const file2 = path.join(OUTPUT_DIR, 'build2.js');

    await buildFlatScript({ input: FIXTURE_ENTRY, output: file1 });
    await buildFlatScript({ input: FIXTURE_ENTRY, output: file2 });

    const hash1 = crypto.createHash('sha256').update(fs.readFileSync(file1)).digest('hex');
    const hash2 = crypto.createHash('sha256').update(fs.readFileSync(file2)).digest('hex');

    assert.equal(hash1, hash2, 'Repeated builds must produce exact identical sha256 checksums');
  });

  await t.test('fails when entrypoint does not expose main function', async () => {
    const invalidEntry = path.resolve(__dirname, 'fixtures/modular/utils.js');
    const targetFile = path.join(OUTPUT_DIR, 'no-main.js');

    await assert.rejects(
      async () => {
        await buildFlatScript({ input: invalidEntry, output: targetFile });
      },
      /must expose top-level main function/i
    );
  });
});
