import { fetchTargetUrlFromJAV } from "./fetchJav";
import {
  ClearanceError,
  TransportError,
  RequestError,
  IMPERSONATE_TARGET,
} from "./javdbClient";

interface requestBody {
  name: string;
  cookie: string | null | undefined;
}

const PORT = Number(process.env.PORT ?? 5000);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Liveness only — deliberately does not touch javdb, so the container is not
    // reported unhealthy just because a caller's cf_clearance went stale.
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", impersonate: IMPERSONATE_TARGET });
    }

    let name: string | undefined;
    let cookie: string | null | undefined;

    if (req.method === "POST") {
      try {
        const untypedBody = (await req.json()) as requestBody;
        ({ name, cookie } = untypedBody);
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }
    } else {
      // Convenience for curl/browser testing; cookie then comes from JAVDB_COOKIE.
      name = url.searchParams.get("name") ?? undefined;
    }

    if (!name) {
      return Response.json({ error: "missing `name`" }, { status: 400 });
    }

    console.log(`[javdb] lookup ${name} (cookie: ${cookie ? "from request" : "from env"})`);

    try {
      const result = await fetchTargetUrlFromJAV(name, cookie);
      if (Object.keys(result).length === 0) {
        console.log(`[javdb] ${name}: no match`);
        return Response.json({ error: "not found", name }, { status: 404 });
      }
      console.log(`[javdb] ${name}: ok`);
      return Response.json(result);
    } catch (err) {
      if (err instanceof RequestError) {
        return Response.json(
          { error: "bad_request", detail: err.message },
          { status: 400 }
        );
      }
      // A stale cf_clearance is an operator problem, not a server fault — say so
      // distinctly so the caller knows to paste a fresh cookie rather than retry.
      if (err instanceof ClearanceError) {
        console.error(`[javdb] ${name}: ${err.message}`);
        return Response.json(
          { error: "cloudflare_clearance_required", detail: err.message },
          { status: 401 }
        );
      }
      if (err instanceof TransportError) {
        console.error(`[javdb] ${name}: ${err.message}`);
        return Response.json(
          { error: "upstream_unavailable", detail: err.message },
          { status: 502 }
        );
      }
      console.error(`[javdb] ${name}:`, err);
      return Response.json(
        { error: "internal", detail: String(err) },
        { status: 500 }
      );
    }
  },
});

console.log(`listening on http://localhost:${PORT}`);
