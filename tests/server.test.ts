import { describe, expect, test } from "bun:test";

import { loadConfig, type Config } from "../src/config";
import {
  ClearanceError,
  NotFoundError,
  ParseError,
  RequestError,
  TransportError,
} from "../src/javdb/errors";
import type { Lookup } from "../src/javdb/lookup";
import { createHandler } from "../src/server";
import type { Movie } from "../src/types";

const MOVIE: Movie = {
  code: "ABC-123",
  originalTitle: "a title",
  translatedTitle: null,
  releasedAt: "2026-01-02",
  durationMinutes: 120,
  director: null,
  studio: null,
  series: null,
  rating: 4.5,
  voteCount: 10,
  genres: ["one"],
  actors: ["someone"],
  previewImages: [],
  sourceUrl: "https://javdb.com/v/x",
};

const config = (overrides: Partial<Config> = {}): Config => ({
  ...loadConfig(),
  cookie: "cf_clearance=from-env",
  maxInFlight: 4,
  ...overrides,
});

const handlerWith = (find: Lookup["find"], overrides?: Partial<Config>) =>
  createHandler(config(overrides), { find });

const post = (body: unknown, init: RequestInit = {}) =>
  new Request("http://localhost/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });

const alwaysThrows = (error: unknown): Lookup["find"] => {
  return async () => {
    throw error;
  };
};

describe("routing", () => {
  test("/health answers without touching javdb", async () => {
    let reached = false;
    const handler = handlerWith(async () => {
      reached = true;
      return MOVIE;
    });

    const response = await handler.fetch(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe("ok");
    expect(reached).toBe(false);
  });

  test("an unknown path is a 404, not a lookup", async () => {
    let reached = false;
    const handler = handlerWith(async () => {
      reached = true;
      return MOVIE;
    });

    const response = await handler.fetch(new Request("http://localhost/favicon.ico"));
    expect(response.status).toBe(404);
    expect(reached).toBe(false);
  });

  test("an unsupported method is refused", async () => {
    const handler = handlerWith(async () => MOVIE);
    const response = await handler.fetch(
      new Request("http://localhost/lookup", { method: "DELETE" }),
    );
    expect(response.status).toBe(400);
  });
});

describe("input", () => {
  test("returns the movie for a well-formed request", async () => {
    const handler = handlerWith(async (name, cookie) => {
      expect(name).toBe("ABC-123");
      expect(cookie).toBe("cf_clearance=supplied");
      return MOVIE;
    });

    const response = await handler.fetch(post({ name: "ABC-123", cookie: "cf_clearance=supplied" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOVIE);
  });

  test("falls back to the configured cookie when the caller sends none", async () => {
    const handler = handlerWith(async (_name, cookie) => {
      expect(cookie).toBe("cf_clearance=from-env");
      return MOVIE;
    });

    expect((await handler.fetch(post({ name: "ABC-123" }))).status).toBe(200);
  });

  test.each([
    ["not json at all", "{"],
    ["a JSON array", JSON.stringify([])],
    ["a missing name", JSON.stringify({ cookie: "x" })],
    ["a blank name", JSON.stringify({ name: "   " })],
    ["a numeric name", JSON.stringify({ name: 42 })],
    ["a numeric cookie", JSON.stringify({ name: "ABC-123", cookie: 42 })],
  ])("rejects %s with 400", async (_label, body) => {
    const handler = handlerWith(async () => MOVIE);
    const response = await handler.fetch(post(body));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("bad_request");
  });

  test("refuses an oversized body before parsing it", async () => {
    const handler = handlerWith(async () => MOVIE);
    const response = await handler.fetch(
      post({ name: "x" }, { headers: { "content-length": String(1024 * 1024) } }),
    );
    expect(response.status).toBe(400);
  });
});

describe("failure mapping", () => {
  test.each([
    [new RequestError("bad input"), 400, "bad_request"],
    [new NotFoundError("no such movie"), 404, "not_found"],
    [new ClearanceError("stale"), 401, "cloudflare_clearance_required"],
    [new TransportError("curl died"), 502, "upstream_unavailable"],
    // Markup drift must not read as a miss, or the caller records the name as
    // permanently absent.
    [new ParseError("markup changed"), 502, "upstream_unavailable"],
    [new Error("something else"), 500, "internal"],
  ])("maps %o to its status", async (error, status, code) => {
    const handler = handlerWith(alwaysThrows(error));
    const response = await handler.fetch(post({ name: "ABC-123" }));

    expect(response.status).toBe(status);
    const body = (await response.json()) as { error: string; detail: unknown };
    expect(body.error).toBe(code);
    expect(typeof body.detail).toBe("string");
  });

  test("every failure body is distinguishable from a movie", async () => {
    for (const error of [new NotFoundError("x"), new ClearanceError("y"), new Error("z")]) {
      const response = await handlerWith(alwaysThrows(error)).fetch(post({ name: "ABC-123" }));
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.ok).toBe(false);
      expect(body).toHaveProperty("error");
      expect(body).not.toHaveProperty("code");
      expect(body).not.toHaveProperty("originalTitle");
    }
  });
});

describe("load shedding", () => {
  test("sheds lookups past maxInFlight instead of queueing them", async () => {
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = handlerWith(async () => {
      await blocked;
      return MOVIE;
    }, { maxInFlight: 2 });

    const first = handler.fetch(post({ name: "A" }));
    const second = handler.fetch(post({ name: "B" }));
    await Promise.resolve();
    const third = await handler.fetch(post({ name: "C" }));

    expect(third.status).toBe(429);
    expect(((await third.json()) as { error: string }).error).toBe("rate_limited");

    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(handler.inFlight()).toBe(0);
  });
});
