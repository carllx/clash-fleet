// test/fixtures/modular/utils.js
// 故意定义局部常量 TAG，用于测试模块作用域隔离
const TAG = '[utils]';

export function formatLabel(str) {
  return `${TAG} ${str}`;
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
