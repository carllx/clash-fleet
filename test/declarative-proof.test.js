import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildFlatScript } from '../src/build/rollup-flat.js';
import { executeScriptWithBoa } from '../src/harness/boa-harness.js';

describe('Declarative edit proof and end-to-end Boa 0.22 assembly suite', () => {
  const rootDir = process.cwd();

  it('proves generated dist/Script.js executes in Boa 0.22 with declarative rules and sniffer', async () => {
    const distScriptPath = path.join(rootDir, 'dist/Script.js');
    assert.ok(fs.existsSync(distScriptPath), 'dist/Script.js must exist from build');
    const scriptCode = fs.readFileSync(distScriptPath, 'utf8');

    const sampleConfig = {
      rules: ['MATCH,🔰 节点选择'],
    };

    const output = await executeScriptWithBoa(scriptCode, sampleConfig, 'test-profile');

    // 验证 Sniffer 嗅探注入
    assert.ok(output.sniffer, 'output must contain sniffer');
    assert.strictEqual(output.sniffer.enable, true);
    assert.strictEqual(output.sniffer['parse-pure-ip'], true);
    assert.deepStrictEqual(output.sniffer.sniff.TLS.ports, [443, 8443]);

    // 验证规则优先级：Reject -> Direct -> Existing Rules
    assert.ok(Array.isArray(output.rules), 'output.rules must be an array');
    const rejectIdx = output.rules.indexOf('RULE-SET,reject,REJECT');
    const directIdx = output.rules.indexOf('IP-CIDR,198.18.0.1/32,DIRECT');
    const existingIdx = output.rules.indexOf('MATCH,🔰 节点选择');

    assert.ok(rejectIdx !== -1, 'reject rule must be present');
    assert.ok(directIdx !== -1, 'direct rule must be present');
    assert.ok(existingIdx !== -1, 'existing rule must be preserved');

    assert.ok(rejectIdx < directIdx, 'reject rule must precede direct rule');
    assert.ok(directIdx < existingIdx, 'direct rule must precede existing downstream rule');
  });

  it('demonstrates adding declarative DIRECT/REJECT entries changes behavior without changing engine JS', async () => {
    // 创建独立沙箱临时目录
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-declarative-proof-'));

    try {
      const srcDir = path.join(tempDir, 'src');
      fs.cpSync(path.join(rootDir, 'src'), srcDir, { recursive: true });

      // 1. 仅在声明式 YAML 中添加规则，严禁改动任何 src/engine/ 逻辑
      const directYamlPath = path.join(srcDir, 'rules/direct.yaml');
      const rejectYamlPath = path.join(srcDir, 'rules/reject.yaml');

      fs.appendFileSync(
        directYamlPath,
        '\n  - "DOMAIN-SUFFIX,custom-declarative-direct.internal,DIRECT"\n',
        'utf8'
      );
      fs.appendFileSync(
        rejectYamlPath,
        '\n  - "DOMAIN-SUFFIX,ad-tracking-telemetry.blocked,REJECT"\n',
        'utf8'
      );

      // 2. 执行 Rollup Flat 扁平化构建
      const customOutputPath = path.join(tempDir, 'dist/Script.js');
      const buildResult = await buildFlatScript({
        input: path.join(srcDir, 'index.js'),
        output: customOutputPath,
      });

      assert.ok(buildResult.code.length > 0);
      assert.ok(fs.existsSync(customOutputPath));

      // 3. 在真实 Boa 0.22 运行环境中执行
      const sampleInput = {
        rules: ['GEOIP,CN,DIRECT', 'MATCH,FINAL_PROXY'],
      };

      const finalConfig = await executeScriptWithBoa(
        buildResult.code,
        sampleInput,
        'custom-declarative-profile'
      );

      // 4. 验证新声明式规则生效并保持正确顺序
      assert.ok(
        finalConfig.rules.includes('DOMAIN-SUFFIX,ad-tracking-telemetry.blocked,REJECT'),
        'newly declared reject rule must appear in output'
      );
      assert.ok(
        finalConfig.rules.includes('DOMAIN-SUFFIX,custom-declarative-direct.internal,DIRECT'),
        'newly declared direct rule must appear in output'
      );

      const newRejectIdx = finalConfig.rules.indexOf(
        'DOMAIN-SUFFIX,ad-tracking-telemetry.blocked,REJECT'
      );
      const newDirectIdx = finalConfig.rules.indexOf(
        'DOMAIN-SUFFIX,custom-declarative-direct.internal,DIRECT'
      );
      const downstreamIdx = finalConfig.rules.indexOf('GEOIP,CN,DIRECT');

      assert.ok(newRejectIdx < newDirectIdx, 'new reject precedes new direct');
      assert.ok(newDirectIdx < downstreamIdx, 'new direct precedes downstream rules');

      // 5. 验证下游既有规则完整按序保留
      assert.strictEqual(
        finalConfig.rules[finalConfig.rules.length - 2],
        'GEOIP,CN,DIRECT'
      );
      assert.strictEqual(
        finalConfig.rules[finalConfig.rules.length - 1],
        'MATCH,FINAL_PROXY'
      );

      // 6. 验证 sniffer 仍然保持正常注入
      assert.strictEqual(finalConfig.sniffer['parse-pure-ip'], true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('demonstrates declarative region presets are loaded and compiled into generated artifact', () => {
    const distScriptPath = path.join(rootDir, 'dist/Script.js');
    const scriptCode = fs.readFileSync(distScriptPath, 'utf8');

    // 验证地区数据已在构建期被内联编译为 JS 数据
    assert.ok(scriptCode.includes('"香港"'), 'contains compiled HK region name');
    assert.ok(scriptCode.includes('"🇭🇰"'), 'contains compiled HK emoji');
    assert.ok(scriptCode.includes('"日本"'), 'contains compiled JP region name');
    assert.ok(scriptCode.includes('"美国"'), 'contains compiled US region name');
  });
});
