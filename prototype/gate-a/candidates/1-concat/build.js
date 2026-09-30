import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const SRC_DIR = path.resolve(ROOT_DIR, 'fixture/src');
const DIST_FILE = path.resolve(ROOT_DIR, 'dist/Script.concat.js');

/**
 * 极简拓扑拼接与剥离生成器 (Minimal Topological Concatenation & Stripping Generator)
 * 1. 确定模块拓扑依赖顺序: utils -> rules -> groups -> index
 * 2. 移除 ES Module 的 import 声明
 * 3. 移除 export 关键字声明，保留纯声明
 * 4. 保证全局显式包含并导出 function main(config, profileName)
 */
export function buildConcat() {
  const orderedFiles = [
    'utils.js',
    'rules.js',
    'groups.js',
    'index.js',
  ];

  const banner = [
    '/**',
    ' * Built by Clash Fleet Concatenation Generator',
    ' * Target: Clash Verge Rev (Boa Engine 0.22.0)',
    ' */',
    '',
  ].join('\n');

  let combined = banner;

  for (const fileName of orderedFiles) {
    const filePath = path.join(SRC_DIR, fileName);
    let code = fs.readFileSync(filePath, 'utf8');

    // 1. 剥离 import 语句 (支持单行与多行解构导入)
    code = code.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');

    // 2. 将 "export function name(" 替换为 "function name("
    code = code.replace(/export\s+function\s+/g, 'function ');

    // 3. 将 "export const name =" 替换为 "const name ="
    code = code.replace(/export\s+const\s+/g, 'const ');

    // 4. 将 "export let name =" 替换为 "let name ="
    code = code.replace(/export\s+let\s+/g, 'let ');

    // 5. 移除独立的 export { ... } 语句
    code = code.replace(/export\s*\{[\s\S]*?\};?/g, '');

    combined += `// --- Module: ${fileName} ---\n${code.trim()}\n\n`;
  }

  // 确保输出目录存在
  fs.mkdirSync(path.dirname(DIST_FILE), { recursive: true });
  fs.writeFileSync(DIST_FILE, combined.trim() + '\n', 'utf8');

  // 生成 Naive 纯文本拼装 (保留 import/export，对照实验)
  const naiveFiles = ['utils.js', 'rules.js', 'groups.js', 'index.js'];
  const naiveCombined = naiveFiles
    .map((f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8'))
    .join('\n\n');
  const naivePath = path.resolve(ROOT_DIR, 'dist/Script.concat-naive.js');
  fs.writeFileSync(naivePath, naiveCombined, 'utf8');

  console.log(`[concat] Generated adapted: ${DIST_FILE} (${fs.statSync(DIST_FILE).size} bytes)`);
  console.log(`[concat] Generated naive: ${naivePath} (${fs.statSync(naivePath).size} bytes)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildConcat();
}
