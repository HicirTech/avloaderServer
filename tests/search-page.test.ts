import { describe, expect, test } from "bun:test";

import { matchByCode, parseSearchPage } from "../src/javdb/search-page";

const SEARCH_URL = "https://javdb.com/search?q=ABC-123";

/**
 * Hand-written, unlike the movie-page fixtures.
 *
 * No real javdb search page has been saved yet, so these mirror the selectors in
 * search-page.ts rather than confirming them. Save a real page into
 * tests/fixtures/ and point these at it.
 */
const results = (...cards: string[]) =>
  `<html><body><div class="movie-list h cols-4">${cards.join("")}</div></body></html>`;

const card = (href: string, code: string) =>
  `<div class="item"><a href="${href}" class="box">
     <div class="video-title"><strong>${code}</strong> some title</div>
   </a></div>`;

describe("parseSearchPage", () => {
  test("reads every result in page order, absolutising the links", () => {
    const hits = parseSearchPage(
      results(card("/v/aaa", "ABC-123"), card("/v/bbb", "ABC-124")),
      SEARCH_URL,
    );

    expect(hits).toEqual([
      { url: "https://javdb.com/v/aaa", code: "ABC-123" },
      { url: "https://javdb.com/v/bbb", code: "ABC-124" },
    ]);
  });

  test("leaves an already absolute link alone", () => {
    const hits = parseSearchPage(results(card("https://javdb.com/v/ccc", "X-1")), SEARCH_URL);
    expect(hits[0]?.url).toBe("https://javdb.com/v/ccc");
  });

  test("returns an empty list when the search ran and matched nothing", () => {
    expect(parseSearchPage(results(), SEARCH_URL)).toEqual([]);
  });

  test("throws rather than calling a non-search page an empty result", () => {
    // The distinction is load-bearing: an empty list lets the caller record the
    // name as permanently absent, so markup drift must not look like one.
    expect(() => parseSearchPage("<html><body>Just a moment...</body></html>", SEARCH_URL)).toThrow(
      /not a javdb search page/,
    );
  });

  test("skips a card with no link", () => {
    const hits = parseSearchPage(
      results(`<div class="item"><a class="box">no href</a></div>`, card("/v/ddd", "Y-2")),
      SEARCH_URL,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.code).toBe("Y-2");
  });

  test("reports an unreadable code as empty rather than guessing", () => {
    const hits = parseSearchPage(
      results(`<div class="item"><a href="/v/eee" class="box">no title element</a></div>`),
      SEARCH_URL,
    );
    expect(hits[0]).toEqual({ url: "https://javdb.com/v/eee", code: "" });
  });
});

describe("matchByCode", () => {
  const hits = [
    { url: "https://javdb.com/v/a", code: "ABC-1234" },
    { url: "https://javdb.com/v/b", code: "ABC-123" },
  ];

  test("picks the exact code, not the first hit", () => {
    expect(matchByCode(hits, "ABC-123")?.url).toBe("https://javdb.com/v/b");
  });

  test("ignores case, spaces and separators", () => {
    expect(matchByCode(hits, "abc 123")?.url).toBe("https://javdb.com/v/b");
    expect(matchByCode(hits, "abc_123")?.url).toBe("https://javdb.com/v/b");
  });

  test("returns null when nothing matches", () => {
    expect(matchByCode(hits, "ZZZ-999")).toBeNull();
  });
});
