import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRuleProvidersYaml,
  generateProvenanceManifest,
  STATUS_NO_EXTERNAL,
  STATUS_FULLY_PINNED,
  STATUS_CONTAINS_DYNAMIC,
  CLASSIFICATION_PINNED,
  CLASSIFICATION_DYNAMIC,
  ROLLBACK_SEMANTICS_PINNED,
  ROLLBACK_SEMANTICS_DYNAMIC,
} from '../src/loader/rule-providers.js';

describe('Rule Provider declarative schema & provenance suite', () => {
  it('parses canonical empty providers registry', () => {
    const yaml = 'providers: []\n';
    const parsed = parseRuleProvidersYaml(yaml, 'canonical-test');
    assert.deepEqual(parsed, []);
  });

  it('parses valid pinned provider and preserves immutable revision', () => {
    const fullSha = 'a1b2c3d4e5f67890123456789abcdef012345678';
    const yaml = `
providers:
  - id: test-pinned-provider
    behavior: domain
    format: yaml
    url: "https://raw.githubusercontent.com/example/rules/${fullSha}/test.yaml"
    source:
      strategy: pinned
      revision:
        kind: git-commit
        value: "${fullSha}"
`;
    const parsed = parseRuleProvidersYaml(yaml, 'pinned-test');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'test-pinned-provider');
    assert.equal(parsed[0].behavior, 'domain');
    assert.equal(parsed[0].source.strategy, 'pinned');
    assert.deepEqual(parsed[0].source.revision, {
      kind: 'git-commit',
      value: fullSha,
    });
  });

  it('parses valid dynamic external dependency provider', () => {
    const yaml = `
providers:
  - id: test-dynamic-provider
    behavior: ipcidr
    format: yaml
    url: "https://raw.githubusercontent.com/example/rules/main/test.yaml"
    interval: 86400
    source:
      strategy: dynamic
`;
    const parsed = parseRuleProvidersYaml(yaml, 'dynamic-test');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'test-dynamic-provider');
    assert.equal(parsed[0].behavior, 'ipcidr');
    assert.equal(parsed[0].source.strategy, 'dynamic');
  });

  it('fails closed on duplicate provider ids', () => {
    const yaml = `
providers:
  - id: duplicate-id
    behavior: domain
    url: "https://example.com/rule1.yaml"
    source:
      strategy: dynamic
  - id: duplicate-id
    behavior: domain
    url: "https://example.com/rule2.yaml"
    source:
      strategy: dynamic
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'dup-test'),
      /Duplicate rule-provider id 'duplicate-id'/
    );
  });

  it('fails closed on unknown source strategy', () => {
    const yaml = `
providers:
  - id: test-unknown
    behavior: domain
    url: "https://example.com/rule.yaml"
    source:
      strategy: floating-tag
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'strategy-test'),
      /Unknown source.strategy 'floating-tag'/
    );
  });

  it('fails closed on pinned provider without immutable revision identity', () => {
    const yaml = `
providers:
  - id: test-pinned-no-rev
    behavior: domain
    url: "https://example.com/rule.yaml"
    source:
      strategy: pinned
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'no-rev-test'),
      /Pinned provider 'test-pinned-no-rev' must declare immutable 'revision'/
    );
  });

  it('fails closed when pinned provider has empty or whitespace revision', () => {
    const yaml = `
providers:
  - id: test-pinned-empty-rev
    behavior: domain
    url: "https://example.com/rule.yaml"
    source:
      strategy: pinned
      revision: "   "
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'empty-rev-test'),
      /Pinned provider 'test-pinned-empty-rev' must declare immutable 'revision'/
    );
  });

  it('fails closed when pinned provider specifies revision as main or master', () => {
    const yaml = `
providers:
  - id: test-pinned-main
    behavior: domain
    url: "https://raw.githubusercontent.com/example/rules/main/test.yaml"
    source:
      strategy: pinned
      revision: main
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'main-test'),
      /cannot be a mutable branch or floating identifier/i
    );
  });

  it('fails closed when pinned provider specifies revision as HEAD or latest', () => {
    const yaml = `
providers:
  - id: test-pinned-head
    behavior: domain
    url: "https://raw.githubusercontent.com/example/rules/HEAD/test.yaml"
    source:
      strategy: pinned
      revision:
        kind: git-commit
        value: HEAD
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'head-test'),
      /cannot be a mutable branch or floating identifier/i
    );
  });

  it('fails closed when pinned git-commit has short or malformed SHA', () => {
    const yaml = `
providers:
  - id: test-pinned-short-sha
    behavior: domain
    url: "https://raw.githubusercontent.com/example/rules/abc1234/test.yaml"
    source:
      strategy: pinned
      revision:
        kind: git-commit
        value: "abc1234"
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'short-sha-test'),
      /requires a full 40-character commit SHA/i
    );
  });

  it('fails closed when pinned metadata says commit SHA but effective runtime locator is mutable branch URL', () => {
    const fullSha = '0123456789abcdef0123456789abcdef01234567';
    const yaml = `
providers:
  - id: test-contradiction
    behavior: domain
    url: "https://raw.githubusercontent.com/example/rules/main/test.yaml"
    source:
      strategy: pinned
      revision:
        kind: git-commit
        value: "${fullSha}"
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'contradiction-test'),
      /Locator URL contradicts immutable pinned identity/i
    );
  });

  it('fails closed when release download locator contains floating latest path', () => {
    const yaml = `
providers:
  - id: test-floating-release
    behavior: domain
    url: "https://github.com/example/rules/releases/latest/download/rules.yaml"
    source:
      strategy: pinned
      revision:
        kind: release-asset
        value: "v1.0.0"
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'floating-release-test'),
      /Locator URL contradicts immutable pinned identity/i
    );
  });

  it('fails closed when release-asset value is latest or floating branch', () => {
    const yaml = `
providers:
  - id: test-bad-release-val
    behavior: domain
    url: "https://github.com/example/rules/releases/download/v1.0.0/rules.yaml"
    source:
      strategy: pinned
      revision:
        kind: release-asset
        value: "latest"
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'bad-release-val'),
      /cannot be a mutable branch or floating identifier/i
    );
  });

  it('parses valid pinned git-commit provider with full SHA and matching locator', () => {
    const fullSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    const yaml = `
providers:
  - id: test-pinned-git
    behavior: domain
    format: yaml
    url: "https://raw.githubusercontent.com/example/rules/${fullSha}/test.yaml"
    source:
      strategy: pinned
      revision:
        kind: git-commit
        value: "${fullSha}"
`;
    const parsed = parseRuleProvidersYaml(yaml, 'git-test');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'test-pinned-git');
    assert.deepEqual(parsed[0].source.revision, {
      kind: 'git-commit',
      value: fullSha,
    });
  });

  it('parses valid pinned release-asset provider with fixed version tag and matching locator', () => {
    const yaml = `
providers:
  - id: test-pinned-release
    behavior: domain
    format: yaml
    url: "https://github.com/example/rules/releases/download/v1.2.3/rules.yaml"
    source:
      strategy: pinned
      revision:
        kind: release-asset
        value: "v1.2.3"
`;
    const parsed = parseRuleProvidersYaml(yaml, 'release-test');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'test-pinned-release');
    assert.deepEqual(parsed[0].source.revision, {
      kind: 'release-asset',
      value: 'v1.2.3',
    });
  });

  it('parses valid dynamic main-branch provider with explicit partial rollback semantics', () => {
    const yaml = `
providers:
  - id: test-dynamic-main
    behavior: classical
    url: "https://raw.githubusercontent.com/example/rules/main/rules.yaml"
    source:
      strategy: dynamic
`;
    const parsed = parseRuleProvidersYaml(yaml, 'dynamic-main-test');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'test-dynamic-main');
    assert.equal(parsed[0].source.strategy, 'dynamic');
  });

  it('fails closed on missing source URL', () => {
    const yaml = `
providers:
  - id: test-no-url
    behavior: domain
    source:
      strategy: dynamic
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'no-url-test'),
      /Provider 'test-no-url' must specify a valid 'url'/
    );
  });

  it('fails closed on invalid behavior', () => {
    const yaml = `
providers:
  - id: test-bad-behavior
    behavior: invalid-behavior
    url: "https://example.com/rule.yaml"
    source:
      strategy: dynamic
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'bad-behavior-test'),
      /Invalid behavior 'invalid-behavior' in provider 'test-bad-behavior'/
    );
  });

  it('fails closed when dynamic provider falsely claims reproducibility', () => {
    const yaml = `
providers:
  - id: test-falsely-reproducible
    behavior: domain
    url: "https://example.com/rule.yaml"
    source:
      strategy: dynamic
      reproducible: true
`;
    assert.throws(
      () => parseRuleProvidersYaml(yaml, 'false-claim-test'),
      /Dynamic provider 'test-falsely-reproducible' cannot claim reproducibility/
    );
  });

  it('generates deterministic manifest for canonical empty registry', () => {
    const manifest = generateProvenanceManifest([]);
    assert.equal(manifest.status, STATUS_NO_EXTERNAL);
    assert.equal(manifest.summary.total_providers, 0);
    assert.equal(manifest.summary.pinned_providers, 0);
    assert.equal(manifest.summary.dynamic_providers, 0);
    assert.deepEqual(manifest.providers, []);
  });

  it('generates fully pinned provenance manifest and guarantees sorted order', () => {
    const providers = [
      {
        id: 'z-provider',
        behavior: 'domain',
        format: 'yaml',
        url: 'https://example.com/rules/z/v2.0.0/z.yaml',
        source: {
          strategy: 'pinned',
          revision: { kind: 'release-asset', value: 'v2.0.0' },
        },
      },
      {
        id: 'a-provider',
        behavior: 'ipcidr',
        format: 'yaml',
        url: 'https://example.com/rules/a/0123456789abcdef0123456789abcdef01234567/a.yaml',
        source: {
          strategy: 'pinned',
          revision: { kind: 'git-commit', value: '0123456789abcdef0123456789abcdef01234567' },
        },
      },
    ];

    const manifest = generateProvenanceManifest(providers);
    assert.equal(manifest.status, STATUS_FULLY_PINNED);
    assert.equal(manifest.summary.total_providers, 2);
    assert.equal(manifest.summary.pinned_providers, 2);
    assert.equal(manifest.summary.dynamic_providers, 0);

    // 验证严格字典序
    assert.equal(manifest.providers[0].id, 'a-provider');
    assert.equal(manifest.providers[0].classification, CLASSIFICATION_PINNED);
    assert.deepEqual(manifest.providers[0].revision, {
      kind: 'git-commit',
      value: '0123456789abcdef0123456789abcdef01234567',
    });
    assert.equal(manifest.providers[0].rollback_semantics, ROLLBACK_SEMANTICS_PINNED);

    assert.equal(manifest.providers[1].id, 'z-provider');
    assert.equal(manifest.providers[1].classification, CLASSIFICATION_PINNED);
    assert.deepEqual(manifest.providers[1].revision, {
      kind: 'release-asset',
      value: 'v2.0.0',
    });
  });

  it('generates dynamic provenance manifest with explicit partial rollback semantics', () => {
    const providers = [
      {
        id: 'dyn-provider',
        behavior: 'classical',
        format: 'yaml',
        url: 'https://example.com/latest.yaml',
        interval: 86400,
        source: { strategy: 'dynamic' },
      },
      {
        id: 'pin-provider',
        behavior: 'domain',
        format: 'yaml',
        url: 'https://example.com/releases/download/v1.0.0/fixed.yaml',
        source: {
          strategy: 'pinned',
          revision: { kind: 'release-asset', value: 'v1.0.0' },
        },
      },
    ];

    const manifest = generateProvenanceManifest(providers);
    assert.equal(manifest.status, STATUS_CONTAINS_DYNAMIC);
    assert.equal(manifest.summary.total_providers, 2);
    assert.equal(manifest.summary.pinned_providers, 1);
    assert.equal(manifest.summary.dynamic_providers, 1);

    const dynEntry = manifest.providers.find((p) => p.id === 'dyn-provider');
    assert.ok(dynEntry);
    assert.equal(dynEntry.classification, CLASSIFICATION_DYNAMIC);
    assert.equal(dynEntry.rollback_semantics, ROLLBACK_SEMANTICS_DYNAMIC);
    assert.equal(dynEntry.revision, null);
  });
});
