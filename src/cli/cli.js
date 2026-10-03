import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildFlatScript } from '../build/rollup-flat.js';
import {
  validateScript,
  executeScriptWithBoa,
  assertBoaCompatibilityEngine,
} from '../harness/boa-harness.js';
import {
  loadRuleProvidersFile,
  generateProvenanceManifest,
  serializeProvenanceManifest,
  assertProviderParity,
} from '../loader/rule-providers.js';
import {
  createDeterministicPackage,
  verifyPackageChecksums,
} from '../release/packager.js';
import { executeDeploymentTransaction } from '../deploy/deployer.js';

/**
 * 打印命令行帮助说明
 */
export function printHelp() {
  console.log(`
Clash Fleet CLI - 多设备配置分发与确定性构建工具链

用法:
  fleet <command> [options]

命令:
    build      打包模块化 JavaScript 源码为 CVR 兼容的单一 Script.js 并生成 Rule Asset Provenance 清单 (强制执行 Boa 0.22 门禁)
    package    确定性打包发布资产 (Script.js, RULE_ASSET_PROVENANCE.json, SHA256SUMS.txt) 并执行机密安全门禁
    verify     使用 Boa 0.22 门禁验证目标 Script.js 的语法与契约
    deploy     执行部署事务前半段 (发现 -> 下载 -> 校验和 -> Boa 预检 -> 备份 -> 原子替换)

  选项 (build):
    --input, -i             入口文件路径 (默认: src/index.js)
    --output, -o            产物输出路径 (默认: dist/Script.js)
    --providers, -p         Rule Provider 声明式文件路径 (默认: src/providers/rule-providers.yaml)
    --provenance-output     Provenance Manifest 输出路径 (默认: 与 output 同目录下的 RULE_ASSET_PROVENANCE.json)

  选项 (package):
    --dist-dir              产物来源目录 (默认: dist)
    --package-dir           发布包输出目录 (默认: dist/package)

  选项 (verify):
    --input, -i             待验证脚本路径 (默认: dist/Script.js，亦支持位置参数传入)

  选项 (deploy):
    --target, -t            目标 Script.js 文件路径 (必选或通过 FLEET_TARGET_SCRIPT 环境变量注入)
    --repo                  GitHub 仓库 (默认: carllx/clash-fleet)
    --token                 GitHub API Token (可选)
    --boa-path              自定义 Boa 可执行文件路径 (可选)

  通用选项:
    --help, -h              查看帮助信息
    --version, -V           查看版本信息
`);
}

/**
 * 解析命令行参数
 *
 * @param {string[]} args 进程参数数组
 * @returns {object} 解析后的命令与配置
 */
export function parseArgs(args) {
  const parsed = {
    command: args[0] || 'help',
    input: null,
    output: null,
    providers: null,
    provenanceOutput: null,
    distDir: null,
    packageDir: null,
    target: null,
    version: null,
    repo: null,
    token: null,
    boaPath: null,
    source: null,
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' || arg === '-i') {
      parsed.input = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      parsed.output = args[++i];
    } else if (arg === '--providers' || arg === '-p') {
      parsed.providers = args[++i];
    } else if (arg === '--provenance-output') {
      parsed.provenanceOutput = args[++i];
    } else if (arg === '--dist-dir') {
      parsed.distDir = args[++i];
    } else if (arg === '--package-dir') {
      parsed.packageDir = args[++i];
    } else if (arg === '--target' || arg === '-t') {
      parsed.target = args[++i];
    } else if (arg === '--repo') {
      parsed.repo = args[++i];
    } else if (arg === '--token') {
      parsed.token = args[++i];
    } else if (arg === '--boa-path') {
      parsed.boaPath = args[++i];
    } else if (arg === '--source') {
      parsed.source = args[++i];
    } else if (!arg.startsWith('-')) {
      if (parsed.command === 'deploy' && !parsed.version) {
        parsed.version = arg;
      } else if (!parsed.input) {
        // 捕获首个位置参数 (例如: fleet verify dist/Script.js)
        parsed.input = arg;
      }
    }
  }

  return parsed;
}

