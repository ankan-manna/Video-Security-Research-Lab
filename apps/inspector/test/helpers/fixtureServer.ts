import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny synthetic local HTTP server standing in for "a real target" across
 * the browser/session/network-observer tests in this workspace. Never
 * reaches the network, never requires credentials — every route below is a
 * fixed, hardcoded response chosen to exercise one specific signal (a
 * manifest content-type, a 401, a redirect to a login-shaped path, etc.).
 */
export interface FixtureServerHandle {
  url: string;
  close: () => Promise<void>;
  /** Flips whether /api/protected returns 200 or 401 — simulates a session becoming valid/invalid. */
  setAuthorized: (authorized: boolean) => void;
}

const HLS_MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=640x360
media.m3u8
`;

const HLS_MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:6.0,
segment-000.ts
#EXTINF:6.0,
segment-001.ts
#EXT-X-ENDLIST
`;

export function startFixtureServer(): Promise<FixtureServerHandle> {
  let authorized = true;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><html><body><p id="marker">loaded</p><a href="/watch">watch</a></body></html>');
      return;
    }

    if (url.pathname === "/watch") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><html><body><p id="marker">watch page</p></body></html>');
      return;
    }

    if (url.pathname === "/auto-play") {
      // Simulates "normal playback": on load, fetches the media playlist and its first segment
      // itself, so an HTTP-API-only test (navigate here) exercises the real capture pipeline
      // without the test needing direct access to the Playwright Page object.
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><body><p id="marker">auto-play</p>
        <script>
          fetch("/media.m3u8").then(() => fetch("/segment-000.ts"));
        </script>
      </body></html>`);
      return;
    }

    if (url.pathname === "/login") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<!doctype html><html><body><p id="marker">login page</p></body></html>');
      return;
    }

    if (url.pathname === "/redirect-login") {
      res.writeHead(302, { location: "/login" });
      res.end();
      return;
    }

    if (url.pathname === "/slow") {
      // Deliberately never responds until the client disconnects — used to trigger a real
      // net::ERR_ABORTED by navigating away mid-request, exercising genuine cancellation.
      req.on("close", () => res.destroy());
      return;
    }

    if (url.pathname === "/init-segment.m4s") {
      res.writeHead(200, { "content-type": "video/mp4" });
      res.end(Buffer.from([0x00, 0x00, 0x00, 0x18]));
      return;
    }

    if (url.pathname === "/broken-manifest.m3u8") {
      // HLS-shaped by content-type and extension, but the body doesn't actually start with
      // #EXTM3U — exercises the "manifest-shaped but didn't actually parse" path.
      res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
      res.end("this is not a real playlist at all");
      return;
    }

    if (url.pathname === "/manifest.mpd") {
      res.writeHead(200, { "content-type": "application/dash+xml" });
      res.end("<MPD></MPD>");
      return;
    }

    if (url.pathname === "/manifest.m3u8") {
      res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
      res.end(HLS_MASTER);
      return;
    }

    if (url.pathname === "/media.m3u8") {
      res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
      res.end(HLS_MEDIA);
      return;
    }

    if (/^\/segment-\d{3}\.ts$/.test(url.pathname)) {
      // Exact-match only (not a loose prefix) — a mutated/malformed variant of one of these exact
      // paths (see security/tests/resourceValidation.ts) deliberately falls through to the 404
      // catch-all below, the way a real target's router would reject an unrecognized path.
      res.writeHead(200, { "content-type": "video/mp2t" });
      res.end(Buffer.from([0x47, 0x00, 0x00, 0x10]));
      return;
    }

    if (url.pathname === "/auth-required-segment.ts") {
      // Always denies, regardless of any header — simulates a target that correctly enforces
      // authentication on a protected media resource. Used by the Prompt 3 security-test fixtures
      // to exercise the "unauthenticated request is correctly denied" (pass) path.
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthenticated" }));
      return;
    }

    if (url.pathname.startsWith("/loose/")) {
      // Always serves 200 for anything under this prefix, including an obviously malformed or
      // mutated suffix — simulates a target with insufficient resource-identifier validation. Used
      // to exercise the "fail" path of the resource/identifier-validation security test.
      res.writeHead(200, { "content-type": "video/mp2t" });
      res.end(Buffer.from([0x47, 0x00, 0x00, 0x10]));
      return;
    }

    if (url.pathname === "/api/protected") {
      if (!authorized) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthenticated" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
        setAuthorized: (value: boolean) => {
          authorized = value;
        },
      });
    });
  });
}
