import { describe, expect, it } from "vitest";
import { extractHtmlMetadata } from "../../src/analysis/htmlMetadata.js";

describe("extractHtmlMetadata", () => {
  it("extracts title, description, canonical, and OpenGraph tags", () => {
    const html = `
      <html>
        <head>
          <title>My Page</title>
          <meta name="description" content="A test page.">
          <link rel="canonical" href="https://example.com/canonical">
          <meta property="og:title" content="OG Title">
          <meta property="og:description" content="OG Description">
          <meta property="og:image" content="https://example.com/img.png">
        </head>
        <body></body>
      </html>
    `;
    expect(extractHtmlMetadata(html)).toEqual({
      title: "My Page",
      description: "A test page.",
      canonicalUrl: "https://example.com/canonical",
      ogTitle: "OG Title",
      ogDescription: "OG Description",
      ogImage: "https://example.com/img.png",
    });
  });

  it("returns null for fields that aren't present, rather than fabricating them", () => {
    const html = "<html><head></head><body>no metadata here</body></html>";
    expect(extractHtmlMetadata(html)).toEqual({
      title: null,
      description: null,
      canonicalUrl: null,
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
    });
  });

  it("does not throw on malformed HTML", () => {
    const html = "<html><head><title>Unclosed<body>garbage</title>";
    expect(() => extractHtmlMetadata(html)).not.toThrow();
  });
});
