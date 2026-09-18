export const DEVELOPMENT_API_BASE = 'http://localhost:8080';

export function resolveApiBase(configuredBase: string | undefined, isProduction: boolean): string {
  const normalizedBase = configuredBase?.trim().replace(/\/+$/, '');
  if (normalizedBase) return normalizedBase;
  return isProduction ? '' : DEVELOPMENT_API_BASE;
}

export const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD);
