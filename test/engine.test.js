import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { injectSniffer, DEFAULT_SNIFFER_CONFIG } from '../src/engine/sniffer.js';
import { assembleRules } from '../src/engine/rules.js';
import { assembleConfig } from '../src/engine/assembler.js';

describe('Modular assembly engine suite (Pure JS)', () => {
  describe('injectSniffer', () => {
    it('injects default sniffer configuration with parse-pure-ip enabled', () => {
      const config = {};
      const result = injectSniffer(config);

      assert.notStrictEqual(result, config, 'returns cloned config to preserve pure contract');
      assert.strictEqual(config.sniffer, undefined, 'does not mutate original argument');
      assert.ok(result.sniffer, 'sniffer field must exist');
      assert.strictEqual(result.sniffer.enable, true);
      assert.strictEqual(result.sniffer['parse-pure-ip'], true);
      assert.deepStrictEqual(result.sniffer.sniff.TLS.ports, [443, 8443]);
      assert.deepStrictEqual(result.sniffer.sniff.HTTP.ports, [80, '8080-8880']);
    });

    it('safely merges with existing sniffer fields without losing settings', () => {
      const config = {
        sniffer: {
          'force-dns-mapping': true,
          sniff: {
            QUIC: { ports: [443] },
          },
        },
      };
      const result = injectSniffer(config);

      assert.strictEqual(result.sniffer.enable, true);
      assert.strictEqual(result.sniffer['parse-pure-ip'], true);
      assert.strictEqual(result.sniffer['force-dns-mapping'], true);
      assert.deepStrictEqual(result.sniffer.sniff.QUIC, { ports: [443] });
      assert.deepStrictEqual(result.sniffer.sniff.TLS.ports, [443, 8443]);
      assert.deepStrictEqual(result.sniffer.sniff.HTTP.ports, [80, '8080-8880']);
    });

    it('does not touch CVR authoritative fields like tun, dns, or port', () => {
      const config = {
        tun: { enable: true, stack: 'mixed' },
        dns: { enable: true, nameserver: ['1.1.1.1'] },
        port: 7890,
      };
      const result = injectSniffer(config);

      assert.deepStrictEqual(result.tun, { enable: true, stack: 'mixed' });
      assert.deepStrictEqual(result.dns, { enable: true, nameserver: ['1.1.1.1'] });
      assert.strictEqual(result.port, 7890);
    });
  });

  describe('assembleRules', () => {
    const declarativeRules = {
      rejectRules: ['RULE-SET,reject,REJECT', 'DOMAIN-SUFFIX,ads.com,REJECT'],
      directRules: ['IP-CIDR,198.18.0.1/32,DIRECT', 'DOMAIN-SUFFIX,corp.internal,DIRECT'],
    };

    it('assembles rules in deterministic order: reject -> direct -> existing rules', () => {
      const existingRules = ['MATCH,🔰 节点选择'];
      const combined = assembleRules(existingRules, declarativeRules);

      assert.deepStrictEqual(combined, [
        'RULE-SET,reject,REJECT',
        'DOMAIN-SUFFIX,ads.com,REJECT',
        'IP-CIDR,198.18.0.1/32,DIRECT',
        'DOMAIN-SUFFIX,corp.internal,DIRECT',
        'MATCH,🔰 节点选择',
      ]);
    });

    it('handles undefined or null existing rules safely', () => {
      const combinedFromNull = assembleRules(null, declarativeRules);
      const combinedFromUndefined = assembleRules(undefined, declarativeRules);

      const expected = [
        'RULE-SET,reject,REJECT',
        'DOMAIN-SUFFIX,ads.com,REJECT',
        'IP-CIDR,198.18.0.1/32,DIRECT',
        'DOMAIN-SUFFIX,corp.internal,DIRECT',
      ];
      assert.deepStrictEqual(combinedFromNull, expected);
      assert.deepStrictEqual(combinedFromUndefined, expected);
    });
  });

  describe('assembleConfig pipeline', () => {
    const declarativeData = {
      rejectRules: ['RULE-SET,reject,REJECT'],
      directRules: ['DOMAIN-SUFFIX,local,DIRECT'],
      regions: { hk: { name: '香港', pattern: 'HK' } },
    };

    it('safely handles null/undefined config and produces enhanced valid config', () => {
      const result = assembleConfig(null, 'test-profile', declarativeData);

      assert.ok(typeof result === 'object' && result !== null);
      assert.strictEqual(result.sniffer.enable, true);
      assert.strictEqual(result.sniffer['parse-pure-ip'], true);
      assert.deepStrictEqual(result.rules, [
        'RULE-SET,reject,REJECT',
        'DOMAIN-SUFFIX,local,DIRECT',
      ]);
    });

    it('preserves existing unrelated configuration fields and rule ordering', () => {
      const inputConfig = {
        proxies: [{ name: 'Node 1', type: 'ss', server: '1.2.3.4', port: 8388 }],
        'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: ['Node 1'] }],
        rules: ['MATCH,PROXY'],
      };

      const result = assembleConfig(inputConfig, 'test-profile', declarativeData);

      assert.deepStrictEqual(result.proxies, inputConfig.proxies);
      assert.ok(Array.isArray(result['proxy-groups']));
      // 验证保留了非 Fleet 拥有的用户自定义组 PROXY
      const preservedUserGroup = result['proxy-groups'].find((g) => g.name === 'PROXY');
      assert.ok(preservedUserGroup);
      assert.deepStrictEqual(preservedUserGroup.proxies, ['Node 1']);
      // 验证生成了基线意图组
      const defaultTier1 = result['proxy-groups'].find((g) => g.name === '🔰 节点选择');
      assert.ok(defaultTier1);
      assert.deepStrictEqual(result.rules, [
        'RULE-SET,reject,REJECT',
        'DOMAIN-SUFFIX,local,DIRECT',
        'MATCH,PROXY',
      ]);
    });

    it('assembleConfig must not mutate caller input (pure / non-destructive contract)', () => {
      const input = {
        port: 7890,
        proxies: [
          { name: 'HK-1', type: 'ss', server: '1.1.1.1', port: 8388, cipher: 'aes-128-gcm', password: 'pwd' },
          { name: 'HK-1-dup', type: 'ss', server: '1.1.1.1', port: 8388, cipher: 'aes-128-gcm', password: 'pwd' },
        ],
        'proxy-groups': [{ name: 'UserGroup', type: 'select', proxies: ['DIRECT'] }],
        rules: ['MATCH,UserGroup'],
      };

      const originalSnapshot = JSON.parse(JSON.stringify(input));
      const result = assembleConfig(input, 'test-profile', declarativeData);

      // 输入对象不可变性守卫
      assert.deepStrictEqual(input, originalSnapshot, 'caller input must not be mutated');
      assert.notStrictEqual(result, input, 'result must be a new enhanced config');

      // 验证增强结果包含去重、拓扑组装并保留无关配置
      assert.strictEqual(result.proxies.length, 1);
      assert.strictEqual(result.proxies[0].name, 'HK-1');
      assert.ok(Array.isArray(result['proxy-groups']));
      assert.ok(result['proxy-groups'].some((g) => g.name === '🔰 节点选择'));
      assert.ok(result['proxy-groups'].some((g) => g.name === 'UserGroup'));
      assert.strictEqual(result.port, 7890);
    });

    it('safely mounts rule-providers when declared without introducing dangling RULE-SET', () => {
      const declarativeWithProviders = {
        ...declarativeData,
        ruleProviders: [
          {
            id: 'test-direct-provider',
            behavior: 'domain',
            format: 'yaml',
            path: './rule_providers/test-direct-provider.yaml',
            url: 'https://example.com/direct.yaml',
            interval: 86400,
            source: { strategy: 'dynamic' },
          },
        ],
      };

      const input = { rules: ['MATCH,DIRECT'] };
      const originalInput = JSON.parse(JSON.stringify(input));
      const result = assembleConfig(input, 'test-profile', declarativeWithProviders);

      assert.deepStrictEqual(input, originalInput, 'caller input must not be mutated');
      assert.ok(result['rule-providers']);
      assert.ok(result['rule-providers']['test-direct-provider']);
      assert.equal(result['rule-providers']['test-direct-provider'].type, 'http');
      assert.equal(result['rule-providers']['test-direct-provider'].behavior, 'domain');
      assert.equal(result['rule-providers']['test-direct-provider'].url, 'https://example.com/direct.yaml');
      assert.equal(result['rule-providers']['test-direct-provider'].interval, 86400);

      // 验证未引入任何悬空的 RULE-SET 规则
      const hasDanglingRuleSet = result.rules.some((r) => r.startsWith('RULE-SET,test-direct-provider'));
      assert.strictEqual(hasDanglingRuleSet, false, 'must not introduce dangling RULE-SET references in Issue #4');
    });
  });
});
