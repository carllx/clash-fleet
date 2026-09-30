/**
 * 辅助工具函数模块
 */

/**
 * 深度克隆 JSON 安全对象
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 规范化为数组
 * @param {any} val
 * @returns {Array<any>}
 */
export function ensureArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}
