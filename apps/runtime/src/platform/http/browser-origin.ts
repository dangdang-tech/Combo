import { ErrorCode } from '@cb/shared';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Env } from '../config/env.js';
import { sendAuthError } from './_helpers.js';

type BrowserOriginEnv = Pick<Env, 'PUBLIC_APP_ORIGIN'>;

/** 公开站点配置必须是没有路径、凭据、查询或片段的 HTTP(S) origin。 */
export function canonicalBrowserOrigin(env: BrowserOriginEnv): string {
  try {
    const url = new URL(env.PUBLIC_APP_ORIGIN);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('invalid public origin');
    }
    return url.origin;
  } catch {
    throw new Error('[browser-origin] PUBLIC_APP_ORIGIN 必须是绝对 HTTP(S) origin');
  }
}

/** 凭据型 CORS 只反射唯一公开站点。 */
export function corsOriginPolicy(env: BrowserOriginEnv) {
  const allowed = canonicalBrowserOrigin(env);
  return (
    origin: string | undefined,
    callback: (error: Error | null, allow: boolean) => void,
  ): void => callback(null, origin !== undefined && origin === allowed);
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Cookie 鉴权的写请求必须来自唯一公开 origin，且 Fetch Metadata 不得是同站子域。 */
export function isTrustedMutationRequest(req: FastifyRequest): boolean {
  const origin = singleHeader(req.headers.origin);
  if (!origin || origin !== canonicalBrowserOrigin(req.server.infra.env)) return false;

  const rawFetchSite = req.headers['sec-fetch-site'];
  if (rawFetchSite === undefined) return true;
  return typeof rawFetchSite === 'string' && rawFetchSite.toLowerCase() === 'same-origin';
}

export function requireTrustedMutationOrigin(): preHandlerHookHandler {
  return async function (req, reply) {
    if (isTrustedMutationRequest(req)) return;

    req.log.warn(
      { code: ErrorCode.FORBIDDEN, traceId: req.id },
      'blocked untrusted browser mutation request',
    );
    return sendAuthError(req, reply, ErrorCode.FORBIDDEN);
  };
}
