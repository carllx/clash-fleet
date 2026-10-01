import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '../bin/fleet.js');
const FIXTURE_ENTRY = path.resolve(__dirname, 'fixtures/modular/index.js');
const OUTPUT_DIR = path.resolve(__dirname, '../.tmp/cli-test');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'Script.js');

test('CLI fleet build command suite', async (t) => {
  await t.test('fleet build outputs valid Script.js with exit code 0', async () => {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      CLI_PATH,
      'build',
      '--input', FIXTURE_ENTRY,
      '--output', OUTPUT_FILE,
      '--verify',
    ]);

    assert.equal(fs.existsSync(OUTPUT_FILE), true, 'Output file should exist');
    const content = fs.readFileSync(OUTPUT_FILE, 'utf8');
    assert.match(content, /function main\s*\(/);
    assert.match(stdout, /Build complete/i);
    assert.match(stdout, /Boa verification: PASSED/i);
  });

  await t.test('fleet build fails with non-zero exit code on non-existent input', async () => {
    await assert.rejects(
      async () => {
        await execFileAsync(process.execPath, [
          CLI_PATH,
          'build',
          '--input', 'non-existent-file.js',
          '--output', OUTPUT_FILE,
        ]);
      },
      (err) => err.code !== 0
    );
  });
});
