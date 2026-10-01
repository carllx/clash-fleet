import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 查找可用的 Boa 二进制文件路径
 *
 * 查找顺序:
 * 1. 自定义指定路径 customBoaPath
 * 2. 环境变量 BOA_PATH
 * 3. 仓库内预置的 bin/boa
 * 4. 系统 PATH 中的 boa
 *
 * @param {string} [customBoaPath] 自定义路径
 * @returns {string} boa 可执行文件绝对路径或命令名称
 */
export function findBoaBinary(customBoaPath) {
  if (customBoaPath) {
    return path.resolve(process.cwd(), customBoaPath);
  }

  if (process.env.BOA_PATH && fs.existsSync(process.env.BOA_PATH)) {
    return path.resolve(process.env.BOA_PATH);
  }

  const projectBoa = path.resolve(__dirname, '../../bin/boa');
  if (fs.existsSync(projectBoa)) {
    return projectBoa;
  }

  return 'boa';
}

/**
 * 获取 Boa 引擎版本信息
 *
 * @param {string} [customBoaPath] 自定义 boa 可执行路径
 * @returns {Promise<string>} 版本输出字符串
 */
export async function getBoaVersion(customBoaPath) {
  const bin = findBoaBinary(customBoaPath);
  const { stdout } = await execFileAsync(bin, ['--version']);
  return stdout.trim();
}

/**
 * 权威校验 Boa 引擎兼容性（必须精确匹配 boa 0.22.0）
 *
 * 遵循严格 Fail-Closed 原则：
 * - 引擎缺失 -> 立即抛出异常阻断
 * - 版本不匹配（如 0.21 或 0.23） -> 立即抛出异常阻断
 * - 绝不允许 warning-and-continue 兜底绕过
 *
 * @param {string} [customBoaPath] 自定义 boa 可执行路径
 * @returns {Promise<{ bin: string, version: string }>} 验证通过的引擎信息
 */
export async function assertBoaCompatibilityEngine(customBoaPath) {
  const bin = findBoaBinary(customBoaPath);

  let stdout;
  try {
    const res = await execFileAsync(bin, ['--version']);
    stdout = res.stdout;
  } catch (err) {
    throw new Error(
      `[fleet] Boa engine binary not found or inaccessible at "${bin}". ` +
      `Run "npm run setup:boa" to prepare it or set BOA_PATH. (${err.message})`
    );
  }

  const version = stdout.trim();
  const isExact022 = /^boa 0\.22\.0(\s|$)/i.test(version);

  if (!isExact022) {
    throw new Error(
      `[fleet] Incompatible Boa engine: Expected exact "boa 0.22.0", found "${version}". ` +
      `Fail-closed compatibility gate rejected execution.`
    );
  }

  return { bin, version };
}

/**
 * 安全创建临时脚本并在执行完成后自动清理的辅助函数
 *
 * @param {string} prefix 临时文件前缀
 * @param {string} content 脚本内容
 * @param {(filePath: string) => Promise<any>} executor 执行回调
 * @returns {Promise<any>} 执行结果
 */
