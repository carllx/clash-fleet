import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleTopology } from '../src/engine/topology.js';

var regionPresets = {
  hk: { name: '香港', emoji: '🇭🇰', pattern: 'HK' },
  jp: { name: '日本', emoji: '🇯🇵', pattern: 'JP' },
  us: { name: '美国', emoji: '🇺🇸', pattern: 'US' },
  sg: { name: '新加坡', emoji: '🇸🇬', pattern: 'SG' },
  uk: { name: '英国', emoji: '🇬🇧', pattern: 'UK' },
  tw: { name: '台湾', emoji: '🇹🇼', pattern: 'TW' },
};

test('Tier 1 Business Intent topology suite', async (t) => {
  await t.test('assembles 🤖 AI 服务 with US/JP/SG pools and HK fallback when available', () => {
    var proxies = [
      { name: 'HK-01', type: 'ss' },
      { name: 'JP-01', type: 'ss' },
      { name: 'US-01', type: 'ss' },
      { name: 'SG-01', type: 'ss' },
    ];

    var groups = assembleTopology(proxies, regionPresets, []);
    var aiGroup = groups.find((g) => g.name === '🤖 AI 服务');

    assert.ok(aiGroup, 'Tier 1 🤖 AI 服务 should exist');
    assert.equal(aiGroup.type, 'select');
    // US, JP, SG preferred, then HK fallback
    assert.deepEqual(aiGroup.proxies, ['🇺🇸 美国', '🇯🇵 日本', '🇸🇬 新加坡', '🇭🇰 香港']);
  });

  await t.test('🤖 AI 服务 dynamically prunes missing regions without dangling references', () => {
    var proxies = [
      { name: 'HK-01', type: 'ss' },
      { name: 'JP-01', type: 'ss' },
    ];

    var groups = assembleTopology(proxies, regionPresets, []);
    var aiGroup = groups.find((g) => g.name === '🤖 AI 服务');

    assert.ok(aiGroup);
    // US and SG are pruned, JP and HK remain
    assert.deepEqual(aiGroup.proxies, ['🇯🇵 日本', '🇭🇰 香港']);
    assert.ok(!aiGroup.proxies.includes('🇺🇸 美国'), 'Must not reference pruned US group');
    assert.ok(!aiGroup.proxies.includes('🇸🇬 新加坡'), 'Must not reference pruned SG group');
  });

  await t.test('🤖 AI 服务 fails closed to REJECT when zero regions exist (no silent fail-open to DIRECT)', () => {
    var proxies = [
      { name: 'Unknown-Node', type: 'ss' },
    ];

    var groups = assembleTopology(proxies, regionPresets, []);
    var aiGroup = groups.find((g) => g.name === '🤖 AI 服务');

    assert.ok(aiGroup);
    assert.deepEqual(aiGroup.proxies, ['REJECT'], 'Must fail closed to REJECT to prevent credential leak');
  });

  await t.test('assembles 🎵 媒体服务 preferring non-HK regions and falls back to HK only if no non-HK regions exist', () => {
    var proxiesWithNonHK = [
      { name: 'HK-01', type: 'ss' },
      { name: 'JP-01', type: 'ss' },
      { name: 'SG-01', type: 'ss' },
    ];

    var groups = assembleTopology(proxiesWithNonHK, regionPresets, []);
    var mediaGroup = groups.find((g) => g.name === '🎵 媒体服务');

    assert.ok(mediaGroup, 'Tier 1 🎵 媒体服务 should exist');
    assert.equal(mediaGroup.type, 'select');
    // Excludes HK when non-HK regions exist
    assert.deepEqual(mediaGroup.proxies, ['🇯🇵 日本', '🇸🇬 新加坡']);

    // When ONLY HK exists, falls back to HK
    var proxiesOnlyHK = [
      { name: 'HK-01', type: 'ss' },
    ];
    var groupsOnlyHK = assembleTopology(proxiesOnlyHK, regionPresets, []);
    var mediaOnlyHK = groupsOnlyHK.find((g) => g.name === '🎵 媒体服务');
    assert.deepEqual(mediaOnlyHK.proxies, ['🇭🇰 香港']);

    // When zero regions exist, falls back to DIRECT
    var groupsZero = assembleTopology([], regionPresets, []);
    var mediaZero = groupsZero.find((g) => g.name === '🎵 媒体服务');
    assert.deepEqual(mediaZero.proxies, ['DIRECT']);
  });

  await t.test('idempotency and referential integrity: preserving user groups and multiple passes', () => {
    var proxies = [
      { name: 'HK-01', type: 'ss' },
      { name: 'JP-01', type: 'ss' },
    ];
    var userGroup = {
      name: 'Custom-Group',
      type: 'select',
      proxies: ['DIRECT', '🤖 AI 服务', '🇺🇸 美国'], // 包含被裁剪的美国组
    };

    var pass1 = assembleTopology(proxies, regionPresets, [userGroup]);
    var customInPass1 = pass1.find((g) => g.name === 'Custom-Group');
    assert.ok(customInPass1);
    assert.deepEqual(customInPass1.proxies, ['DIRECT', '🤖 AI 服务'], 'Pruned US group reference must be cleaned');

    var pass2 = assembleTopology(proxies, regionPresets, pass1);
    var pass3 = assembleTopology(proxies, regionPresets, pass2);
    assert.deepEqual(pass2, pass3, 'Multiple passes must produce identical groups');
  });

  await t.test('🤖 AI 服务 fails closed to REJECT when only unsupported regions (e.g. UK, TW) exist', () => {
    var proxiesOnlyUK = [
      { name: 'UK-01', type: 'ss' },
      { name: 'TW-01', type: 'ss' },
    ];
    var groups = assembleTopology(proxiesOnlyUK, regionPresets, []);
    var aiGroup = groups.find((g) => g.name === '🤖 AI 服务');
    assert.ok(aiGroup);
    assert.deepEqual(aiGroup.proxies, ['REJECT'], 'Must fail closed to REJECT to prevent UK 403 / geographic violation');
  });

  await t.test('Tier 1.5 omission cleanses autoSelectGroupName from user groups to prevent dangling references', () => {
    var proxiesOnlyHK = [
      { name: 'HK-01', type: 'ss' },
    ];
    var userGroup = {
      name: 'User-Selected-Group',
      type: 'select',
      proxies: ['DIRECT', '🚀 自动优选', '🇭🇰 香港'],
    };
    var groups = assembleTopology(proxiesOnlyHK, regionPresets, [userGroup]);
    var custom = groups.find((g) => g.name === 'User-Selected-Group');
    assert.ok(custom);
    assert.deepEqual(custom.proxies, ['DIRECT', '🇭🇰 香港'], '🚀 自动优选 must be cleanly pruned from user groups when omitted');
  });
});

