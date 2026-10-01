import { injectSniffer } from './sniffer.js';
import { assembleRules } from './rules.js';

/**
 * 模块化配置装配核心引擎
 *
 * 接收原始订阅配置与构建期编译注入的声明式数据，
 * 纯函数执行配置增强并返回最终配置对象。
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

  // 1. 注入 Sniffer 纯 IP 嗅探配置
  config = injectSniffer(config);

  // 2. 组装确定性规则链
  config.rules = assembleRules(config.rules, declarativeData);

  return config;
}