async function withTempScript(prefix, content, executor) {
  const tmpFile = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(8).toString('hex')}.js`);
  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    return await executor(tmpFile);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // 忽略临时文件删除异常
    }
  }
}

/**
 * 执行静态合规检查与 Boa 语法解析验证 (CVR Static Marker & Pure AST Syntax Gate)
 *
 * @param {string} code 待校验的脚本内容
 * @param {object} [options] 校验选项
 * @param {string} [options.boaPath] 自定义 boa 路径
 * @returns {Promise<{ valid: boolean, errors: string[], staticMarkerPassed: boolean }>} 验证报告
 */
export async function validateScript(code, options = {}) {
  // 必须首先通过权威的 Boa 0.22.0 引擎门禁校验 (Fail-Closed)
  const { bin } = await assertBoaCompatibilityEngine(options.boaPath);
  const errors = [];

  // 1. CVR 源码静态 Marker 检查 (validate.rs)
  const hasStaticMarker =
    code.includes('function main') ||
    code.includes('const main') ||
    code.includes('let main');

  if (!hasStaticMarker) {
    errors.push("Script must contain CVR static main marker ('function main', 'const main', or 'let main')");
  }

  // 2. 检查 CommonJS / Node.js 宿主对象泄露
  if (/\brequire\s*\(/.test(code) || /\bmodule\.exports\b/.test(code) || /\bprocess\./.test(code)) {
    errors.push('Script contains CommonJS or Node.js host references (require/module.exports/process)');
  }

  // 3. 检查未被剥离的 ES Module 导出语法 (Boa 脚本模式不支持)
  if (/\bexport\s*\{/.test(code) || /\bexport\s+default\b/.test(code) || /\bexport\s+(async\s+function|function|const|let|var|class)\b/.test(code)) {
    errors.push('Script contains unstripped export statements (Boa script mode rejects export)');
  }

  // 4. Boa 0.22.0 纯静态 AST 语法树解析 (无运行时副作用)
  try {
    await withTempScript('boa-ast', code, async (tmpFile) => {
      await execFileAsync(bin, ['-a', 'json', tmpFile]);
    });
  } catch (err) {
    const stdout = (err.stdout || '').trim();
    const stderr = (err.stderr || '').trim();
    const errMsg = [stderr, stdout].filter(Boolean).join('\n') || err.message;
    errors.push(`Boa 0.22 syntax parse error: ${errMsg}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    staticMarkerPassed: hasStaticMarker,
  };
}

/**
 * 在独立的 Boa 0.22 进程沙箱中运行脚本并执行 main(config, profileName)
 *
 * @param {string} code 目标脚本代码
 * @param {object} inputConfig 模拟传入的配置对象
 * @param {string} profileName 模拟传入的订阅名称
 * @param {object} [options] 执行配置
 * @returns {Promise<object>} main 函数的返回对象
 */
export async function executeScriptWithBoa(code, inputConfig, profileName = 'default', options = {}) {
  // 必须首先通过权威的 Boa 0.22.0 引擎门禁校验 (Fail-Closed)
  const { bin } = await assertBoaCompatibilityEngine(options.boaPath);

  const serializedInput = JSON.stringify(inputConfig ?? {});
  const serializedProfile = JSON.stringify(String(profileName));

  const runnerScript = `
${code}

// 受约束的 CVR 运行时沙箱调用桩
(function() {
  if (typeof main !== 'function') {
    throw new TypeError("Callable global 'main' is not defined or not a function");
  }
  var __input = JSON.parse(${JSON.stringify(serializedInput)});
  var __profile = ${serializedProfile};
  var __output = main(__input, __profile);
  console.log('__FLEET_OUTPUT_START__' + JSON.stringify(__output || {}) + '__FLEET_OUTPUT_END__');
})();
`;

  try {
    return await withTempScript('boa-run', runnerScript, async (tmpFile) => {
      const { stdout, stderr } = await execFileAsync(bin, [tmpFile]);

      const startTag = '__FLEET_OUTPUT_START__';
      const endTag = '__FLEET_OUTPUT_END__';
      const startIndex = stdout.indexOf(startTag);
      const endIndex = stdout.indexOf(endTag);

      if (startIndex === -1 || endIndex === -1) {
        throw new Error(`Execution did not return expected output token. Stderr: ${stderr}\nStdout: ${stdout}`);
      }

      const payload = stdout.slice(startIndex + startTag.length, endIndex);
      return JSON.parse(payload);
    });
  } catch (err) {
    const stdout = (err.stdout || '').trim();
    const stderr = (err.stderr || '').trim();
    const detail = [stderr, stdout].filter(Boolean).join('\n') || err.message;
    throw new Error(`Boa execution failed: ${detail}`);
  }
}
