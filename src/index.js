/**
 * Clash Fleet 主脚本入口 (Modular Entrypoint)
 *
 * 作为 Rollup Flat 打包的入口模块，该模块导出 CVR 规范的 main 函数。
 * 打包后自动剥离 export 声明，并在全局暴露原生顶层 function main(config, profileName)。
 */

/**
 * Clash Verge Rev 扩展脚本主处理函数
 *
 * @param {object} config 订阅传入的原始配置对象
 * @param {string} profileName 订阅名称
 * @returns {object} 处理后的配置对象
 */
export function main(config, profileName) {
  config = config || {};
  return config;
}
