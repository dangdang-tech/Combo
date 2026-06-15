import { describe, it, expect } from 'vitest';
import {
  buildError,
  buildErrorWithCode,
  ErrorBodySchema,
  ErrorCode,
  ErrorEnvelopeSchema,
  lintUserMessage,
  httpStatusFor,
  REQUIRED_IDEMPOTENCY_SCOPES,
  SSE_EVENT_TYPES,
  ErrorFramePayloadSchema,
  DonePayloadSchema,
  envelopeSchema,
  MeViewSchema,
  CreateCapabilityBodySchema,
  buildOpenApiDocument,
  REGISTERED_SCHEMA_NAMES,
  OutboxTopicSchema,
  ACTIVE_OUTBOX_TOPICS,
  TOPIC_CLASS,
  NotifyReviewDecidedPayloadSchema,
  CapabilityPublishedPayloadSchema,
  CapabilityUnpublishedPayloadSchema,
  NotifyImportCompletedPayloadSchema,
  NotifyExtractCompletedPayloadSchema,
  NotifyPublishCompletedPayloadSchema,
  UsageMeteringPayloadSchema,
  RuntimeSessionEventPayloadSchema,
} from '../index.js';
import { z } from 'zod';

describe('ErrorEnvelope', () => {
  it('builds from classification table with userMessage + action', () => {
    const env = buildError(ErrorCode.UNAUTHENTICATED, '01J-trace');
    expect(env.error.action).toBe('escalate');
    expect(env.error.userMessage).toContain('登录');
    expect(ErrorEnvelopeSchema.safeParse(env).success).toBe(true);
  });

  it('outbound envelope NEVER contains code (D1: code is internal-only)', () => {
    const env = buildError(ErrorCode.EXTRACT_UPSTREAM_TIMEOUT, 't');
    // 对外信封不含 code（仅 userMessage/action/retriable/traceId/failureId?/details?）。
    expect('code' in env.error).toBe(false);
    expect((env.error as Record<string, unknown>).code).toBeUndefined();
    // 即便构造时塞 code 字段，对外 schema 也会剥离（strip）—— 解析结果里无 code。
    const parsed = ErrorBodySchema.parse({
      code: 'SHOULD_BE_STRIPPED',
      userMessage: '人话',
      action: 'retry',
      retriable: true,
      traceId: 't',
    } as Record<string, unknown>);
    expect('code' in parsed).toBe(false);
  });

  it('buildErrorWithCode keeps code internal, envelope code-free (D1)', () => {
    const { code, envelope } = buildErrorWithCode(ErrorCode.INTERNAL, 'tr');
    // 内部 code 单独可读（供日志/告警，经 traceId 关联）。
    expect(code).toBe(ErrorCode.INTERNAL);
    // 对外信封仍不含 code。
    expect('code' in envelope.error).toBe(false);
    expect(envelope.error.traceId).toBe('tr');
  });

  it('SSE error frame payload = full outbound ErrorEnvelope (Codex#2), code-free', () => {
    const env = buildError(ErrorCode.STRUCTURE_FIELD_FAILED, 't', {
      details: { field: 'tagline', attempts: 2 },
    });
    // error 帧 = 完整对外信封（{ error: {...} }），不是裸 ErrorBody。
    expect(ErrorFramePayloadSchema.safeParse(env).success).toBe(true);
    // 裸 ErrorBody（无外层 error 包裹）不被 error 帧 schema 接受。
    expect(ErrorFramePayloadSchema.safeParse(env.error).success).toBe(false);
    // error 帧里不含 code。
    const ok = ErrorFramePayloadSchema.parse(env);
    expect('code' in ok.error).toBe(false);
  });

  it('SSE done frame error = full outbound ErrorEnvelope (Codex#2)', () => {
    const env = buildError(ErrorCode.JOB_TIMEOUT, 't');
    expect(DonePayloadSchema.safeParse({ status: 'failed', error: env }).success).toBe(true);
    // done.error 不接受裸 ErrorBody（须是完整信封）。
    expect(DonePayloadSchema.safeParse({ status: 'failed', error: env.error }).success).toBe(false);
  });

  it('maps code → http status', () => {
    expect(httpStatusFor(ErrorCode.NOT_FOUND)).toBe(404);
    expect(httpStatusFor(ErrorCode.PUBLISH_MISSING_FIELDS)).toBe(422);
  });

  it('all default userMessages are human-readable (no leaked codes/stack/SQL)', () => {
    for (const code of Object.values(ErrorCode)) {
      const env = buildError(code, 't');
      expect(lintUserMessage(env.error.userMessage)).toHaveLength(0);
    }
  });
});

describe('constants', () => {
  it('exposes 22 required idempotency scopes', () => {
    expect(REQUIRED_IDEMPOTENCY_SCOPES.length).toBe(22);
    expect(new Set(REQUIRED_IDEMPOTENCY_SCOPES).size).toBe(22);
  });

  it('exposes exactly 12 SSE event types', () => {
    expect(SSE_EVENT_TYPES.length).toBe(12);
  });
});

