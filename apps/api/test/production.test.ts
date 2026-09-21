import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveApiBase } from '../../admin/src/apiBase';
import { validateProductionEnvironment } from '../src/config.js';
import { buildApp } from '../src/server.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('production configuration', () => {
  it('uses same-origin API in production and localhost in development', () => {
    expect(resolveApiBase(undefined, true)).toBe('');
    expect(resolveApiBase(undefined, false)).toBe('http://localhost:8080');
    expect(resolveApiBase('https://api.example.test/', true)).toBe('https://api.example.test');
  });

  it('requires database, JWT and administrator secrets in production', () => {
    expect(() => validateProductionEnvironment({ NODE_ENV: 'production' })).toThrow(
      'DATABASE_URL is required',
    );
    expect(() =>
      validateProductionEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://example',
        JWT_SECRET: 'change-me',
      }),
    ).toThrow('JWT_SECRET must be set to a secure value');
    expect(() =>
      validateProductionEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://example',
        JWT_SECRET: 'production-secret',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'short',
        ADMIN_SESSION_SECRET: 'admin-session-secret',
      }),
    ).toThrow('ADMIN_PASSWORD must be at least 12 characters');
    expect(() =>
      validateProductionEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://example',
        JWT_SECRET: 'production-secret',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'production-admin-password',
      }),
    ).toThrow('ADMIN_SESSION_SECRET is required');
    expect(() =>
      validateProductionEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://example',
        JWT_SECRET: 'production-secret',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'production-admin-password',
        ADMIN_SESSION_SECRET: 'production-admin-session-secret',
        ONEC_EXCHANGE_TOKEN: 'production-onec-exchange-token-1234567890',
      }),
    ).not.toThrow();
  });
});

describe('production frontend serving', () => {
  it('serves the SPA without intercepting API and health routes', async () => {
    const frontendRoot = await mkdtemp(join(tmpdir(), 'assembly-frontend-'));
    temporaryDirectories.push(frontendRoot);
    await writeFile(join(frontendRoot, 'index.html'), '<!doctype html><title>Production terminal</title>');

    const app = await buildApp({ frontendRoot });
    const root = await app.inject({ method: 'GET', url: '/' });
    const spaRoute = await app.inject({ method: 'GET', url: '/orders/current' });
    const missingApi = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    const health = await app.inject({ method: 'GET', url: '/health' });
    const missingHealth = await app.inject({ method: 'GET', url: '/health/does-not-exist' });

    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('Production terminal');
    expect(spaRoute.statusCode).toBe(200);
    expect(spaRoute.body).toContain('Production terminal');
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toEqual({ error: 'Маршрут не найден' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true, service: 'assembly-orders-2026' });
    expect(missingHealth.statusCode).toBe(404);
    expect(missingHealth.json()).toEqual({ error: 'Маршрут не найден' });
    await app.close();
  });
});
