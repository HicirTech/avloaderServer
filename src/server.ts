/**
 * The HTTP surface.
 *
 * Two rules shape it. Every failure answers with `{error, detail}` and a status
 * outside 2xx, so a caller that checks either one cannot mistake a failure for
 * metadata. And only `maxInFlight` lookups may be waiting at once: past that the
 * service sheds load rather than queueing work that will age out anyway.
 */

import type { Config } from "./config";
import {
  ClearanceError,
  NotFoundError,
  ParseError,
  RequestError,
  TransportError,
} from "./javdb/errors";
import type { Lookup } from "./javdb/lookup";
import type { ErrorBody, ErrorCode } from "./types";

/** Refuse a body large enough to be a mistake before parsing it. */
const MAX_BODY_BYTES = 64 * 1024;

const fail = (status: number, error: ErrorCode, detail: string): Response =>
  Response.json({ error, detail } satisfies ErrorBody, { status });

interface Request {
  readonly name: string;
  readonly cookie: string;
}

/** Read `name` and `cookie` out of a request, or say why it cannot be read. */
const readRequest = async (
  request: globalThis.Request,
  url: URL,
  config: Config,
): Promise<Request | Response> => {
  if (request.method === "GET") {
    // Convenience for curl; the cookie then has to come from the environment.
    const name = url.searchParams.get("name")?.trim() ?? "";
    if (!name) return fail(400, "bad_request", "missing `name`");
    return { name, cookie: config.cookie };
  }

  if (request.method !== "POST") {
    return fail(400, "bad_request", `${request.method} is not supported; use GET or POST`);
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return fail(400, "bad_request", `request body exceeds ${MAX_BODY_BYTES} bytes`);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "bad_request", "body is not valid JSON");
  }

  if (typeof body !== "object" || body === null) {
    return fail(400, "bad_request", "body must be a JSON object");
  }

  const { name, cookie } = body as { name?: unknown; cookie?: unknown };
  if (typeof name !== "string" || !name.trim()) {
    return fail(400, "bad_request", "`name` must be a non-empty string");
  }
  if (cookie !== undefined && cookie !== null && typeof cookie !== "string") {
    return fail(400, "bad_request", "`cookie` must be a string when present");
  }

  return { name: name.trim(), cookie: (cookie as string | undefined) || config.cookie };
};

const statusFor = (error: unknown): { status: number; code: ErrorCode } => {
  if (error instanceof RequestError) return { status: 400, code: "bad_request" };
  if (error instanceof NotFoundError) return { status: 404, code: "not_found" };
  // A stale clearance is an operator problem, not a server fault, and the caller
  // must not record the name as absent because of it.
  if (error instanceof ClearanceError) {
    return { status: 401, code: "cloudflare_clearance_required" };
  }
  if (error instanceof TransportError) return { status: 502, code: "upstream_unavailable" };
  // Markup drift reads as a miss unless it is reported as a fault of ours.
  if (error instanceof ParseError) return { status: 502, code: "upstream_unavailable" };
  return { status: 500, code: "internal" };
};

export interface Handler {
  readonly fetch: (request: globalThis.Request) => Promise<Response>;
  readonly inFlight: () => number;
}

export const createHandler = (config: Config, lookup: Lookup): Handler => {
  let inFlight = 0;
  let requestCounter = 0;

  const handleLookup = async (request: globalThis.Request, url: URL): Promise<Response> => {
    if (inFlight >= config.maxInFlight) {
      return fail(
        429,
        "rate_limited",
        `${inFlight} lookups already in flight; retry after the current ones finish`,
      );
    }

    // Claimed synchronously, before the first await. Counting after the body was
    // parsed would let a burst of concurrent requests all read the old value and
    // sail past the cap together.
    inFlight += 1;
    requestCounter += 1;
    const id = `r${requestCounter}`;

    try {
      const parsed = await readRequest(request, url, config);
      if (parsed instanceof Response) return parsed;

      console.log(`[${id}] lookup ${parsed.name}`);
      try {
        const movie = await lookup.find(parsed.name, parsed.cookie);
        console.log(`[${id}] ${parsed.name}: ok`);
        return Response.json(movie);
      } catch (error) {
        const { status, code } = statusFor(error);
        const detail = error instanceof Error ? error.message : String(error);
        // Everything above a miss is worth an operator's attention.
        const log = status === 404 ? console.log : console.error;
        log(`[${id}] ${parsed.name}: ${code} - ${detail}`);
        return fail(status, code, detail);
      }
    } finally {
      inFlight -= 1;
    }
  };

  return {
    inFlight: () => inFlight,
    fetch: async (request) => {
      const url = new URL(request.url);

      // Liveness only. It deliberately never touches javdb, so a stale caller
      // cookie cannot mark the container unhealthy.
      if (url.pathname === "/health") {
        return Response.json({ status: "ok", impersonate: config.impersonate, inFlight });
      }

      if (url.pathname === "/lookup") return handleLookup(request, url);

      return fail(404, "not_found", `no route for ${request.method} ${url.pathname}`);
    },
  };
};
