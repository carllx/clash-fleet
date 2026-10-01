/**
 * 规则装配流水线模块
 *
 * 负责依据 Clash Fleet 优先级规范组装最终规则链条：
 * Reject 广告拦截规则 -> Direct 直连白名单规则 -> 下游既有规则 (Existing Rules)
 */

/**
 * 辅助函数：按序追加数组元素
 *
 * @param {string[]} target 目标数组
 * @param {string[]} source 源数组
 */
function appendItems(target, source) {
  for (var i = 0; i < source.length; i++) {
    target.push(source[i]);
  }
}

/**
 * 确定性组装分流规则链
 *
 * @param {string[]|null|undefined} existingRules 订阅或既有配置中的规则
 * @param {object} declarativeRules 声明式规则包
 * @param {string[]} declarativeRules.rejectRules 声明式拦截规则
 * @param {string[]} declarativeRules.directRules 声明式直连规则
 * @returns {string[]} 组装完成的规则链列表
 */
export function assembleRules(existingRules, declarativeRules) {
  var rejectList = (declarativeRules && declarativeRules.rejectRules) || [];
  var directList = (declarativeRules && declarativeRules.directRules) || [];
  var downstreamList = Array.isArray(existingRules) ? existingRules : [];

  var result = [];

  // 1. 前置拦截规则 (广告拦截优先于直连白名单，防止穿透)
  appendItems(result, rejectList);

  // 2. 自定义直连规则
  appendItems(result, directList);

  // 3. 原配置下游既有规则 (保留原顺序)
  appendItems(result, downstreamList);

  return result;
}
