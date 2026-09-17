import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'));
  } catch {
    // Prisma reports a precise error below if DATABASE_URL is still unavailable.
  }
}

export const db = new PrismaClient();