/**
 * 格式化验证错误并阻断流程
 *
 * @param {string[]} errors 错误清单
 * @param {string} summary 失败异常摘要
 */
function assertNoErrors(errors, summary) {
  if (errors && errors.length > 0) {
    console.error('[fleet] Boa verification: FAILED');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    throw new Error(summary);
  }
}

/**
 * 执行完整的 Boa 0.22 门禁校验流水线 (版本 -> 静态语法 -> 运行时沙箱契约)
 *
 * @param {string} code 目标脚本代码
 * @param {string} failSummary 失败提示信息
 */
async function verifyScriptPipeline(code, failSummary) {
  console.log('[fleet] Running Boa 0.22 compatibility gate...');
  const { version } = await assertBoaCompatibilityEngine();
  console.log(`[fleet] Boa engine verified: ${version}`);

  const report = await validateScript(code);
  assertNoErrors(report.errors, failSummary);

  // 对目标脚本执行沙箱运行契约验证
  const runtimeOutput = await executeScriptWithBoa(code, { proxies: [], rules: [] }, 'default');

  console.log('[fleet] Boa verification: PASSED (Static marker, AST syntax, and runtime callable verified)');
  return runtimeOutput;
}

/**
 * 执行 build 命令 (构建 + 生成 Rule Asset Provenance 清单 + 强制 Fail-Closed 门禁校验 + Provider Parity 校验)
 *
 * @param {object} options 构建选项
 */
export async function runBuild(options) {
  const input = options.input || 'src/index.js';
  const output = options.output || 'dist/Script.js';

  // 1. 确定并校验 Rule Provider 声明式来源
  const resolvedProvidersPath = options.providers
    ? path.resolve(process.cwd(), options.providers)
    : path.resolve(process.cwd(), 'src/providers/rule-providers.yaml');

  let providers = [];
  if (fs.existsSync(resolvedProvidersPath)) {
    providers = loadRuleProvidersFile(resolvedProvidersPath);
  } else if (options.providers) {
    throw new Error(`Specified providers file not found: ${resolvedProvidersPath}`);
  }

  // 2. 确定性生成 Rule Asset Provenance Manifest
  const manifest = generateProvenanceManifest(providers);
  const resolvedOutputPath = path.resolve(process.cwd(), output);
  const resolvedProvenanceOutput = options.provenanceOutput
    ? path.resolve(process.cwd(), options.provenanceOutput)
    : path.join(path.dirname(resolvedOutputPath), 'RULE_ASSET_PROVENANCE.json');

  const provenanceDir = path.dirname(resolvedProvenanceOutput);
  if (!fs.existsSync(provenanceDir)) {
    fs.mkdirSync(provenanceDir, { recursive: true });
  }

  const manifestJson = serializeProvenanceManifest(manifest);
  fs.writeFileSync(resolvedProvenanceOutput, manifestJson, 'utf8');
  const manifestHash = crypto.createHash('sha256').update(manifestJson).digest('hex');
  console.log(`[fleet] Provenance manifest generated: ${resolvedProvenanceOutput} (Status: ${manifest.status}, SHA-256: ${manifestHash})`);

  // 3. 构建单一 Flat Script.js (单一权威源：传入当次已校验的 providers)
  console.log(`[fleet] Building flat script from ${input} -> ${output}...`);

  const buildResult = await buildFlatScript({
    input,
    output,
    validatedProviders: providers,
  });

  console.log(`[fleet] Build complete: ${buildResult.outputPath} (SHA-256: ${buildResult.hash})`);

  // 4. 强制执行 Boa 0.22 门禁
  const runtimeOutput = await verifyScriptPipeline(buildResult.code, 'Boa verification gate rejected the built script');

  // 5. 强制执行 Provider Provenance / Runtime Parity Gate (Fail-Closed)
  assertProviderParity(runtimeOutput, providers);
  console.log('[fleet] Provider provenance parity: PASSED (Manifest equals runtime rule-providers)');

  return {
    ...buildResult,
    manifest,
    provenancePath: resolvedProvenanceOutput,
    manifestHash,
  };
}

/**
 * 执行 package 命令 (确定性生成发布包边界构件与校验和)
 *
 * @param {object} options 打包选项
 */
