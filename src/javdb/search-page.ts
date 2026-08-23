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
  /** The container is present even when it holds no results. */
  list: ".movie-list",
  item: ".item > a",
  /** javdb prints the code under each result. */
  code: ".video-title strong",
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
    throw new ParseError(
      `no results container on ${searchUrl}; this was not a javdb search page, so the name cannot be called missing`,
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
 * The hit whose code is the one asked for, else null.
 *
 * javdb's search is fuzzy and happily returns neighbours, so opening hit zero
 * blindly can attach one movie's metadata to another movie's file.
 */
export const matchByCode = (hits: readonly SearchHit[], wanted: string): SearchHit | null => {
  const target = normaliseCode(wanted);
  return hits.find((hit) => normaliseCode(hit.code) === target) ?? null;
};
