import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * 模拟 Clash Verge Rev (src-tauri/src/enhance/script.rs) 执行单脚本
 * @param {string} scriptPath 目标单一脚本绝对路径
 * @param {object} inputConfig 输入配置
 * @param {string} profileName 配置名称
 * @param {string} boaBinPath Boa 可执行文件路径
 * @returns {{ success: boolean, output?: object, error?: string, rawLogs?: string }}
 */
export function executeScriptWithBoa(scriptPath, inputConfig, profileName, boaBinPath) {
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `Script file not found: ${scriptPath}` };
  }

  const scriptContent = fs.readFileSync(scriptPath, 'utf8');
  const configJson = JSON.stringify(inputConfig);
  const safeProfileName = profileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // 构建与 CVR script.rs eval_script 完全一致的沙箱代码
  const runnerCode = `
// 1. CVR Mock Console
var __verge_logs__ = [];
var console = Object.freeze({
  log(...d){ __verge_logs__.push(["log", JSON.stringify(d)]); },
  info(...d){ __verge_logs__.push(["info", JSON.stringify(d)]); },
  error(...d){ __verge_logs__.push(["error", JSON.stringify(d)]); },
  debug(...d){ __verge_logs__.push(["debug", JSON.stringify(d)]); },
  warn(...d){ __verge_logs__.push(["warn", JSON.stringify(d)]); }
});

// 2. CVR 注入的全局配置
globalThis.__verge_config__ = ${JSON.stringify(configJson)};

// 3. 用户扩展脚本源码
${scriptContent}

// 4. CVR 执行调用与捕获 (与 CVR script.rs 保持严格一致)
try {
  if (typeof main !== 'function') {
    throw new TypeError("Callable global 'main' is not defined (type is " + typeof main + ")");
  }
  var __result = main(JSON.parse(globalThis.__verge_config__), '${safeProfileName}');
  if (typeof __result !== 'object' || __result === null) {
    throw new TypeError("main function should return object");
  }
  JSON.stringify(__result);
} catch (err) {
  "__ERROR_FLAG__ " + (err && err.message ? err.message : String(err));
}
`;

  const tempRunnerPath = path.join(
    os.tmpdir(),
    `cvr_test_runner_${Date.now()}_${Math.random().toString(36).slice(2)}.js`
  );

  try {
    fs.writeFileSync(tempRunnerPath, runnerCode, 'utf8');
    const rawOutput = execFileSync(boaBinPath, [tempRunnerPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
    });

    const trimmed = rawOutput.trim();

    if (trimmed.includes('__ERROR_FLAG__')) {
      const errorMsg = trimmed.split('__ERROR_FLAG__')[1].trim();
      return { success: false, error: errorMsg, rawLogs: rawOutput };
    }

    // Boa CLI 对最后的表达式求值返回 JSON 字符串外壳，解析外壳与内层对象
    let parsedJsonString = trimmed;
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      parsedJsonString = JSON.parse(trimmed);
    }
    const parsedObj = JSON.parse(parsedJsonString);
    return { success: true, output: parsedObj, rawLogs: rawOutput };
  } catch (err) {
    const stderr = err.stderr || err.stdout || err.message;
    return {
      success: false,
      error: `Boa execution crashed: ${String(stderr).trim()}`,
      rawLogs: String(stderr),
    };
  } finally {
    try {
      if (fs.existsSync(tempRunnerPath)) {
        fs.unlinkSync(tempRunnerPath);
      }
    } catch (_) {}
  }
}
