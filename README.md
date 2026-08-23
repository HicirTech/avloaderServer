# avloaderServer

An HTTP service that looks up movie metadata on javdb and returns it as JSON.

It is one part of a three-piece pipeline. A Chrome extension puts downloads into aria2; this
service answers metadata lookups; `avLoaderClient` renames the finished files and writes `.nfo`
sidecars from what this returns. Each piece runs on its own and knows nothing about the others.

## The problem it solves

javdb sits behind a Cloudflare managed challenge. Cloudflare binds the `cf_clearance` cookie to
three things at once: the exit IP, the exact User-Agent string, and the TLS and HTTP/2 fingerprint
of the client. An ordinary `fetch` fails the third, and Cloudflare does not merely ignore the
mismatched cookie -- it invalidates it. That is why a freshly pasted cookie dies minutes after a
plain scraper touches it.

So every request is shelled out to `curl-impersonate`, which replays Chrome's ClientHello and
nghttp2 SETTINGS frames. The clearance survives, and the caller supplies the cookie; nothing
secret lives in the image.

## API

### `POST /lookup`

```sh
curl -X POST http://localhost:5000/lookup \
  -H 'Content-Type: application/json' \
  -d '{"name": "NYKD-145", "cookie": "cf_clearance=...; _jdb_session=..."}'
```

`cookie` is the whole Cookie header from a browser that loads javdb.com without a challenge. It
must contain `cf_clearance`. Omit it and the service falls back to `JAVDB_COOKIE`.

A success is `200` and the movie:

```json
{
  "code": "NYKD-145",
  "originalTitle": "還暦で初撮り 石川桃子",
  "translatedTitle": null,
  "releasedAt": "2026-08-18",
  "durationMinutes": 118,
  "director": "村山恭介",
  "studio": "ルビー",
  "series": "還暦で初撮り",
  "rating": 5,
  "voteCount": 7,
  "genres": ["熟女", "已婚婦女"],
  "actors": ["石川桃子"],
  "previewImages": ["https://c0.jdbstatic.com/samples/4d/4DEE4p_l_0.jpg"],
  "sourceUrl": "https://javdb.com/v/4DEE4p"
}
```

Absent fields are `null` or `[]`, never missing. Only `code` and `originalTitle` are guaranteed:
a page without them is reported as a fault rather than returned half-parsed.

Everything else is a non-2xx status and `{"error": "...", "detail": "..."}`. **Check the status.**
The two shapes have no field in common, but a caller that writes any body it receives will end up
storing an error as if it were metadata.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `bad_request` | The request or the cookie is unusable. The detail says which. |
| 401 | `cloudflare_clearance_required` | The cookie is stale, or was minted for a different address or User-Agent. Paste a fresh one; do not retry. |
| 404 | `not_found` | javdb has no movie under that code. The detail names what its search returned instead. |
| 429 | `rate_limited` | Too many lookups already in flight. Retry later. |
| 502 | `upstream_unavailable` | javdb could not be reached, or served something this cannot parse. Retrying may help. |
| 500 | `internal` | A bug here. |

The 404 and 401 distinction matters to a caller that records finished work: a 404 means the name
is genuinely absent, while a 401 means nothing about the name at all.

### `GET /lookup?name=NYKD-145`

The same lookup for a quick shell test. The cookie then has to come from `JAVDB_COOKIE`.

### `GET /health`

Liveness only. It deliberately never touches javdb, so a stale caller cookie cannot mark the
container unhealthy. Returns the impersonation profile in use and the current in-flight count.

## Pacing

Requests to javdb are serialised and spaced out here, not by the callers. The scarce resource is
the clearance cookie: two clients scraping at once look like a bot and get the cookie burned for
everyone. One lookup costs two upstream requests -- a search and a detail page -- and both are
paced by `JAVDB_MIN_INTERVAL_MS`. Past `JAVDB_MAX_IN_FLIGHT` waiting lookups the service answers
429 rather than queueing work that will age out.

There is no cache. Every lookup really is fetched.

## Running it

```sh
cp .env.example .env     # then read it; the IPv6 and User-Agent notes are not decoration
bun install
bun run docker:up
bun run docker:logs
```

`.env.example` is the reference for every setting, and explains the two that are easy to get
wrong: the browser identity headers must match the browser the cookie came from, and the address
family must match too, because Cloudflare treats a machine's IPv4 and IPv6 as different clients.

Before enabling the IPv6 network, read the note in `.env.example` about `accept_ra`. Docker turns
on IPv6 forwarding to provide it, and a forwarding host ignores Router Advertisements by default
-- which can strip the host's own IPv6 address and default route.

To run it outside a container you need `curl-impersonate` on `PATH`, or `CURL_IMPERSONATE_BIN`
pointing at it:

```sh
bun run start
```

## Development

```sh
bun run dev         # reload on change
bun test            # unit tests
bun run typecheck   # tsc --noEmit
```

```
src/
  index.ts            wiring and the listener
  server.ts           routing, validation, error to status mapping
  config.ts           every environment variable, read once
  throttle.ts         the serialising, spacing queue
  types.ts            the wire contract
  javdb/
    client.ts         the curl-impersonate subprocess and Cloudflare handling
    lookup.ts         search, choose the right result, parse it
    search-page.ts    the search results page, and code matching
    detail-page.ts    the movie page, and every javdb-specific selector
    errors.ts         the failure kinds the HTTP layer maps
tests/
  fixtures/           whole javdb pages saved from a browser
```

Every javdb-specific selector lives in one block at the top of `detail-page.ts` or
`search-page.ts`, so a site redesign is a one-file fix. The movie-page selectors are pinned by
four whole saved pages in `tests/fixtures/`. The search-page ones are not: no real search page has
been saved yet, and those tests use hand-written markup that mirrors the same assumptions the
parser makes. Save a real one and switch them over.

Two behaviours are worth knowing before changing anything. The code is verified twice -- once
against the search card, then against the movie page's own `番號` -- because javdb's search is
fuzzy and returns neighbours, and attaching one movie's metadata to another movie's file is worse
than returning nothing. And a search page that carries no results container at all is a 502, not a
404: markup drift must not read as "this movie does not exist", or a caller that records finished
work will mark the name absent for good.
