import { describe, expect, it } from 'vitest';
import { CREATOR_NAV } from './routes.js';

describe('CREATOR_NAV', () => {
  it('keeps the upload-to-trial journey visible in the creator sidebar', () => {
    expect(CREATOR_NAV.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: '上传任务', path: '/tasks' },
      { label: '我的能力', path: '/capabilities' },
      { label: '能力市集', path: '/try/market' },
    ]);
    expect(CREATOR_NAV.at(-1)?.external).toBe(true);
  });
});
