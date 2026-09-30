import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * 模拟 Clash Verge Rev (src-tauri/src/core/validate.rs) 的校验器
 * 1. 静态包含 "function main" / "const main" / "let main"
 * 2. Boa 0.22.0 语法解析
 * 3. 检查 Node 运行时泄露 (CommonJS require 等)
 */
export function validateScript(scriptPath, boaBinPath) {
  if (!fs.existsSync(scriptPath)) {
    return { valid: false, reason: `File not found: ${scriptPath}` };
  }

  const content = fs.readFileSync(scriptPath, 'utf8');

  // 1. CVR 原生静态检查
  const hasMainString =
    content.includes('function main') ||
    content.includes('const main') ||
    content.includes('let main');

  if (!hasMainString) {
    return {
      valid: false,
      reason: 'Script must contain a main function (failed CVR validate.rs string check)',
      stage: 'static_string_check',
    };
  }

  // 2. 检查非法 Node 运行时残留 (如沙箱中不存在的 require/process)
  if (/\brequire\s*\(/.test(content)) {
    return {
      valid: false,
      reason: 'Script contains CommonJS require() calls which are unsupported in Boa sandbox',
      stage: 'runtime_dependency_check',
    };
  }

  // 3. Boa 0.22.0 语法与评估校验 (等价于 CVR validate.rs 中的 context.eval)
  const validationSnippet = `
var console = Object.freeze({
  log(...data){}, info(...data){}, error(...data){}, debug(...data){}
});
`;
  try {
    execFileSync(boaBinPath, ['-e', validationSnippet, scriptPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = err.stderr || err.stdout || err.message;
    return {
      valid: false,
      reason: `Boa syntax evaluation failed: ${stderr.trim()}`,
      stage: 'boa_syntax_eval',
    };
  }

  return { valid: true, reason: 'Passed CVR static string & Boa 0.22.0 syntax validation' };
}
