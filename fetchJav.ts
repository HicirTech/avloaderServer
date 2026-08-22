import { HTMLElement, parse } from "node-html-parser";
import { fetchJavdbPage, RequestError } from "./javdbClient";

const fetchTargetUrlFromJAV = async (name: string, cookie?: string | null) => {
  const effectiveCookie = cookie || process.env.JAVDB_COOKIE;
  if (!effectiveCookie) {
    throw new RequestError(
      "no cookie supplied — pass `cookie` in the request body or set JAVDB_COOKIE"
    );
  }
  if (!effectiveCookie.includes("cf_clearance=")) {
    throw new RequestError(
      "cookie has no cf_clearance — copy the whole Cookie header from a browser that loads javdb.com without a challenge"
    );
  }

  const searchQuery = new URL("https://javdb.com/search");
  searchQuery.searchParams.append("q", name);
  const searchUrl = searchQuery.toString();

  const firstSearchText = await fetchJavdbPage(searchUrl, {
    cookie: effectiveCookie,
  });

  const firstParser = parse(firstSearchText);

  const firstItemElment = firstParser.querySelector(".movie-list > .item > a");
  if (!firstItemElment) {
    return {};
  }

  const videoQuery = `https://javdb.com${firstItemElment.getAttribute("href")}`;
  // Modelled as a click from the search results page.
  const inVideoText = await fetchJavdbPage(videoQuery, {
    cookie: effectiveCookie,
    referer: searchUrl,
  });

  const detailParse = parse(inVideoText);

  const moiveAttr = {} as { [key: string]: any };

  const hasOriginalTitle = detailParse.querySelector(
    '[data-movie-detail-target="showOriginTitle"]'
  );

  // titles
  if (hasOriginalTitle) {
    const translatedTitle = detailParse.querySelector(".current-title");
    const originalTitle = detailParse.querySelector(".origin-title");
    moiveAttr["原标题"] = originalTitle!.innerText;
    moiveAttr["翻译标题"] = translatedTitle!.innerText;
  } else {
    const originalTitle = detailParse.querySelector(".current-title");
    moiveAttr["原标题"] = originalTitle!.innerText;
  }

  const tileImages = detailParse.querySelector(".tile-images");
  const imgs = tileImages
    ? [...tileImages.querySelectorAll(".tile-item")].map((el) =>
        el.getAttribute("href")
      )
    : [];

  if (imgs.length) {
    moiveAttr["预览图"] = imgs;
  }

  const resultMata = [...detailParse.querySelectorAll(".panel-block")]
    .filter((el) => {
      return el.querySelector("strong");
    })
    .map((el) => {
      const key = el.querySelector("strong")!.innerText.replace(":", "").trim();
      const valuesTag = el.querySelector(".value");

      if (key === "評分") {
        const rateValue = valuesTag!.textContent.trim().split("分")[0];

        return { key, values: [rateValue] };
      }

      if (key === "番號") {
        const rateValue = valuesTag!.textContent.trim();
        return { key, values: [rateValue] };
      }

      if (valuesTag!.childNodes.length != 1) {
        const valueChildren = [...valuesTag!.childNodes]
          .map((ell) => ell as HTMLElement)
          .filter((ell) => ell.tagName === "A")
          .map((ell) => ell.innerText.trim().replace(/^\s+|\s+$/g, ""));

        return {
          key,
          values: valueChildren,
        };
      } else {
        if (valuesTag?.innerText.includes("N/A")) {
          return { key, values: [] };
        }

        return { key, values: [valuesTag!.innerText] };
      }
    })
    .reduce((acc, item) => {
      acc[item.key] = item.values;
      return acc;
    }, {} as { [key: string]: any });

  return { ...resultMata, ...moiveAttr };
};

export { fetchTargetUrlFromJAV };
