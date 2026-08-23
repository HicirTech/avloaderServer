/**
 * One lookup: search javdb, open the right result, parse it.
 *
 * javdb's search is fuzzy and returns neighbours, so the code is verified twice.
 * The search card is checked first because a match there saves opening the wrong
 * page at all; the detail page's own 番號 is checked afterwards because that one
 * is authoritative. Attaching one movie's metadata to another movie's file is
 * worse than returning nothing.
 */

import type { Movie } from "../types";
import type { JavdbClient } from "./client";
import { parseDetailPage } from "./detail-page";
import { NotFoundError } from "./errors";
import { matchByCode, parseSearchPage, type SearchHit } from "./search-page";

const SEARCH = "https://javdb.com/search";

/** javdb codes differ only in punctuation and case across pages. */
const normalise = (code: string): string => code.replace(/[\s_-]/g, "").toUpperCase();

export interface Lookup {
  readonly find: (name: string, cookie: string) => Promise<Movie>;
}

/**
 * Which result to open.
 *
 * An exact code match wins. When no card exposed a code at all the selector has
 * probably drifted, so the first hit is opened and the detail page decides --
 * degrading to the old behaviour rather than reporting every name as missing.
 */
const choose = (hits: readonly SearchHit[], name: string): SearchHit | null => {
  const exact = matchByCode(hits, name);
  if (exact) return exact;
  if (hits.every((hit) => hit.code === "")) return hits[0] ?? null;
  return null;
};

export const createLookup = (client: JavdbClient): Lookup => ({
  find: async (name, cookie) => {
    const searchUrl = `${SEARCH}?${new URLSearchParams({ q: name }).toString()}`;
    const hits = parseSearchPage(await client.fetchPage(searchUrl, { cookie }), searchUrl);

    if (hits.length === 0) {
      throw new NotFoundError(`javdb search returned no results for ${name}`);
    }

    const hit = choose(hits, name);
    if (!hit) {
      const found = hits
        .map((candidate) => candidate.code)
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");
      throw new NotFoundError(`javdb has no ${name}; its search returned ${found} instead`);
    }

    // Modelled as a click from the results page: a cold navigation would carry
    // no Referer and report sec-fetch-site: none, which is a fingerprint tell.
    const movie = parseDetailPage(
      await client.fetchPage(hit.url, { cookie, referer: searchUrl }),
      hit.url,
    );

    if (normalise(movie.code) !== normalise(name)) {
      throw new NotFoundError(
        `javdb has no ${name}; the closest result was ${movie.code} at ${hit.url}`,
      );
    }

    return movie;
  },
});
