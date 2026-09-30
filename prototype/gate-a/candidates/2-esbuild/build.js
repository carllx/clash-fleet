import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const ENTRY_FILE = path.resolve(ROOT_DIR, 'fixture/src/index.js');
const DIST_FILE = path.resolve(ROOT_DIR, 'dist/Script.esbuild.js');
const DIST_NAIVE_FILE = path.resolve(ROOT_DIR, 'dist/Script.esbuild-naive.js');

export async function buildEsbuild() {
  fs.mkdirSync(path.dirname(DIST_FILE), { recursive: true });

  // 1. 带 small adapter 的兼容构建 (Supported with small adapter)
  await esbuild.build({
    entryPoints: [ENTRY_FILE],
    bundle: true,
    outfile: DIST_FILE,
    format: 'iife',
    globalName: 'fleetBundle',
    target: 'es2020',
    footer: {
      js: '\nfunction main(config, profileName) { return fleetBundle.main(config, profileName); }',
    },
    banner: {
      js: '/**\n * Built by Clash Fleet esbuild Candidate\n * Target: Clash Verge Rev (Boa Engine 0.22.0)\n */',
    },
  });

  // 2. 原生默认未适配构建 (用于记录 Naive / Zero-Adapter 失败对照)
  await esbuild.build({
    entryPoints: [ENTRY_FILE],
    bundle: true,
    outfile: DIST_NAIVE_FILE,
    format: 'iife',
    target: 'es2020',
  });

  console.log(`[esbuild] Generated adapted: ${DIST_FILE} (${fs.statSync(DIST_FILE).size} bytes)`);
  console.log(`[esbuild] Generated naive: ${DIST_NAIVE_FILE} (${fs.statSync(DIST_NAIVE_FILE).size} bytes)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildEsbuild();
}
