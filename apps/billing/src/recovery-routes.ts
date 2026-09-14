import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreatePaymentBodySchema,
  PaymentApiErrorResponseSchema,
  RecoverPaymentBodySchema,
  RecoverablePaymentResponseSchema,
} from '@cb/payment-protocol';
import { ChannelConflictError } from './channel-service.js';
import { PaymentAuthenticationError } from './payment-auth.js';
import type { PaymentStore } from './payment-service.js';
import type { CheckoutRecovery } from './recovery-service.js';
import { recoveryCheckoutHtml } from './recovery-page.js';

export interface RecoveryRoutes {
  recovery: CheckoutRecovery;
  payments: PaymentStore;
  authenticateUser(request: FastifyRequest): Promise<string | null>;
  testMode: boolean;
}
const Id = z.object({ paymentId: z.string().uuid() }).strict();
const Method = z.object({ payType: z.enum(['wechat', 'alipay']) }).strict();
export function registerRecoveryRoutes(app: FastifyInstance, deps: RecoveryRoutes) {
  app.register(async (scope) => {
    const users = new WeakMap<FastifyRequest, string>();
    function fail(req: FastifyRequest, reply: FastifyReply, status: number) {
      return reply.code(status).send(
        PaymentApiErrorResponseSchema.parse({
          error: {
            userMessage:
              status === 401
                ? '请重新登录当前账户。'
                : status === 404
                  ? '未找到可访问的支付。'
                  : status === 409
                    ? '支付状态已变化，请刷新查看原支付。'
                    : '支付暂时无法处理，请稍后查询原支付。',
            retriable: status === 503,
            action: status === 503 ? 'retry' : 'none',
            traceId: req.id,
          },
        }),
      );
    }
    scope.addHook('onRequest', async (req, reply) => {
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');
      try {
        const user = await deps.authenticateUser(req);
        if (!user || !z.string().uuid().safeParse(user).success) return fail(req, reply, 401);
        users.set(req, user);
      } catch (error) {
        return fail(req, reply, error instanceof PaymentAuthenticationError ? error.status : 503);
      }
    });
    scope.setErrorHandler((error, req, reply) =>
      fail(
        req,
        reply,
        error instanceof ChannelConflictError
          ? 409
          : typeof error === 'object' &&
              error !== null &&
              'statusCode' in error &&
              Number(error.statusCode) < 500
            ? 400
            : 503,
      ),
    );
    const send = (req: FastifyRequest, reply: FastifyReply, data: unknown, status = 200) =>
      data
        ? reply
            .code(status)
            .send(RecoverablePaymentResponseSchema.parse({ data, meta: { traceId: req.id } }))
        : fail(req, reply, 404);
    scope.post('/v2/payments', async (req, reply) => {
      const input = CreatePaymentBodySchema.safeParse(req.body);
      if (!input.success) return fail(req, reply, 400);
      const result = await deps.payments.createPayment({ userId: users.get(req)!, ...input.data });
      if (result.kind !== 'payment')
        return fail(req, reply, result.kind === 'conflict' ? 409 : 404);
      return send(
        req,
        reply,
        await deps.recovery.view(result.payment.paymentRequestId, users.get(req)!),
        result.replayed ? 200 : 201,
      );
    });
    scope.get('/v2/payments/by-request-key/:requestKey', async (req, reply) => {
      const input = z
        .object({
          requestKey: z
            .string()
            .min(8)
            .max(128)
            .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*[A-Za-z0-9]$/),
        })
        .strict()
        .safeParse(req.params);
      if (!input.success) return fail(req, reply, 400);
      const p = await deps.payments.findPayment({
        userId: users.get(req)!,
        requestKey: input.data.requestKey,
      });
      return send(
        req,
        reply,
        p ? await deps.recovery.view(p.paymentRequestId, users.get(req)!) : null,
      );
    });
    scope.get('/v2/payments/:paymentId', async (req, reply) => {
      const input = Id.safeParse(req.params);
      if (!input.success) return fail(req, reply, 400);
      return send(req, reply, await deps.recovery.view(input.data.paymentId, users.get(req)!));
    });
    scope.post('/v2/payments/:paymentId/recover', async (req, reply) => {
      const id = Id.safeParse(req.params);
      const input = RecoverPaymentBodySchema.safeParse(req.body);
      if (!id.success || !input.success) return fail(req, reply, 400);
      return send(
        req,
        reply,
        await deps.recovery.recover(id.data.paymentId, users.get(req)!, input.data),
        202,
      );
    });
    scope.get('/v2/payment-checkouts/:paymentId', async (req, reply) => {
      const id = Id.safeParse(req.params);
      if (!id.success) return fail(req, reply, 400);
      const data = await deps.recovery.qr(id.data.paymentId, users.get(req)!);
      if (!data) return fail(req, reply, 404);
      const { qrContent, ...view } = data;
      return {
        data: {
          ...view,
          ...(qrContent
            ? {
                qrImage: await QRCode.toDataURL(qrContent, {
                  width: 280,
                  margin: 2,
                  errorCorrectionLevel: 'M',
                }),
              }
            : {}),
        },
        meta: { traceId: req.id },
      };
    });
    scope.post('/v2/payment-checkouts/:paymentId', async (req, reply) => {
      const id = Id.safeParse(req.params);
      const input = Method.safeParse(req.body);
      if (!id.success || !input.success) return fail(req, reply, 400);
      return send(
        req,
        reply,
        await deps.recovery.create(id.data.paymentId, users.get(req)!, input.data.payType),
      );
    });
  });
}

/** Used by the existing authenticated /payments route, only for an explicit version=2. */
export function recoveryPage(reply: FastifyReply, paymentId: string, testMode: boolean) {
  const nonce = randomBytes(18).toString('base64');
  return reply
    .header(
      'content-security-policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    )
    .type('text/html; charset=utf-8')
    .send(recoveryCheckoutHtml(paymentId, nonce, testMode));
}
