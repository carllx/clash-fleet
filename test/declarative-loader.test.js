import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  loadRulesFile,
  loadRegionsFile,
  loadAllDeclarativeSources,
} from '../src/loader/declarative.js';

describe('Declarative data loader suite (Build-time only)', () => {
  const rootDir = process.cwd();

  it('loads direct.yaml and parses explicit rule declarations', () => {
    const directPath = path.join(rootDir, 'src/rules/direct.yaml');
    const directRules = loadRulesFile(directPath);

    assert.ok(Array.isArray(directRules), 'directRules must be an array');
    assert.ok(directRules.length >= 2, 'directRules should have entries');
    assert.ok(
      directRules.includes('IP-CIDR,198.18.0.1/32,DIRECT'),
      'includes primary CIDR'
    );
    assert.ok(
      directRules.includes('DOMAIN-SUFFIX,internal,DIRECT'),
      'includes domain suffix'
    );
  });

  it('loads reject.yaml and parses reject rule declarations', () => {
    const rejectPath = path.join(rootDir, 'src/rules/reject.yaml');
    const rejectRules = loadRulesFile(rejectPath);

    assert.ok(Array.isArray(rejectRules), 'rejectRules must be an array');
    assert.ok(
      rejectRules.includes('RULE-SET,reject,REJECT'),
      'includes reject rule-set declaration'
    );
    assert.ok(
      rejectRules.includes('DOMAIN-SUFFIX,ads.example.com,REJECT'),
      'includes ad domain rule'
    );
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

  it('loadAllDeclarativeSources loads all required sources in one call', () => {
    const sources = loadAllDeclarativeSources({ rootDir: path.join(rootDir, 'src') });

    assert.ok(sources.directRules.length > 0);
    assert.ok(sources.rejectRules.length > 0);
    assert.ok(sources.regions.hk);
  });

  it('fails closed on non-existent file or invalid schema', () => {
    assert.throws(
      () => loadRulesFile(path.join(rootDir, 'src/rules/non-existent.yaml')),
      /File not found/
    );
  });
});
