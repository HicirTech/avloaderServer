/** Failure kinds the HTTP layer maps to status codes. */

/** The caller's input is unusable. A 400, not a server fault. */
export class RequestError extends Error {
  readonly kind = "request";
  constructor(message: string) {
    super(message);
    this.name = "RequestError";
  }
}

/** cf_clearance is missing, stale, or was burned by a bad fingerprint. An operator problem. */
export class ClearanceError extends Error {
  readonly kind = "clearance";
  constructor(message: string) {
    super(message);
    this.name = "ClearanceError";
  }
}

/** curl-impersonate could not run, or the request failed at transport level. */
export class TransportError extends Error {
  readonly kind = "transport";
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

/** javdb served a page, but it did not contain what the parser needs. */
export class ParseError extends Error {
  readonly kind = "parse";
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

/** javdb has no movie under the requested code. */
export class NotFoundError extends Error {
  readonly kind = "not_found";
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
