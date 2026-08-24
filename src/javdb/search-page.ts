/**
 * Reads a javdb search results page.
 *
 * The distinction that matters here is "the search ran and matched nothing"
 * versus "this is not a search results page at all". The first is a 404 for the
 * caller; the second means javdb changed or served something else, and reporting
 * it as a miss would let the caller record the name as permanently absent.
 */

import { parse } from "node-html-parser";

import { ParseError } from "./errors";

const SELECTORS = {
  /** Absent entirely when the search matched nothing -- see parseSearchPage. */
  list: ".movie-list",
  item: ".item > a",
  /** javdb prints the code under each result. */
  code: ".video-title strong",
  /** javdb's explicit no-results marker, "暫無內容". */
  emptyMessage: ".empty-message",
  /** The search box, present on any search page whether or not it matched. */
  searchBar: "#video-search",
} as const;

export interface SearchHit {
  /** Absolute javdb URL of the movie page. */
  readonly url: string;
  /** Code as printed on the result card, or empty when it could not be read. */
  readonly code: string;
}

const BASE = "https://javdb.com";

const clean = (value: string | null | undefined): string =>
  (value ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

/**
 * Every result on the page, in order.
 *
 * Throws ParseError when the page carries no results container at all, which
 * separates a genuine miss from markup drift or an interstitial.
 */
export const parseSearchPage = (html: string, searchUrl: string): SearchHit[] => {
  const root = parse(html);

  if (!root.querySelector(SELECTORS.list)) {
    // A search that matched nothing renders no list at all, only "暫無內容", so
    // the absence of a list is not by itself evidence of drift. The empty
    // marker, or failing that the search box, is what proves this really was a
    // search page and the name really is missing.
    if (root.querySelector(SELECTORS.emptyMessage) || root.querySelector(SELECTORS.searchBar)) {
      return [];
    }
    throw new ParseError(
      `no results container and no search box on ${searchUrl}; this was not a javdb search page, so the name cannot be called missing`,
    );
  }

  const hits: SearchHit[] = [];
  for (const anchor of root.querySelectorAll(`${SELECTORS.list} ${SELECTORS.item}`)) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    hits.push({
      url: href.startsWith("http") ? href : `${BASE}${href}`,
      code: clean(anchor.querySelector(SELECTORS.code)?.textContent),
    });
  }

  return hits;
};

/** javdb codes differ only in punctuation and case across pages. */
const normaliseCode = (code: string): string => code.replace(/[\s_-]/g, "").toUpperCase();

/**
 * A file named after a distributor prefix, as in the 328 of 328CNSTV-027.
 *
 * Some labels carry the prefix into javdb's own code (259LUXU-1234 really is
 * called that) and some do not, and the two are indistinguishable by shape --
 * which is why this is only ever a fallback, never the first thing tried.
 */
const withoutNumericPrefix = (code: string): string | null =>
  /^\d{1,4}([A-Za-z].*)$/.exec(code.trim())?.[1] ?? null;

/**
 * The hit for the code asked for, else null.
 *
 * An exact match wins. Failing that, the same code without a leading numeric
 * prefix is accepted, but only from the FIRST hit: javdb ranks by relevance, so
 * a stripped code at the top is its own answer to what the file is, while the
 * same code further down is just a neighbour.
 *
 * javdb's search is fuzzy and happily returns neighbours, so opening hit zero
 * blindly would attach one movie's metadata to another movie's file.
 */
export const matchByCode = (hits: readonly SearchHit[], wanted: string): SearchHit | null => {
  const exact = hits.find((hit) => normaliseCode(hit.code) === normaliseCode(wanted));
  if (exact) return exact;

  const stripped = withoutNumericPrefix(wanted);
  const first = hits[0];
  return stripped && first && normaliseCode(first.code) === normaliseCode(stripped) ? first : null;
};
