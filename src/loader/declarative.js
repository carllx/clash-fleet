import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/**
 * 声明式数据构建期加载器
 *
 * 仅用于 Node.js 构建期流水线，严禁在运行时引入。
 */

/**
 * 加载并校验声明式规则文件
 *
 * @param {string} filePath 规则文件绝对路径
 * @returns {string[]} 标准化后的规则字符串数组
 */
export function loadRulesFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(content);

  if (!parsed || !Array.isArray(parsed.rules)) {
    throw new Error(`Invalid rules schema in ${filePath}: expected top-level 'rules' array`);
  }

  return parsed.rules.map((rule) => {
    if (typeof rule !== 'string') {
      throw new Error(`Rule item must be a string, got ${typeof rule} in ${filePath}`);
    }
    const trimmed = rule.trim();
    if (!trimmed) {
      throw new Error(`Empty rule entry in ${filePath}`);
    }
    return trimmed;
  });
}

/**
 * 加载并校验地区预设文件
 *
 * @param {string} filePath 地区预设文件绝对路径
 * @returns {Record<string, { name: string, emoji?: string, pattern: string }>} 地区字典
 */
export function loadRegionsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(content);

  if (!parsed || typeof parsed.regions !== 'object' || parsed.regions === null) {
    throw new Error(`Invalid regions schema in ${filePath}: expected top-level 'regions' map`);
  }

  const validatedRegions = {};
  for (const [key, region] of Object.entries(parsed.regions)) {
    if (!region || typeof region.name !== 'string' || typeof region.pattern !== 'string') {
      throw new Error(`Region ${key} must include valid 'name' and 'pattern'`);
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
 * 一次性加载全部声明式源码数据
 *
 * @param {object} options 加载选项
 * @param {string} options.rootDir 源码根目录 (如 src)
 * @returns {{ directRules: string[], rejectRules: string[], regions: object }} 声明式数据包
 */
export function loadAllDeclarativeSources({ rootDir }) {
  const directPath = path.join(rootDir, 'rules/direct.yaml');
  const rejectPath = path.join(rootDir, 'rules/reject.yaml');
  const regionsPath = path.join(rootDir, 'presets/regions.yaml');

  return {
    directRules: loadRulesFile(directPath),
    rejectRules: loadRulesFile(rejectPath),
    regions: loadRegionsFile(regionsPath),
  };
}
