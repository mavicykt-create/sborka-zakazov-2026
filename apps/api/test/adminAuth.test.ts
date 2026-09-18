import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuthService } from '../src/modules/auth/adminAuth.js';
import { buildApp } from '../src/server.js';

vi.mock('../src/db.js', () => ({
  db: { $queryRaw: vi.fn().mockResolvedValue([{ connected: 1 }]) },
}));

const username = 'admin';
const password = 'correct-admin-password';
const sessionSecret = 'test-session-secret-that-is-never-returned';

describe('admin authentication', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      frontendRoot: false,
      adminAuthService: new AdminAuthService({
        username,
        password,
        sessionSecret,
        production: true,
      }),
      loginPicker: async (login) => ({
        token: 'independent-picker-token',
        expiresAt: new Date('2026-09-19T00:00:00.000Z'),
        worker: {
          id: 'picker-1',
          login,
          name: 'Тестовый сборщик',
          isActive: true,
          shiftStatus: 'AVAILABLE',
        },
      }),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    '/api/orders',
    '/api/order-items/test/status',
    '/api/workers',
    '/api/dashboard',
    '/api/analytics',
    '/api/imports',
    '/api/problems',
    '/api/settings',
  ])('rejects an unauthenticated request to %s', async (url) => {
    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Требуется вход администратора' });
  });

  it('creates a secure HttpOnly session and revokes it on logout', async () => {
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username, password: 'wrong-password' },
    });
    expect(rejected.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username, password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json<{ admin: { username: string } }>().admin.username).toBe(username);

    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toContain('assembly_admin_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    const cookie = setCookie.split(';')[0];

    const me = await app.inject({ method: 'GET', url: '/api/admin/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ admin: { username: string } }>().admin.username).toBe(username);

    const protectedApi = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(protectedApi.statusCode).toBe(200);
    expect(protectedApi.json<{ service: string }>().service).toBe('assembly-orders-2026');

    const logout = await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(200);

    const revoked = await app.inject({ method: 'GET', url: '/api/admin/me', headers: { cookie } });
    expect(revoked.statusCode).toBe(401);
    const revokedAdminApi = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(revokedAdminApi.statusCode).toBe(401);

    const serializedResponse = `${login.body}\n${JSON.stringify(login.headers)}\n${me.body}`;
    expect(serializedResponse).not.toContain(password);
    expect(serializedResponse).not.toContain(sessionSecret);
  });

  it('keeps health and picker login public and independent', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const pickerLogin = await app.inject({
      method: 'POST',
      url: '/api/picker/login',
      payload: { login: 'picker', password: 'picker-password' },
    });
    expect(pickerLogin.statusCode).toBe(200);
    expect(pickerLogin.json<{ token: string }>().token).toBe('independent-picker-token');
    expect(pickerLogin.headers['set-cookie']).toBeUndefined();
  });

  it('limits admin login to five attempts per minute and returns Retry-After', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { username, password: 'wrong-password' },
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username, password },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
  });
});
