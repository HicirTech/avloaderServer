/**
 * Every environment variable, read once.
 *
 * An empty value counts as unset: docker-compose renders an undefined `${VAR}`
 * as an empty string, and `?? default` would keep it -- an empty User-Agent
 * silently invalidates every cf_clearance.
 */

const str = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value && value.trim() ? value : fallback;
};

const int = (key: string, fallback: number, min = 0): number => {
  const value = Number(str(key, String(fallback)));
  return Number.isFinite(value) && value >= min ? value : fallback;
};

export interface Config {
  readonly port: number;
  /** Fallback cookie for callers that send none. Empty when unset. */
  readonly cookie: string;
  readonly curlBin: string;
  readonly impersonate: string;
  readonly userAgent: string;
  readonly secChUa: string;
  readonly secChUaPlatform: string;
  readonly acceptLanguage: string;
  /** Forced into the Cookie header so javdb serves one language. Empty disables it. */
  readonly locale: string;
  readonly timeoutMs: number;
  /** "4", "6" or "auto". See .env.example for why this is not cosmetic. */
  readonly ipVersion: string;
  /** Smallest gap between two requests to javdb. Requests are serialised regardless. */
  readonly minIntervalMs: number;
  /** Lookups allowed to be waiting at once before the service sheds load. */
  readonly maxInFlight: number;
}

export const loadConfig = (): Config => ({
  port: int("PORT", 5000),
  cookie: str("JAVDB_COOKIE", ""),
  curlBin: str("CURL_IMPERSONATE_BIN", "curl-impersonate"),
  // Newest profile curl-impersonate v2.0.0 ships. Chrome's ClientHello is stable
  // across these versions, and Cloudflare binds the clearance to the User-Agent
  // string rather than the TLS version.
  impersonate: str("CURL_IMPERSONATE_TARGET", "chrome146"),
  userAgent: str(
    "JAVDB_UA",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0",
  ),
  secChUa: str("JAVDB_SEC_CH_UA", '"Not:A-Brand";v="99", "Microsoft Edge";v="152", "Chromium";v="152"'),
  secChUaPlatform: str("JAVDB_SEC_CH_UA_PLATFORM", '"Windows"'),
  // Chinese-first now: javdb serves the metadata panel in the session language,
  // and this service exists to return Chinese metadata. Only used when the
  // locale cookie below is absent -- the cookie is the stronger signal.
  acceptLanguage: str("JAVDB_ACCEPT_LANGUAGE", "zh-TW,zh;q=0.9,en;q=0.8"),
  // javdb reads its own `locale` cookie to choose the page language. Forcing it
  // makes the output independent of whatever language the caller's cookie
  // carried. Set JAVDB_LOCALE="" to leave the caller's locale untouched.
  locale: str("JAVDB_LOCALE", "zh"),
  // A floor, not just a default: 0 would otherwise disable every deadline.
  timeoutMs: int("JAVDB_TIMEOUT_MS", 30_000, 1_000),
  ipVersion: str("JAVDB_IP_VERSION", "auto"),
  minIntervalMs: int("JAVDB_MIN_INTERVAL_MS", 2_000),
  maxInFlight: int("JAVDB_MAX_IN_FLIGHT", 4, 1),
});
