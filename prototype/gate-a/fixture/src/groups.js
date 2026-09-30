/**
 * 策略组构建器模块
 */
import { filterProxiesByRegion } from './rules.js';
import { ensureArray } from './utils.js';

const REGION_GROUP_SPECS = [
  { key: 'HK', name: '🇭🇰 香港', icon: '🇭🇰' },
  { key: 'SG', name: '🇸🇬 新加坡', icon: '🇸🇬' },
  { key: 'US', name: '🇺🇸 美国', icon: '🇺🇸' },
];

/**
 * 构建地区 url-test 策略组列表
 * @param {Array<any>} proxies
 * @returns {Array<object>}
 */
export function buildRegionalGroups(proxies) {
  const safeProxies = ensureArray(proxies);
  const groups = [];

  for (const spec of REGION_GROUP_SPECS) {
    const matchedNames = filterProxiesByRegion(safeProxies, spec.key);
    if (matchedNames.length > 0) {
      groups.push({
        name: spec.name,
        type: 'url-test',
        url: 'https://cp.cloudflare.com/generate_204',
        interval: 300,
        tolerance: 50,
        proxies: matchedNames,
      });
    }
  }

  return groups;
}

/**
 * 构建 Tier 1 意图层策略组
 * @param {Array<string>} regionalGroupNames
 * @returns {Array<object>}
 */
export function buildTier1Groups(regionalGroupNames) {
  const selectProxies = ['🚀 自动优选', ...regionalGroupNames, 'DIRECT'];
  const autoProxies = [...regionalGroupNames];

  return [
    {
      name: '🔰 节点选择',
      type: 'select',
      proxies: selectProxies,
    },
    {
      name: '🚀 自动优选',
      type: 'url-test',
      url: 'https://cp.cloudflare.com/generate_204',
      interval: 300,
      proxies: autoProxies,
    },
  ];
}
