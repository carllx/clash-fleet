#!/usr/bin/env node

/**
 * Boa 0.22.0 确定性引擎环境准备脚本 (Setup Seam)
 *
 * 负责在本地或 CI 环境可重复自举准备 Boa 0.22.0 二进制。
 * 遵循严格 Fail-Closed 原则：下载或发现后必须重新校验版本，不合格立即终止。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertBoaCompatibilityEngine } from '../src/harness/boa-harness.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(PROJECT_ROOT, 'bin');
const IS_WIN = process.platform === 'win32';
const TARGET_BIN = path.join(BIN_DIR, IS_WIN ? 'boa.exe' : 'boa');

/**
 * 校验给定二进制文件的版本是否精确为 boa 0.22.0
 *
 * @param {string} binPath 二进制绝对路径
 * @returns {Promise<boolean>} 是否合规
 */
async function verifyBoaVersion(binPath) {
  try {
    await assertBoaCompatibilityEngine(binPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取官方构建资产名称
 *
 * @param {string} platform 操作系统标识
 * @param {string} arch 硬件架构标识
 * @returns {string|null} 资产名称
 */
function getPrebuiltAssetName(platform, arch) {
  if (platform === 'darwin' && arch === 'arm64') {
    return 'boa-aarch64-apple-darwin';
  }
  if (platform === 'linux' && arch === 'x64') {
    return 'boa-x86_64-unknown-linux-gnu';
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'boa-x86_64-pc-windows-msvc.exe';
  }
  return null;
}

/**
 * 执行引擎获取与配置流程
 */
async function main() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  // 1. 检查当前目标路径是否已有合规的 Boa 0.22.0
  if (fs.existsSync(TARGET_BIN)) {
    if (await verifyBoaVersion(TARGET_BIN)) {
      console.log(`[setup-boa] Boa 0.22.0 is already prepared at: ${TARGET_BIN}`);
      return;
    }
    // 版本不匹配，删除旧文件
    fs.unlinkSync(TARGET_BIN);
  }

  // 2. 检查环境变量 BOA_PATH (严格 Fail-Closed，不回退、不静默警告)
  if (process.env.BOA_PATH) {
    if (!fs.existsSync(process.env.BOA_PATH)) {
      throw new Error(`[setup-boa] BOA_PATH specified but file does not exist: ${process.env.BOA_PATH}`);
    }
    const isValid = await verifyBoaVersion(process.env.BOA_PATH);
    if (!isValid) {
      throw new Error(
        `[setup-boa] BOA_PATH (${process.env.BOA_PATH}) does not match exact version boa 0.22.0. Fail-closed.`
      );
    }
    console.log(`[setup-boa] Using BOA_PATH: ${process.env.BOA_PATH}`);
    const resolvedSrc = path.resolve(process.env.BOA_PATH);
    if (resolvedSrc !== TARGET_BIN) {
      fs.copyFileSync(resolvedSrc, TARGET_BIN);
    }
    fs.chmodSync(TARGET_BIN, 0o755);
    return;
  }

  // 3. 检查系统全局 PATH 中的 boa
  try {
    const { stdout: sysPathOut } = await execFileAsync(IS_WIN ? 'where' : 'which', ['boa']);
    const sysBoaPath = sysPathOut.trim().split('\n')[0].trim();
    if (sysBoaPath && (await verifyBoaVersion(sysBoaPath))) {
      console.log(`[setup-boa] Using system Boa: ${sysBoaPath}`);
      fs.copyFileSync(sysBoaPath, TARGET_BIN);
      fs.chmodSync(TARGET_BIN, 0o755);
      return;
    }
  } catch {
    // 忽略 which/where 异常
  }

  // 4. 下载官方对应架构的预编译二进制
  const assetName = getPrebuiltAssetName(process.platform, process.arch);
  if (!assetName) {
    throw new Error(
      `[setup-boa] Prebuilt Boa 0.22.0 binary is not available for ${process.platform}-${process.arch}. ` +
      `Please install cargo and compile boa 0.22.0 manually, then set BOA_PATH.`
    );
  }

  const downloadUrl = `https://github.com/boa-dev/boa/releases/download/v0.22/${assetName}`;
  console.log(`[setup-boa] Downloading Boa 0.22.0 from ${downloadUrl}...`);

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`[setup-boa] Download failed with HTTP ${response.status}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(TARGET_BIN, Buffer.from(arrayBuffer));
  fs.chmodSync(TARGET_BIN, 0o755);

  // 5. 校验刚下载的二进制版本
  const isValid = await verifyBoaVersion(TARGET_BIN);
  if (!isValid) {
    fs.unlinkSync(TARGET_BIN);
    throw new Error('[setup-boa] Post-download verification failed: Binary did not report exact "boa 0.22.0".');
  }

  console.log(`[setup-boa] Boa 0.22.0 successfully installed and verified at: ${TARGET_BIN}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
