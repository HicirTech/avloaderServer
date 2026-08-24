import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { matchByCode, parseSearchPage } from "../src/javdb/search-page";

const SEARCH_URL = "https://javdb.com/search?q=NYKD-145";

/** A whole javdb search page saved from a browser. See tests/fixtures/README.md. */
const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "fixtures", `${name}.html`), "utf8");

describe("against saved javdb search pages", () => {
  test("reads the results, their links and their codes", () => {
    const hits = parseSearchPage(fixture("search-hits"), SEARCH_URL);

    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0]).toEqual({ url: "https://javdb.com/v/4DEE4p", code: "NYKD-145" });
    for (const hit of hits) {
      expect(hit.url).toStartWith("https://javdb.com/v/");
    }
  });

  test("javdb's search is fuzzy, so the wanted code is not the only hit", () => {
    // This is why lookup verifies the code instead of opening hit zero blindly.
    const hits = parseSearchPage(fixture("search-hits"), SEARCH_URL);
    const others = hits.filter((hit) => hit.code !== "NYKD-145");
    expect(others.length).toBeGreaterThan(0);
  });

  test("picks the wanted code out of the neighbours", () => {
    const hits = parseSearchPage(fixture("search-hits"), SEARCH_URL);
    expect(matchByCode(hits, "NYKD-145")?.url).toBe("https://javdb.com/v/4DEE4p");
    expect(matchByCode(hits, "ZZZZ-9999")).toBeNull();
  });

  test("a search that matched nothing is an empty list, not an error", () => {
    // javdb renders no results container at all in this case, only the
    // empty-message marker. Treating that as drift would make every genuinely
    // missing code retry forever.
    const html = fixture("search-empty");
    expect(html).not.toContain('class="movie-list');
    expect(html).toContain("empty-message");

    expect(parseSearchPage(html, "https://javdb.com/search?q=ZZZZ-9999")).toEqual([]);
  });
});

describe("shapes no saved page covers", () => {
  const results = (...cards: string[]) =>
    `<html><body><div class="movie-list h cols-4">${cards.join("")}</div></body></html>`;

  const card = (href: string, code: string) =>
    `<div class="item"><a href="${href}" class="box">
       <div class="video-title"><strong>${code}</strong> some title</div>
     </a></div>`;

  test("leaves an already absolute link alone", () => {
    const hits = parseSearchPage(results(card("https://javdb.com/v/ccc", "X-1")), SEARCH_URL);
    expect(hits[0]?.url).toBe("https://javdb.com/v/ccc");
  });

  test("throws when the page is neither a result list nor a search page", () => {
    // A Cloudflare interstitial, or markup that moved. The caller must not
    // record the name as permanently absent because of it.
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

describe("matchByCode and distributor prefixes", () => {
  // Real failures: searching 328CNSTV-027 returns CNSTV-027 at the top, and
  // 393OTIM-684 returns OTIM-684. The prefix is the distributor's, not javdb's.
  const ranked = [
    { url: "https://javdb.com/v/a", code: "CNSTV-027" },
    { url: "https://javdb.com/v/b", code: "CNSTV-007" },
    { url: "https://javdb.com/v/c", code: "CNSTV-017" },
  ];

  test("accepts the top hit once the numeric prefix is dropped", () => {
    expect(matchByCode(ranked, "328CNSTV-027")?.url).toBe("https://javdb.com/v/a");
  });

  test("prefers an exact match, so a code that really carries digits still wins", () => {
    // javdb's own code for this label includes the 259.
    const withPrefix = [
      { url: "https://javdb.com/v/x", code: "LUXU-1234" },
      { url: "https://javdb.com/v/y", code: "259LUXU-1234" },
    ];
    expect(matchByCode(withPrefix, "259LUXU-1234")?.url).toBe("https://javdb.com/v/y");
  });

  test("will not take a stripped match from further down the ranking", () => {
    // Relevance put something else first, so the stripped code is a neighbour
    // rather than javdb's answer to what this file is.
    const buried = [
      { url: "https://javdb.com/v/first", code: "CNSTV-007" },
      { url: "https://javdb.com/v/second", code: "CNSTV-027" },
    ];
    expect(matchByCode(buried, "328CNSTV-027")).toBeNull();
  });

  test("does not strip when there is no letter after the digits", () => {
    expect(matchByCode([{ url: "u", code: "027" }], "328027")).toBeNull();
  });
});