export async function runPackage(options) {
  const distDir = options.distDir || 'dist';
  const packageDir = options.packageDir || 'dist/package';

  const scriptPath = path.resolve(process.cwd(), distDir, 'Script.js');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Cannot package: Script.js not found in ${distDir}. Run "fleet build" first.`);
  }

  // 门禁前置：确保待发布的 Script.js 严格满足 Boa 0.22 规范与契约
  console.log(`[fleet] Verifying Script.js against Boa 0.22 gate before packaging...`);
  const scriptCode = fs.readFileSync(scriptPath, 'utf8');
  await verifyScriptPipeline(scriptCode, 'Script.js in dist failed Boa compatibility gate');

  console.log(`[fleet] Creating deterministic release package from ${distDir} -> ${packageDir}...`);
  const result = createDeterministicPackage({ distDir, packageDir });

  // 内部即刻自验校验和
  verifyPackageChecksums(result.packageDir);

  console.log(`[fleet] Deterministic release package successfully created at: ${result.packageDir}`);
  for (const [file, hash] of Object.entries(result.checksums)) {
    console.log(`  - ${file}: ${hash}`);
  }
  return result;
}

/**
 * 执行 verify 命令
 *
 * @param {object} options 验证选项
 */
export async function runVerify(options) {
  const target = options.input || 'dist/Script.js';
  const resolvedTarget = path.resolve(process.cwd(), target);

  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Target script not found: ${resolvedTarget}`);
  }

  const code = fs.readFileSync(resolvedTarget, 'utf8');
  console.log(`[fleet] Verifying ${resolvedTarget}...`);

  await verifyScriptPipeline(code, 'Script failed Boa compatibility gate');
  return { valid: true };
}

/**
 * 执行 deploy 命令 (部署事务前半段: Discover -> Fetch -> Checksum -> Boa Preflight -> Backup -> Atomic Replace)
 *
 * @param {object} options 部署选项
 */
export async function runDeploy(options) {
  const version = options.version;
  if (!version) {
    throw new Error('Deployment version must be specified: fleet deploy <version>');
  }

  const target = options.target || process.env.FLEET_TARGET_SCRIPT;
  if (!target) {
    throw new Error(
      'Target script path must be specified via --target <path> or FLEET_TARGET_SCRIPT ' +
      '(Platform adapter topology discovery belongs to #8/#9).'
    );
  }

  console.log(`[fleet:deploy] Starting deployment transaction for version: ${version}`);
  console.log(`[fleet:deploy] Target script: ${path.resolve(target)}`);

  const result = await executeDeploymentTransaction({
    version,
    target,
    owner: options.repo ? options.repo.split('/')[0] : 'carllx',
    repo: options.repo ? (options.repo.includes('/') ? options.repo.split('/')[1] : options.repo) : 'clash-fleet',
    token: options.token,
    boaPath: options.boaPath,
    source: options.source,
  });

  console.log(`[fleet:deploy] Deployment Transaction PASSED (Steps 1–6):`);
  console.log(`  - Status: ${result.status}`);
  console.log(`  - Target: ${result.target}`);
  console.log(`  - Backup: ${result.backup} (SHA-256: ${result.backupSha256})`);
  console.log(`  - Candidate: SHA-256: ${result.candidateSha256}`);
  console.log(`  - Lifecycle Boundary: ${result.lifecycleBoundary}`);
  console.log(`  - Note: ${result.detail}`);
  return result;
}

/**
 * CLI 主入口执行函数
 *
 * @param {string[]} rawArgs 命令行参数
 */
export async function runCli(rawArgs) {
  const args = rawArgs.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-V')) {
    const pkgJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    console.log(`clash-fleet v${pkgJson.version}`);
    return;
  }

  const parsed = parseArgs(args);

  switch (parsed.command) {
    case 'build':
      await runBuild(parsed);
      break;
    case 'package':
      await runPackage(parsed);
      break;
    case 'verify':
      await runVerify(parsed);
      break;
    case 'deploy':
      await runDeploy(parsed);
      break;
    case 'help':
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${parsed.command}`);
      printHelp();
      process.exitCode = 1;
      break;
  }
}
