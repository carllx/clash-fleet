import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { loadRulesFile } from '../src/loader/declarative.js';
import { buildFlatScript } from '../src/build/rollup-flat.js';
import { executeScriptWithBoa, validateScript } from '../src/harness/boa-harness.js';

test('Cross-Platform PROCESS Declarations and Universal Coexistence Suite', async (t) => {
  const darwinYamlPath = path.resolve(process.cwd(), 'src/rules/platforms/darwin.yaml');
  const win32YamlPath = path.resolve(process.cwd(), 'src/rules/platforms/win32.yaml');

  await t.test('loads declarative platform files and verifies valid Mihomo rule syntax', () => {
    assert.ok(fs.existsSync(darwinYamlPath), 'platforms/darwin.yaml must exist');
    assert.ok(fs.existsSync(win32YamlPath), 'platforms/win32.yaml must exist');

    const darwinRules = loadRulesFile(darwinYamlPath);
    const win32Rules = loadRulesFile(win32YamlPath);

    assert.ok(darwinRules.length > 0, 'Darwin rules must not be empty');
    assert.ok(win32Rules.length > 0, 'Win32 rules must not be empty');

    // Verify Darwin rules contain expected process rules
    const hasDarwinApp = darwinRules.some((r) => r.startsWith('PROCESS-NAME,') && r.includes('.app'));
    const hasDarwinPath = darwinRules.some((r) => r.startsWith('PROCESS-PATH,/Applications/'));
    const hasDarwinAgy = darwinRules.some((r) => r.includes('Antigravity'));
    assert.ok(hasDarwinApp, 'Darwin rules must contain .app process declarations');
    assert.ok(hasDarwinPath, 'Darwin rules must contain PROCESS-PATH declarations');
    assert.ok(hasDarwinAgy, 'Darwin rules must contain Antigravity declarations');

    // Verify Win32 rules contain expected process rules
    const hasWinExe = win32Rules.some((r) => r.startsWith('PROCESS-NAME,') && r.includes('.exe'));
    const hasWinAgy = win32Rules.some((r) => r.includes('Antigravity.exe'));
    assert.ok(hasWinExe, 'Win32 rules must contain .exe process declarations');
    assert.ok(hasWinAgy, 'Win32 rules must contain Antigravity.exe declarations');
  });

  await t.test('Universal Script builds and proves macOS and Windows PROCESS rules coexist in single artifact', async () => {
    const tmpOutputDir = path.resolve(process.cwd(), '.tmp/test-universal-process');
    const outputPath = path.join(tmpOutputDir, 'Script.js');

    const buildResult = await buildFlatScript({
      input: 'src/index.js',
      output: outputPath,
    });

    assert.ok(fs.existsSync(outputPath), 'Build output must be written');

    // Static check: both Darwin and Win32 process rules exist in the same Script.js
    assert.ok(buildResult.code.includes('DingTalk.app'), 'Must contain Darwin DingTalk.app');
    assert.ok(buildResult.code.includes('DingTalk.exe'), 'Must contain Win32 DingTalk.exe');
    assert.ok(buildResult.code.includes('/Applications/Antigravity IDE.app'), 'Must contain Darwin PROCESS-PATH');
    assert.ok(buildResult.code.includes('Antigravity.exe'), 'Must contain Win32 PROCESS-NAME');

    // Validate script AST via Boa harness
    const validation = await validateScript(buildResult.code);
    assert.deepEqual(validation.errors, [], 'Script must pass Boa AST validation with zero errors');

    // Execute with Boa 0.22 engine to prove runtime coexistence
    const sampleInput = {
      proxies: [
        { name: 'HK-01', type: 'ss' },
        { name: 'JP-01', type: 'ss' },
        { name: 'US-01', type: 'ss' },
      ],
      rules: ['MATCH,🔰 节点选择'],
    };

    const output = await executeScriptWithBoa(buildResult.code, sampleInput, 'default');
    assert.ok(output, 'Boa execution must return config object');
    assert.ok(Array.isArray(output.rules), 'Config rules must be an array');

    // Assert that rules array in the running config contains BOTH platforms rules without conflict
    const rulesStr = JSON.stringify(output.rules);
    assert.ok(rulesStr.includes('DingTalk.app'), 'Runtime output rules must include DingTalk.app');
    assert.ok(rulesStr.includes('DingTalk.exe'), 'Runtime output rules must include DingTalk.exe');
    assert.ok(rulesStr.includes('Antigravity.exe'), 'Runtime output rules must include Antigravity.exe');
    assert.ok(rulesStr.includes('/Applications/Antigravity IDE.app'), 'Runtime output rules must include PROCESS-PATH');
  });
});
