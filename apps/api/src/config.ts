type RuntimeEnvironment = Record<string, string | undefined>;

export function validateProductionEnvironment(env: RuntimeEnvironment = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const errors: string[] = [];
  if (!env.DATABASE_URL?.trim()) errors.push('DATABASE_URL is required');

  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret || jwtSecret === 'change-me') {
    errors.push('JWT_SECRET must be set to a secure value');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid production environment: ${errors.join('; ')}`);
  }
}
