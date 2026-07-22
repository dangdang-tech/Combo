import { afterEach, describe, expect, it, vi } from 'vitest';

const COMMON = {
  DATABASE_URL: 'postgres://test.invalid/test',
  REDIS_QUEUE_URL: 'redis://test.invalid/0',
  REDIS_HOT_URL: 'redis://test.invalid/0',
  S3_ENDPOINT: 'https://objects.example.test',
  S3_ACCESS_KEY: 'test-access-value',
  S3_SECRET_KEY: 'test-secret-value',
};

async function freshLoadEnv() {
  vi.resetModules();
  return (await import('../platform/config/env.js')).loadEnv;
}

function stub(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('authoring authentication environment boundary', () => {
  it('fails production API startup on missing auth keys without printing values', async () => {
    stub({
      ...COMMON,
      NODE_ENV: 'production',
      PROCESS: 'api',
      PUBLIC_APP_ORIGIN: 'https://combo.example',
      RESEND_API_KEY: '',
      RESEND_FROM_EMAIL: '',
      OTP_HMAC_SECRET: '',
    });
    const loadEnv = await freshLoadEnv();

    expect(loadEnv).toThrowError(/RESEND_API_KEY/);
    try {
      loadEnv();
    } catch (error) {
      expect(String(error)).not.toContain('test-secret-value');
      expect(String(error)).not.toContain('postgres://test.invalid/test');
    }
  });

  it('pins production to the official Resend HTTPS base and a secure public origin', async () => {
    stub({
      ...COMMON,
      NODE_ENV: 'production',
      PROCESS: 'api',
      PUBLIC_APP_ORIGIN: 'https://combo.example',
      RESEND_API_KEY: 'test-resend-key-value',
      RESEND_FROM_EMAIL: 'login@example.test',
      OTP_HMAC_SECRET: 'h'.repeat(32),
      RESEND_API_BASE_URL: 'http://127.0.0.1:45678',
    });
    const loadEnv = await freshLoadEnv();

    expect(loadEnv).toThrowError(/RESEND_API_BASE_URL/);
    try {
      loadEnv();
    } catch (error) {
      expect(String(error)).not.toContain('test-resend-key-value');
      expect(String(error)).not.toContain('127.0.0.1');
    }
  });

  it('rejects a malformed production sender at startup without printing the address', async () => {
    const invalidSender = 'not-a-resend-sender';
    stub({
      ...COMMON,
      NODE_ENV: 'production',
      PROCESS: 'api',
      PUBLIC_APP_ORIGIN: 'https://combo.example',
      RESEND_API_KEY: 'test-resend-key-value',
      RESEND_FROM_EMAIL: invalidSender,
      OTP_HMAC_SECRET: 'h'.repeat(32),
    });
    const loadEnv = await freshLoadEnv();

    expect(loadEnv).toThrowError(/RESEND_FROM_EMAIL/);
    try {
      loadEnv();
    } catch (error) {
      expect(String(error)).not.toContain(invalidSender);
      expect(String(error)).not.toContain('test-resend-key-value');
    }
  });

  it('accepts a display name with a syntactically valid Resend sender mailbox', async () => {
    stub({
      ...COMMON,
      NODE_ENV: 'production',
      PROCESS: 'api',
      PUBLIC_APP_ORIGIN: 'https://combo.example',
      RESEND_API_KEY: 'test-resend-key-value',
      RESEND_FROM_EMAIL: 'Agora Login <login@example.test>',
      OTP_HMAC_SECRET: 'h'.repeat(32),
    });
    const loadEnv = await freshLoadEnv();

    expect(loadEnv().RESEND_FROM_EMAIL).toBe('Agora Login <login@example.test>');
  });

  it('does not require or materialize production auth secrets for the worker process', async () => {
    stub({
      ...COMMON,
      NODE_ENV: 'production',
      PROCESS: 'worker',
      RESEND_API_KEY: '',
      RESEND_FROM_EMAIL: '',
      OTP_HMAC_SECRET: '',
    });
    const loadEnv = await freshLoadEnv();

    const env = loadEnv();
    expect(env.PROCESS).toBe('worker');
    expect(env.RESEND_API_KEY).toBe('');
    expect(env.RESEND_FROM_EMAIL).toBe('');
    expect(env.OTP_HMAC_SECRET).toBe('');
  });

  it('allows a local Resend mock base only in test', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stub({
      ...COMMON,
      NODE_ENV: 'test',
      PROCESS: 'api',
      PUBLIC_APP_ORIGIN: 'http://localhost',
      RESEND_API_KEY: 'test-resend-key-value',
      RESEND_FROM_EMAIL: 'login@example.test',
      OTP_HMAC_SECRET: 'h'.repeat(32),
      RESEND_API_BASE_URL: 'http://127.0.0.1:45678',
    });
    const loadEnv = await freshLoadEnv();

    expect(loadEnv().RESEND_API_BASE_URL).toBe('http://127.0.0.1:45678');
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('test-resend-key-value'));
  });
});
