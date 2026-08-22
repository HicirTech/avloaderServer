/**
 * HTTP layer for javdb.
 *
 * javdb sits behind a Cloudflare managed challenge: every request without a
 * valid `cf_clearance` gets a 403 "Just a moment..." page, including the
 * homepage. Solving that challenge requires running Cloudflare's JS, so the
 * clearance cookie has to come from a real browser.
 *
 * Cloudflare binds `cf_clearance` to three things:
 *   1. the exit IP
 *   2. the exact User-Agent string
 *   3. the TLS (JA3/JA4) + HTTP/2 fingerprint of the client
 *
 * Stock curl/Bun fetch fail (3) — and Cloudflare does not merely ignore the
 * mismatched cookie, it *invalidates* it, which is why a freshly pasted cookie
 * dies within minutes of the scraper touching it. curl-impersonate replays
 * Chrome's BoringSSL ClientHello and nghttp2 SETTINGS frames, so the clearance
 * survives.
 *
 * `--impersonate` already supplies Chrome's full header set in Chrome's order;
 * we override only the identity headers so they match the browser that minted
 * the cookie. Overriding these does not perturb the TLS/H2 fingerprint.
 */

/**
 * Treat an empty/whitespace value as unset. docker-compose renders an undefined
 * `${VAR}` as an empty string, and `?? default` would happily keep that — an
 * empty User-Agent silently invalidates every cf_clearance.
 */
const env = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value && value.trim() ? value : fallback;
};

const CURL_BIN = env("CURL_IMPERSONATE_BIN", "curl-impersonate");
// Newest profile curl-impersonate v2.0.0 ships. The browser minting the cookie
// is Chromium 152; Chrome's ClientHello is stable across these versions, and
// Cloudflare binds the clearance to the User-Agent string, not the TLS version.
const IMPERSONATE = env("CURL_IMPERSONATE_TARGET", "chrome146");

// These must match the browser that minted the cookie. Change them together.
const UA = env(
  "JAVDB_UA",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0"
);
const SEC_CH_UA = env(
  "JAVDB_SEC_CH_UA",
  '"Not:A-Brand";v="99", "Microsoft Edge";v="152", "Chromium";v="152"'
);
const SEC_CH_UA_PLATFORM = env("JAVDB_SEC_CH_UA_PLATFORM", '"Windows"');
const ACCEPT_LANGUAGE = env(
  "JAVDB_ACCEPT_LANGUAGE",
  "en-NZ,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,en-US;q=0.6"
);

const TIMEOUT_MS = Number(env("JAVDB_TIMEOUT_MS", "30000"));

/**
 * "4" | "6" | "auto". Cloudflare binds cf_clearance to the client address, and
 * IPv4 and IPv6 are different addresses for the same machine. A browser on a
 * dual-stack host usually prefers IPv6, so a cookie minted there is bound to
 * that IPv6 address — and a container without IPv6 falls back to IPv4 and gets
 * challenged, with every other signal (fingerprint, UA, headers) identical.
 *
 * IPv4 additionally survives being shared: several machines behind one NAT
 * present the same address, whereas each gets its own global IPv6. So when the
 * cookie is minted on one machine and used on another, both sides must be
 * pinned to IPv4.
 */
const IP_VERSION = env("JAVDB_IP_VERSION", "auto");

// Match only the interstitial. Cloudflare injects `challenge-platform/scripts/jsd`
// into ordinary 200 responses too, so that path alone is not a challenge signal —
// the orchestrate endpoint and `_cf_chl_opt` are.
const CHALLENGE_RE =
  /<title>Just a moment|_cf_chl_opt|challenge-platform\/h\/[a-z]\/orchestrate/;
const BLOCKED_RE = /Sorry, you have been blocked/;

/** Resolved impersonation profile, surfaced on /health to make misconfig visible. */
export const IMPERSONATE_TARGET = IMPERSONATE;

/** The clearance cookie is missing, stale, or was burned by a bad fingerprint. */
export class ClearanceError extends Error {
  readonly kind = "clearance";
  constructor(message: string) {
    super(message);
    this.name = "ClearanceError";
  }
}

