import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const ENTRY_FILE = path.resolve(ROOT_DIR, 'fixture/src/index.js');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

export async function buildRollup() {
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const bundle = await rollup({
    input: ENTRY_FILE,
  });

  // 1. Rollup Flat (Strip-Export): 优雅利用作用域提升，消除 IIFE 闭包，剥离 export 成为纯顶层函数
  const flatResult = await bundle.generate({
    format: 'es',
    banner: '/**\n * Built by Clash Fleet Rollup Candidate (Flat Mode)\n * Target: Clash Verge Rev (Boa Engine 0.22.0)\n */\n',
  });
  const flatCode = flatResult.output[0].code.replace(/export\s*\{[\s\S]*?\};?/g, '').trim() + '\n';
  const flatPath = path.join(DIST_DIR, 'Script.rollup-flat.js');
  fs.writeFileSync(flatPath, flatCode, 'utf8');

  // 2. Rollup IIFE + Adapter: IIFE 格式挂载全局对象，并通过 footer 桥接暴露 function main
  const iifeResult = await bundle.generate({
    format: 'iife',
    name: 'fleetBundle',
    banner: '/**\n * Built by Clash Fleet Rollup Candidate (IIFE Mode)\n * Target: Clash Verge Rev (Boa Engine 0.22.0)\n */\n',
    footer: '\nfunction main(config, profileName) { return fleetBundle.main(config, profileName); }',
  });
  const iifePath = path.join(DIST_DIR, 'Script.rollup-iife.js');
  fs.writeFileSync(iifePath, iifeResult.output[0].code, 'utf8');

  // 3. Rollup Naive IIFE: 默认未配置 footer 的 IIFE（用于对照失败）
  const naiveResult = await bundle.generate({
    format: 'iife',
    name: 'fleetBundle',
  });
  const naivePath = path.join(DIST_DIR, 'Script.rollup-naive.js');
  fs.writeFileSync(naivePath, naiveResult.output[0].code, 'utf8');

  console.log(`[rollup] Generated flat: ${flatPath} (${fs.statSync(flatPath).size} bytes)`);
  console.log(`[rollup] Generated iife: ${iifePath} (${fs.statSync(iifePath).size} bytes)`);
  console.log(`[rollup] Generated naive: ${naivePath} (${fs.statSync(naivePath).size} bytes)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildRollup();
}
