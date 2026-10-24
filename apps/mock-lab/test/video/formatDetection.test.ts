import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectVideoFormat } from "../../src/video/formatDetection.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(here, "../fixtures", name));

describe("detectVideoFormat", () => {
  it("recognizes a real MP4 by its ftyp box, not its extension", () => {
    expect(detectVideoFormat(fixture("sample.mp4"))).toBe("mp4");
  });

  it("recognizes a real WebM by its EBML header", () => {
    expect(detectVideoFormat(fixture("sample.webm"))).toBe("webm");
  });

  it("rejects random bytes even with a .mp4 filename/extension", () => {
    expect(detectVideoFormat(fixture("not-a-video.mp4"))).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(detectVideoFormat(Buffer.alloc(0))).toBeNull();
  });

  it("rejects a buffer that merely contains the word mp4 as text", () => {
    expect(detectVideoFormat(Buffer.from("this is definitely an mp4 video trust me"))).toBeNull();
  });
});
