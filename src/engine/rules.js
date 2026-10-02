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
 * 优先级顺序：
 * 1. Reject 拦截规则 (广告拦截优先于所有其他规则，防止穿透)
 * 2. 业务敏感 AI 与 OAuth 依赖规则 (优先于进程规则与通用直连，防止敏感 AI/OAuth 流量被更早的 PROCESS DIRECT 意外截获)
 * 3. 跨平台进程规则 (darwin + win32 进程规则共存于 Universal 规则链)
 * 4. 媒体服务规则 (如 Spotify)
 * 5. 自定义直连规则 (如学术镜像、公共服务白名单)
 * 6. 原配置下游既有规则 (保留原顺序)
 *
 * @param {string[]|null|undefined} existingRules 订阅或既有配置中的规则
 * @param {object} declarativeRules 声明式规则包
 * @param {string[]} [declarativeRules.rejectRules] 声明式拦截规则
 * @param {string[]} [declarativeRules.darwinRules] macOS 专有进程规则
 * @param {string[]} [declarativeRules.win32Rules] Windows 专有进程规则
 * @param {string[]} [declarativeRules.aiRules] AI/OAuth 敏感路由规则
 * @param {string[]} [declarativeRules.mediaRules] 媒体服务路由规则
 * @param {string[]} [declarativeRules.directRules] 声明式直连规则
 * @returns {string[]} 组装完成的规则链列表
 */
export function assembleRules(existingRules, declarativeRules) {
  var rejectList = (declarativeRules && declarativeRules.rejectRules) || [];
  var darwinList = (declarativeRules && declarativeRules.darwinRules) || [];
  var win32List = (declarativeRules && declarativeRules.win32Rules) || [];
  var aiList = (declarativeRules && declarativeRules.aiRules) || [];
  var mediaList = (declarativeRules && declarativeRules.mediaRules) || [];
  var directList = (declarativeRules && declarativeRules.directRules) || [];
  var rawDownstream = Array.isArray(existingRules) ? existingRules : [];

  // 构建 Fleet 规则索引，用于多次装配时清洗已存在的 Fleet 声明式规则，确保幂等性
  var fleetRulesMap = {};
  var allFleetLists = [rejectList, darwinList, win32List, aiList, mediaList, directList];
  for (var f = 0; f < allFleetLists.length; f++) {
    var subList = allFleetLists[f];
    for (var si = 0; si < subList.length; si++) {
      fleetRulesMap[subList[si]] = true;
    }
  }

  var downstreamList = [];
  for (var d = 0; d < rawDownstream.length; d++) {
    var ruleEntry = rawDownstream[d];
    if (!fleetRulesMap[ruleEntry]) {
      downstreamList.push(ruleEntry);
    }
  }

  var result = [];

  // 1. 前置拦截规则 (广告拦截优先于所有其他规则，防止穿透)
  appendItems(result, rejectList);

  // 2. 业务敏感 AI 与 OAuth 依赖规则 (优先于平台进程规则与通用直连，防止敏感 AI/OAuth 流量被更早的 PROCESS DIRECT 意外截获)
  appendItems(result, aiList);

  // 3. 跨平台进程规则 (darwin + win32 共同注入 Universal 规则链)
  appendItems(result, darwinList);
  appendItems(result, win32List);

  // 4. 媒体服务规则
  appendItems(result, mediaList);

  // 5. 自定义直连规则
  appendItems(result, directList);

  // 6. 原配置下游既有规则 (保留原顺序)
  appendItems(result, downstreamList);

  return result;
}
