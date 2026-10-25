import { XMLParser } from "fast-xml-parser";
import type { DashAdaptationSet, DashAnalysis, DashPeriod, DashRepresentation } from "./types.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

interface RawRepresentation {
  ["@_id"]?: string;
  ["@_bandwidth"]?: string;
  ["@_codecs"]?: string;
  ["@_width"]?: string;
  ["@_height"]?: string;
  ["@_mimeType"]?: string;
}

interface RawContentProtection {
  ["@_schemeIdUri"]?: string;
}

interface RawAdaptationSet {
  ["@_id"]?: string;
  ["@_contentType"]?: string;
  ["@_mimeType"]?: string;
  ["@_codecs"]?: string;
  Representation?: RawRepresentation | RawRepresentation[];
  ContentProtection?: RawContentProtection | RawContentProtection[];
  SegmentTemplate?: unknown;
  SegmentList?: unknown;
}

interface RawPeriod {
  ["@_id"]?: string;
  AdaptationSet?: RawAdaptationSet | RawAdaptationSet[];
}

interface RawMpd {
  ["@_profiles"]?: string;
  ["@_mediaPresentationDuration"]?: string;
  ["@_type"]?: string;
  Period?: RawPeriod | RawPeriod[];
}

function parseRepresentation(raw: RawRepresentation, fallbackCodecs: string | null): DashRepresentation {
  return {
    id: stringOrNull(raw["@_id"]),
    bandwidth: numberOrNull(raw["@_bandwidth"]),
    codecs: stringOrNull(raw["@_codecs"]) ?? fallbackCodecs,
    width: numberOrNull(raw["@_width"]),
    height: numberOrNull(raw["@_height"]),
    mimeType: stringOrNull(raw["@_mimeType"]),
  };
}

function parseAdaptationSet(raw: RawAdaptationSet): DashAdaptationSet {
  const fallbackCodecs = stringOrNull(raw["@_codecs"]);
  const representations = asArray(raw.Representation).map((rep) => parseRepresentation(rep, fallbackCodecs));
  const contentProtection = asArray(raw.ContentProtection)
    .map((cp) => stringOrNull(cp["@_schemeIdUri"]))
    .filter((schemeIdUri): schemeIdUri is string => schemeIdUri !== null)
    .map((schemeIdUri) => ({ schemeIdUri }));

  return {
    id: stringOrNull(raw["@_id"]),
    contentType: stringOrNull(raw["@_contentType"]),
    mimeType: stringOrNull(raw["@_mimeType"]),
    representations,
    contentProtection,
    segmentTemplatePresent: raw.SegmentTemplate !== undefined,
    segmentListPresent: raw.SegmentList !== undefined,
  };
}

function parsePeriod(raw: RawPeriod): DashPeriod {
  return {
    id: stringOrNull(raw["@_id"]),
    adaptationSets: asArray(raw.AdaptationSet).map(parseAdaptationSet),
  };
}

/**
 * Parses an MPEG-DASH MPD manifest. ContentProtection elements (DRM
 * signaling) are reported by scheme URI only — this never attempts to
 * resolve a license server, fetch a key, or otherwise act on DRM metadata
 * beyond noting that it's present.
 */
export function parseDashManifest(xmlText: string): DashAnalysis {
  const warnings: string[] = [];
  let parsed: { MPD?: RawMpd };
  try {
    parsed = xmlParser.parse(xmlText) as { MPD?: RawMpd };
  } catch (error) {
    return {
      type: "dash",
      profiles: null,
      mediaPresentationDuration: null,
      isDynamic: false,
      periods: [],
      warnings: [`XML could not be parsed: ${(error as Error).message}`],
    };
  }

  const mpd = parsed.MPD;
  if (!mpd) {
    warnings.push("No <MPD> root element was found.");
    return {
      type: "dash",
      profiles: null,
      mediaPresentationDuration: null,
      isDynamic: false,
      periods: [],
      warnings,
    };
  }

  const periods = asArray(mpd.Period).map(parsePeriod);
  if (periods.length === 0) {
    warnings.push("No <Period> elements were found inside <MPD>.");
  }

  return {
    type: "dash",
    profiles: stringOrNull(mpd["@_profiles"]),
    mediaPresentationDuration: stringOrNull(mpd["@_mediaPresentationDuration"]),
    isDynamic: stringOrNull(mpd["@_type"]) === "dynamic",
    periods,
    warnings,
  };
}
