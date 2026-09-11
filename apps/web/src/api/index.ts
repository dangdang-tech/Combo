// API 层出口：认证、typed client 与当前 Agent Package 交付接口。
export {
  ApiError,
  apiGet,
  apiPost,
  fallbackErrorBody,
  sanitizeErrorBody,
  unwrapErrorBody,
  type RequestOptions,
} from './client.js';
export {
  AuthRequestError,
  requestEmailChallenge,
  verifyEmail,
  probeAuthSession,
  EMAIL_CHALLENGE_PATH,
  EMAIL_VERIFICATION_PATH,
  AUTH_ME_PATH,
  type AuthSessionProbe,
} from './auth.js';
export * from './agentPackages.js';
