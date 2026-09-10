import { z } from 'zod';

export const RECEIVER_VERSION = 'combo.agent-package-receiver/2' as const;
export const RECEIVER_BUN_VERSION = '1.4.2' as const;
export const MAX_RECEIVER_ARTIFACT_BYTES = 134_217_728;
export const RECEIVER_TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const;
export const ReceiverTargetSchema = z.enum(RECEIVER_TARGETS);
export type ReceiverTarget = z.infer<typeof ReceiverTargetSchema>;
export const ReceiverArtifactSchema = z
  .object({
    target: ReceiverTargetSchema,
    filename: z.string().regex(/^(?:darwin|linux)-(?:arm64|x64)-[0-9a-f]{64}\.bin$/u),
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    byteLength: z.number().int().positive().max(MAX_RECEIVER_ARTIFACT_BYTES),
  })
  .strict()
  .refine((value) => value.filename === `${value.target}-${value.digest.slice(7)}.bin`);
export const ReceiverManifestSchema = z
  .object({
    protocol: z.literal('combo.agent-package-receiver-artifacts/2'),
    receiverVersion: z.literal(RECEIVER_VERSION),
    bunVersion: z.literal(RECEIVER_BUN_VERSION),
    artifacts: z.array(ReceiverArtifactSchema).length(RECEIVER_TARGETS.length),
  })
  .strict()
  .refine(
    (value) =>
      JSON.stringify(value.artifacts.map(({ target }) => target).sort()) ===
      JSON.stringify(RECEIVER_TARGETS),
  );
export type ReceiverManifest = z.infer<typeof ReceiverManifestSchema>;
