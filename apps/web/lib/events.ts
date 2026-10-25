/**
 * Several independent panels (SecurityOverview, SecurityTestRunner,
 * SecurityLabScenarios, ReportsPanel, DemoMode) each read the same
 * server-side security test run history but fetch it on their own mount —
 * none of them share React state. Without this, triggering a run from one
 * panel (e.g. DemoMode's own fetch call) left the others showing stale
 * data until a manual page reload. A plain DOM event is enough to keep
 * them in sync without introducing a context/store for one signal.
 */
export const SECURITY_TEST_RUN_EVENT = "research-lab:security-test-run-updated";

export function notifySecurityTestRunUpdated() {
  window.dispatchEvent(new Event(SECURITY_TEST_RUN_EVENT));
}
