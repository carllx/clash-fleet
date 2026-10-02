import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildFlatScript } from '../src/build/rollup-flat.js';
import { executeScriptWithBoa } from '../src/harness/boa-harness.js';

test('Complex sanitized fixture end-to-end Boa 0.22 verification suite', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-e2e-boa-'));
  const scriptPath = path.join(tempDir, 'Script.js');

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // 1. 构建主脚本 (Rollup Flat)
  await buildFlatScript({
    input: path.resolve('src/index.js'),
    output: scriptPath,
  });

  const scriptCode = fs.readFileSync(scriptPath, 'utf8');

  // 2. 构造复杂脱敏 Fixture
  // 覆盖需求矩阵：
  // - HK (多节点)
  // - JP
  // - US
  // - SG
  // - unmatched node
  // - 相同 server+port 但凭据不同 (uuid/password) -> 两者均保留
  // - 相同 server+port 但传输/TLS 不同 (ws vs grpc) -> 两者均保留
  // - 未知专有字段不同 -> 两者均保留
  // - 明确可证明的等价重复节点 -> 确定性安全去重 (仅保留一份)
  // - 声明了空地区 (TW, UK) -> 该地区 Tier 2 组不存在，且不出现在 Tier 1 / 1.5 引用中
  const complexFixtureProxies = [
    // HK 节点
    {
      name: '🇭🇰 HK | Hong Kong 01',
      type: 'ss',
      server: '198.51.100.1',
      port: 8388,
      cipher: 'aes-128-gcm',
      password: 'sanitized-secret-1',
    },
    // 相同 server+port 但凭据不同 (负向用例：必须同时保留)
    {
      name: '🇭🇰 HK | Hong Kong 02-diff-cred',
      type: 'ss',
      server: '198.51.100.1',
      port: 8388,
      cipher: 'aes-128-gcm',
      password: 'sanitized-secret-different',
    },
    // 相同 server+port 但传输/TLS 不同 (负向用例：必须同时保留)
    {
      name: '🇺🇸 US | Los Angeles WS',
      type: 'trojan',
      server: '198.51.100.2',
      port: 443,
      password: 'trojan-password',
      sni: 'us-la.example.org',
      network: 'ws',
      'ws-opts': { path: '/ws' },
    },
    {
      name: '🇺🇸 US | Los Angeles gRPC',
      type: 'trojan',
      server: '198.51.100.2',
      port: 443,
      password: 'trojan-password',
      sni: 'us-la.example.org',
      network: 'grpc',
      'grpc-opts': { 'grpc-service-name': 'trojan-grpc' },
    },
    // 未知/专有字段不同 (负向用例：必须同时保留)
    {
      name: '🇯🇵 JP | Tokyo 01',
      type: 'ss',
      server: '198.51.100.3',
      port: 8388,
      cipher: 'aes-256-gcm',
      password: 'pass',
      'x-vendor-custom-tag': 'route-A',
    },
    {
      name: '🇯🇵 JP | Tokyo 02',
      type: 'ss',
      server: '198.51.100.3',
      port: 8388,
      cipher: 'aes-256-gcm',
      password: 'pass',
      'x-vendor-custom-tag': 'route-B',
    },
    // SG 节点 (完全等价重复项，应当被安全去重仅保留首项)
    {
      name: '🇸🇬 SG | Singapore 01',
      type: 'ss',
      server: '198.51.100.4',
      port: 8388,
      cipher: 'chacha20-ietf-poly1305',
      password: 'pass-sg',
      udp: true,
    },
    {
      name: '🇸🇬 SG | Singapore 01-Exact-Duplicate',
      type: 'ss',
      server: '198.51.100.4',
      port: 8388,
      cipher: 'chacha20-ietf-poly1305',
      password: 'pass-sg',
      udp: true,
    },
    // 未匹配节点 (Unmatched)
    {
      name: 'Special Custom Tunnel Node',
      type: 'ss',
      server: '198.51.100.99',
      port: 9999,
      cipher: 'aes-128-gcm',
      password: 'pass-tunnel',
    },
  ];

  const initialConfig = {
    proxies: complexFixtureProxies,
    'proxy-groups': [
      {
        name: 'Manual Existing Group',
        type: 'select',
        proxies: ['Special Custom Tunnel Node'],
      },
    ],
    rules: ['MATCH,Manual Existing Group'],
  };

  // 3. 在真实 Boa 0.22 引擎中调用编译生成的单一 main(config, profileName)
  const result1 = await executeScriptWithBoa(
    scriptCode,
    initialConfig,
    'ComplexSanitizedProfile'
  );

  await t.test('preserves original physical proxy.name values exactly', () => {
    const proxyNames = result1.proxies.map((p) => p.name);
    assert.ok(proxyNames.includes('🇭🇰 HK | Hong Kong 01'));
    assert.ok(proxyNames.includes('🇭🇰 HK | Hong Kong 02-diff-cred'));
    assert.ok(proxyNames.includes('🇺🇸 US | Los Angeles WS'));
    assert.ok(proxyNames.includes('🇺🇸 US | Los Angeles gRPC'));
    assert.ok(proxyNames.includes('🇯🇵 JP | Tokyo 01'));
    assert.ok(proxyNames.includes('🇯🇵 JP | Tokyo 02'));
    assert.ok(proxyNames.includes('🇸🇬 SG | Singapore 01'));
    assert.ok(proxyNames.includes('Special Custom Tunnel Node'));
  });

  await t.test('conservative dedup preserves ambiguous nodes and dedupes provable exact duplicates', () => {
    // 原始 9 个节点中，SG 的第二个节点与首个完全等价，去重后应为 8 个
    assert.strictEqual(result1.proxies.length, 8);

    const proxyNames = result1.proxies.map((p) => p.name);
    // 凭据不同：两者保留
    assert.ok(proxyNames.includes('🇭🇰 HK | Hong Kong 01'));
    assert.ok(proxyNames.includes('🇭🇰 HK | Hong Kong 02-diff-cred'));

    // 传输/TLS 不同：两者保留
    assert.ok(proxyNames.includes('🇺🇸 US | Los Angeles WS'));
    assert.ok(proxyNames.includes('🇺🇸 US | Los Angeles gRPC'));

    // 未知属性不同：两者保留
    assert.ok(proxyNames.includes('🇯🇵 JP | Tokyo 01'));
    assert.ok(proxyNames.includes('🇯🇵 JP | Tokyo 02'));

    // 确证完全等价：首项保留，副本去重
    assert.ok(proxyNames.includes('🇸🇬 SG | Singapore 01'));
    assert.ok(!proxyNames.includes('🇸🇬 SG | Singapore 01-Exact-Duplicate'));
  });

  await t.test('Tier 2 empty-region pruning: empty declared regions (TW, UK) are absent', () => {
    const groupNames = result1['proxy-groups'].map((g) => g.name);

    // 存在的地区
    assert.ok(groupNames.includes('🇭🇰 香港'));
    assert.ok(groupNames.includes('🇯🇵 日本'));
    assert.ok(groupNames.includes('🇺🇸 美国'));
    assert.ok(groupNames.includes('🇸🇬 新加坡'));

    // 空地区必须被裁剪
    assert.ok(!groupNames.includes('🇹🇼 台湾'));
    assert.ok(!groupNames.includes('🇬🇧 英国'));
  });

  await t.test('Tier 1.5 Hard Invariant: contains ONLY Tier 2 group names, NO physical proxies', () => {
    const autoGroup = result1['proxy-groups'].find((g) => g.name === '🚀 自动优选');
    assert.ok(autoGroup);
    assert.strictEqual(autoGroup.type, 'url-test');

    const expectedTier2 = ['🇭🇰 香港', '🇯🇵 日本', '🇺🇸 美国', '🇸🇬 新加坡'];
    assert.deepStrictEqual(autoGroup.proxies, expectedTier2);

    // 严禁包含任何物理代理节点名称
    for (const proxy of result1.proxies) {
      assert.ok(!autoGroup.proxies.includes(proxy.name));
    }
  });

  await t.test('Tier 1 Business Intent references Tier 1.5 and Tier 2 without dangling references', () => {
    const tier1 = result1['proxy-groups'].find((g) => g.name === '🔰 节点选择');
    assert.ok(tier1);
    assert.strictEqual(tier1.type, 'select');

    assert.ok(tier1.proxies.includes('🚀 自动优选'));
    assert.ok(tier1.proxies.includes('🇭🇰 香港'));
    assert.ok(tier1.proxies.includes('🇯🇵 日本'));
    assert.ok(tier1.proxies.includes('🇺🇸 美国'));
    assert.ok(tier1.proxies.includes('🇸🇬 新加坡'));
    assert.ok(tier1.proxies.includes('DIRECT'));

    // 被裁剪的空地区绝不出现在 Tier 1
    assert.ok(!tier1.proxies.includes('🇹🇼 台湾'));
    assert.ok(!tier1.proxies.includes('🇬🇧 英国'));

    // 所有引用的目标均在有效范围内
    const allKnownNames = new Set([
      'DIRECT',
      'REJECT',
      ...result1['proxy-groups'].map((g) => g.name),
      ...result1.proxies.map((p) => p.name),
    ]);
    for (const ref of tier1.proxies) {
      assert.ok(allKnownNames.has(ref), `Dangling reference found in Tier 1: ${ref}`);
    }
  });

  await t.test('Referential Integrity: preserves pre-existing user groups and references', () => {
    const manualGroup = result1['proxy-groups'].find((g) => g.name === 'Manual Existing Group');
    assert.ok(manualGroup);
    assert.deepStrictEqual(manualGroup.proxies, ['Special Custom Tunnel Node']);
  });

  await t.test('Idempotency: passing output back into Boa main produces identical structure without duplicate groups', async () => {
    const result2 = await executeScriptWithBoa(
      scriptCode,
      result1,
      'ComplexSanitizedProfile'
    );

    assert.deepStrictEqual(result2.proxies, result1.proxies);
    assert.deepStrictEqual(result2['proxy-groups'], result1['proxy-groups']);
    assert.deepStrictEqual(result2.rules, result1.rules);

    // 断言 Fleet 组没有被重复追加
    const autoGroups = result2['proxy-groups'].filter((g) => g.name === '🚀 自动优选');
    assert.strictEqual(autoGroups.length, 1);

    const defaultGroups = result2['proxy-groups'].filter((g) => g.name === '🔰 节点选择');
    assert.strictEqual(defaultGroups.length, 1);
  });
});
