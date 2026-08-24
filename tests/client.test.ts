import { describe, expect, test } from "bun:test";

import { cookieProblem, withLocale } from "../src/javdb/client";

describe("withLocale", () => {
  test("appends the locale when the cookie has none", () => {
    expect(withLocale("cf_clearance=abc; _jdb_session=x", "zh")).toBe(
      "cf_clearance=abc; _jdb_session=x; locale=zh",
    );
  });

  test("replaces a locale the caller sent, so the two do not conflict", () => {
    // The real bug: a cookie carrying locale=en made javdb serve English labels.
    expect(withLocale("cf_clearance=abc; locale=en; _jdb_session=x", "zh")).toBe(
      "cf_clearance=abc; _jdb_session=x; locale=zh",
    );
  });

  test("matches the locale key regardless of case", () => {
    expect(withLocale("cf_clearance=abc; Locale=EN", "zh")).toBe("cf_clearance=abc; locale=zh");
  });

  test("leaves cf_clearance and every other cookie intact", () => {
    const out = withLocale("cf_clearance=keepme; over18=1; mdd=0", "zh");
    expect(out).toContain("cf_clearance=keepme");
    expect(out).toContain("over18=1");
    expect(out).toContain("mdd=0");
  });

  test("does nothing when locale forcing is disabled", () => {
    expect(withLocale("cf_clearance=abc; locale=en", "")).toBe("cf_clearance=abc; locale=en");
  });
});

describe("cookieProblem", () => {
  test("accepts a cookie carrying cf_clearance", () => {
    expect(cookieProblem("cf_clearance=abc; _jdb_session=x")).toBeNull();
  });

  test("rejects a missing cookie", () => {
    expect(cookieProblem("")).toContain("no cookie");
  });

  test("rejects a cookie with no cf_clearance", () => {
    expect(cookieProblem("_jdb_session=x")).toContain("cf_clearance");
  });

  test("rejects a cookie that would forge a header", () => {
    expect(cookieProblem("cf_clearance=abc\r\nX-Evil: 1")).toContain("newline");
  });
});
