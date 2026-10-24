export {
  validateUrlForAnalysis,
  isHostAllowed,
  isIpAddressSafe,
  resolveHostnameSafely,
} from "./urlSafety.js";
export type { UrlSafetyResult, ValidateUrlOptions, ResolutionResult } from "./urlSafety.js";

export { safeFetch, buildPinnedLookup } from "./safeFetch.js";
export type {
  SafeFetchOptions,
  SafeFetchResult,
  SafeFetchSuccess,
  SafeFetchFailure,
  SafeFetchFailureStage,
  PinnedLookupFn,
} from "./safeFetch.js";
