import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Bounded CVR Compatibility Harness — 校验器部分
 *
 * 注意：本 Harness 只复制 Gate A 所需的 observable contract：
 * - CVR static main marker 字符串要求；
 * - Boa 0.22.0 parse / eval 语法合法性；
 * - 无 CommonJS loader / require 宿主泄漏。
 * 它不是 CVR runtime 的完整 emulator（不包含 CVR 的 execution timeout、loop iteration limit、
 * log limits、config lowercasing、error fallback 及 result mapping 等全量控制面逻辑）。
 */
export function validateScript(scriptPath, boaBinPath) {
  if (!fs.existsSync(scriptPath)) {
    return {
      valid: false,
      staticMarkerPassed: false,
      boaSyntaxValid: false,
      noNodeLoaderLeak: false,
      reason: `File not found: ${scriptPath}`,
    };
  }

  const content = fs.readFileSync(scriptPath, 'utf8');

  // 1. CVR 原生静态 Marker 检查 (validate.rs: content.contains("function main") || ...)
  const staticMarkerPassed =
    content.includes('function main') ||
    content.includes('const main') ||
    content.includes('let main');

  // 2. 检查非法 Node 宿主残留 (沙箱中不存在 CommonJS require() 或 process)
  const noNodeLoaderLeak = !/\brequire\s*\(/.test(content) && !/\bprocess\./.test(content);

  // 3. Boa 0.22.0 语法解析与评估校验 (评估脚本语法是否能被 Boa 0.22.0 正确解析)
  const validationSnippet = `
var console = Object.freeze({
  log(...data){}, info(...data){}, error(...data){}, debug(...data){}
});
`;
  let boaSyntaxValid = false;
  let syntaxError = null;

  try {
    execFileSync(boaBinPath, ['-e', validationSnippet, scriptPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    boaSyntaxValid = true;
  } catch (err) {
    const stderr = err.stderr || err.stdout || err.message;
    syntaxError = `Boa syntax evaluation failed: ${String(stderr).trim()}`;
  }

  const valid = staticMarkerPassed && noNodeLoaderLeak && boaSyntaxValid;
  let reason = 'Passed CVR static marker, Boa 0.22.0 syntax validation, and no Node loader leak';
  if (!staticMarkerPassed) {
    reason = 'Script missing required static main marker (failed CVR validate.rs string check)';
  } else if (!noNodeLoaderLeak) {
    reason = 'Script contains CommonJS require() or process references unsupported in Boa sandbox';
  } else if (!boaSyntaxValid) {
    reason = syntaxError;
  }

  return {
    valid,
    staticMarkerPassed,
    boaSyntaxValid,
    noNodeLoaderLeak,
    reason,
  };
}
