import { parse } from "node-html-parser";

/**
 * Only publicly-rendered <head> metadata that was already present in the
 * fetched HTML. Any field that wasn't found is `null` — never fabricated.
 */
export interface PageMetadata {
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
}

function textOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function extractHtmlMetadata(html: string): PageMetadata {
  const root = parse(html, { lowerCaseTagName: true });

  const title = textOrNull(root.querySelector("title")?.text);
  const description = textOrNull(root.querySelector('meta[name="description"]')?.getAttribute("content"));
  const canonicalUrl = textOrNull(root.querySelector('link[rel="canonical"]')?.getAttribute("href"));
  const ogTitle = textOrNull(root.querySelector('meta[property="og:title"]')?.getAttribute("content"));
  const ogDescription = textOrNull(root.querySelector('meta[property="og:description"]')?.getAttribute("content"));
  const ogImage = textOrNull(root.querySelector('meta[property="og:image"]')?.getAttribute("content"));

  return { title, description, canonicalUrl, ogTitle, ogDescription, ogImage };
}
