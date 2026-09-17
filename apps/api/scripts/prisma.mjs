import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile(resolve(process.cwd(), '../../.env'));
} catch {
  // Prisma prints a precise message when a command actually needs DATABASE_URL.
}

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  env: process.env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
