/**
 * Clash Verge Rev 扩展脚本入口 (Entry)
 * 组合 rules、groups 与 utils 模块
 */
import { buildRegionalGroups, buildTier1Groups } from './groups.js';
import { deepClone, ensureArray } from './utils.js';

/**
 * 最终暴露给 Clash Verge Rev 的 main 入口
 * @param {object} rawConfig
 * @param {string} profileName
 * @returns {object}
 */
export function main(rawConfig, profileName) {
  const config = deepClone(rawConfig || {});
  const proxies = ensureArray(config.proxies);

  const regionalGroups = buildRegionalGroups(proxies);
  const regionalGroupNames = regionalGroups.map((g) => g.name);

  const tier1Groups = buildTier1Groups(regionalGroupNames);

  const existingGroups = ensureArray(config['proxy-groups']);

  config['proxy-groups'] = [...tier1Groups, ...regionalGroups, ...existingGroups];

  config['__fleet_meta'] = {
    profile: profileName,
    processed: true,
    regionalGroupCount: regionalGroups.length,
  };

  return config;
}
