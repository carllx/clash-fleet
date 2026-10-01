#!/usr/bin/env node

import { runCli } from '../src/cli/cli.js';

runCli(process.argv).catch((err) => {
  console.error(`[fleet] Error: ${err.message}`);
  process.exit(1);
});