describe('zod DTOs', () => {
  it('envelope factory wraps data', () => {
    const schema = envelopeSchema(z.object({ ok: z.boolean() }));
    expect(schema.safeParse({ data: { ok: true } }).success).toBe(true);
  });

  it('MeView parses a valid /me payload', () => {
    const ok = MeViewSchema.safeParse({
      id: 'u1',
      logtoUserId: 'sub1',
      account: 'WAYNE',
      email: null,
      roles: ['creator'],
      status: 'active',
      hasProfile: false,
      creatorId: 'u1',
      createdAt: '2026-06-15T00:00:00Z',
      lastLoginAt: null,
    });
    expect(ok.success).toBe(true);
  });

  it('CreateCapabilityBody enforces EXACTLY-one of three sources (Codex#7)', () => {
    // 恰好一个 → 通过（三分支各一例）。
    expect(CreateCapabilityBodySchema.safeParse({ sourceCandidateId: 'c1' }).success).toBe(true);
    expect(CreateCapabilityBodySchema.safeParse({ capabilityId: 'cap1' }).success).toBe(true);
    expect(CreateCapabilityBodySchema.safeParse({ fromVersionId: 'v1' }).success).toBe(true);
    // 带可选 draftId 不影响「恰好一个 source」判定。
    expect(
      CreateCapabilityBodySchema.safeParse({ sourceCandidateId: 'c1', draftId: 'd1' }).success,
    ).toBe(true);
    // 零个 → 拒。
    expect(CreateCapabilityBodySchema.safeParse({}).success).toBe(false);
    expect(CreateCapabilityBodySchema.safeParse({ draftId: 'd1' }).success).toBe(false);
    // 两个并存（任意配对）→ 拒（含旧 refine 漏掉的 sourceCandidateId+capabilityId）。
    expect(
      CreateCapabilityBodySchema.safeParse({ sourceCandidateId: 'c1', capabilityId: 'cap1' })
        .success,
    ).toBe(false);
    expect(
      CreateCapabilityBodySchema.safeParse({ fromVersionId: 'v1', capabilityId: 'cap1' }).success,
    ).toBe(false);
    expect(
      CreateCapabilityBodySchema.safeParse({ fromVersionId: 'v1', sourceCandidateId: 'c1' })
        .success,
    ).toBe(false);
    // 三个全给 → 拒。
    expect(
      CreateCapabilityBodySchema.safeParse({
        sourceCandidateId: 'c1',
        capabilityId: 'cap1',
        fromVersionId: 'v1',
      }).success,
    ).toBe(false);
  });
});

describe('events / outbox topics', () => {
  // B-30 评审事件 topic 单一权威（Codex#11-r4）：50/70/shared 必须同名为 notify.review_decided。
  // 旧分裂名 capability.review_resolved 绝不复活（防回归再次劈成两 topic）。
  it('canonical review topic = notify.review_decided (never the old capability.review_resolved)', () => {
    expect(OutboxTopicSchema.safeParse('notify.review_decided').success).toBe(true);
    expect(OutboxTopicSchema.safeParse('capability.review_resolved').success).toBe(false);
    expect(ACTIVE_OUTBOX_TOPICS).toContain('notify.review_decided');
  });

  it('every ACTIVE topic is a typed OutboxTopic with a TOPIC_CLASS mapping', () => {
    for (const t of ACTIVE_OUTBOX_TOPICS) {
      expect(OutboxTopicSchema.safeParse(t).success).toBe(true);
      expect(TOPIC_CLASS[t]).toBeDefined();
    }
  });

  it('TOPIC_CLASS covers all topics; notify.review_decided is class notify', () => {
    for (const t of OutboxTopicSchema.options) {
      expect(TOPIC_CLASS[t]).toBeDefined();
    }
    expect(TOPIC_CLASS['notify.review_decided']).toBe('notify');
  });

  it('NotifyReviewDecidedPayload accepts the authoritative review-decided payload', () => {
    const ok = NotifyReviewDecidedPayloadSchema.safeParse({
      recipientId: 'u1',
      capabilityId: 'cap1',
      versionId: 'v1',
      decision: 'rejected',
      rejectReason: '标题不够清晰',
      link: '/creator/builder?capabilityId=cap1',
      traceId: '01J-trace',
      occurredAt: '2026-06-16T00:00:00Z',
    });
    expect(ok.success).toBe(true);
  });
});

