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

  await t.test('fleet build fails closed when BOA_PATH points to incompatible version (e.g. 0.23.0)', async () => {
    const fakeBoa = path.join(OUTPUT_DIR, 'fake-boa');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      fakeBoa,
      '#!/bin/sh\necho "boa 0.23.0"\n',
      { mode: 0o755 }
    );

    await assert.rejects(
      async () => {
        await execFileAsync(
          process.execPath,
          [CLI_PATH, 'build', '--input', FIXTURE_ENTRY, '--output', OUTPUT_FILE, '--verify'],
          { env: { ...process.env, BOA_PATH: fakeBoa } }
        );
      },
      (err) => err.code !== 0 && /Incompatible Boa engine/i.test(err.stderr || err.stdout)
    );
  });

  await t.test('fleet verify validates target script using positional argument', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      CLI_PATH,
      'verify',
      OUTPUT_FILE,
    ]);

    assert.match(stdout, /Verifying/i);
    assert.match(stdout, /Boa verification: PASSED/i);
  });
});
