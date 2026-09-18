import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

export const ADMIN_SESSION_COOKIE = 'assembly_admin_session';

export type AdminSession = {
  username: string;
  expiresAt: Date;
};

type StoredSession = AdminSession & {
  tokenHash: string;
};

export type AdminAuthOptions = {
  username?: string;
  password?: string;
  sessionSecret?: string;
  production?: boolean;
  now?: () => number;
};

export class AdminAuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AdminAuthError';
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export class AdminAuthService {
  readonly production: boolean;
  private readonly username: string;
  private readonly password: string;
  private readonly sessionSecret: string;
  private readonly now: () => number;
  private readonly sessions = new Map<string, StoredSession>();
  private readonly loginAttempts = new Map<string, number[]>();

  constructor(options: AdminAuthOptions = {}) {
    this.username = options.username ?? process.env.ADMIN_USERNAME ?? '';
    this.password = options.password ?? process.env.ADMIN_PASSWORD ?? '';
    this.sessionSecret = options.sessionSecret ?? process.env.ADMIN_SESSION_SECRET ?? '';
    this.production = options.production ?? process.env.NODE_ENV === 'production';
    this.now = options.now ?? Date.now;
  }

  login(username: string, password: string, ip: string): { token: string; session: AdminSession } {
    this.recordLoginAttempt(ip);
    const configured = Boolean(this.username && this.password && this.sessionSecret);
    const validUsername = constantTimeEqual(username, this.username);
    const validPassword = constantTimeEqual(password, this.password);
    if (!configured || !validUsername || !validPassword) {
      throw new AdminAuthError('Неверный логин или пароль', 401);
    }

    this.deleteExpiredSessions();
    const token = randomBytes(32).toString('base64url');
    const session: StoredSession = {
      username: this.username,
      expiresAt: new Date(this.now() + SESSION_DURATION_MS),
      tokenHash: this.hashToken(token),
    };
    this.sessions.set(session.tokenHash, session);
    return { token, session: { username: session.username, expiresAt: session.expiresAt } };
  }

  authenticate(token?: string): AdminSession {
    if (!token) throw new AdminAuthError('Требуется вход администратора', 401);
    const tokenHash = this.hashToken(token);
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt.getTime() <= this.now()) {
      this.sessions.delete(tokenHash);
      throw new AdminAuthError('Сессия администратора истекла, войдите снова', 401);
    }
    return { username: session.username, expiresAt: session.expiresAt };
  }

  logout(token?: string): void {
    if (!token) throw new AdminAuthError('Требуется вход администратора', 401);
    const tokenHash = this.hashToken(token);
    if (!this.sessions.delete(tokenHash)) {
      throw new AdminAuthError('Сессия администратора истекла, войдите снова', 401);
    }
  }

  private hashToken(token: string): string {
    return createHmac('sha256', this.sessionSecret).update(token).digest('hex');
  }

  private deleteExpiredSessions(): void {
    const now = this.now();
    for (const [tokenHash, session] of this.sessions) {
      if (session.expiresAt.getTime() <= now) this.sessions.delete(tokenHash);
    }
  }

  private recordLoginAttempt(ip: string): void {
    const now = this.now();
    const attempts = (this.loginAttempts.get(ip) ?? []).filter((attempt) => now - attempt < LOGIN_WINDOW_MS);
    if (attempts.length >= MAX_LOGIN_ATTEMPTS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - attempts[0])) / 1000));
      throw new AdminAuthError('Слишком много попыток входа. Повторите позже', 429, retryAfterSeconds);
    }
    attempts.push(now);
    this.loginAttempts.set(ip, attempts);
  }
}
