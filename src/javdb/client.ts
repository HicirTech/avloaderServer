/**
 * HTTP to javdb, through curl-impersonate.
 *
 * javdb sits behind a Cloudflare managed challenge, and Cloudflare binds
 * cf_clearance to three things: the exit IP, the exact User-Agent string, and
 * the TLS/HTTP2 fingerprint. Stock fetch fails the third, and Cloudflare does
 * not merely ignore the mismatched cookie -- it invalidates it, which is why a
 * freshly pasted cookie dies minutes after a plain scraper touches it.
 * curl-impersonate replays Chrome's ClientHello and nghttp2 SETTINGS, so the
 * clearance survives.
 *
 * `--impersonate` already supplies Chrome's header set in Chrome's order; only
 * the identity headers are overridden, which does not perturb the fingerprint.
 */

import type { Config } from "../config";
import type { Throttle } from "../throttle";
import { ClearanceError, RequestError, TransportError } from "./errors";

/**
 * Cloudflare injects `challenge-platform/scripts/jsd` into ordinary 200s too,
 * so that path alone is not a challenge signal. The orchestrate endpoint and
 * `_cf_chl_opt` are.
 */
const CHALLENGE_RE = /<title>Just a moment|_cf_chl_opt|challenge-platform\/h\/[a-z]\/orchestrate/;
const BLOCKED_RE = /Sorry, you have been blocked/;

/** Headers are line-delimited; a cookie carrying CR or LF would append its own. */
const HEADER_INJECTION_RE = /[\r\n\0]/;

export interface FetchOptions {
  /** Whole Cookie header from a browser that loads javdb without a challenge. */
  readonly cookie: string;
  /** Set when the request models a click from another javdb page. */
  readonly referer?: string;
}

export interface JavdbClient {
  readonly fetchPage: (url: string, options: FetchOptions) => Promise<string>;
}

/** Reject a cookie before it reaches the argv. Returns the reason, or null. */
export const cookieProblem = (cookie: string): string | null => {
  if (!cookie) {
    return "no cookie supplied: pass `cookie` in the request body or set JAVDB_COOKIE";
  }
  if (HEADER_INJECTION_RE.test(cookie)) {
    return "cookie contains a newline or NUL, which would forge additional request headers";
  }
  if (!cookie.includes("cf_clearance=")) {
    return "cookie has no cf_clearance: copy the whole Cookie header from a browser that loads javdb.com without a challenge";
  }
  return null;
};

export const createJavdbClient = (config: Config, throttle: Throttle): JavdbClient => {
  const argvFor = (url: string, { cookie, referer }: FetchOptions): string[] => {
    const argv = [
      config.curlBin,
      "--compressed",
      "--impersonate",
      config.impersonate,
      "-sS",
      "-L",
      // Status to stderr so stdout stays a clean body. remote_ip rides along
      // because an unexpected address family is the least obvious way for a
      // clearance to fail.
      "-w",
      "%{stderr}__http_code=%{http_code} __remote_ip=%{remote_ip}",
      "--max-time",
      String(Math.ceil(config.timeoutMs / 1000)),
      url,
      "-H",
      `user-agent: ${config.userAgent}`,
      "-H",
      `sec-ch-ua: ${config.secChUa}`,
      "-H",
      `sec-ch-ua-platform: ${config.secChUaPlatform}`,
      "-H",
      `accept-language: ${config.acceptLanguage}`,
      "-H",
      `cookie: ${cookie}`,
    ];

    if (config.ipVersion === "4") argv.splice(1, 0, "--ipv4");
    else if (config.ipVersion === "6") argv.splice(1, 0, "--ipv6");

    // A navigation from another javdb page carries a Referer and reports
    // same-origin; a cold one keeps the impersonation defaults. Mixing the two
    // is a fingerprint tell.
    if (referer) argv.push("-H", `referer: ${referer}`, "-H", "sec-fetch-site: same-origin");

    return argv;
  };

  const runCurl = async (url: string, options: FetchOptions): Promise<string> => {
    // Bun.spawn's return type depends on its stdio options, so the type comes
    // from this thunk rather than from a name that would pin the wrong overload.
    const spawnCurl = () => Bun.spawn(argvFor(url, options), { stdout: "pipe", stderr: "pipe" });

    let proc: ReturnType<typeof spawnCurl>;
    try {
      proc = spawnCurl();
    } catch (cause) {
      throw new TransportError(
        `could not run "${config.curlBin}". Install curl-impersonate or set CURL_IMPERSONATE_BIN. (${cause})`,
      );
    }

    const [body, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const status = Number(/__http_code=(\d+)/.exec(stderr)?.[1] ?? 0);
    const remoteIp = /__remote_ip=(\S+)/.exec(stderr)?.[1] ?? "";
    const diagnostics = stderr.replace(/__http_code=\d+ __remote_ip=\S*/, "").trim();

    if (exitCode !== 0) {
      throw new TransportError(
        `${config.curlBin} exited ${exitCode} for ${url}${diagnostics ? `: ${diagnostics}` : ""}`,
      );
    }

    if (BLOCKED_RE.test(body)) {
      throw new ClearanceError(
        `Cloudflare hard-blocked this IP on ${url} (HTTP ${status}). This is a WAF ban, not a stale cookie.`,
      );
    }

    if (CHALLENGE_RE.test(body) || status === 403) {
      const family = remoteIp.includes(":") ? "IPv6" : "IPv4";
      throw new ClearanceError(
        `Cloudflare challenged ${url} (HTTP ${status}), reached over ${family} (${remoteIp}). ` +
          `cf_clearance is missing, expired, or was minted for a different client address or User-Agent. ` +
          `A dual-stack browser usually prefers IPv6 while a container without IPv6 uses IPv4, and those ` +
          `are different addresses -- mint the cookie over ${family} or set JAVDB_IP_VERSION.`,
      );
    }

    if (status >= 400) throw new TransportError(`javdb returned HTTP ${status} for ${url}`);

    return body;
  };

  return {
    fetchPage: (url, options) => {
      const problem = cookieProblem(options.cookie);
      if (problem) throw new RequestError(problem);
      return throttle.run(() => runCurl(url, options));
    },
  };
};
