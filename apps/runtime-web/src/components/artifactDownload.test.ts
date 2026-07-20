import { describe, expect, it } from 'vitest';
import { artifactDownloadFilename, artifactDownloadMeta } from './artifactDownload.js';

describe('artifactDownloadFilename', () => {
  it('keeps a readable title and maps artifact kinds to useful extensions', () => {
    expect(artifactDownloadFilename('季度复盘', 'markdown')).toBe('季度复盘.md');
    expect(artifactDownloadFilename('landing', 'html')).toBe('landing.html');
    expect(artifactDownloadFilename('payload', 'structured')).toBe('payload.json');
  });

  it('sanitizes path separators and does not duplicate an existing extension', () => {
    expect(artifactDownloadFilename('../客户/方案.HTML', 'html')).toBe('客户-方案.HTML');
    expect(artifactDownloadFilename('   ', 'code')).toBe('Combo 产物.txt');
  });
});

describe('artifactDownloadMeta', () => {
  it('uses a browser-friendly content type', () => {
    expect(artifactDownloadMeta('html').mime).toContain('text/html');
    expect(artifactDownloadMeta('structured').mime).toContain('application/json');
  });
});
