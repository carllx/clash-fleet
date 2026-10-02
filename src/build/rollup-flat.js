import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hasCvrStaticMarker } from '../harness/boa-harness.js';
import { rollup } from 'rollup';
import YAML from 'yaml';
import { parseRulesYaml, parseRegionsYaml, parseRuleProvidersYaml } from '../loader/declarative.js';

/**
 * Rollup 构建期 YAML 解析插件
 *
 * 在构建打包时将声明式 YAML 转换为纯 JavaScript 数据导出，
 * 避免在运行时产生对 Node.js/文件系统/YAML 库的任何依赖。
 *
 * @param {object} [options] 插件选项
 * @param {Array<object>} [options.validatedProviders] 当次构建已校验的权威 providers 数据 (保证单权威源)
 */
export function rollupYamlPlugin(options = {}) {
  const { validatedProviders } = options;
  return {
    name: 'rollup-yaml-plugin',
    transform(code, id) {
      if (!id.endsWith('.yaml') && !id.endsWith('.yml')) {
        return null;
      }

      var parsedData;
      if (/(direct|reject)\.(yaml|yml)$/.test(id)) {
        parsedData = parseRulesYaml(code, id);
      } else if (id.endsWith('regions.yaml') || id.endsWith('regions.yml')) {
        parsedData = parseRegionsYaml(code, id);
      } else if (id.endsWith('rule-providers.yaml') || id.endsWith('rule-providers.yml')) {
        // 单一权威源保证：若构建期传入了全局唯一校验的 providers 数据，直接使用该权威数据
        parsedData = Array.isArray(validatedProviders)
          ? validatedProviders
          : parseRuleProvidersYaml(code, id);
      } else {
        parsedData = YAML.parse(code);
      }

      return {
        code: `export default ${JSON.stringify(parsedData)};`,
        map: { mappings: '' },
      };
    },
  };
}

/**
 * 剥离代码中的 ES Module 导出声明，使其退化为原生顶层声明
 *
 * @param {string} code 源代码
 * @returns {string} 剥离 export 后的脚本内容
 */
export function stripModuleExports(code) {
  let cleaned = code;

  // 1. 移除具名导出块: export { a, b as c };
  cleaned = cleaned.replace(/^\s*export\s*\{[\s\S]*?\};?\s*$/gm, '');

  // 2. 剥离直接导出声明: export function / export const / export let / export var / export class
  cleaned = cleaned.replace(/^\s*export\s+(async\s+function|function|const|let|var|class)\b/gm, '$1');

  // 3. 移除 export default 声明
  cleaned = cleaned.replace(/^\s*export\s+default\s+/gm, '');

  // 整理连续空行并保留末尾单换行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim() + '\n';

  return cleaned;
}

/**
 * 使用 Rollup 进行 Scope-Hoisted 扁平化打包，生成兼容 Boa 0.22 的单一脚本
 *
 * @param {object} options 构建选项
 * @param {string} options.input 入口文件绝对路径或相对路径
 * @param {string} options.output 目标产物路径
 * @param {string} [options.banner] 自定义头部注释
 * @param {Array<object>} [options.validatedProviders] 当次构建全局唯一的权威 providers 数据
 * @returns {Promise<{ code: string, outputPath: string, hash: string }>} 构建结果
 */
export async function buildFlatScript({ input, output, banner, validatedProviders }) {
  const resolvedInput = path.resolve(process.cwd(), input);
  const resolvedOutput = path.resolve(process.cwd(), output);

  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Entry file not found: ${resolvedInput}`);
  }

  const bundle = await rollup({
    input: resolvedInput,
    plugins: [rollupYamlPlugin({ validatedProviders })],
    treeshake: {
      moduleSideEffects: 'no-external',
      propertyReadSideEffects: true,
      tryCatchDeoptimization: false,
    },
    onwarn(warning, defaultHandler) {
      // 模块同名变量被 Rollup 重命名属于符合预期的正常行为，忽略冲突提醒
      if (warning.code === 'CIRCULAR_DEPENDENCY') return;
      defaultHandler(warning);
    },
  });

  const { output: outputChunks } = await bundle.generate({
    format: 'es',
    generatedCode: {
      preset: 'es2015',
    },
    compact: false,
  });

  await bundle.close();

  if (!outputChunks || outputChunks.length === 0) {
    throw new Error('Rollup produced no output chunks');
  }

  const rawChunk = outputChunks[0];
  const strippedCode = stripModuleExports(rawChunk.code);

  // 严格确保最终代码包含原生可调用的 top-level main 函数
  if (!hasCvrStaticMarker(strippedCode)) {
    throw new Error("Build output must expose top-level main function ('function main', 'const main', or 'let main')");
  }

  const finalBanner = banner
    ? `${banner.trim()}\n\n`
    : '// Clash Fleet generated Script.js - Deterministic Flat Build\n\n';

  const finalCode = `${finalBanner}${strippedCode}`;

  // 确保输出目录存在
  const outputDir = path.dirname(resolvedOutput);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(resolvedOutput, finalCode, 'utf8');

  const hash = crypto.createHash('sha256').update(finalCode).digest('hex');

  return {
    code: finalCode,
    outputPath: resolvedOutput,
    hash,
  };
}
