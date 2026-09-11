// combo-artifacts 的不可变 exact-byte S3/MinIO 原语与就绪探针。
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { Env } from '../config/env.js';

let client: S3Client | undefined;
// 条件写命中 412 后的 exact-byte 回读使用独立连接池，避免错误响应占用主客户端连接时阻塞幂等校验。
let immutableReadbackClient: S3Client | undefined;

function getClient(env: Env): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true, // MinIO 必需（非虚拟主机风格寻址）
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      maxAttempts: 1, // 骨架阶段不重试（探针/调用连不上时快速失败，不裸挂）
      requestHandler: {
        // 连接/请求超时短，依赖宕机时 /ready 快速判 down。
        requestTimeout: 2_000,
        connectionTimeout: 2_000,
      },
    });
  }
  return client;
}

function getImmutableReadbackClient(env: Env): S3Client {
  immutableReadbackClient ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    maxAttempts: 1,
    requestHandler: { requestTimeout: 2_000, connectionTimeout: 2_000 },
  });
  return immutableReadbackClient;
}

export type ArtifactBucket = 'combo-artifacts';

export type ImmutableObjectStoreFailure =
  | 'invalid_limit'
  | 'invalid_input'
  | 'too_large'
  | 'aborted'
  | 'conflict'
  | 'invalid_response'
  | 'unavailable';

const IMMUTABLE_OBJECT_ERROR_MESSAGES: Readonly<Record<ImmutableObjectStoreFailure, string>> = {
  invalid_limit: 'immutable object byte limit is invalid',
  invalid_input: 'immutable object bytes are invalid',
  too_large: 'immutable object exceeds the byte limit',
  aborted: 'immutable object operation was aborted',
  conflict: 'immutable object already exists with different bytes',
  invalid_response: 'immutable object storage returned an invalid response',
  unavailable: 'immutable object storage is unavailable',
};

const IMMUTABLE_OBJECT_STORE_ERROR_BRAND = new WeakSet<object>();

/**
 * 不可变对象原语的稳定失败分类。错误文案不包含 bucket、key、SDK 响应或凭据。
 */
export class ImmutableObjectStoreError extends Error {
  constructor(readonly failure: ImmutableObjectStoreFailure) {
    super(IMMUTABLE_OBJECT_ERROR_MESSAGES[failure]);
    this.name = 'ImmutableObjectStoreError';
    IMMUTABLE_OBJECT_STORE_ERROR_BRAND.add(this);
  }
}

function isImmutableObjectStoreError(error: unknown): error is ImmutableObjectStoreError {
  return (
    typeof error === 'object' && error !== null && IMMUTABLE_OBJECT_STORE_ERROR_BRAND.has(error)
  );
}

