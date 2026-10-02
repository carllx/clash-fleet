#!/usr/bin/env node

/**
 * 轻量级代码风格与静态合规检查门禁 (Lint Seam)
 *
 * 遵循极简与轻量原则：
 * 1. 采用 node --check 执行零外部依赖的 AST 语法解析（自动排除故意的测试 fixture）
 * 2. 检查常见代码坏味与 Boa 运行时代规避项（避免在核心源码内引入未授权的危险用法）
 * 3. 检查敏感绝对用户主路径泄露
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = ['src', 'bin', 'scripts', 'test'];
const JS_EXTS = ['.js', '.mjs', '.cjs'];

// 忽略故意的语法错误测试用例 fixture
const IGNORED_FIXTURES = ['test/fixtures/invalid-syntax.js'];

// 正则模式：匹配硬编码绝对用户家目录路径 (例如 /Users/<name>, C:\Users\<name>, /home/<name>)
const USER_PATH_PATTERN = new RegExp(
  ['\\/', 'Users\\/', '[a-zA-Z0-9_-]+|', '[A-Z]:\\\\+', 'Users\\\\+', '[a-zA-Z0-9_-]+|', '\\/', 'home\\/', '[a-zA-Z0-9_-]+'].join(''),
  'g'
);

/**
 * 递归收集指定目录下的所有 JS 文件
 *
 * @param {string} dir 目录路径
 * @returns {string[]} 文件列表
 */
function collectFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.tmp' && entry.name !== '.git') {
        results.push(...collectFiles(fullPath));
      }
    } else if (entry.isFile() && JS_EXTS.includes(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * 检查代码文件静态特征
 *
 * @param {string} filePath 文件绝对路径
 * @returns {string[]} 违规信息列表
 */
function checkFilePatterns(filePath) {
  const issues = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(PROJECT_ROOT, filePath);
  const relPathPosix = relPath.replace(/\\/g, '/');

  if (IGNORED_FIXTURES.includes(relPathPosix)) {
    return issues;
  }

  // 1. 语法检查 node --check
  try {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
  } catch (err) {
    const stderr = (err.stderr || '').toString().trim();
    issues.push(`Syntax error: ${stderr || err.message}`);
  }

  // 2. 严禁源码中残留本地绝对主目录路径泄露
  if (relPath.startsWith('src/') || relPath.startsWith('scripts/')) {
    if (relPath !== 'scripts/lint.js') {
      const homeDirMatches = content.match(USER_PATH_PATTERN);
      if (homeDirMatches) {
        issues.push(`Hardcoded absolute user path detected: ${homeDirMatches.join(', ')}`);
      }
    }
  }

  return issues;
}

/**
 * 主执行入口
 */
function main() {
  console.log('[fleet:lint] Running lightweight static syntax and style gate...');
  let totalFiles = 0;
  let hasErrors = false;

  for (const dirName of SCAN_DIRS) {
    const targetDir = path.join(PROJECT_ROOT, dirName);
    const files = collectFiles(targetDir);
    totalFiles += files.length;

    for (const file of files) {
      const issues = checkFilePatterns(file);
      if (issues.length > 0) {
        hasErrors = true;
        const rel = path.relative(PROJECT_ROOT, file);
        console.error(`[fleet:lint] ❌ Issues in ${rel}:`);
        for (const issue of issues) {
          console.error(`  - ${issue}`);
        }
      }
    }
  }

  if (hasErrors) {
    console.error('\n[fleet:lint] Lint failed: Static gate violations found.');
    process.exit(1);
  }

  console.log(`[fleet:lint] Lint PASSED: Verified ${totalFiles} JavaScript files with clean syntax and standards.`);
}

main();
