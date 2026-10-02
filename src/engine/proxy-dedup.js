/**
 * 保守语义等价去重与引用完整性守卫模块
 *
 * 核心原则：
 * 1. 严禁仅依赖 server + port 作为节点唯一身份标识；
 * 2. 只有当除 name 外的所有配置字段（包含协议、凭证、传输、TLS、复杂配置及未知字段）
 *    均被严格证明完全深度相等时，才视为语义等价；
 * 3. 任何字段不一致或未知属性差异，均作为不可去重的充分依据，保守保留全部节点；
 * 4. 引用完整性守卫 (Referential Integrity): 若移除某节点会导致既有策略组的
 *    name 引用悬空，必须无条件安全保留该节点。
 */

/**
 * 辅助函数：深度判断两值是否严格相等 (兼容 Boa 0.22 ES2019 沙箱)
 *
 * @param {*} valA 第一个值
 * @param {*} valB 第二个值
 * @returns {boolean} 是否深度相等
 */
function isDeepEqual(valA, valB) {
  if (valA === valB) {
    return true;
  }

  if (valA === null || valA === undefined || valB === null || valB === undefined) {
    return valA === valB;
  }

  var typeA = typeof valA;
  var typeB = typeof valB;

  if (typeA !== typeB) {
    return false;
  }

  if (typeA !== 'object') {
    return false;
  }

  var isArrA = Array.isArray(valA);
  var isArrB = Array.isArray(valB);

  if (isArrA !== isArrB) {
    return false;
  }

  if (isArrA) {
    if (valA.length !== valB.length) {
      return false;
    }
    for (var i = 0; i < valA.length; i++) {
      if (!isDeepEqual(valA[i], valB[i])) {
        return false;
      }
    }
    return true;
  }

  var keysA = Object.keys(valA);
  var keysB = Object.keys(valB);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (var k = 0; k < keysA.length; k++) {
    var key = keysA[k];
    if (!Object.prototype.hasOwnProperty.call(valB, key)) {
      return false;
    }
    if (!isDeepEqual(valA[key], valB[key])) {
      return false;
    }
  }

  return true;
}

/**
 * 保守断言两个物理代理节点是否具备完全相同的运行态语义 (除 name 外)
 *
 * @param {object} proxyA 第一个节点对象
 * @param {object} proxyB 第二个节点对象
 * @returns {boolean} 是否完全等价
 */
export function areProxiesEquivalent(proxyA, proxyB) {
  if (!proxyA || typeof proxyA !== 'object' || !proxyB || typeof proxyB !== 'object') {
    return false;
  }

  // 基础身份字段快速比对
  if (proxyA.server !== proxyB.server || proxyA.port !== proxyB.port || proxyA.type !== proxyB.type) {
    return false;
  }

  // 收集除 'name' 外所有字段名
  var keysA = Object.keys(proxyA);
  var keysB = Object.keys(proxyB);

  var allKeysMap = {};
  for (var i = 0; i < keysA.length; i++) {
    if (keysA[i] !== 'name') {
      allKeysMap[keysA[i]] = true;
    }
  }
  for (var j = 0; j < keysB.length; j++) {
    if (keysB[j] !== 'name') {
      allKeysMap[keysB[j]] = true;
    }
  }

  var allKeys = Object.keys(allKeysMap);
  for (var k = 0; k < allKeys.length; k++) {
    var keyName = allKeys[k];
    var hasA = Object.prototype.hasOwnProperty.call(proxyA, keyName);
    var hasB = Object.prototype.hasOwnProperty.call(proxyB, keyName);

    // 任一方缺失某个配置属性，表明配置不完全一致，保守判定不等价
    if (hasA !== hasB) {
      return false;
    }

    // 属性值深度比对，任何未知或特有属性差异均导致判定不等价
    if (!isDeepEqual(proxyA[keyName], proxyB[keyName])) {
      return false;
    }
  }

  return true;
}

/**
 * 收集已有策略组中直接引用的所有 proxy name 集合
 *
 * @param {Array} existingProxyGroups 现有策略组列表
 * @returns {object} 名字字典映射
 */
function collectReferencedNames(existingProxyGroups) {
  var referenced = {};
  if (!Array.isArray(existingProxyGroups)) {
    return referenced;
  }

  for (var i = 0; i < existingProxyGroups.length; i++) {
    var group = existingProxyGroups[i];
    if (group && Array.isArray(group.proxies)) {
      for (var j = 0; j < group.proxies.length; j++) {
        var refName = group.proxies[j];
        if (typeof refName === 'string') {
          referenced[refName] = true;
        }
      }
    }
  }

  return referenced;
}

/**
 * 对节点列表执行保守语义等价去重，同时守卫既有策略组的引用完整性
 *
 * @param {Array} proxies 待清洗的代理节点列表
 * @param {Array} [existingProxyGroups] 既有策略组列表（用于守卫引用完整性）
 * @returns {Array} 清洗与去重后的代理节点列表
 */
export function deduplicateProxies(proxies, existingProxyGroups) {
  if (!Array.isArray(proxies)) {
    return [];
  }

  var referencedNames = collectReferencedNames(existingProxyGroups);
  var preserved = [];

  for (var i = 0; i < proxies.length; i++) {
    var current = proxies[i];
    if (!current || typeof current !== 'object') {
      continue;
    }

    // 守卫引用完整性：若该节点名称被外部既有策略组显式引用，坚决保留
    var isReferenced = current.name && referencedNames[current.name] === true;
    if (isReferenced) {
      preserved.push(current);
      continue;
    }

    // 检查是否与已保留的节点中存在完全语义等价项
    var hasDuplicate = false;
    for (var j = 0; j < preserved.length; j++) {
      if (areProxiesEquivalent(current, preserved[j])) {
        hasDuplicate = true;
        break;
      }
    }

    // 仅在完全无法证明等价时安全保留；确证等价且无外部专属引用时安全去重
    if (!hasDuplicate) {
      preserved.push(current);
    }
  }

  return preserved;
}
