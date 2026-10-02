#!/usr/bin/env node

/**
 * 跨平台测试执行器 (Cross-Platform Test Runner Seam)
 *
 * 显式遍历并收集 test 目录下所有 *.test.js 文件，并调用 node --test 执行。
 * 彻底消除不同 OS/Shell (bash, zsh, powershell, cmd) 对 glob 展开差异或 Node 20 glob 限制的影响。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(PROJECT_ROOT, 'test');

const testFiles = fs
  .readdirSync(TEST_DIR)
  .filter((file) => file.endsWith('.test.js'))
  .map((file) => path.join('test', file));

if (testFiles.length === 0) {
  console.error('[fleet:test] No test files found in test/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: PROJECT_ROOT,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
