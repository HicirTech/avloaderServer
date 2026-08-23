/**
 * Parses a javdb movie page into a Movie.
 *
 * Every javdb-specific selector and label is declared at the top, so a site
 * redesign is a one-file fix. Saved pages in tests/fixtures/ pin all of them.
 *
 * Only `code` and `originalTitle` are required; everything else degrades to null
 * or an empty list, because a page missing its director is still worth returning.
 */

import { parse, type HTMLElement } from "node-html-parser";

import type { Movie } from "../types";
import { ParseError } from "./errors";

const SELECTORS = {
  panelBlock: ".panel-block",
  panelLabel: "strong",
  panelValue: ".value",
  /** Shown alone, or as the translated title when an original one is also present. */
  currentTitle: ".current-title",
  /** Present only when javdb has both a translated and an original title. */
  originTitle: ".origin-title",
  /**
   * A page carries several `.tile-images`; the later ones are related-movie
   * thumbnails. Only the preview gallery belongs to this movie.
   */
  previewGallery: ".tile-images.preview-images",
  previewItem: ".tile-item",
} as const;

/** Panel labels, across the language settings javdb serves. */
const LABELS = {
  code: ["番號", "番号"],
  releasedAt: ["日期"],
  duration: ["時長", "时长"],
  director: ["導演", "导演"],
  studio: ["片商"],
  series: ["系列"],
  rating: ["評分", "评分"],
  genres: ["類別", "类别"],
  actors: ["演員", "演员"],
} as const;

/** javdb pads panel values with non-breaking spaces. */
const clean = (value: string | null | undefined): string =>
  (value ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

const textOf = (node: HTMLElement | null | undefined): string => clean(node?.textContent);

/** Anchor labels inside a panel value, which is how javdb renders every list field. */
const linkTexts = (value: HTMLElement | null): string[] =>
  value
    ? value
        .querySelectorAll("a")
        .map((anchor) => clean(anchor.textContent))
        .filter((text) => text.length > 0)
    : [];

/** Label to its `.value` element. Blocks without a label are ignored. */
const readPanels = (root: HTMLElement): Map<string, HTMLElement> => {
  const panels = new Map<string, HTMLElement>();

  for (const block of root.querySelectorAll(SELECTORS.panelBlock)) {
    const label = clean(block.querySelector(SELECTORS.panelLabel)?.textContent).replace(
      /[:：]$/,
      "",
    );
    const value = block.querySelector(SELECTORS.panelValue);
    // First wins: javdb prints each label once, and a duplicate would be a
    // related-movie panel rather than this movie's.
    if (label && value && !panels.has(label)) panels.set(label, value);
  }

  return panels;
};

const pick = (
  panels: Map<string, HTMLElement>,
  labels: readonly string[],
): HTMLElement | null => {
  for (const label of labels) {
    const found = panels.get(label);
    if (found) return found;
  }
  return null;
};

/** A panel's text, or null when absent or javdb printed its N/A placeholder. */
const textField = (panels: Map<string, HTMLElement>, labels: readonly string[]): string | null => {
  const text = textOf(pick(panels, labels));
  if (!text || text.includes("N/A")) return null;
  return text;
};

/** "140 分鍾" to 140. */
const parseDuration = (text: string | null): number | null => {
  const match = text ? /(\d+)\s*分/.exec(text) : null;
  return match?.[1] ? Number(match[1]) : null;
};

/** "4.33分, 由101人評價" to its two numbers. */
const parseScore = (text: string | null): { rating: number | null; voteCount: number | null } => {
  if (!text) return { rating: null, voteCount: null };
  const rating = /([\d.]+)\s*分/.exec(text)?.[1];
  const votes = /(\d+)\s*人/.exec(text)?.[1];
  return {
    rating: rating !== undefined ? Number(rating) : null,
    voteCount: votes !== undefined ? Number(votes) : null,
  };
};

/** Keep only what javdb prints as a plain ISO date; anything else is not a date. */
const parseDate = (text: string | null): string | null =>
  text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;

export const parseDetailPage = (html: string, sourceUrl: string): Movie => {
  const root = parse(html);
  const panels = readPanels(root);

  const code = textField(panels, LABELS.code);
  if (!code) {
    throw new ParseError(`no video code on ${sourceUrl}; javdb markup may have changed`);
  }

  // javdb shows the translated title as the current one and puts the original
  // beneath it, so the pair is inverted relative to how it reads on the page.
  const current = textOf(root.querySelector(SELECTORS.currentTitle));
  const origin = textOf(root.querySelector(SELECTORS.originTitle));
  const originalTitle = origin || current;
  if (!originalTitle) {
    throw new ParseError(`no title on ${sourceUrl}; javdb markup may have changed`);
  }

  const score = parseScore(textField(panels, LABELS.rating));

  return {
    code,
    originalTitle,
    translatedTitle: origin ? current || null : null,
    releasedAt: parseDate(textField(panels, LABELS.releasedAt)),
    durationMinutes: parseDuration(textField(panels, LABELS.duration)),
    director: textField(panels, LABELS.director),
    studio: textField(panels, LABELS.studio),
    series: textField(panels, LABELS.series),
    rating: score.rating,
    voteCount: score.voteCount,
    genres: linkTexts(pick(panels, LABELS.genres)),
    actors: linkTexts(pick(panels, LABELS.actors)),
    previewImages: (root.querySelector(SELECTORS.previewGallery)?.querySelectorAll(
      SELECTORS.previewItem,
    ) ?? [])
      .map((item) => item.getAttribute("href") ?? "")
      .filter((href) => href.length > 0),
    sourceUrl,
  };
};
