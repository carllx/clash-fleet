import { injectSniffer } from './sniffer.js';
import { assembleRules } from './rules.js';
import { deduplicateProxies } from './proxy-dedup.js';
import { assembleTopology } from './topology.js';

/**
 * 模块化配置装配核心引擎
 *
 * 接收原始订阅配置与构建期编译注入的声明式数据，
 * 纯函数执行配置增强并返回全新的配置对象 (Non-destructive / Copy-on-Write)，
 * 严格保证调用方传入的原始配置对象不受任何原地修改。
 *
 * 执行流水线：
 * config.proxies
 * -> safe proxy inspection
 * -> conservative equivalence handling
 * -> derived normalized labels & region classification
 * -> Tier 2 Region Pools
 * -> optional Tier 1.5 Scheduling
 * -> Tier 1 Business Intent
 * -> deterministic config.proxy-groups
 * -> inject sniffer
 * -> assemble rules
 *
 * @param {object|null|undefined} config 原始配置对象
 * @param {string} profileName 配置文件名称
 * @param {object} declarativeData 声明式数据资产 (含 directRules, rejectRules, regions 等)
 * @returns {object} 装配增强后的全新配置对象
 */
export function assembleConfig(config, profileName, declarativeData) {
  var working = {};
  if (config && typeof config === 'object') {
    var keys = Object.keys(config);
    for (var i = 0; i < keys.length; i++) {
      working[keys[i]] = config[keys[i]];
    }
  }

  // 1. 保守语义等价去重 (守卫原始 proxy.name 与既有策略组引用完整性)
  if (Array.isArray(working.proxies)) {
    working.proxies = deduplicateProxies(working.proxies, working['proxy-groups']);
  }

  // 2. 提取地区声明字典
  var regionPresets = null;
  if (declarativeData && declarativeData.regions) {
    if (declarativeData.regions.regions && typeof declarativeData.regions.regions === 'object') {
      regionPresets = declarativeData.regions.regions;
    } else if (typeof declarativeData.regions === 'object') {
      regionPresets = declarativeData.regions;
    }
  }

  // 3. 装配三级分层策略组拓扑 (Tier 1 -> Tier 1.5 -> Tier 2)
  if (regionPresets) {
    var rawProxies = Array.isArray(working.proxies) ? working.proxies : [];
    working['proxy-groups'] = assembleTopology(rawProxies, regionPresets, working['proxy-groups']);
  }

  // 4. 注入 Sniffer 纯 IP 嗅探配置
  working = injectSniffer(working);

  // 5. 组装确定性规则链
  working.rules = assembleRules(working.rules, declarativeData);

  // 6. 挂载 Rule Providers (仅当声明式配置存在且非空时挂载，且绝不引入悬空 RULE-SET)
  if (declarativeData && Array.isArray(declarativeData.ruleProviders) && declarativeData.ruleProviders.length > 0) {
    var existingProviders = {};
    if (working['rule-providers'] && typeof working['rule-providers'] === 'object') {
      var pKeys = Object.keys(working['rule-providers']);
      for (var k = 0; k < pKeys.length; k++) {
        existingProviders[pKeys[k]] = working['rule-providers'][pKeys[k]];
      }
    }
    for (var j = 0; j < declarativeData.ruleProviders.length; j++) {
      var p = declarativeData.ruleProviders[j];
      var providerDef = {
        type: 'http',
        behavior: p.behavior,
        url: p.url,
        path: p.path,
        format: p.format,
      };
      if (typeof p.interval === 'number') {
        providerDef.interval = p.interval;
      }
      existingProviders[p.id] = providerDef;
    }
    working['rule-providers'] = existingProviders;
  }

  return working;
}

