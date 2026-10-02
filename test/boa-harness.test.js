import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  validateScript,
  executeScriptWithBoa,
  assertBoaCompatibilityEngine,
  isExactBoaVersion,
} from '../src/harness/boa-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVALID_SYNTAX_FILE = path.resolve(__dirname, 'fixtures/invalid-syntax.js');
const MISSING_MAIN_FILE = path.resolve(__dirname, 'fixtures/missing-main.js');

test('Boa 0.22 compatibility gate and CVR harness', async (t) => {
  await t.test('isExactBoaVersion strictly validates version equality and rejects suffixes', () => {
    // 必须通过
    assert.equal(isExactBoaVersion('boa 0.22.0'), true);
    assert.equal(isExactBoaVersion('  boa 0.22.0\n'), true);
    assert.equal(isExactBoaVersion('BOA 0.22.0'), true);

    // 必须拒绝带有任何后缀或不同版本的情况
    assert.equal(isExactBoaVersion('boa 0.23.0'), false);
    assert.equal(isExactBoaVersion('boa 0.22.0-dev'), false);
    assert.equal(isExactBoaVersion('boa 0.22.0 unexpected-suffix'), false);
    assert.equal(isExactBoaVersion('boa 0.22.0 (rev 123)'), false);
    assert.equal(isExactBoaVersion(''), false);
    assert.equal(isExactBoaVersion(null), false);
  });

  await t.test('detects and asserts exact boa 0.22.0 binary', async () => {
    const { version } = await assertBoaCompatibilityEngine();
    assert.equal(isExactBoaVersion(version), true, `Expected exact boa 0.22.0, got "${version}"`);
  });

  await t.test('assertBoaCompatibilityEngine rejects versions with suffixes (e.g. -dev, (rev 123))', async () => {
    const fakeBoaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-boa-suffix-'));
    const isWin = process.platform === 'win32';
    const fakeBoa = path.join(fakeBoaDir, isWin ? 'boa.cmd' : 'boa');
    if (isWin) {
      fs.writeFileSync(fakeBoa, '@echo off\r\necho boa 0.22.0-dev\r\n');
    } else {
      fs.writeFileSync(
        fakeBoa,
        '#!/bin/sh\necho "boa 0.22.0-dev"\n',
        { mode: 0o755 }
      );
    }

    try {
      await assert.rejects(
        async () => {
          await assertBoaCompatibilityEngine(fakeBoa);
        },
        /Incompatible Boa engine: Expected exact "boa 0\.22\.0", found "boa 0\.22\.0-dev"/i
      );
    } finally {
      fs.rmSync(fakeBoaDir, { recursive: true, force: true });
    }
  });

  await t.test('assertBoaCompatibilityEngine fails closed on missing binary', async () => {
    await assert.rejects(
      async () => {
        await assertBoaCompatibilityEngine('/non/existent/boa-binary');
      },
      /Boa engine binary not found or inaccessible/i
    );
  });

  await t.test('assertBoaCompatibilityEngine fails closed on wrong engine version (e.g. 0.23.0)', async () => {
    const fakeBoaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-boa-'));
    const isWin = process.platform === 'win32';
    const fakeBoa = path.join(fakeBoaDir, isWin ? 'boa.cmd' : 'boa');
    if (isWin) {
      fs.writeFileSync(fakeBoa, '@echo off\r\necho boa 0.23.1\r\n');
    } else {
      fs.writeFileSync(
        fakeBoa,
        `#!/usr/bin/env node\nif (process.argv.includes('--version')) { console.log('boa 0.23.1'); process.exit(0); }\n`,
        { mode: 0o755 }
      );
    }

    try {
      await assert.rejects(
        async () => {
          await assertBoaCompatibilityEngine(fakeBoa);
        },
        /Incompatible Boa engine: Expected exact "boa 0\.22\.0", found "boa 0\.23\.1"/i
      );

      // 验证 validateScript 和 executeScriptWithBoa 同样在版本不符时立即 fail-closed
      const validCode = 'function main(config, profileName) { return config; }';
      await assert.rejects(
        async () => {
          await validateScript(validCode, { boaPath: fakeBoa });
        },
        /Incompatible Boa engine/i
      );

      await assert.rejects(
        async () => {
          await executeScriptWithBoa(validCode, {}, 'default', { boaPath: fakeBoa });
        },
        /Incompatible Boa engine/i
      );
    } finally {
      fs.rmSync(fakeBoaDir, { recursive: true, force: true });
    }
  });

  await t.test('validateScript passes valid script with CVR static marker and clean code', async () => {
    const validCode = 'function main(config, profileName) { return config; }';
    const report = await validateScript(validCode);
    assert.equal(report.valid, true, `Report should be valid: ${JSON.stringify(report)}`);
    assert.equal(report.staticMarkerPassed, true);
    assert.equal(report.errors.length, 0);
  });

  await t.test('validateScript fails if CVR static marker is missing', async () => {
    const codeWithoutMain = 'function run(config, profileName) { return config; }';
    const report = await validateScript(codeWithoutMain);
    assert.equal(report.valid, false);
    assert.equal(report.staticMarkerPassed, false);
    assert.ok(report.errors.some(e => e.includes('CVR static main marker')));
  });

  await t.test('validateScript fails on CommonJS leaks or export leftovers', async () => {
    const cjsCode = 'function main(c) { require("fs"); return c; }';
    const reportCjs = await validateScript(cjsCode);
    assert.equal(reportCjs.valid, false);
    assert.ok(reportCjs.errors.some(e => e.includes('CommonJS')));

    const exportCode = 'function main(c) { return c; }\nexport { main };';
    const reportExport = await validateScript(exportCode);
    assert.equal(reportExport.valid, false);
    assert.ok(reportExport.errors.some(e => e.includes('export')));
  });

  await t.test('validateScript fails on syntax error', async () => {
    const invalidCode = fs.readFileSync(INVALID_SYNTAX_FILE, 'utf8');
    const report = await validateScript(invalidCode);
    assert.equal(report.valid, false);
    assert.ok(report.errors.some(e => /syntax/i.test(e)));
  });

  await t.test('executeScriptWithBoa evaluates script and returns deep-equal result', async () => {
    const code = `
      function main(config, profileName) {
        config = config || {};
        config.profile = profileName;
        config.processed = true;
        return config;
      }
    `;
    const input = { port: 7890, mode: 'rule' };
    const output = await executeScriptWithBoa(code, input, 'default');
    assert.deepEqual(output, {
      port: 7890,
      mode: 'rule',
      profile: 'default',
      processed: true,
    });
  });

  await t.test('executeScriptWithBoa fails when callable global main is missing', async () => {
    const missingMainCode = fs.readFileSync(MISSING_MAIN_FILE, 'utf8');
    await assert.rejects(
      async () => {
        await executeScriptWithBoa(missingMainCode, {}, 'test');
      },
      /main is not defined|Callable global 'main'|not a function/i
    );
  });

  await t.test('executeScriptWithBoa fails on syntax error', async () => {
    const invalidCode = fs.readFileSync(INVALID_SYNTAX_FILE, 'utf8');
    await assert.rejects(
      async () => {
        await executeScriptWithBoa(invalidCode, {}, 'test');
      },
      /SyntaxError|syntax/i
    );
  });
});
