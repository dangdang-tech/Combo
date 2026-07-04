import { describe, expect, it } from 'vitest';
import { normalizeStructuredArtifactContent, RUNTIME_EVIDENCE_NOTICE } from './safety.js';

describe('normalizeStructuredArtifactContent', () => {
  it('rewrites model-authored generatedAt fields to the runtime date', () => {
    const normalized = normalizeStructuredArtifactContent(
      JSON.stringify({
        generatedAt: '2025-07-07',
        meta: { generatedAt: '2025-07-07' },
        report: 'ok',
      }),
      new Date('2026-07-05T00:34:27.000Z'),
    );

    expect(JSON.parse(normalized)).toEqual({
      generatedAt: '2026-07-05',
      meta: {
        generatedAt: '2026-07-05',
        runtimeEvidenceNotice: RUNTIME_EVIDENCE_NOTICE,
      },
      report: 'ok',
    });
  });

  it('adds evidence-boundary metadata even when the model omits meta', () => {
    const normalized = normalizeStructuredArtifactContent(
      JSON.stringify({ findings: [{ status: 'needs_review' }] }),
      new Date('2026-07-05T00:34:27.000Z'),
    );

    expect(JSON.parse(normalized)).toEqual({
      findings: [{ status: 'needs_review' }],
      meta: { runtimeEvidenceNotice: RUNTIME_EVIDENCE_NOTICE },
    });
  });

  it('leaves invalid or non-object JSON unchanged', () => {
    expect(normalizeStructuredArtifactContent('{not-json')).toBe('{not-json');
    expect(normalizeStructuredArtifactContent('["a"]')).toBe('["a"]');
  });
});
