import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  loadRulesFile,
  loadRegionsFile,
  loadAllDeclarativeSources,
  parseRulesYaml,
  parseRegionsYaml,
} from '../src/loader/declarative.js';

describe('Declarative data loader suite (Build-time only)', () => {
  const rootDir = process.cwd();

  it('loads canonical direct.yaml and reject.yaml with expected schema', () => {
    const directPath = path.join(rootDir, 'src/rules/direct.yaml');
    const rejectPath = path.join(rootDir, 'src/rules/reject.yaml');

    const directRules = loadRulesFile(directPath);
    const rejectRules = loadRulesFile(rejectPath);

    assert.ok(Array.isArray(directRules), 'directRules must be an array');
    assert.ok(directRules.length > 0, 'direct.yaml must contain migrated public-safe direct rules');

    assert.ok(Array.isArray(rejectRules), 'rejectRules must be an array');
    assert.strictEqual(rejectRules.length, 0, 'canonical reject.yaml remains policy-neutral empty');
  });

  it('parses explicit rule declarations from YAML content (sanitized fixture)', () => {
    const fixtureYaml = `
rules:
  - "IP-CIDR,198.18.0.1/32,DIRECT"
  - "DOMAIN-SUFFIX,example.internal,DIRECT"
  - "DOMAIN-SUFFIX,ads.example.com,REJECT"
`;
    const parsed = parseRulesYaml(fixtureYaml, 'test-fixture');

    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed.length, 3);
    assert.ok(parsed.includes('IP-CIDR,198.18.0.1/32,DIRECT'));
    assert.ok(parsed.includes('DOMAIN-SUFFIX,example.internal,DIRECT'));
    assert.ok(parsed.includes('DOMAIN-SUFFIX,ads.example.com,REJECT'));
  });

  it('loads regions.yaml and compiles region presets for future engine use', () => {
    const regionsPath = path.join(rootDir, 'src/presets/regions.yaml');
    const regions = loadRegionsFile(regionsPath);

    assert.ok(typeof regions === 'object' && regions !== null, 'regions must be an object');
    assert.ok(regions.hk, 'must contain hk region');
    assert.strictEqual(regions.hk.name, '香港');
    assert.ok(regions.hk.pattern, 'must have regex pattern');
    assert.ok(regions.jp, 'must contain jp region');
    assert.ok(regions.us, 'must contain us region');
  });

  it('loadAllDeclarativeSources loads all canonical assets in one call', () => {
    const sources = loadAllDeclarativeSources({ rootDir: path.join(rootDir, 'src') });

    assert.ok(Array.isArray(sources.directRules));
    assert.ok(sources.directRules.length > 0);
    assert.ok(Array.isArray(sources.rejectRules));
    assert.ok(Array.isArray(sources.aiRules) && sources.aiRules.length > 0);
    assert.ok(Array.isArray(sources.mediaRules) && sources.mediaRules.length > 0);
    assert.ok(Array.isArray(sources.darwinRules) && sources.darwinRules.length > 0);
    assert.ok(Array.isArray(sources.win32Rules) && sources.win32Rules.length > 0);
    assert.ok(sources.regions.hk);
    assert.ok(Array.isArray(sources.ruleProviders));
    assert.strictEqual(sources.ruleProviders.length, 0, 'canonical rule-providers.yaml must be policy-neutral');
  });

  it('fails closed on non-existent file or invalid schema', () => {
    assert.throws(
      () => loadRulesFile(path.join(rootDir, 'src/rules/non-existent.yaml')),
      /File not found/
    );

    assert.throws(
      () => parseRulesYaml('invalid: true', 'invalid-yaml'),
      /Invalid rules schema/
    );

    // 验证非法地区正则 fail closed
    const invalidRegexYaml = `
regions:
  bad_region:
    name: "错误地区"
    pattern: "(unclosed_parenthesis["
`;
    assert.throws(
      () => parseRegionsYaml(invalidRegexYaml, 'invalid-regex-fixture'),
      /Invalid regex pattern in region 'bad_region'/
    );
  });
});
