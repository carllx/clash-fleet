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

      assert.strictEqual(result, config, 'mutates or returns config');
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

      assert.strictEqual(result.proxies, inputConfig.proxies);
      assert.strictEqual(result['proxy-groups'], inputConfig['proxy-groups']);
      assert.deepStrictEqual(result.rules, [
        'RULE-SET,reject,REJECT',
        'DOMAIN-SUFFIX,local,DIRECT',
        'MATCH,PROXY',
      ]);
    });
  });
});
