import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MANAGED_KEYS = [
  'NODE_ENV',
  'DATABASE_URL',
  'REDIS_URL',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'PUBLIC_APP_ORIGIN',
] as const;

const originalValues = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of MANAGED_KEYS) originalValues.set(key, process.env[key]);
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    const value = originalValues.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalValues.clear();
  vi.resetModules();
});

function setProductionInfrastructure(): void {
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = 'postgres://runtime:runtime@database.invalid/runtime';
  process.env.REDIS_URL = 'redis://redis.invalid:6379';
  process.env.S3_ENDPOINT = 'https://objects.invalid';
  process.env.S3_ACCESS_KEY = 'test-placeholder';
  process.env.S3_SECRET_KEY = 'test-placeholder';
  process.env.PUBLIC_APP_ORIGIN = 'https://combo.example';
}

describe('runtime authentication configuration', () => {
  it('does not expose remote identity-provider or local token-signing configuration', async () => {
    setProductionInfrastructure();
    vi.resetModules();

    const { loadEnv } = await import('../platform/config/env.js');
    const env = loadEnv() as unknown as Record<string, unknown>;

    expect(env.NODE_ENV).toBe('production');
    expect(Object.keys(env).join(' ')).not.toMatch(
      /issuer|jwks|audience|token.*secret|session.*secret/i,
    );
  });

  it('rejects a non-HTTPS public app origin in production', async () => {
    setProductionInfrastructure();
    process.env.PUBLIC_APP_ORIGIN = 'http://combo.example';
    vi.resetModules();

    const { loadEnv } = await import('../platform/config/env.js');
    expect(() => loadEnv()).toThrowError('PUBLIC_APP_ORIGIN');
  });

  it('keeps PostgreSQL, runtime infrastructure and public origin as production startup requirements', async () => {
    process.env.NODE_ENV = 'production';
    for (const key of [
      'DATABASE_URL',
      'REDIS_URL',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'PUBLIC_APP_ORIGIN',
    ] as const) {
      delete process.env[key];
    }
    vi.resetModules();

    const { loadEnv } = await import('../platform/config/env.js');
    let message = '';
    try {
      loadEnv();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('REDIS_URL');
    expect(message).toContain('S3_ENDPOINT');
    expect(message).toContain('PUBLIC_APP_ORIGIN');
    expect(message).not.toMatch(/identity|issuer|jwks|audience|session.*secret/i);
  });
});
