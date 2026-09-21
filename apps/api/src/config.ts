type RuntimeEnvironment = Record<string, string | undefined>;

export function validateProductionEnvironment(env: RuntimeEnvironment = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const errors: string[] = [];
  if (!env.DATABASE_URL?.trim()) errors.push('DATABASE_URL is required');

  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret || jwtSecret === 'change-me') {
    errors.push('JWT_SECRET must be set to a secure value');
  }

  if (!env.ADMIN_USERNAME?.trim()) errors.push('ADMIN_USERNAME is required');

  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12) {
    errors.push('ADMIN_PASSWORD must be at least 12 characters');
  }

  if (!env.ADMIN_SESSION_SECRET?.trim()) {
    errors.push('ADMIN_SESSION_SECRET is required');
  }

  if (!env.ONEC_EXCHANGE_TOKEN || env.ONEC_EXCHANGE_TOKEN.length < 32) {
    errors.push('ONEC_EXCHANGE_TOKEN must be at least 32 characters');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid production environment: ${errors.join('; ')}`);
  }
}