// 全量 outbox topic × payload 一致性自核验（Codex r5 防再漏）：
//   shared events.ts 是【已实现真源】，50/60/70 契约描述必须字段级对齐到它。
//   下表枚举每个 active topic 的权威 payload 形态（= 70 §7 / shared），逐一断言：
//   ① 权威完整 payload 通过；② 旧/错形态被拒（capability.unpublished 不再接受 versionId/review_rejected）。
describe('events / payload consistency sweep (every outbox topic)', () => {
  const ISO = '2026-06-16T00:00:00+00:00';

  it('capability.published — full authoritative payload parses; isRollback/ownerUserId required', () => {
    const full = {
      capabilityId: 'cap1',
      versionId: 'v1',
      slug: 'my-capability',
      manifestHash: 'sha256:abc',
      reviewStatus: 'alpha_pending',
      isRollback: false,
      ownerUserId: 'u1',
      traceId: '01J-trace',
      occurredAt: ISO,
    };
    expect(CapabilityPublishedPayloadSchema.safeParse(full).success).toBe(true);
    // rollback 路径（评审拒绝回退上一版）：isRollback=true + published。
    expect(
      CapabilityPublishedPayloadSchema.safeParse({
        ...full,
        isRollback: true,
        reviewStatus: 'published',
      }).success,
    ).toBe(true);
    // 旧契约缺 isRollback/ownerUserId/traceId/occurredAt（50 旧 `{versionId,reviewStatus,visibility,slug,manifestHash}`）→ 拒。
    expect(
      CapabilityPublishedPayloadSchema.safeParse({
        versionId: 'v1',
        reviewStatus: 'alpha_pending',
        slug: 'my-capability',
        manifestHash: 'sha256:abc',
      }).success,
    ).toBe(false);
  });

  it('capability.unpublished — authoritative reason=review_rejected_no_prev; old shape rejected', () => {
    const ok = CapabilityUnpublishedPayloadSchema.safeParse({
      capabilityId: 'cap1',
      reason: 'review_rejected_no_prev',
      ownerUserId: 'u1',
      traceId: '01J-trace',
      occurredAt: ISO,
    });
    expect(ok.success).toBe(true);
    // 旧 50 契约 `{ versionId, reason:'review_rejected' }` 必须被拒（reason 字面量已收紧 + 缺字段）。
    expect(
      CapabilityUnpublishedPayloadSchema.safeParse({ versionId: 'v1', reason: 'review_rejected' })
        .success,
    ).toBe(false);
    // 仅 reason 字面量错（其余齐全）也拒。
    expect(
      CapabilityUnpublishedPayloadSchema.safeParse({
        capabilityId: 'cap1',
        reason: 'review_rejected',
        ownerUserId: 'u1',
        traceId: '01J-trace',
        occurredAt: ISO,
      }).success,
    ).toBe(false);
  });

  it('notify.import_completed — base(recipientId/link/traceId/occurredAt) + jobId/attemptNo/snapshotId/segmentCount', () => {
    expect(
      NotifyImportCompletedPayloadSchema.safeParse({
        recipientId: 'u1',
        link: '/creator/builder?step=import',
        traceId: '01J-trace',
        occurredAt: ISO,
        jobId: 'j1',
        attemptNo: 1,
        snapshotId: 'snap1',
        segmentCount: 215,
      }).success,
    ).toBe(true);
  });

  it('notify.extract_completed — base + jobId/attemptNo/candidateCount', () => {
    expect(
      NotifyExtractCompletedPayloadSchema.safeParse({
        recipientId: 'u1',
        link: '/creator/builder?step=extract',
        traceId: '01J-trace',
        occurredAt: ISO,
        jobId: 'j1',
        attemptNo: 1,
        candidateCount: 9,
      }).success,
    ).toBe(true);
  });

  it('notify.publish_completed — base + versionId/capabilityId/reviewStatus=alpha_pending', () => {
    expect(
      NotifyPublishCompletedPayloadSchema.safeParse({
        recipientId: 'u1',
        link: '/creator/builder?step=publish',
        traceId: '01J-trace',
        occurredAt: ISO,
        versionId: 'v1',
        capabilityId: 'cap1',
        reviewStatus: 'alpha_pending',
      }).success,
    ).toBe(true);
  });

  it('frozen topics (usage.metering / runtime.session_event) keep their frozen schema shape', () => {
    expect(
      UsageMeteringPayloadSchema.safeParse({
        sessionId: 's1',
        turn: 1,
        attempt: 1,
        consumerKey: 'anon-hash',
        tokens: 100,
        costMicros: 5,
        revenueMicros: 8,
        mode: 'paid',
        traceId: '01J-trace',
        occurredAt: ISO,
      }).success,
    ).toBe(true);
    expect(
      RuntimeSessionEventPayloadSchema.safeParse({
        sessionId: 's1',
        phase: 'init',
        traceId: '01J-trace',
        occurredAt: ISO,
      }).success,
    ).toBe(true);
  });

  it('every ACTIVE topic has an exercised payload schema (no topic left unswept)', () => {
    // active = capability.published/unpublished + 四个 notify.*；本块已逐一断言其权威 payload。
    const sweptActive = new Set([
      'capability.published',
      'capability.unpublished',
      'notify.import_completed',
      'notify.extract_completed',
      'notify.publish_completed',
      'notify.review_decided', // 上一 describe 块断言
    ]);
    for (const t of ACTIVE_OUTBOX_TOPICS) {
      expect(sweptActive.has(t)).toBe(true);
    }
    expect(sweptActive.size).toBe(ACTIVE_OUTBOX_TOPICS.length);
  });
});

describe('OpenAPI', () => {
  it('generates a 3.1 document with all registered component schemas', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    const schemas = doc.components?.schemas ?? {};
    for (const name of REGISTERED_SCHEMA_NAMES) {
      expect(schemas[name]).toBeDefined();
    }
    expect(schemas['ErrorEnvelope']).toBeDefined();
  });
});
