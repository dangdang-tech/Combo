import type { FastifyInstance } from 'fastify';
import { CreateStudioTestBodySchema, type CreateStudioTestResult, type RunInput } from '@cb/shared';
import type { RuntimeContext } from '../../bootstrap/context.js';
import { badRequest, notFound } from '../../platform/http/errors.js';
import { requireCreatorIdentity } from '../../platform/http/auth.js';
import { runAgui } from '../agent/agui-run.js';
import { createRun, setRunStatus } from '../run/repo.js';
import { createEventLogEmitter } from '../run/event-log-emitter.js';
import { createSession, getSessionRow } from '../session/repo.js';
import {
  createStudioTestRecord,
  getStudioRevision,
  getStudioState,
  isStudioTestSession,
  setStudioTestStatus,
} from './repo.js';

export async function registerStudioRoutes(
  app: FastifyInstance,
  ctx: RuntimeContext,
): Promise<void> {
  app.get<{ Params: { id: string } }>('/runtime/studio/sessions/:id', async (req, reply) => {
    const identity = await requireCreatorIdentity(req, reply, ctx.pool, ctx.env);
    if (!identity) return reply;
    const row = await getSessionRow(ctx.pool, req.params.id, identity.userId);
    if (
      !row ||
      row.mode !== 'trial' ||
      row.publicView.status !== 'draft' ||
      (await isStudioTestSession(ctx.pool, row.id))
    ) {
      return notFound(reply, req.id);
    }
    return reply.send(await getStudioState(ctx.pool, row.id));
  });

  app.post<{ Params: { id: string } }>('/runtime/studio/sessions/:id/tests', async (req, reply) => {
    const identity = await requireCreatorIdentity(req, reply, ctx.pool, ctx.env);
    if (!identity) return reply;
    const ownerId = identity.userId;
    const studio = await getSessionRow(ctx.pool, req.params.id, ownerId);
    if (
      !studio ||
      studio.mode !== 'trial' ||
      studio.publicView.status !== 'draft' ||
      (await isStudioTestSession(ctx.pool, studio.id))
    ) {
      return notFound(reply, req.id);
    }
    const parsed = CreateStudioTestBodySchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, req.id);
    const revision = await getStudioRevision(ctx.pool, studio.id, parsed.data.revisionId);
    if (!revision) return notFound(reply, req.id);

    // A real capability test gets a clean child session. Design conversation
    // and UI artifacts never enter the Agent's execution transcript.
    const testMeta = await createSession(ctx.pool, {
      ownerId,
      capabilityId: studio.capabilityId,
      slug: studio.slug,
      version: studio.version,
      mode: 'trial',
      title: `${studio.publicView.name} · UI R${revision.revisionNo} 试用`,
      instructions: studio.instructions,
      manifestHash: studio.manifestHash,
      publicView: studio.publicView,
    });
    const testSession = await getSessionRow(ctx.pool, testMeta.id, ownerId);
    if (!testSession) throw new Error('studio test session was not persisted');

    const runBody: RunInput = {
      contentParts: [{ type: 'text', text: parsed.data.prompt }],
      intent: 'capability',
    };
    const run = await createRun(ctx.pool, {
      sessionId: testSession.id,
      ownerId,
      body: runBody,
    });
    const test = await createStudioTestRecord(ctx.pool, {
      studioSessionId: studio.id,
      revisionId: revision.id,
      testSessionId: testSession.id,
      runId: run.id,
    });
    const controller = new AbortController();
    ctx.runControls.set(run.id, controller);
    const emitter = createEventLogEmitter({
      pool: ctx.pool,
      threadId: testSession.id,
      runId: run.id,
      signal: controller.signal,
    });

    void runAgui({
      env: ctx.env,
      pool: ctx.pool,
      session: testSession,
      runId: run.id,
      userText: parsed.data.prompt,
      intent: 'capability',
      emitter,
      log: req.log,
    })
      .then(async (status) => {
        await setRunStatus(ctx.pool, run.id, status);
        await setStudioTestStatus(ctx.pool, run.id, status);
      })
      .catch(async (error: unknown) => {
        req.log.error(error, 'studio test run crashed');
        await Promise.all([
          setRunStatus(ctx.pool, run.id, 'failed', 'studio test crashed'),
          setStudioTestStatus(ctx.pool, run.id, 'failed'),
        ]).catch(() => undefined);
      })
      .finally(() => {
        ctx.runControls.delete(run.id);
      });

    const response: CreateStudioTestResult = {
      test,
      run,
      eventsUrl: `/api/v1/runtime/runs/${run.id}/events`,
    };
    return reply.code(202).send(response);
  });
}
