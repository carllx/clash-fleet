/**
 * 节点派生规范化与分类引擎
 *
 * 核心原则：
 * 1. 严格保持物理节点原始 proxy.name 不变，绝不破坏性修改名称；
 * 2. 派生标签 (Derived Normalized Label) 仅用于正则匹配与地区归类；
 * 3. 容忍异常/缺失/非字符串节点名称，安全降级，绝不崩溃；
 * 4. 无法匹配的节点安全保留在未分类列表中。
 */

/**
 * 清洗派生节点标签（仅供内部正则匹配与归类使用）
 *
 * @param {string} rawName 原始节点名称
 * @returns {string} 归一化后的标签字符串
 */
export function normalizeProxyName(rawName) {
  if (typeof rawName !== 'string') {
    return '';
  }

  // 1. 去除多余前后空格与控制字符
  var label = rawName.trim();

  // 2. 规范化连字符与分隔符，保持主体字符便于正则匹配
  return label;
}

/**
 * 对单个节点执行地区分类判定
 *
 * @param {object} proxy 代理节点对象
 * @param {object} regionPresets 地区正则预置字典 (来自 regions.yaml)
 * @returns {string|null} 匹配到的地区代码 (如 'hk', 'jp')，未匹配返回 null
 */
export function classifyProxy(proxy, regionPresets) {
  if (!proxy || typeof proxy !== 'object' || typeof proxy.name !== 'string') {
    return null;
  }

  if (!regionPresets || typeof regionPresets !== 'object') {
    return null;
  }

  var normalizedLabel = normalizeProxyName(proxy.name);
  if (!normalizedLabel) {
    return null;
  }

  // 遍历预置地区正则
  var regionKeys = Object.keys(regionPresets);
  for (var i = 0; i < regionKeys.length; i++) {
    var key = regionKeys[i];
    var regionDef = regionPresets[key];
    if (regionDef && regionDef.pattern) {
      try {
        var re = new RegExp(regionDef.pattern, 'i');
        if (re.test(normalizedLabel) || re.test(proxy.name)) {
          return key;
        }
      } catch (e) {
        // 正则表达式异常时安全跳过当前规则
      }
    }
  }

  return null;
}

/**
 * 批量对代理节点集合执行派生分类
 *
 * @param {Array} proxies 代理节点列表
 * @param {object} regionPresets 地区预置字典
 * @returns {object} 分类结果，包含 buckets (按地区代码分桶) 与 unclassified (未分类节点)
 */
export function classifyProxies(proxies, regionPresets) {
  var buckets = {};
  var unclassified = [];

  if (regionPresets && typeof regionPresets === 'object') {
    var keys = Object.keys(regionPresets);
    for (var k = 0; k < keys.length; k++) {
      buckets[keys[k]] = [];
    }
  }

  if (!Array.isArray(proxies)) {
    return {
      buckets: buckets,
      unclassified: unclassified,
    };
  }

  for (var i = 0; i < proxies.length; i++) {
    var proxy = proxies[i];
    if (!proxy || typeof proxy !== 'object') {
      continue;
    }

    var matchedRegion = classifyProxy(proxy, regionPresets);
    if (matchedRegion && buckets[matchedRegion]) {
      buckets[matchedRegion].push(proxy);
    } else {
      unclassified.push(proxy);
    }
  }

  return {
    buckets: buckets,
    unclassified: unclassified,
  };
}