/** The caller's input is unusable — a 400, not a server fault. */
export class RequestError extends Error {
  readonly kind = "request";
  constructor(message: string) {
    super(message);
    this.name = "RequestError";
  }
}

/** curl-impersonate itself could not run or the request failed at transport level. */
export class TransportError extends Error {
  readonly kind = "transport";
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

export interface FetchOptions {
  /** Full cookie header copied from a logged-in browser. Must contain cf_clearance. */
  cookie: string;
  /** Set when the request models a click from another javdb page. */
  referer?: string;
}

/**
 * Fetch one javdb page with a browser-identical fingerprint.
 * Throws ClearanceError when Cloudflare answers with a challenge.
 */
export async function fetchJavdbPage(
  url: string,
  { cookie, referer }: FetchOptions
): Promise<string> {
  const argv = [
    CURL_BIN,
    "--compressed",
    "--impersonate",
    IMPERSONATE,
    "-sS",
    "-L",
    // Send the status code to stderr so stdout stays a clean response body.
    // remote_ip rides along because an unexpected address family is the least
    // obvious way for a clearance to fail.
    "-w",
    "%{stderr}__http_code=%{http_code} __remote_ip=%{remote_ip}",
    "--max-time",
    String(Math.ceil(TIMEOUT_MS / 1000)),
    url,
    "-H",
    `user-agent: ${UA}`,
    "-H",
    `sec-ch-ua: ${SEC_CH_UA}`,
    "-H",
    `sec-ch-ua-platform: ${SEC_CH_UA_PLATFORM}`,
    "-H",
    `accept-language: ${ACCEPT_LANGUAGE}`,
    "-H",
    `cookie: ${cookie}`,
  ];

  if (IP_VERSION === "4") argv.splice(1, 0, "--ipv4");
  else if (IP_VERSION === "6") argv.splice(1, 0, "--ipv6");

  // A navigation that originates from another javdb page carries a Referer and
  // reports same-origin; a cold navigation keeps the impersonation defaults
  // (Sec-Fetch-Site: none, no Referer). Mixing the two is a fingerprint tell.
  if (referer) {
    argv.push("-H", `referer: ${referer}`, "-H", "sec-fetch-site: same-origin");
  }

  let proc;
  try {
    proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  } catch (cause) {
    throw new TransportError(
      `could not run "${CURL_BIN}". Install curl-impersonate or set CURL_IMPERSONATE_BIN. (${cause})`
    );
  }

  const [body, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const status = Number(stderr.match(/__http_code=(\d+)/)?.[1] ?? 0);
  const remoteIp = stderr.match(/__remote_ip=(\S+)/)?.[1] ?? "";
  const diagnostics = stderr
    .replace(/__http_code=\d+ __remote_ip=\S*/, "")
    .trim();

  if (exitCode !== 0) {
    throw new TransportError(
      `${CURL_BIN} exited ${exitCode} for ${url}${diagnostics ? `: ${diagnostics}` : ""}`
    );
  }

  if (BLOCKED_RE.test(body)) {
    throw new ClearanceError(
      `Cloudflare hard-blocked this IP on ${url} (HTTP ${status}). This is a WAF ban, not a stale cookie.`
    );
  }

  if (CHALLENGE_RE.test(body) || status === 403) {
    const family = remoteIp.includes(":") ? "IPv6" : "IPv4";
    throw new ClearanceError(
      `Cloudflare challenged ${url} (HTTP ${status}), reached over ${family} (${remoteIp}). ` +
        `cf_clearance is missing, expired, or was minted for a different client address or User-Agent. ` +
        `Note that a dual-stack browser usually prefers IPv6 while a container without IPv6 uses IPv4, ` +
        `and those are different addresses — mint the cookie over ${family} or set JAVDB_IP_VERSION.`
    );
  }

  if (status >= 400) {
    throw new TransportError(`javdb returned HTTP ${status} for ${url}`);
  }

  return body;
}
