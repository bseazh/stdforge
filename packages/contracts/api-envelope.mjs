import { randomUUID } from 'node:crypto';

export function createRequestId() {
  return `req_${randomUUID()}`;
}

export function success(data, { requestId = createRequestId(), mode = 'live', source = [] } = {}) {
  return {
    ok: true,
    data,
    meta: { requestId, mode, source }
  };
}

export function failure(code, message, { requestId = createRequestId(), retryable = false, details } = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(details === undefined ? {} : { details })
    },
    meta: { requestId }
  };
}
