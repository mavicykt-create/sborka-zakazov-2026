import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password.js';

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile(resolve(process.cwd(), '../../.env'));
  } catch {
    // Prisma reports the missing variable if the root env file is unavailable.
  }
}

const db = new PrismaClient();
const password = process.env.DEMO_WORKER_PASSWORD ?? randomBytes(12).toString('base64url');

const workers = [
  { login: 'anna', name: 'Анна Соколова' },
  { login: 'boris', name: 'Борис Ветров' },
  { login: 'vera', name: 'Вера Лукина' },
];

try {
  for (const worker of workers) {
    await db.worker.upsert({
      where: { login: worker.login },
      update: { name: worker.name, isActive: true },
      create: {
        ...worker,
        passwordHash: await hashPassword(password),
        isActive: true,
        shiftStatus: 'AVAILABLE',
      },
    });
  }
  console.log(`Созданы демонстрационные сборщики: ${workers.map((worker) => worker.login).join(', ')}`);
  if (!process.env.DEMO_WORKER_PASSWORD) {
    console.log(`Временный пароль для новых демонстрационных сборщиков: ${password}`);
  }
} finally {
  await db.$disconnect();
}
