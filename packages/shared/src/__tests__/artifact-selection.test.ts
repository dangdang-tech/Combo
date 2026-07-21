import { describe, expect, it } from 'vitest';
import { selectPrimaryArtifactKey } from '../domains/runtime-api.js';

describe('selectPrimaryArtifactKey', () => {
  it('keeps the explicit main deliverable selected when an auxiliary result follows it', () => {
    expect(
      selectPrimaryArtifactKey([
        { artifactKey: 'main', kind: 'html' },
        { artifactKey: 'checklist', kind: 'structured' },
      ]),
    ).toBe('main');
  });

  it('prefers the latest HTML artifact for legacy sessions without a main key', () => {
    expect(
      selectPrimaryArtifactKey([
        { artifactKey: 'draft-page', kind: 'html' },
        { artifactKey: 'audit', kind: 'structured' },
        { artifactKey: 'revised-page', kind: 'html' },
      ]),
    ).toBe('revised-page');
  });

  it('falls back to the latest artifact when there is no main or HTML output', () => {
    expect(
      selectPrimaryArtifactKey([
        { artifactKey: 'notes', kind: 'markdown' },
        { artifactKey: 'score', kind: 'structured' },
      ]),
    ).toBe('score');
    expect(selectPrimaryArtifactKey([])).toBeNull();
  });
});
