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

/**
 * 严格预期矩阵 (Expected Outcome Matrix for Fail-Closed Gate Enforcement)
 */
const EXPECTED_MATRIX = {
  'concat': {
    name: 'Candidate 1: Minimal Concat Generator (Stripping Adapter)',
    verdict: 'SUPPORTED WITH SMALL ADAPTER',
    singleScript: true,
    staticMainMarker: true,
    boaSyntaxValid: true,
    globalCallableMain: true,
    behaviorMatch: true,
    noNodeLeakage: true,
    deterministicBuild: true,
  },
  'concat-naive': {
    name: 'Candidate 1 (Naive Negative Control): Raw Concat (unstripped imports/exports)',
    verdict: 'NOT VIABLE',
    singleScript: true,
    staticMainMarker: true,
    boaSyntaxValid: false, // 预期: Boa 普通脚本模式遇到 export 语法报错
    globalCallableMain: false,
    behaviorMatch: false,
    noNodeLeakage: true,
    deterministicBuild: true,
  },
  'esbuild': {
    name: 'Candidate 2: esbuild (IIFE + Footer Adapter)',
    verdict: 'SUPPORTED WITH SMALL ADAPTER',
    singleScript: true,
    staticMainMarker: true,
    boaSyntaxValid: true,
    globalCallableMain: true,
    behaviorMatch: true,
    noNodeLeakage: true,
    deterministicBuild: true,
  },
  'esbuild-naive': {
    name: 'Candidate 2 (Naive Negative Control): esbuild (Default IIFE, unbridged)',
    verdict: 'NOT VIABLE',
    singleScript: true,
    staticMainMarker: true,
    boaSyntaxValid: true,
    globalCallableMain: false, // 预期: main 被闭包隔离在 IIFE 内，全局不可调用
    behaviorMatch: false,
    noNodeLeakage: true,
    deterministicBuild: true,
  },
  'rollup-flat': {
    name: 'Candidate 3A: Rollup Flat (Scope Hoisted + Post-process Export Stripping Adapter)',
    verdict: 'SUPPORTED WITH SMALL ADAPTER',
    singleScript: true,
    staticMainMarker: true,
    boaSyntaxValid: true,
    globalCallableMain: true,
    behaviorMatch: true,
    noNodeLeakage: true,
    deterministicBuild: true,
  },
  'rollup-iife': {
    name: 'Candidate 3B: Rollup IIFE (IIFE + Footer Adapter)',
    verdict: 'SUPPORTED WITH SMALL ADAPTER',
    singleScript: true,
    staticMainMarker: true,
    boaSyntaxValid: true,
    globalCallableMain: true,
    behaviorMatch: true,
    noNodeLeakage: true,
    deterministicBuild: true,
  },
  'rollup-naive': {
    name: 'Candidate 3 (Naive Negative Control): Rollup (Default IIFE, unbridged)',
    verdict: 'NOT VIABLE',
    singleScript: true,
    staticMainMarker: true,
    boaSyntaxValid: true,
    globalCallableMain: false, // 预期: main 被闭包隔离在 IIFE 内，全局不可调用
    behaviorMatch: false,
    noNodeLeakage: true,
    deterministicBuild: true,
  },
};

