import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDetailPage } from "../src/javdb/detail-page";

const URL_FOR = (code: string) => `https://javdb.com/v/${code}`;

/** A whole javdb page saved from a browser. See tests/fixtures/README.md. */
const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "fixtures", `${name}.html`), "utf8");

const parseFixture = (name: string) => parseDetailPage(fixture(name), URL_FOR(name));

describe("against saved javdb pages", () => {
  test("reads every field of a page with one actor and a single preview image", () => {
    const movie = parseFixture("nykd-145");

    expect(movie.code).toBe("NYKD-145");
    expect(movie.originalTitle).toBe("還暦で初撮り 石川桃子");
    expect(movie.translatedTitle).toBeNull();
    expect(movie.releasedAt).toBe("2026-08-18");
    expect(movie.durationMinutes).toBe(118);
    expect(movie.director).toBe("村山恭介");
    expect(movie.studio).toBe("ルビー");
    expect(movie.series).toBe("還暦で初撮り");
    expect(movie.rating).toBe(5);
    expect(movie.voteCount).toBe(7);
    expect(movie.genres).toEqual(["熟女", "已婚婦女", "和服，喪服", "單體作品", "中出", "首次亮相"]);
    expect(movie.actors).toContain("石川桃子");
    expect(movie.previewImages).toEqual(["https://c0.jdbstatic.com/samples/4d/4DEE4p_l_0.jpg"]);
    expect(movie.sourceUrl).toBe(URL_FOR("nykd-145"));
  });

  test("reads an English-locale page whose labels and formats differ", () => {
    // javdb serves the panel in the account language: without a locale=zh cookie
    // the labels are ID/Rating/Tags and the rating reads "4.63, by 399 users".
    const movie = parseFixture("achj-090-en");

    expect(movie.code).toBe("ACHJ-090");
    expect(movie.releasedAt).toBe("2026-08-25");
    expect(movie.durationMinutes).toBe(190);
    expect(movie.director).toBe("真咲南朋");
    expect(movie.rating).toBe(4.63);
    expect(movie.voteCount).toBe(399);
    expect(movie.genres[0]).toBe("Mature Woman");
    expect(movie.actors).toContain("七海ティナ");
  });

  test("reads a fractional rating and its vote count", () => {
    const movie = parseFixture("jur-100");
    expect(movie.rating).toBe(4.33);
    expect(movie.voteCount).toBe(101);
  });

  test("takes the preview gallery, not the related-movie thumbnails", () => {
    // Every page carries three `.tile-images`; only the first is this movie's.
    expect(fixture("jur-100").split("tile-images").length - 1).toBe(3);

    const movie = parseFixture("jur-100");
    expect(movie.previewImages).toHaveLength(11);
    for (const url of movie.previewImages) {
      expect(url).toContain("/samples/");
    }
  });

  test("keeps every performer the page lists, in page order", () => {
    // javdb marks gender with a sibling <strong> holding U+2640 or U+2642,
    // which must not reach the name.
    const movie = parseFixture("madv-641");
    expect(movie.actors).toEqual(["押井敬之", "那賀崎ゆきね"]);
    for (const actor of movie.actors) {
      expect(actor).not.toContain("\u2640");
      expect(actor).not.toContain("\u2642");
    }
  });

  test("strips the non-breaking spaces javdb pads panel values with", () => {
    expect(fixture("tcd-343")).toContain("&nbsp;");

    const movie = parseFixture("tcd-343");
    expect(movie.code).toBe("TCD-343");
    expect(movie.code).not.toMatch(/\s/);
    expect(movie.studio).toBe("TRANS CLUB");
  });

  test("parses all four fixtures without throwing", () => {
    for (const name of ["jur-100", "madv-641", "nykd-145", "tcd-343"]) {
      expect(parseFixture(name).code).toMatch(/^[A-Z]+-\d+$/);
    }
  });
});

describe("shapes no saved page covers", () => {
  const page = (body: string) => `<html><body>${body}</body></html>`;

  test("inverts the title pair when javdb shows a translated title", () => {
    // The page reads translated-first, so `.current-title` is the translation.
    const movie = parseDetailPage(
      page(`<div class="panel-block"><strong>番號:</strong><span class="value">ABC-1</span></div>
            <h2><strong class="current-title">翻译过的标题</strong>
                <strong class="origin-title">原文タイトル</strong></h2>`),
      URL_FOR("abc-1"),
    );

    expect(movie.originalTitle).toBe("原文タイトル");
    expect(movie.translatedTitle).toBe("翻译过的标题");
  });

  test("treats javdb's N/A placeholder as absent", () => {
    const movie = parseDetailPage(
      page(`<div class="panel-block"><strong>番號:</strong><span class="value">ABC-1</span></div>
            <div class="panel-block"><strong>導演:</strong><span class="value">N/A</span></div>
            <h2 class="current-title">t</h2>`),
      URL_FOR("abc-1"),
    );

    expect(movie.director).toBeNull();
  });

  test("keeps a movie whose optional fields are all missing", () => {
    const movie = parseDetailPage(
      page(`<div class="panel-block"><strong>番號:</strong><span class="value">ABC-1</span></div>
            <h2 class="current-title">t</h2>`),
      URL_FOR("abc-1"),
    );

    expect(movie.code).toBe("ABC-1");
    expect(movie.releasedAt).toBeNull();
    expect(movie.rating).toBeNull();
    expect(movie.genres).toEqual([]);
    expect(movie.previewImages).toEqual([]);
  });

  test("rejects a date that is not the plain form javdb prints", () => {
    const movie = parseDetailPage(
      page(`<div class="panel-block"><strong>番號:</strong><span class="value">ABC-1</span></div>
            <div class="panel-block"><strong>日期:</strong><span class="value">明日</span></div>
            <h2 class="current-title">t</h2>`),
      URL_FOR("abc-1"),
    );

    expect(movie.releasedAt).toBeNull();
  });

  test("a page with no panel at all says so, and quotes the title", () => {
    // Tells a Cloudflare interstitial apart from markup drift, which used to
    // read the same and want a different response.
    expect(() =>
      parseDetailPage(
        `<html><head><title>Just a moment...</title></head><body>_cf_chl_opt</body></html>`,
        URL_FOR("x"),
      ),
    ).toThrow(/no metadata panel .*Just a moment/);
  });

  test("a renamed code label is reported with the labels that were there", () => {
    expect(() =>
      parseDetailPage(
        page(`<div class="panel-block"><strong>編號:</strong><span class="value">ABC-1</span></div>
              <div class="panel-block"><strong>日期:</strong><span class="value">2026-01-01</span></div>`),
        URL_FOR("x"),
      ),
    ).toThrow(/code label has been renamed/);
  });

  test("throws ParseError rather than returning a movie with no code", () => {
    expect(() => parseDetailPage(page(`<h2 class="current-title">t</h2>`), URL_FOR("x"))).toThrow(
      /no metadata panel/,
    );
  });

  test("throws ParseError rather than returning a movie with no title", () => {
    expect(() =>
      parseDetailPage(
        page(`<div class="panel-block"><strong>番號:</strong><span class="value">ABC-1</span></div>`),
        URL_FOR("x"),
      ),
    ).toThrow(/no title/);
  });
});
