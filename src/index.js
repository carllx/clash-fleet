import directRules from './rules/direct.yaml';
import rejectRules from './rules/reject.yaml';
import regions from './presets/regions.yaml';
import { assembleConfig } from './engine/assembler.js';

/**
 * Clash Fleet 主脚本入口 (Modular Entrypoint)
 *
 * 在构建期通过 Rollup Flat 打包，声明式 YAML 被内联为纯 JavaScript 数据，
 * 最终剥离 export 声明并在全局暴露原生顶层 function main(config, profileName)。
 */

/**
 * 编译期内联的声明式数据资产
 */
const DECLARATIVE_DATA = {
  directRules: directRules,
  rejectRules: rejectRules,
  regions: regions,
};

/**
 * Clash Verge Rev 扩展脚本主处理函数
 *
 * @param {object} config 订阅传入的原始配置对象
 * @param {string} profileName 订阅名称
 * @returns {object} 处理后的配置对象
 */
export function main(config, profileName) {
  return assembleConfig(config, profileName, DECLARATIVE_DATA);
}