export async function runTestSuite() {
  console.log('========================================================================');
  console.log(' Clash Fleet — Prototype Gate A / Build Gate Verification Test Suite');
  console.log(' Harness Scope: Bounded CVR Compatibility Harness (Boa 0.22.0 Parity)');
  console.log('========================================================================\n');

  if (!fs.existsSync(BOA_BIN)) {
    console.error(`[FATAL] Boa binary not found at ${BOA_BIN}. Run setup-boa.sh first.`);
    process.exit(1);
  }

  console.log(`[Target Runtime]  ${BOA_BIN} (boa 0.22.0)`);
  console.log(`[Input Config]    ${INPUT_FILE}`);
  console.log(`[Expected Output] ${EXPECTED_FILE}\n`);

  const inputConfig = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const expectedOutput = JSON.parse(fs.readFileSync(EXPECTED_FILE, 'utf8'));

  // 1. 首次构建
  console.log('>>> [Step 1] Running Initial Candidate Builds...');
  buildConcat();
  await buildEsbuild();
  await buildRollup();

  const candidateDefs = [
    { id: 'concat', file: path.join(DIST_DIR, 'Script.concat.js'), complexity: 'Pure Node.js topological read + regex strip adapter' },
    { id: 'concat-naive', file: path.join(DIST_DIR, 'Script.concat-naive.js'), complexity: 'Simple text concatenation (negative control)' },
    { id: 'esbuild', file: path.join(DIST_DIR, 'Script.esbuild.js'), complexity: 'esbuild IIFE + global footer adapter bridge' },
    { id: 'esbuild-naive', file: path.join(DIST_DIR, 'Script.esbuild-naive.js'), complexity: 'esbuild default IIFE unbridged (negative control)' },
    { id: 'rollup-flat', file: path.join(DIST_DIR, 'Script.rollup-flat.js'), complexity: 'Rollup format es + regex post-process export strip adapter' },
    { id: 'rollup-iife', file: path.join(DIST_DIR, 'Script.rollup-iife.js'), complexity: 'Rollup IIFE + global footer adapter bridge' },
    { id: 'rollup-naive', file: path.join(DIST_DIR, 'Script.rollup-naive.js'), complexity: 'Rollup default IIFE unbridged (negative control)' },
  ];

  // 记录哈希用于确定性重复构建检查
  const initialHashes = {};
  for (const c of candidateDefs) {
    initialHashes[c.id] = getFileHash(c.file);
  }

  // 2. 二次构建验证构建可重复性
  console.log('\n>>> [Step 2] Executing Repeat Build for Determinism Assertion...');
  buildConcat();
  await buildEsbuild();
  await buildRollup();

  const observedResults = [];
  const gateAssertionFailures = [];

  // 3. 运行逐项验证并断言
  console.log('\n>>> [Step 3] Evaluating Candidates against Bounded CVR Observable Contract...');

  for (const c of candidateDefs) {
    const expected = EXPECTED_MATRIX[c.id];
    const secondHash = getFileHash(c.file);
    const deterministicBuild = initialHashes[c.id] === secondHash;
    const sizeBytes = fs.statSync(c.file).size;

    // 静态与语法校验
    const valRes = validateScript(c.file, BOA_BIN);
    const singleScript = fs.existsSync(c.file);
    const staticMainMarker = valRes.staticMarkerPassed;
    const boaSyntaxValid = valRes.boaSyntaxValid;
    const noNodeLeakage = valRes.noNodeLoaderLeak;

    // 沙箱运行时可调用与行为输出执行
    const execRes = executeScriptWithBoa(c.file, inputConfig, 'CreamData', BOA_BIN);
    const globalCallableMain = execRes.globalCallableMainPassed;
    const behaviorMatch = execRes.success && execRes.output ? deepEqual(execRes.output, expectedOutput) : false;

    // 综合判定
    let verdict = 'NOT VIABLE';
    if (singleScript && staticMainMarker && boaSyntaxValid && globalCallableMain && behaviorMatch && noNodeLeakage && deterministicBuild) {
      verdict = 'SUPPORTED WITH SMALL ADAPTER';
    }

    const observed = {
      id: c.id,
      name: expected.name,
      verdict,
      singleScript,
      staticMainMarker,
      boaSyntaxValid,
      globalCallableMain,
      behaviorMatch,
      noNodeLeakage,
      deterministicBuild,
      sizeBytes,
      complexity: c.complexity,
      errorDetail: !valRes.valid ? valRes.reason : execRes.error,
    };
    observedResults.push(observed);

    // Fail-Closed Gate Assertions
    const assertionErrors = [];
    if (observed.verdict !== expected.verdict) {
      assertionErrors.push(`Verdict mismatch: expected ${expected.verdict}, got ${observed.verdict}`);
    }
    if (observed.singleScript !== expected.singleScript) {
      assertionErrors.push(`singleScript mismatch: expected ${expected.singleScript}, got ${observed.singleScript}`);
    }
    if (observed.staticMainMarker !== expected.staticMainMarker) {
      assertionErrors.push(`staticMainMarker mismatch: expected ${expected.staticMainMarker}, got ${observed.staticMainMarker}`);
    }
    if (observed.boaSyntaxValid !== expected.boaSyntaxValid) {
      assertionErrors.push(`boaSyntaxValid mismatch: expected ${expected.boaSyntaxValid}, got ${observed.boaSyntaxValid}`);
    }
    if (observed.globalCallableMain !== expected.globalCallableMain) {
      assertionErrors.push(`globalCallableMain mismatch: expected ${expected.globalCallableMain}, got ${observed.globalCallableMain}`);
    }
    if (observed.behaviorMatch !== expected.behaviorMatch) {
      assertionErrors.push(`behaviorMatch mismatch: expected ${expected.behaviorMatch}, got ${observed.behaviorMatch}`);
    }
    if (observed.noNodeLeakage !== expected.noNodeLeakage) {
      assertionErrors.push(`noNodeLeakage mismatch: expected ${expected.noNodeLeakage}, got ${observed.noNodeLeakage}`);
    }
    if (observed.deterministicBuild !== expected.deterministicBuild) {
      assertionErrors.push(`deterministicBuild mismatch: expected ${expected.deterministicBuild}, got ${observed.deterministicBuild}`);
    }

    if (assertionErrors.length > 0) {
      gateAssertionFailures.push({
        id: c.id,
        name: expected.name,
        errors: assertionErrors,
      });
    }
  }

  // 4. 打印格式化矩阵报告
  console.log('\n========================================================================');
  console.log(' GATE A OBSERVABLE CONTRACT MATRIX');
  console.log('========================================================================\n');

  for (const r of observedResults) {
    console.log(`------------------------------------------------------------------------`);
    console.log(`[${r.verdict}] ${r.name}`);
    console.log(`  - Artifact Size:              ${r.sizeBytes} bytes`);
    console.log(`  - Single Script.js:           ${r.singleScript ? 'PASS' : 'FAIL'}`);
    console.log(`  - CVR Static Main Marker:     ${r.staticMainMarker ? 'PASS' : 'FAIL'}`);
    console.log(`  - Boa 0.22.0 Syntax/Parse:    ${r.boaSyntaxValid ? 'PASS' : 'FAIL'}`);
    console.log(`  - Callable Global Main:       ${r.globalCallableMain ? 'PASS' : 'FAIL'}`);
    console.log(`  - Fixture Output Match:       ${r.behaviorMatch ? 'PASS (Deep Equal)' : 'FAIL'}`);
    console.log(`  - Zero Node Loader Leak:      ${r.noNodeLeakage ? 'PASS' : 'FAIL'}`);
    console.log(`  - Deterministic Repeat Build: ${r.deterministicBuild ? 'PASS (Bit-identical)' : 'FAIL'}`);
    console.log(`  - Build & Adapter Shape:      ${r.complexity}`);
    if (r.errorDetail) {
      console.log(`  - Observable Rejection:       ${r.errorDetail}`);
    }
  }
  console.log('------------------------------------------------------------------------\n');

  // 5. Fail-Closed Gate Enforcement 检查
  if (gateAssertionFailures.length > 0) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error(' [FAIL-CLOSED GATE FAILED] The following candidates violated gate assertions:');
    for (const f of gateAssertionFailures) {
      console.error(`  * ${f.name} (${f.id}):`);
      for (const err of f.errors) {
        console.error(`      - ${err}`);
      }
    }
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n');
    process.exit(1);
  }

  console.log('>>> [FAIL-CLOSED GATE ASSERTIONS: ALL PASSED]');
  console.log('All adapted candidates met observable contracts and all negative controls failed as expected.\n');
  return observedResults;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTestSuite().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
}
