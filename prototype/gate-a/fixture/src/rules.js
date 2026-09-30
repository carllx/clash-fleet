/**
 * 规则分类模块
 * 定义地区正则与代理过滤函数
 */

export const REGION_PATTERNS = {
  HK: /香港|HK|Hong\s*Kong/i,
  SG: /新加坡|SG|Singapore/i,
  US: /美国|US|United\s*States/i,
};

/**
 * 依据区域代码过滤匹配的代理名称
 * @param {Array<{name: string}>} proxies
 * @param {string} regionKey
 * @returns {Array<string>}
 */
export function filterProxiesByRegion(proxies, regionKey) {
  const pattern = REGION_PATTERNS[regionKey];
  if (!pattern || !Array.isArray(proxies)) {
    return [];
  }
  return proxies
    .filter((p) => p && typeof p.name === 'string' && pattern.test(p.name))
    .map((p) => p.name);
}
