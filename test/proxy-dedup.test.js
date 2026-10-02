import test from 'node:test';
import assert from 'node:assert/strict';
import { areProxiesEquivalent, deduplicateProxies } from '../src/engine/proxy-dedup.js';

test('Conservative equivalence and deduplication suite', async (t) => {
  await t.test('same server and port but different credentials are BOTH preserved', () => {
    var proxyA = {
      name: 'HK-01',
      type: 'vmess',
      server: '1.2.3.4',
      port: 443,
      uuid: 'uuid-1',
      alterId: 0,
      cipher: 'auto',
    };
    var proxyB = {
      name: 'HK-02',
      type: 'vmess',
      server: '1.2.3.4',
      port: 443,
      uuid: 'uuid-2',
      alterId: 0,
      cipher: 'auto',
    };

    assert.equal(areProxiesEquivalent(proxyA, proxyB), false);
    var deduped = deduplicateProxies([proxyA, proxyB]);
    assert.equal(deduped.length, 2);
    assert.deepEqual(deduped, [proxyA, proxyB]);
  });

  await t.test('same server and port but different transport/TLS/SNI are BOTH preserved', () => {
    var proxyA = {
      name: 'US-01',
      type: 'trojan',
      server: 'example.com',
      port: 443,
      password: 'pass',
      sni: 'sni1.example.com',
      network: 'ws',
      'ws-opts': { path: '/ws' },
    };
    var proxyB = {
      name: 'US-02',
      type: 'trojan',
      server: 'example.com',
      port: 443,
      password: 'pass',
      sni: 'sni2.example.com',
      network: 'grpc',
      'grpc-opts': { 'grpc-service-name': 'grpc-svc' },
    };

    assert.equal(areProxiesEquivalent(proxyA, proxyB), false);
    var deduped = deduplicateProxies([proxyA, proxyB]);
    assert.equal(deduped.length, 2);
  });

  await t.test('unknown or protocol-specific field differs causes BOTH to be preserved', () => {
    var proxyA = {
      name: 'JP-01',
      type: 'ss',
      server: '5.6.7.8',
      port: 8388,
      cipher: 'aes-128-gcm',
      password: 'secret-password',
      'custom-proprietary-field': 'value-A',
    };
    var proxyB = {
      name: 'JP-02',
      type: 'ss',
      server: '5.6.7.8',
      port: 8388,
      cipher: 'aes-128-gcm',
      password: 'secret-password',
      'custom-proprietary-field': 'value-B',
    };

    assert.equal(areProxiesEquivalent(proxyA, proxyB), false);
    var deduped = deduplicateProxies([proxyA, proxyB]);
    assert.equal(deduped.length, 2);
  });

  await t.test('clearly provable exact-equivalent duplicate is safely deduplicated', () => {
    var proxyA = {
      name: 'SG-01',
      type: 'ss',
      server: '9.9.9.9',
      port: 8388,
      cipher: 'chacha20-ietf-poly1305',
      password: 'pass',
      udp: true,
    };
    var proxyB = {
      name: 'SG-01-dup',
      type: 'ss',
      server: '9.9.9.9',
      port: 8388,
      cipher: 'chacha20-ietf-poly1305',
      password: 'pass',
      udp: true,
    };

    assert.equal(areProxiesEquivalent(proxyA, proxyB), true);
    var deduped = deduplicateProxies([proxyA, proxyB]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].name, 'SG-01');
  });

  await t.test('Referential Integrity: duplicate is preserved if referenced by existing proxy-groups', () => {
    var proxyA = {
      name: 'HK-A',
      type: 'ss',
      server: '1.1.1.1',
      port: 8080,
      cipher: 'aes-256-gcm',
      password: 'pwd',
    };
    var proxyB = {
      name: 'HK-B',
      type: 'ss',
      server: '1.1.1.1',
      port: 8080,
      cipher: 'aes-256-gcm',
      password: 'pwd',
    };

    // 虽然 proxyA 与 proxyB 语义完全等价，但既有策略组显式引用了 HK-B
    var existingGroups = [
      {
        name: 'Custom Group',
        type: 'select',
        proxies: ['HK-B'],
      },
    ];

    var deduped = deduplicateProxies([proxyA, proxyB], existingGroups);
    // 为守卫引用完整性，HK-B 必须保留，不能因去重导致 Custom Group 悬空
    assert.equal(deduped.length, 2);
  });
});
