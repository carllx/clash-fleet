// test/fixtures/modular/rules.js
// 同样定义同名局部常量 TAG，验证 Rollup AST 级自动安全重命名
const TAG = '[rules]';

export function filterDirectRules(rules) {
  const list = Array.isArray(rules) ? rules : [];
  return list.filter(r => typeof r === 'string' && r.startsWith('DOMAIN'));
}

export function getTag() {
  return TAG;
}
