import type { ArtifactView } from '@cb/shared';

const DOWNLOAD_META: Record<ArtifactView['kind'], { extension: string; mime: string }> = {
  html: { extension: 'html', mime: 'text/html;charset=utf-8' },
  markdown: { extension: 'md', mime: 'text/markdown;charset=utf-8' },
  code: { extension: 'txt', mime: 'text/plain;charset=utf-8' },
  structured: { extension: 'json', mime: 'application/json;charset=utf-8' },
};

export function artifactDownloadMeta(kind: ArtifactView['kind']): {
  extension: string;
  mime: string;
} {
  const meta = DOWNLOAD_META[kind];
  if (!meta) return { extension: 'txt', mime: 'text/plain;charset=utf-8' };
  return meta;
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 ? '-' : character;
  }).join('');
}

export function artifactDownloadFilename(title: string, kind: ArtifactView['kind']): string {
  const { extension } = artifactDownloadMeta(kind);
  const safeTitle = replaceControlCharacters(title.normalize('NFKC'))
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. -]+/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80);
  const base = safeTitle || 'Combo 产物';
  return base.toLocaleLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}

export function downloadArtifact(title: string, kind: ArtifactView['kind'], content: string): void {
  const { mime } = artifactDownloadMeta(kind);
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifactDownloadFilename(title, kind);
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
