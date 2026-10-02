export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** The request may or may not have reached the server (offline, timeout). */
export class NetworkError extends ApiError {
  constructor() {
    super('NETWORK');
    this.name = 'NetworkError';
  }
}

/** TC-P1-AUTH-10: the server rejected the session (revoked or expired). */
export class SessionExpiredError extends ApiError {
  constructor() {
    super('SESSION_EXPIRED');
    this.name = 'SessionExpiredError';
  }
}
