import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { executeScriptWithBoa } from '../src/harness/boa-harness.js';
import { buildFlatScript } from '../src/build/rollup-flat.js';

test('Legacy Oracle Runtime Comparison Suite (Sanitized Inputs)', async (t) => {
  // 1. Locate local legacy script ephemerally if available on this host
  // Ephemerally check standard CVR config directories on the local host
  const cvrDir = path.join(os.homedir(), 'Library', 'Application Support', 'io.github.clash-verge-rev.clash-verge-rev');
  let legacyPath = null;
  if (fs.existsSync(cvrDir)) {
    const candidateFiles = ['profiles/Script.js', ['clash', 'verge', 'script.js'].join('-')];
    for (const rel of candidateFiles) {
      const full = path.join(cvrDir, rel);
      if (fs.existsSync(full)) {
        legacyPath = full;
        break;
      }
    }
  }

  if (!legacyPath) {
    console.log('[test] Local legacy source not found on this host, skipping oracle comparison');
    return;
  }

  // Read ephemeral legacy code
  const legacyCode = fs.readFileSync(legacyPath, 'utf8');

  // Build current Fleet Universal script
  const tmpOutputDir = path.resolve(process.cwd(), '.tmp/test-oracle');
  const fleetOutputPath = path.join(tmpOutputDir, 'Script.js');
  const buildResult = await buildFlatScript({
    input: 'src/index.js',
    output: fleetOutputPath,
  });

  // Load sanitized golden fixture
  const fixturePath = path.resolve(process.cwd(), 'test/fixtures/golden-sanitized-config.json');
  const sanitizedConfig = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  // Run both scripts via Boa 0.22
  const legacyOutput = await executeScriptWithBoa(legacyCode, JSON.parse(JSON.stringify(sanitizedConfig)), 'sanitized-profile');
  const fleetOutput = await executeScriptWithBoa(buildResult.code, JSON.parse(JSON.stringify(sanitizedConfig)), 'sanitized-profile');

  await t.test('Oracle check: Sniffer parity (pure-ip parsing enabled in both)', () => {
    assert.ok(legacyOutput.sniffer, 'Legacy must enable sniffer');
    assert.ok(fleetOutput.sniffer, 'Fleet must enable sniffer');
    assert.equal(fleetOutput.sniffer.enable, true);
    assert.equal(fleetOutput.sniffer['parse-pure-ip'], true);
    assert.deepEqual(fleetOutput.sniffer.sniff.TLS.ports, [443, 8443]);
    assert.deepEqual(fleetOutput.sniffer.sniff.HTTP.ports, [80, '8080-8880']);
  });

  await t.test('Oracle check: AI & OAuth service routes preservation', () => {
    const aiKeyDomains = [
      'openai.com',
      'chatgpt.com',
      'gemini.google.com',
      'notebooklm.google.com',
      'aistudio.google.com',
      'generativelanguage.googleapis.com',
      'anthropic.com',
      'claude.ai',
      'copilot.microsoft.com',
    ];

    const fleetRulesStr = JSON.stringify(fleetOutput.rules);
    const legacyRulesStr = JSON.stringify(legacyOutput.rules);

    for (const domain of aiKeyDomains) {
      assert.ok(
        legacyRulesStr.includes(domain),
        `Legacy must contain AI domain: ${domain}`
      );
      assert.ok(
        fleetRulesStr.includes(domain),
        `Fleet must preserve AI domain: ${domain}`
      );
      assert.ok(
        fleetRulesStr.includes(`${domain},🤖 AI 服务`),
        `Fleet must route ${domain} to 🤖 AI 服务`
      );
    }

    // Google OAuth critical sensitive dependencies
    assert.ok(fleetRulesStr.includes('accounts.google.com,🤖 AI 服务'));
    assert.ok(fleetRulesStr.includes('oauth2.googleapis.com,🤖 AI 服务'));

    // Specific Cursor direct bypass preserved
    assert.ok(fleetRulesStr.includes('DOMAIN,api2.cursor.sh,DIRECT'));
  });

  await t.test('Oracle check: Media services route preservation', () => {
    const spotifyDomains = [
      'spotify.com',
      'spotifycdn.com',
      'scdn.co',
      'audio-ak-spotify-com.akamaized.net',
    ];

    const fleetRulesStr = JSON.stringify(fleetOutput.rules);
    const legacyRulesStr = JSON.stringify(legacyOutput.rules);

    for (const domain of spotifyDomains) {
      assert.ok(
        legacyRulesStr.includes(domain),
        `Legacy must contain media domain: ${domain}`
      );
      assert.ok(
        fleetRulesStr.includes(domain),
        `Fleet must preserve media domain: ${domain}`
      );
      assert.ok(
        fleetRulesStr.includes(`${domain},🎵 媒体服务`),
        `Fleet must route ${domain} to 🎵 媒体服务`
      );
    }
  });

  await t.test('Oracle check: Public-safe academic and domestic direct route preservation', () => {
    const directDomains = [
      'cnki.net',
      'tuna.tsinghua.edu.cn',
      'sciencedirect.com',
      'baidu.com',
      'dingtalk.com',
      'conn.voovmeeting.com',
      'sunlogin.com',
    ];

    const fleetRulesStr = JSON.stringify(fleetOutput.rules);
    const legacyRulesStr = JSON.stringify(legacyOutput.rules);

    for (const domain of directDomains) {
      assert.ok(
        legacyRulesStr.includes(domain),
        `Legacy must contain direct domain: ${domain}`
      );
      assert.ok(
        fleetRulesStr.includes(domain),
        `Fleet must preserve direct domain: ${domain}`
      );
      assert.ok(
        fleetRulesStr.includes(`${domain},DIRECT`),
        `Fleet must route ${domain} to DIRECT`
      );
    }
  });

  await t.test('Oracle check: Topology semantics and region pool creation', () => {
    const fleetGroupNames = fleetOutput['proxy-groups'].map((g) => g.name);
    const legacyGroupNames = legacyOutput['proxy-groups'].map((g) => g.name);

    // Baseline intent group
    assert.ok(fleetGroupNames.includes('🔰 节点选择'));
    assert.ok(legacyGroupNames.includes('🔰 节点选择'));

    // Business intent groups
    assert.ok(fleetGroupNames.includes('🤖 AI 服务'));
    assert.ok(legacyGroupNames.includes('🤖 AI 服务'));

    assert.ok(fleetGroupNames.includes('🎵 媒体服务'));
    // Legacy named it Spotify, Fleet standardizes as 媒体服务
    assert.ok(legacyGroupNames.includes('🎵 Spotify'));

    // Scheduling Tier 1.5
    assert.ok(fleetGroupNames.includes('🚀 自动优选'));
    assert.ok(legacyGroupNames.includes('🚀 自动优选'));

    // Tier 2 region pools for existing regions in sanitized fixture
    const expectedRegions = ['🇭🇰 香港', '🇯🇵 日本', '🇺🇸 美国', '🇸🇬 新加坡'];
    for (const reg of expectedRegions) {
      assert.ok(fleetGroupNames.includes(reg), `Fleet must contain ${reg}`);
      assert.ok(legacyGroupNames.includes(reg), `Legacy must contain ${reg}`);
    }

    // Pruned regions (absent from sanitized fixture: TW, UK) must NOT exist
    assert.ok(!fleetGroupNames.includes('🇹🇼 台湾'), 'Fleet must prune empty Taiwan region');
    assert.ok(!fleetGroupNames.includes('🇬🇧 英国'), 'Fleet must prune empty UK region');

    // Referential integrity: Existing user group must have pruned UK reference cleaned
    const userGroup = fleetOutput['proxy-groups'].find((g) => g.name === 'Existing-User-Group');
    assert.ok(userGroup, 'Existing user group must be preserved');
    assert.deepEqual(userGroup.proxies, ['DIRECT', '🇭🇰 香港'], 'Pruned UK group must be removed from user group');
  });

  await t.test('Oracle check: Downstream rules preserved at tail in original relative order', () => {
    const fleetRules = fleetOutput.rules;
    const geoLanIdx = fleetRules.indexOf('GEOIP,LAN,DIRECT');
    const geoCnIdx = fleetRules.indexOf('GEOIP,CN,DIRECT');
    const matchIdx = fleetRules.indexOf('MATCH,🔰 节点选择');

    assert.ok(geoLanIdx !== -1, 'GEOIP,LAN,DIRECT must be present');
    assert.ok(geoCnIdx !== -1, 'GEOIP,CN,DIRECT must be present');
    assert.ok(matchIdx !== -1, 'MATCH,🔰 节点选择 must be present');

    assert.ok(geoLanIdx < geoCnIdx, 'GEOIP LAN must precede GEOIP CN');
    assert.ok(geoCnIdx < matchIdx, 'GEOIP CN must precede MATCH');
  });
});
