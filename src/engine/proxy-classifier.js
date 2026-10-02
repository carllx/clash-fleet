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

  // 去除多余首尾空白与控制字符，得到用于正则匹配的派生标签
  return rawName.trim();
}

/**
 * 编译地区预置字典中的正则表达式
 *
 * @param {object} regionPresets 声明式地区字典
 * @returns {Array<{ key: string, regex: RegExp }>} 预编译正则列表
 */
function compileRegionMatchers(regionPresets) {
  var matchers = [];
  if (!regionPresets || typeof regionPresets !== 'object') {
    return matchers;
  }

  var keys = Object.keys(regionPresets);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var def = regionPresets[key];
    if (def && typeof def.pattern === 'string') {
      try {
        matchers.push({
          key: key,
          regex: new RegExp(def.pattern, 'i'),
        });
      } catch (e) {
        // 忽略非法正则，保持运行稳健
      }
    }
  }

  return matchers;
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

  var normalizedLabel = normalizeProxyName(proxy.name);
  if (!normalizedLabel) {
    return null;
  }

  var matchers = compileRegionMatchers(regionPresets);
  for (var i = 0; i < matchers.length; i++) {
    var matcher = matchers[i];
    if (matcher.regex.test(normalizedLabel) || matcher.regex.test(proxy.name)) {
      return matcher.key;
    }
  }

  return null;
}

/**
 * 批量对代理节点集合执行派生分类 (采用单次预编译正则，提升匹配效率)
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

  // 单次预编译全部地区正则，避免在遍历 proxy 时重复创建 RegExp
  var matchers = compileRegionMatchers(regionPresets);

  for (var i = 0; i < proxies.length; i++) {
    var proxy = proxies[i];
    if (!proxy || typeof proxy !== 'object' || typeof proxy.name !== 'string') {
      continue;
    }

    var normalizedLabel = normalizeProxyName(proxy.name);
    var matchedKey = null;

    if (normalizedLabel) {
      for (var m = 0; m < matchers.length; m++) {
        var matcher = matchers[m];
        if (matcher.regex.test(normalizedLabel) || matcher.regex.test(proxy.name)) {
          matchedKey = matcher.key;
          break;
        }
      }
    }

    if (matchedKey && buckets[matchedKey]) {
      buckets[matchedKey].push(proxy);
    } else {
      unclassified.push(proxy);
    }
  }

  return {
    buckets: buckets,
    unclassified: unclassified,
  };
}
