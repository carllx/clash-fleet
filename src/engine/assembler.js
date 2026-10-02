import { injectSniffer } from './sniffer.js';
import { assembleRules } from './rules.js';
import { deduplicateProxies } from './proxy-dedup.js';
import { assembleTopology } from './topology.js';

/**
 * 模块化配置装配核心引擎
 *
 * 接收原始订阅配置与构建期编译注入的声明式数据，
 * 纯函数执行配置增强并返回最终配置对象。
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
 * @returns {object} 装配增强后的配置对象
 */
export function assembleConfig(config, profileName, declarativeData) {
  if (!config || typeof config !== 'object') {
    config = {};
  }

  // 1. 保守语义等价去重 (守卫原始 proxy.name 与既有策略组引用完整性)
  if (Array.isArray(config.proxies)) {
    config.proxies = deduplicateProxies(config.proxies, config['proxy-groups']);
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
    var rawProxies = Array.isArray(config.proxies) ? config.proxies : [];
    config['proxy-groups'] = assembleTopology(rawProxies, regionPresets, config['proxy-groups']);
  }

  // 4. 注入 Sniffer 纯 IP 嗅探配置
  config = injectSniffer(config);

  // 5. 组装确定性规则链
  config.rules = assembleRules(config.rules, declarativeData);

  return config;
}
