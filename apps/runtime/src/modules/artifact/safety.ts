export const RUNTIME_EVIDENCE_NOTICE =
  '本产物仅基于本次会话中用户提供的材料和上下文；若用户只提供摘录、片段或摘要，摘录外事实必须视为证据不足/待核查。';

function runDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Runtime structured artifacts are model-authored JSON. Before persisting them,
 * normalize platform-owned metadata so user-facing reports cannot carry stale
 * hallucinated dates, and always state the evidence boundary of the artifact.
 */
export function normalizeStructuredArtifactContent(content: string, now = new Date()): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  if (!isPlainRecord(parsed)) return content;

  const today = runDate(now);
  if (typeof parsed.generatedAt === 'string') parsed.generatedAt = today;
  if (typeof parsed.generated_at === 'string') parsed.generated_at = today;

  const meta = isPlainRecord(parsed.meta) ? parsed.meta : {};
  if (typeof meta.generatedAt === 'string') meta.generatedAt = today;
  if (typeof meta.generated_at === 'string') meta.generated_at = today;
  if (typeof meta.runtimeEvidenceNotice !== 'string') {
    meta.runtimeEvidenceNotice = RUNTIME_EVIDENCE_NOTICE;
  }
  parsed.meta = meta;

  return JSON.stringify(parsed, null, 2);
}
