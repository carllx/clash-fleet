import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/**
 * 声明式数据构建期加载器
 *
 * 仅用于 Node.js 构建期流水线，严禁在运行时引入。
 */

/**
 * 安全读取并解析 YAML 文件
 *
 * @param {string} filePath 文件路径
 * @returns {any} 解析后的数据对象
 */
function readYamlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return YAML.parse(content);
}

/**
 * 解析并校验声明式规则 YAML 内容
 *
 * @param {string|object} content YAML 字符串或已解析对象
 * @param {string} [sourceId] 数据来源标识 (供报错提示)
 * @returns {string[]} 标准化后的规则字符串数组
 */
export function parseRulesYaml(content, sourceId = 'rules') {
  const parsed = typeof content === 'string' ? YAML.parse(content) : content;

  if (!parsed || !Array.isArray(parsed.rules)) {
    throw new Error(`Invalid rules schema in ${sourceId}: expected top-level 'rules' array`);
  }

  return parsed.rules.map((rule) => {
    if (typeof rule !== 'string') {
      throw new Error(`Rule item must be a string, got ${typeof rule} in ${sourceId}`);
    }
    const trimmed = rule.trim();
    if (!trimmed) {
      throw new Error(`Empty rule entry in ${sourceId}`);
    }
    return trimmed;
  });
}

/**
 * 解析并校验地区预设 YAML 内容
 *
 * @param {string|object} content YAML 字符串或已解析对象
 * @param {string} [sourceId] 数据来源标识 (供报错提示)
 * @returns {Record<string, { name: string, emoji?: string, pattern: string }>} 地区字典
 */
export function parseRegionsYaml(content, sourceId = 'regions') {
  const parsed = typeof content === 'string' ? YAML.parse(content) : content;

  if (!parsed || typeof parsed.regions !== 'object' || parsed.regions === null) {
    throw new Error(`Invalid regions schema in ${sourceId}: expected top-level 'regions' map`);
  }

  const validatedRegions = {};
  for (const [key, region] of Object.entries(parsed.regions)) {
    if (!region || typeof region.name !== 'string' || typeof region.pattern !== 'string') {
      throw new Error(`Region ${key} must include valid 'name' and 'pattern'`);
    }

    // 校验 pattern 必须为合法正则表达式 (Fail-Closed)
    try {
      new RegExp(region.pattern);
    } catch (err) {
      throw new Error(`Invalid regex pattern in region '${key}' (${sourceId}): ${err.message}`);
    }

    validatedRegions[key] = {
      name: region.name,
      emoji: region.emoji || '',
      pattern: region.pattern,
    };
  }

  return validatedRegions;
}

/**
 * 从文件加载并校验声明式规则
 *
 * @param {string} filePath 规则文件绝对路径
 * @returns {string[]} 标准化后的规则字符串数组
 */
export function loadRulesFile(filePath) {
  const parsed = readYamlFile(filePath);
  return parseRulesYaml(parsed, filePath);
}

/**
 * 从文件加载并校验地区预设
 *
 * @param {string} filePath 地区预设文件绝对路径
 * @returns {Record<string, { name: string, emoji?: string, pattern: string }>} 地区字典
 */
export function loadRegionsFile(filePath) {
  const parsed = readYamlFile(filePath);
  return parseRegionsYaml(parsed, filePath);
}

export {
  parseRuleProvidersYaml,
  loadRuleProvidersFile,
  generateProvenanceManifest,
  serializeProvenanceManifest,
  assertProviderParity,
  STATUS_NO_EXTERNAL,
  STATUS_FULLY_PINNED,
  STATUS_CONTAINS_DYNAMIC,
  CLASSIFICATION_PINNED,
  CLASSIFICATION_DYNAMIC,
  ROLLBACK_SEMANTICS_PINNED,
  ROLLBACK_SEMANTICS_DYNAMIC,
  STRATEGY_PINNED,
  STRATEGY_DYNAMIC,
} from './rule-providers.js';

import { loadRuleProvidersFile } from './rule-providers.js';

/**
 * 一次性加载全部声明式源码数据
 *
 * @param {object} options 加载选项
 * @param {string} options.rootDir 源码根目录 (如 src)
 * @returns {{ directRules: string[], rejectRules: string[], aiRules: string[], mediaRules: string[], darwinRules: string[], win32Rules: string[], regions: object, ruleProviders: Array<object> }} 声明式数据包
 */
export function loadAllDeclarativeSources({ rootDir }) {
  const directPath = path.join(rootDir, 'rules/direct.yaml');
  const rejectPath = path.join(rootDir, 'rules/reject.yaml');
  const aiPath = path.join(rootDir, 'rules/ai-services.yaml');
  const mediaPath = path.join(rootDir, 'rules/media-services.yaml');
  const darwinPath = path.join(rootDir, 'rules/platforms/darwin.yaml');
  const win32Path = path.join(rootDir, 'rules/platforms/win32.yaml');
  const regionsPath = path.join(rootDir, 'presets/regions.yaml');
  const providersPath = path.join(rootDir, 'providers/rule-providers.yaml');

  return {
    directRules: loadRulesFile(directPath),
    rejectRules: loadRulesFile(rejectPath),
    aiRules: fs.existsSync(aiPath) ? loadRulesFile(aiPath) : [],
    mediaRules: fs.existsSync(mediaPath) ? loadRulesFile(mediaPath) : [],
    darwinRules: fs.existsSync(darwinPath) ? loadRulesFile(darwinPath) : [],
    win32Rules: fs.existsSync(win32Path) ? loadRulesFile(win32Path) : [],
    regions: loadRegionsFile(regionsPath),
    ruleProviders: fs.existsSync(providersPath) ? loadRuleProvidersFile(providersPath) : [],
  };
}

