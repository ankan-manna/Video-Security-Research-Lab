import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeManifestText } from "../../src/manifest/analyzeManifest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(path.join(here, "../fixtures", name), "utf8");

describe("analyzeManifestText", () => {
  it("auto-detects HLS content", () => {
    const outcome = analyzeManifestText(read("hls-media.m3u8"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.type).toBe("hls");
  });

  it("auto-detects DASH content", () => {
    const outcome = analyzeManifestText(read("dash-sample.mpd"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.type).toBe("dash");
  });

  it("respects an explicit format hint", () => {
    const outcome = analyzeManifestText(read("hls-media.m3u8"), "hls");
    expect(outcome.ok).toBe(true);
  });

  it("reports unsupported content types instead of guessing", () => {
    const outcome = analyzeManifestText("<html><body>not a manifest</body></html>");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain("Could not detect manifest format");
    }
  });
});
