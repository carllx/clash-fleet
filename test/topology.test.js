import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleTopology } from '../src/engine/topology.js';

test('Policy topology assembly suite (Three-Tier Policy Topology)', async (t) => {
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
    tw: {
      name: '台湾',
      emoji: '🇹🇼',
      pattern: '(🇹🇼|台湾|Taiwan|Taipei|Taichung|(^|[^a-zA-Z])TW([^a-zA-Z]|$))',
    },
  };

  await t.test('builds Tier 2 Region Pools binding real proxy.name and prunes empty regions', () => {
    var proxies = [
      { name: '🇭🇰 HK-01', type: 'ss' },
      { name: '🇯🇵 JP-01', type: 'ss' },
      // 注意：没有 us 和 tw 节点
    ];

    var groups = assembleTopology(proxies, regionPresets, []);

    // 应该生成 HK 与 JP 的 Tier 2 组，但绝不能生成 US 和 TW 的空组
    var tier2HK = groups.find((g) => g.name === '🇭🇰 香港');
    var tier2JP = groups.find((g) => g.name === '🇯🇵 日本');
    var tier2US = groups.find((g) => g.name === '🇺🇸 美国');
    var tier2TW = groups.find((g) => g.name === '🇹🇼 台湾');

    assert.ok(tier2HK, 'Tier 2 HK should exist');
    assert.deepEqual(tier2HK.proxies, ['🇭🇰 HK-01']);
    assert.equal(tier2HK.type, 'url-test');

    assert.ok(tier2JP, 'Tier 2 JP should exist');
    assert.deepEqual(tier2JP.proxies, ['🇯🇵 JP-01']);

    assert.equal(tier2US, undefined, 'Empty region US must be pruned');
    assert.equal(tier2TW, undefined, 'Empty region TW must be pruned');
  });

  await t.test('Tier 1.5 Hard Invariant: references ONLY Tier 2 group names, never physical proxies', () => {
    var proxies = [
      { name: '🇭🇰 HK-01', type: 'ss' },
      { name: '🇯🇵 JP-01', type: 'ss' },
    ];

    var groups = assembleTopology(proxies, regionPresets, []);
    var tier15 = groups.find((g) => g.name === '🚀 自动优选');

    assert.ok(tier15, 'Tier 1.5 🚀 自动优选 should exist');
    assert.equal(tier15.type, 'fallback');
    assert.deepEqual(tier15.proxies, ['🇭🇰 香港', '🇯🇵 日本']);

    // 严格检查：不能包含任何物理节点名称
    for (var i = 0; i < tier15.proxies.length; i++) {
      var ref = tier15.proxies[i];
      assert.notEqual(ref, '🇭🇰 HK-01');
      assert.notEqual(ref, '🇯🇵 JP-01');
    }
  });

  await t.test('collapses Tier 1.5 when zero valid Tier 2 regions exist', () => {
    var proxies = [
      { name: 'Unmatched-Node-01', type: 'ss' },
    ];

    var groups = assembleTopology(proxies, regionPresets, []);
    var tier15 = groups.find((g) => g.name === '🚀 自动优选');
    assert.equal(tier15, undefined, 'Tier 1.5 should be collapsed when no Tier 2 groups exist');

    var tier1 = groups.find((g) => g.name === '🔰 节点选择');
    assert.ok(tier1, 'Tier 1 default group should still exist');
    // Tier 1 此时不应有悬空引用
    assert.ok(!tier1.proxies.includes('🚀 自动优选'));
    assert.ok(!tier1.proxies.includes('🇭🇰 香港'));
  });

  await t.test('Tier 1 Business Intent references Tier 1.5 and Tier 2 without dangling references', () => {
    var proxies = [
      { name: '🇭🇰 HK-01', type: 'ss' },
      { name: '🇯🇵 JP-01', type: 'ss' },
    ];

    var groups = assembleTopology(proxies, regionPresets, []);
    var tier1 = groups.find((g) => g.name === '🔰 节点选择');

    assert.ok(tier1);
    assert.equal(tier1.type, 'select');
    // 包含 🚀 自动优选, 🇭🇰 香港, 🇯🇵 日本, DIRECT 等
    assert.ok(tier1.proxies.includes('🚀 自动优选'));
    assert.ok(tier1.proxies.includes('🇭🇰 香港'));
    assert.ok(tier1.proxies.includes('🇯🇵 日本'));
    assert.ok(!tier1.proxies.includes('🇺🇸 美国'), 'Must not reference pruned region');
  });

  await t.test('idempotency: multiple passes produce stable groups and preserve unrelated user groups with cleaned references', () => {
    var proxies = [{ name: '🇭🇰 HK-01', type: 'ss' }];
    var userGroup = {
      name: 'My Custom Manual Group',
      type: 'select',
      proxies: ['DIRECT', '🇹🇼 台湾'], // 包含一个在本次运行中被裁剪的空地区
    };

    var pass1 = assembleTopology(proxies, regionPresets, [userGroup]);
    var pass2 = assembleTopology(proxies, regionPresets, pass1);

    // 运行两次应完全一致
    assert.deepEqual(pass1, pass2);

    // 用户自定义组必须得到保留，且悬空引用 '🇹🇼 台湾' 被清洗
    var preservedUserGroup = pass2.find((g) => g.name === 'My Custom Manual Group');
    assert.ok(preservedUserGroup);
    assert.deepEqual(preservedUserGroup.proxies, ['DIRECT']);

    // Fleet 拥有的组不能重复出现
    var autoGroups = pass2.filter((g) => g.name === '🚀 自动优选');
    assert.equal(autoGroups.length, 1);
  });
});
