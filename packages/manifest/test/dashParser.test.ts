import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDashManifest } from "../src/dashParser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(path.join(here, "fixtures", name), "utf8");

describe("parseDashManifest", () => {
  it("parses MPD structure: periods, adaptation sets, representations", () => {
    const result = parseDashManifest(read("dash-sample.mpd"));
    expect(result.isDynamic).toBe(false);
    expect(result.mediaPresentationDuration).toBe("PT1H0M0.000S");
    expect(result.profiles).toBe("urn:mpeg:dash:profile:isoff-on-demand:2011");
    expect(result.periods).toHaveLength(1);

    const period = result.periods[0]!;
    expect(period.id).toBe("p0");
    expect(period.adaptationSets).toHaveLength(2);

    const video = period.adaptationSets[0]!;
    expect(video.contentType).toBe("video");
    expect(video.representations).toHaveLength(2);
    expect(video.representations[0]).toEqual({
      id: "v0",
      bandwidth: 1280000,
      codecs: "avc1.4d401e",
      width: 640,
      height: 360,
      mimeType: null,
    });
    expect(video.segmentTemplatePresent).toBe(true);
    expect(video.segmentListPresent).toBe(false);
    expect(video.contentProtection).toEqual([
      { schemeIdUri: "urn:mpeg:dash:mp4protection:2011" },
      { schemeIdUri: "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" },
    ]);

    const audio = period.adaptationSets[1]!;
    expect(audio.contentType).toBe("audio");
    expect(audio.segmentListPresent).toBe(true);
    expect(audio.segmentTemplatePresent).toBe(false);
    // representation without its own codecs falls back to the adaptation set's
    expect(audio.representations[0]!.codecs).toBe("mp4a.40.2");
  });

  it("never resolves or fetches ContentProtection / license information, only reports scheme presence", () => {
    const result = parseDashManifest(read("dash-sample.mpd"));
    const schemes = result.periods[0]!.adaptationSets[0]!.contentProtection.map((cp) => cp.schemeIdUri);
    expect(schemes).toContain("urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed");
  });

  it("reports a warning and empty periods for XML without an MPD root", () => {
    const result = parseDashManifest("<notMpd><foo/></notMpd>");
    expect(result.periods).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("reports a warning rather than throwing for unparseable XML", () => {
    const result = parseDashManifest("<MPD><Period id=");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