export interface ImmutableObjectCommandSender {
  send(
    command: GetObjectCommand | PutObjectCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

export interface ImmutableObjectReadInput {
  bucket: ArtifactBucket;
  key: string;
  maxBytes: number;
  signal?: AbortSignal;
}

export interface ImmutableObjectCommitInput extends ImmutableObjectReadInput {
  bytes: Uint8Array;
  contentType?: string;
}

export interface ImmutableObjectStore {
  read(input: ImmutableObjectReadInput): Promise<Uint8Array>;
  commit(
    input: ImmutableObjectCommitInput,
  ): Promise<{ outcome: 'created' | 'already_committed'; size: number }>;
}

function validateMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new ImmutableObjectStoreError('invalid_limit');
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ImmutableObjectStoreError('aborted');
}

function isAbortFailure(error: unknown, signal: AbortSignal | undefined): boolean {
  try {
    if (signal?.aborted) return true;
    if (typeof error !== 'object' || error === null) return false;
    const name = (error as { name?: unknown }).name;
    return name === 'AbortError';
  } catch {
    return false;
  }
}

function isObjectAlreadyCommitted(error: unknown): boolean {
  try {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as {
      name?: unknown;
      Code?: unknown;
      $metadata?: { httpStatusCode?: unknown };
    };
    const status = candidate.$metadata?.httpStatusCode;
    if (status !== undefined) return status === 412;
    return candidate.name === 'PreconditionFailed' || candidate.Code === 'PreconditionFailed';
  } catch {
    return false;
  }
}

function normalizeBodyChunk(value: unknown): Uint8Array | null {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function ignoreRejectedCleanup(result: unknown): void {
  if (typeof (result as { catch?: unknown } | null)?.catch === 'function') {
    void (result as Promise<unknown>).catch(() => undefined);
  }
}

function cancelAsyncBody(body: unknown, iterator: AsyncIterator<unknown>): void {
  try {
    const destroy = (body as { destroy?: unknown } | null)?.destroy;
    if (typeof destroy === 'function') destroy.call(body);
  } catch {
    // 收尾不能覆盖原始的安全错误分类。
  }
  try {
    if (typeof iterator.return === 'function') {
      ignoreRejectedCleanup(iterator.return());
    }
  } catch {
    // 收尾不能覆盖原始的安全错误分类。
  }
}

function cancelUnreadBody(body: unknown): void {
  try {
    const destroy = (body as { destroy?: unknown } | null)?.destroy;
    if (typeof destroy === 'function') destroy.call(body);
  } catch {
    // 收尾不能覆盖原始的安全错误分类。
  }
  try {
    const cancel = (body as { cancel?: unknown } | null)?.cancel;
    if (typeof cancel === 'function') ignoreRejectedCleanup(cancel.call(body));
  } catch {
    // 收尾不能覆盖原始的安全错误分类。
  }
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ImmutableObjectStoreError('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function readAsyncBodyBounded(
  body: AsyncIterable<unknown>,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    for (;;) {
      const step = await awaitWithAbort(Promise.resolve(iterator.next()), signal);
      if (step.done) {
        complete = true;
        break;
      }
      throwIfAborted(signal);
      const chunk = normalizeBodyChunk(step.value);
      if (!chunk) throw new ImmutableObjectStoreError('invalid_response');
      const snapshot = snapshotBoundedBytes(chunk, maxBytes - total, 'invalid_response');
      chunks.push(snapshot);
      total += snapshot.byteLength;
    }
  } finally {
    if (!complete) cancelAsyncBody(body, iterator);
  }
  return concatenateChunks(chunks, total);
}

async function readWebBodyBounded(
  body: ReadableStream<unknown>,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    for (;;) {
      const step = await awaitWithAbort(reader.read(), signal);
      if (step.done) {
        complete = true;
        break;
      }
      throwIfAborted(signal);
      const chunk = normalizeBodyChunk(step.value);
      if (!chunk) throw new ImmutableObjectStoreError('invalid_response');
      const snapshot = snapshotBoundedBytes(chunk, maxBytes - total, 'invalid_response');
      chunks.push(snapshot);
      total += snapshot.byteLength;
    }
  } finally {
    if (!complete) {
      try {
        ignoreRejectedCleanup(reader.cancel());
      } catch {
        // 收尾不能覆盖原始的安全错误分类。
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // 收尾不能覆盖原始的安全错误分类。
    }
  }
  return concatenateChunks(chunks, total);
}

function concatenateChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readBodyBounded(
  body: unknown,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  try {
    throwIfAborted(signal);
  } catch (error) {
    cancelUnreadBody(body);
    throw error;
  }
  const direct = normalizeBodyChunk(body);
  if (direct) {
    return snapshotBoundedBytes(direct, maxBytes, 'invalid_response');
  }
  if (
    typeof (body as { [Symbol.asyncIterator]?: unknown } | null)?.[Symbol.asyncIterator] ===
    'function'
  ) {
    return readAsyncBodyBounded(body as AsyncIterable<unknown>, maxBytes, signal);
  }
  if (typeof (body as { getReader?: unknown } | null)?.getReader === 'function') {
    return readWebBodyBounded(body as ReadableStream<unknown>, maxBytes, signal);
  }
  throw new ImmutableObjectStoreError('invalid_response');
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const GET_TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'byteLength',
)?.get as ((this: Uint8Array) => number) | undefined;
const GET_TYPED_ARRAY_BYTE_OFFSET = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'byteOffset',
)?.get as ((this: Uint8Array) => number) | undefined;
const GET_TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'buffer')
  ?.get as ((this: Uint8Array) => ArrayBufferLike) | undefined;

function snapshotBoundedBytes(
  input: unknown,
  maxBytes: number,
  invalidFailure: 'invalid_input' | 'invalid_response',
): Uint8Array {
  try {
    if (!GET_TYPED_ARRAY_BYTE_LENGTH || !GET_TYPED_ARRAY_BYTE_OFFSET || !GET_TYPED_ARRAY_BUFFER) {
      throw new ImmutableObjectStoreError(invalidFailure);
    }
    const bytes = input as Uint8Array;
    const byteLength = GET_TYPED_ARRAY_BYTE_LENGTH.call(bytes);
    if (byteLength > maxBytes) throw new ImmutableObjectStoreError('too_large');
    const byteOffset = GET_TYPED_ARRAY_BYTE_OFFSET.call(bytes);
    const buffer = GET_TYPED_ARRAY_BUFFER.call(bytes);
    const source = new Uint8Array(buffer, byteOffset, byteLength);
    const snapshot = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index += 1) snapshot[index] = source[index] as number;
    const snapshotByteLength = GET_TYPED_ARRAY_BYTE_LENGTH.call(snapshot);
    if (snapshotByteLength > maxBytes) throw new ImmutableObjectStoreError('too_large');
    if (snapshotByteLength !== byteLength) {
      throw new ImmutableObjectStoreError(invalidFailure);
    }
    return snapshot;
  } catch (error) {
    if (isImmutableObjectStoreError(error)) throw error;
    throw new ImmutableObjectStoreError(invalidFailure);
  }
}

