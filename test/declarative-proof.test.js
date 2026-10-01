import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildFlatScript } from '../src/build/rollup-flat.js';
import { executeScriptWithBoa } from '../src/harness/boa-harness.js';

describe('Declarative edit proof and end-to-end Boa 0.22 assembly suite', () => {
  const rootDir = process.cwd();

  it('builds canonical source in isolated temp directory and verifies Boa 0.22 execution without relying on dist/', async () => {
    // 创建独立沙箱临时目录，完全自包含构建，不依赖仓库级 dist/Script.js
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-canonical-test-'));

    try {
      const isolatedScriptPath = path.join(tempDir, 'Script.js');
      const buildResult = await buildFlatScript({
        input: path.join(rootDir, 'src/index.js'),
        output: isolatedScriptPath,
      });

      assert.ok(buildResult.code.length > 0);
      assert.ok(fs.existsSync(isolatedScriptPath));

      const sampleConfig = {
        rules: ['MATCH,🔰 节点选择'],
      };

      const output = await executeScriptWithBoa(buildResult.code, sampleConfig, 'test-profile');

      // 1. 验证 Sniffer 嗅探注入
      assert.ok(output.sniffer, 'output must contain sniffer');
      assert.strictEqual(output.sniffer.enable, true);
      assert.strictEqual(output.sniffer['parse-pure-ip'], true);
      assert.deepStrictEqual(output.sniffer.sniff.TLS.ports, [443, 8443]);
      assert.deepStrictEqual(output.sniffer.sniff.HTTP.ports, [80, '8080-8880']);

      // 2. 验证规范声明无悬挂 RULE-SET 引用 (No dangling RULE-SET in canonical policy-neutral build)
      assert.ok(Array.isArray(output.rules), 'output.rules must be an array');
      const hasDanglingRuleSet = output.rules.some((r) => r.startsWith('RULE-SET,'));
      assert.strictEqual(hasDanglingRuleSet, false, 'must not contain dangling RULE-SET in canonical config');

      // 3. 验证下游既有规则完整保留
      assert.ok(output.rules.includes('MATCH,🔰 节点选择'), 'existing downstream rule must be preserved');
      assert.strictEqual(output.rules[output.rules.length - 1], 'MATCH,🔰 节点选择');

      // 4. 验证地区预设已在构建期内联编译为 JS 数据
      assert.ok(buildResult.code.includes('"香港"'), 'contains compiled HK region name');
      assert.ok(buildResult.code.includes('"🇭🇰"'), 'contains compiled HK emoji');
      assert.ok(buildResult.code.includes('"日本"'), 'contains compiled JP region name');
      assert.ok(buildResult.code.includes('"美国"'), 'contains compiled US region name');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
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

      // 写入纯声明式规则项 (无未定义的 RULE-SET)
      fs.writeFileSync(
        directYamlPath,
        'rules:\n  - "DOMAIN-SUFFIX,custom-declarative-direct.internal,DIRECT"\n',
        'utf8'
      );
      fs.writeFileSync(
        rejectYamlPath,
        'rules:\n  - "DOMAIN-SUFFIX,ad-tracking-telemetry.blocked,REJECT"\n',
        'utf8'
      );

      // 2. 执行 Rollup Flat 扁平化构建到沙箱隔离输出路径
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

      // 4. 验证新声明式规则生效并保持正确优先级：Reject -> Direct -> Downstream
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
});
