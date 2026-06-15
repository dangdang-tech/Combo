// API 层出口：typed client + SSE hook（均消费 @cb/shared 契约真源）。
export {
  ApiError,
  apiGet,
  apiGetEnvelope,
  apiPost,
  apiPatch,
  apiDelete,
  type RequestOptions,
  type IdempotencyScopeInput,
} from './client.js';
export {
  useSSE,
  type UseSSEState,
  type UseSSEOptions,
  type SSEConnectionStatus,
} from './useSSE.js';
