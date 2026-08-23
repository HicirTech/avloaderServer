/** The wire contract. Stable English field names, so no page language leaks into the API. */

export interface Movie {
  /** Video code, for example "JUR-100". */
  readonly code: string;
  /** Title as javdb shows it by default. Never empty on a page that parsed. */
  readonly originalTitle: string;
  /** Translated title, present only when javdb offers both. */
  readonly translatedTitle: string | null;
  /** Release date as "YYYY-MM-DD", or null when javdb printed none. */
  readonly releasedAt: string | null;
  readonly durationMinutes: number | null;
  readonly director: string | null;
  readonly studio: string | null;
  readonly series: string | null;
  /** Out of 5, as javdb scores it. */
  readonly rating: number | null;
  readonly voteCount: number | null;
  readonly genres: readonly string[];
  readonly actors: readonly string[];
  /** Full-size sample image URLs, in page order. */
  readonly previewImages: readonly string[];
  /** The javdb page this was read from. */
  readonly sourceUrl: string;
}

/** Error bodies the service returns. The caller branches on `error`, never on prose. */
export type ErrorCode =
  | "bad_request"
  | "not_found"
  | "cloudflare_clearance_required"
  | "upstream_unavailable"
  | "rate_limited"
  | "internal";

export interface ErrorBody {
  readonly error: ErrorCode;
  readonly detail: string;
}
