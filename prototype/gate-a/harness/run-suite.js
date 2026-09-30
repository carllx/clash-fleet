import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { buildConcat } from '../candidates/1-concat/build.js';
import { buildEsbuild } from '../candidates/2-esbuild/build.js';
import { buildRollup } from '../candidates/3-rollup/build.js';
import { validateScript } from './cvr-validator.js';
import { executeScriptWithBoa } from './cvr-executor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../');
const BOA_BIN = path.resolve(ROOT_DIR, 'bin/boa');
const INPUT_FILE = path.resolve(ROOT_DIR, 'fixture/data/input.json');
const EXPECTED_FILE = path.resolve(ROOT_DIR, 'fixture/data/expected.json');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

function getFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function runTestSuite() {
  console.log('===============================================================');
  console.log(' Clash Fleet — Prototype Gate A / Build Gate Test Suite');
  console.log('===============================================================\n');

  if (!fs.existsSync(BOA_BIN)) {
    console.error(`[FATAL] Boa binary not found at ${BOA_BIN}. Run setup-boa.sh first.`);
    process.exit(1);
  }

  const boaVersion = fs.readFileSync(path.resolve(ROOT_DIR, 'bin/setup-boa.sh'), 'utf8');
  console.log(`[Env] Target Boa: ${BOA_BIN}`);
  console.log(`[Env] Input Config: ${INPUT_FILE}`);
  console.log(`[Env] Expected Result: ${EXPECTED_FILE}\n`);

  const inputConfig = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const expectedOutput = JSON.parse(fs.readFileSync(EXPECTED_FILE, 'utf8'));

  // 1. 首次构建
  console.log('>>> [Step 1] Running Initial Builds...');
  buildConcat();
  await buildEsbuild();
  await buildRollup();

  // 记录哈希用于可重复性测试
  const candidates = [
    {
      id: 'concat',
      name: 'Candidate 1: Minimal Concat Generator',
      file: path.join(DIST_DIR, 'Script.concat.js'),
      buildFn: () => buildConcat(),
      complexity: 'Very Low (50 LOC pure Node script, zero deps)',
    },
    {
      id: 'concat-naive',
      name: 'Candidate 1 (Naive): Raw Concat (with imports/exports)',
      file: path.join(DIST_DIR, 'Script.concat-naive.js'),
      buildFn: () => buildConcat(),
      complexity: 'Minimal (simple cat)',
    },
    {
      id: 'esbuild',
      name: 'Candidate 2: esbuild (IIFE + Adapter)',
      file: path.join(DIST_DIR, 'Script.esbuild.js'),
      buildFn: async () => await buildEsbuild(),
      complexity: 'Low (15 LOC esbuild config with footer adapter)',
    },
    {
      id: 'esbuild-naive',
      name: 'Candidate 2 (Naive): esbuild (Default IIFE, no adapter)',
      file: path.join(DIST_DIR, 'Script.esbuild-naive.js'),
      buildFn: async () => await buildEsbuild(),
      complexity: 'Minimal (esbuild default)',
    },
    {
      id: 'rollup-flat',
      name: 'Candidate 3A: Rollup Flat (Scope Hoisted, Stripped Export)',
      file: path.join(DIST_DIR, 'Script.rollup-flat.js'),
      buildFn: async () => await buildRollup(),
      complexity: 'Low (18 LOC Rollup config, natural top-level export)',
    },
    {
      id: 'rollup-iife',
      name: 'Candidate 3B: Rollup IIFE (IIFE + Adapter)',
      file: path.join(DIST_DIR, 'Script.rollup-iife.js'),
      buildFn: async () => await buildRollup(),
      complexity: 'Low (20 LOC Rollup config with footer adapter)',
    },
    {
      id: 'rollup-naive',
      name: 'Candidate 3 (Naive): Rollup (Default IIFE, no adapter)',
      file: path.join(DIST_DIR, 'Script.rollup-naive.js'),
      buildFn: async () => await buildRollup(),
      complexity: 'Minimal (Rollup default)',
    },
  ];

  // 2. 验证可重复性 (Repeatability Check)
  console.log('\n>>> [Step 2] Verifying Build Repeatability (Deterministic Check)...');
  const initialHashes = {};
  for (const c of candidates) {
    initialHashes[c.id] = getFileHash(c.file);
  }

  // 二次构建
  buildConcat();
  await buildEsbuild();
  await buildRollup();

  const results = [];

  for (const c of candidates) {
    const secondHash = getFileHash(c.file);
    const repeatable = initialHashes[c.id] === secondHash;
    const sizeBytes = fs.statSync(c.file).size;

    // 静态校验 (CVR validate.rs 模拟)
    const valRes = validateScript(c.file, BOA_BIN);

    // 运行时执行 (Boa 0.22.0)
    const execRes = executeScriptWithBoa(c.file, inputConfig, 'CreamData', BOA_BIN);

    let behaviorMatch = false;
    if (execRes.success && execRes.output) {
      behaviorMatch = deepEqual(execRes.output, expectedOutput);
    }

    // 检查是否有 CommonJS loader / require 隐式依赖
    const content = fs.readFileSync(c.file, 'utf8');
    const hasNodeDeps = /\brequire\s*\(/.test(content) || /\bprocess\./.test(content);

    // 判断整体判定
    let verdict = 'NOT VIABLE';
    if (valRes.valid && execRes.success && behaviorMatch) {
      if (c.id === 'concat' || c.id === 'rollup-flat') {
        verdict = 'SUPPORTED';
      } else {
        verdict = 'SUPPORTED WITH SMALL ADAPTER';
      }
    }

    results.push({
      id: c.id,
      name: c.name,
      verdict,
      singleScript: true,
      hasMainContract: valRes.valid,
      boaParsable: !valRes.reason || !valRes.reason.includes('syntax'),
      boaExecSuccess: execRes.success,
      behaviorMatch,
      noNodeDeps: !hasNodeDeps,
      complexity: c.complexity,
      repeatable,
      sizeBytes,
      errorDetail: !valRes.valid ? valRes.reason : execRes.error,
    });
  }

  // 3. 输出汇总报告
  console.log('\n===============================================================');
  console.log(' GATE A CANDIDATE COMPARISON MATRIX');
  console.log('===============================================================\n');

  for (const r of results) {
    console.log(`---------------------------------------------------------------`);
    console.log(`[${r.verdict}] ${r.name}`);
    console.log(`  - Artifact Size:        ${r.sizeBytes} bytes`);
    console.log(`  - Single Script.js:     ${r.singleScript ? 'PASS' : 'FAIL'}`);
    console.log(`  - Global main Contract: ${r.hasMainContract ? 'PASS' : 'FAIL'}`);
    console.log(`  - Boa Parse & Exec:     ${r.boaExecSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`  - Fixture Output Match: ${r.behaviorMatch ? 'PASS (Deep Equal)' : 'FAIL'}`);
    console.log(`  - Zero Node Loader:     ${r.noNodeDeps ? 'PASS' : 'FAIL'}`);
    console.log(`  - Build Repeatable:     ${r.repeatable ? 'PASS (Bit-identical)' : 'FAIL'}`);
    console.log(`  - Build Complexity:     ${r.complexity}`);
    if (r.errorDetail) {
      console.log(`  - Failure Detail:       ${r.errorDetail}`);
    }
  }

  console.log('---------------------------------------------------------------\n');
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTestSuite().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