/**
 * 创建一个不可覆盖的 exact-byte 对象原语。它不列举、删除或解析对象内容。
 */
export function createImmutableObjectStore(
  sender: ImmutableObjectCommandSender,
  readSender: ImmutableObjectCommandSender = sender,
): ImmutableObjectStore {
  async function readWithSender(
    commandSender: ImmutableObjectCommandSender,
    input: ImmutableObjectReadInput,
  ): Promise<Uint8Array> {
    validateMaxBytes(input.maxBytes);
    throwIfAborted(input.signal);
    try {
      const rawResponse = await commandSender.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
        input.signal ? { abortSignal: input.signal } : undefined,
      );
      if (typeof rawResponse !== 'object' || rawResponse === null) {
        throw new ImmutableObjectStoreError('invalid_response');
      }
      const response = rawResponse as { Body?: unknown; ContentLength?: unknown };
      const body = response.Body;
      const declaredLength = response.ContentLength;
      if (
        declaredLength !== undefined &&
        (!Number.isSafeInteger(declaredLength) || (declaredLength as number) < 0)
      ) {
        cancelUnreadBody(body);
        throw new ImmutableObjectStoreError('invalid_response');
      }
      if (typeof declaredLength === 'number' && declaredLength > input.maxBytes) {
        cancelUnreadBody(body);
        throw new ImmutableObjectStoreError('too_large');
      }
      if (body == null) {
        if (declaredLength === 0) return new Uint8Array();
        throw new ImmutableObjectStoreError('invalid_response');
      }
      const bytes = await readBodyBounded(body, input.maxBytes, input.signal);
      if (typeof declaredLength === 'number' && declaredLength !== bytes.byteLength) {
        throw new ImmutableObjectStoreError('invalid_response');
      }
      return bytes;
    } catch (error) {
      if (isImmutableObjectStoreError(error)) throw error;
      if (isAbortFailure(error, input.signal)) throw new ImmutableObjectStoreError('aborted');
      throw new ImmutableObjectStoreError('unavailable');
    }
  }

  async function read(input: ImmutableObjectReadInput): Promise<Uint8Array> {
    return readWithSender(readSender, input);
  }

  async function commit(
    input: ImmutableObjectCommitInput,
  ): Promise<{ outcome: 'created' | 'already_committed'; size: number }> {
    validateMaxBytes(input.maxBytes);
    throwIfAborted(input.signal);
    let exactBytes: Uint8Array;
    try {
      exactBytes = snapshotBoundedBytes(input.bytes, input.maxBytes, 'invalid_input');
    } catch (error) {
      if (isImmutableObjectStoreError(error)) throw error;
      throw new ImmutableObjectStoreError('invalid_input');
    }
    try {
      await sender.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: exactBytes,
          ContentLength: exactBytes.byteLength,
          IfNoneMatch: '*',
          ...(input.contentType ? { ContentType: input.contentType } : {}),
        }),
        input.signal ? { abortSignal: input.signal } : undefined,
      );
      return { outcome: 'created', size: exactBytes.byteLength };
    } catch (error) {
      if (isAbortFailure(error, input.signal)) throw new ImmutableObjectStoreError('aborted');
      if (!isObjectAlreadyCommitted(error)) {
        throw new ImmutableObjectStoreError('unavailable');
      }
    }

    let existing: Uint8Array;
    try {
      existing = await read(input);
    } catch (error) {
      if (isImmutableObjectStoreError(error) && error.failure === 'too_large') {
        throw new ImmutableObjectStoreError('conflict');
      }
      throw error;
    }
    if (!equalBytes(existing, exactBytes)) {
      throw new ImmutableObjectStoreError('conflict');
    }
    return { outcome: 'already_committed', size: exactBytes.byteLength };
  }

  return { read, commit };
}

/** 生产 S3/MinIO 客户端的惰性组装入口。 */
export function createS3ImmutableObjectStore(env: Env): ImmutableObjectStore {
  const s3 = getClient(env);
  const readbackS3 = getImmutableReadbackClient(env);
  return createImmutableObjectStore(
    {
      send(command, options) {
        return s3.send(command, options);
      },
    },
    {
      send(command, options) {
        return readbackS3.send(command, options);
      },
    },
  );
}

/** ready 探针：轻量列举 combo-artifacts；连不上或凭证错误时返回 down。 */
export async function pingObjectStore(env: Env): Promise<boolean> {
  try {
    await getClient(env).send(new ListObjectsV2Command({ Bucket: 'combo-artifacts', MaxKeys: 1 }));
    return true;
  } catch {
    return false;
  }
}

/** 优雅关闭。 */
export function closeObjectStore(): void {
  client?.destroy();
  client = undefined;
  immutableReadbackClient?.destroy();
  immutableReadbackClient = undefined;
}
