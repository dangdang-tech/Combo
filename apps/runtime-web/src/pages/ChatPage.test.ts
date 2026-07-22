import { describe, expect, it } from 'vitest';
import { resolveTrialCanvasState } from './ChatPage.js';

describe('resolveTrialCanvasState', () => {
  it('keeps the honest page skeleton while a first artifact is still running', () => {
    expect(resolveTrialCanvasState({ messageCount: 2, running: true, hasArtifact: false })).toBe(
      'running',
    );
  });

  it('keeps an existing artifact visible while applying another edit', () => {
    expect(resolveTrialCanvasState({ messageCount: 3, running: true, hasArtifact: true })).toBe(
      'output',
    );
  });

  it('shows intake only before any conversation or artifact exists', () => {
    expect(resolveTrialCanvasState({ messageCount: 0, running: false, hasArtifact: false })).toBe(
      'intake',
    );
  });
});
