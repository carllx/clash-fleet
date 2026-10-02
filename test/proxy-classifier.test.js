import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProxyName,
  classifyProxy,
  classifyProxies,
} from '../src/engine/proxy-classifier.js';

test('Proxy normalization and derived classification suite', async (t) => {
  var regionPresets = {
    hk: {
      name: '香港',
      emoji: '🇭🇰',
      pattern: '(🇭🇰|香港|Hong\\s*Kong|HongKong|(^|[^a-zA-Z])HK([^a-zA-Z]|$))',
    },
    jp: {
      name: '日本',
      emoji: '🇯🇵',
      pattern: '(🇯🇵|日本|Japan|Tokyo|Osaka|Saitama|Nagoya|(^|[^a-zA-Z])(JP|JPN)([^a-zA-Z]|$))',
    },
    us: {
      name: '美国',
      emoji: '🇺🇸',
      pattern: '(🇺🇸|美国|United\\s*States|America|Los\\s*Angeles|San\\s*Jose|Silicon\\s*Valley|Portland|Seattle|New\\s*York|(^|[^a-zA-Z])(US|USA)([^a-zA-Z]|$))',
    },
  };

  await t.test('preserves original proxy.name exactly and does not mutate it', () => {
    var rawProxy = {
      name: '🇭🇰 HK | 香港 01 - 专线',
      type: 'ss',
      server: '1.2.3.4',
      port: 10001,
    };
    var originalName = rawProxy.name;

    var region = classifyProxy(rawProxy, regionPresets);
    assert.equal(region, 'hk');
    assert.equal(rawProxy.name, originalName);
  });

  await t.test('normalizeProxyName normalizes for matching without affecting original names', () => {
    var label1 = normalizeProxyName('  🇭🇰  HK_01 [Vless]  ');
    assert.ok(typeof label1 === 'string');
    assert.ok(label1.includes('HK_01'));
  });

  await t.test('classifyProxies handles varied naming formats and preserves unclassified proxies', () => {
    var proxies = [
      { name: '🇭🇰 HK | 香港 01', type: 'ss' },
      { name: '🇯🇵 东京 Vless IEPL 01', type: 'vless' },
      { name: 'US Silicon Valley 02', type: 'trojan' },
      { name: 'Unmatched Custom Node 99', type: 'ss' },
    ];

    var result = classifyProxies(proxies, regionPresets);

    assert.equal(result.buckets.hk.length, 1);
    assert.equal(result.buckets.hk[0].name, '🇭🇰 HK | 香港 01');

    assert.equal(result.buckets.jp.length, 1);
    assert.equal(result.buckets.jp[0].name, '🇯🇵 东京 Vless IEPL 01');

    assert.equal(result.buckets.us.length, 1);
    assert.equal(result.buckets.us[0].name, 'US Silicon Valley 02');

    assert.equal(result.unclassified.length, 1);
    assert.equal(result.unclassified[0].name, 'Unmatched Custom Node 99');
  });

  await t.test('handles missing or invalid proxy names gracefully without crashing', () => {
    var malformedProxies = [
      null,
      undefined,
      {},
      { name: null },
      { name: 12345 },
      { name: '' },
    ];

    var result = classifyProxies(malformedProxies, regionPresets);
    assert.ok(result);
    assert.equal(result.buckets.hk.length, 0);
    assert.equal(result.buckets.jp.length, 0);
  });
});
