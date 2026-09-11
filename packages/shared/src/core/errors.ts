// ErrorEnvelope 绝不暴露内部错误码。对外只提供人话、退路和 traceId；
// 排障通过 traceId 关联服务端日志中的内部分类。
import { z } from 'zod';
import { TraceIdSchema } from './ids.js';

/** 用户遇错后的退路。可对 UI 展示的核心三类：retry|change_input|escalate；wait|none 为后台态/信息态。 */
export const ErrorActionSchema = z.enum(['retry', 'change_input', 'escalate', 'wait', 'none']);
export type ErrorAction = z.infer<typeof ErrorActionSchema>;

export const DISPLAYABLE_ACTIONS = ['retry', 'change_input', 'escalate'] as const;
export type DisplayableAction = (typeof DISPLAYABLE_ACTIONS)[number];

/** 对外错误体。userMessage 是唯一可展示的人话；不包含 code、状态码或堆栈。 */
export const ErrorBodySchema = z.object({
  userMessage: z.string().min(1),
  retriable: z.boolean(),
  action: ErrorActionSchema,
  /** 关联日志；前端可作“反馈代码”展示，但它不是错误分类码。 */
  traceId: TraceIdSchema,
  /** 仅登录等重定向场景使用的不透明失败标识。 */
  failureId: z.string().optional(),
  /** 结构化可安全展示补充；禁放堆栈、原始报错、内部路径或内部 code。 */
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** 完整对外错误信封。所有非 2xx 和前端可见失败都只使用这一形态。 */
export const ErrorEnvelopeSchema = z.object({ error: ErrorBodySchema });
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** 客户端兜底人话信封 traceId 哨兵值（不关联真实日志，不当「反馈代码」展示）。 */
export const CLIENT_FALLBACK_TRACE_ID = 'client-local';

// ---------- 内部错误码（命名 {DOMAIN}_{REASON}；对外只出 userMessage+action）----------

export const ErrorCode = {
  // 通用
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  STATE_CONFLICT: 'STATE_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  // 邮箱验证码认证
  AUTH_OTP_INVALID: 'AUTH_OTP_INVALID',
  AUTH_ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 错误分类条目：HTTP 状态 + retriable/action 缺省 + 人话模板。各处只引用、不重定义。 */
export interface ErrorClassification {
  code: ErrorCodeValue;
  http: number;
  retriable: boolean;
  action: ErrorAction;
  userMessageTemplate: string;
}

export const ERROR_CLASSIFICATION: Record<ErrorCodeValue, ErrorClassification> = {
  VALIDATION_FAILED: {
    code: 'VALIDATION_FAILED',
    http: 400,
    retriable: false,
    action: 'change_input',
    userMessageTemplate: '输入有点问题，改一下再试。',
  },
  UNAUTHENTICATED: {
    code: 'UNAUTHENTICATED',
    http: 401,
    retriable: false,
    action: 'escalate',
    userMessageTemplate: '请先登录。',
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    http: 403,
    retriable: false,
    action: 'escalate',
    userMessageTemplate: '你没有权限做这个操作。',
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    http: 404,
    retriable: false,
    action: 'change_input',
    userMessageTemplate: '没找到对应内容，可能已被删除。',
  },
  IDEMPOTENCY_CONFLICT: {
    code: 'IDEMPOTENCY_CONFLICT',
    http: 409,
    retriable: false,
    action: 'change_input',
    userMessageTemplate: '这个请求和之前的一次提交冲突了，刷新后再试。',
  },
  STATE_CONFLICT: {
    code: 'STATE_CONFLICT',
    http: 409,
    retriable: false,
    action: 'change_input',
    userMessageTemplate: '当前状态不允许这个操作，刷新看看最新状态。',
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    http: 429,
    retriable: true,
    action: 'wait',
    userMessageTemplate: '操作太频繁了，歇一会儿再试。',
  },
  INTERNAL: {
    code: 'INTERNAL',
    http: 500,
    retriable: true,
    action: 'retry',
    userMessageTemplate: '服务开小差了，请重试。',
  },
  DEPENDENCY_UNAVAILABLE: {
    code: 'DEPENDENCY_UNAVAILABLE',
    http: 503,
    retriable: true,
    action: 'retry',
    userMessageTemplate: '依赖服务暂时不可用，请稍后重试。',
  },
  AUTH_OTP_INVALID: {
    code: 'AUTH_OTP_INVALID',
    http: 401,
    retriable: false,
    action: 'change_input',
    userMessageTemplate: '验证码无效或已过期，请重新获取。',
  },
  AUTH_ACCOUNT_DISABLED: {
    code: 'AUTH_ACCOUNT_DISABLED',
    http: 403,
    retriable: false,
    action: 'escalate',
    userMessageTemplate: '账号已停用，请联系支持。',
  },
};

/** 按内部 code 组装对外错误体。内部 code 不进入响应。 */
export function errorBodyFor(
  code: ErrorCodeValue,
  traceId: string,
  overrides?: Partial<Pick<ErrorBody, 'userMessage' | 'details' | 'failureId'>>,
): { http: number; body: ErrorBody } {
  const c = ERROR_CLASSIFICATION[code];
  return {
    http: c.http,
    body: {
      userMessage: overrides?.userMessage ?? c.userMessageTemplate,
      retriable: c.retriable,
      action: c.action,
      traceId,
      ...(overrides?.failureId ? { failureId: overrides.failureId } : {}),
      ...(overrides?.details ? { details: overrides.details } : {}),
    },
  };
}
