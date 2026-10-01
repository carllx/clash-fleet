import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScript, executeScriptWithBoa, getBoaVersion } from '../src/harness/boa-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVALID_SYNTAX_FILE = path.resolve(__dirname, 'fixtures/invalid-syntax.js');
const MISSING_MAIN_FILE = path.resolve(__dirname, 'fixtures/missing-main.js');

test('Boa 0.22 compatibility gate and CVR harness', async (t) => {
  await t.test('detects exact boa 0.22.0 binary', async () => {
    const version = await getBoaVersion();
    assert.match(version, /^boa 0\.22\.0/, `Expected boa 0.22.0, got "${version}"`);
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
