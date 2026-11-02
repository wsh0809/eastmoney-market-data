export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_HTTP_ERROR'
  | 'UPSTREAM_REJECTED'
  | 'UPSTREAM_INVALID_DATA';

export type Failure = {
  success: false;
  error: { code: ErrorCode; message: string };
};

export type Result<T> = { success: true; data: T } | Failure;

export function failure(code: ErrorCode, message: string): Failure {
  return { success: false, error: { code, message } };
}

export function success<T>(data: T): Result<T> {
  return { success: true, data };
}
