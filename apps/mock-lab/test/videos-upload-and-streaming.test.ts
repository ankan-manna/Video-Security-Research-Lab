import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildMockLabApp } from "../src/app.js";
import { videoDir } from "../src/video/paths.js";
import { buildMultipartPayload, multipartHeaders, waitForVideoStatus } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const SECRET = "test-secret-not-a-real-credential";

let dataDir: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `mock-lab-route-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  // Some tests intentionally don't await background processing before the
  // test ends (e.g. "rejects deletion with no auth token" doesn't care
  // whether FFmpeg has finished yet) — maxRetries tolerates the resulting
  // race against FFmpeg still writing segment files into this directory.
  await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function appWithAuth(overrides: Partial<Parameters<typeof buildMockLabApp>[0]> = {}) {
  const app = await buildMockLabApp({
    sessionSecret: SECRET,
    dataDir,
    segmentDurationSeconds: 1,
    ...overrides,
  });
  return { app };
}

/**
 * Logs in via the real Prompt 4 account system (buildMockLabApp seeds G1
 * and G2 on every fresh dataDir, same as the live server does on startup).
 * No password — picking the account label is the entire login, same
 * no-real-credentials spirit as Prompt 1's role picker, just backed by a
 * real revocable session now instead of a stateless role token.
 */
async function login(app: Awaited<ReturnType<typeof buildMockLabApp>>, accountLabel: "G1" | "G2") {
  const response = await app.inject({
    method: "POST",
    url: "/mock/session/login",
    payload: { accountLabel },
  });
  return response.json() as { token: string; csrfToken: string; user: { id: string; label: string } };
}

async function activateMembership(app: Awaited<ReturnType<typeof buildMockLabApp>>, token: string, channelId: string) {
  const response = await app.inject({
    method: "POST",
    url: `/mock/channels/${channelId}/membership/checkout`,
    headers: { authorization: `Bearer ${token}` },
    payload: { simulateOutcome: "success" },
  });
  return response.json() as { session: { token: string } };
}

async function g1ChannelId(app: Awaited<ReturnType<typeof buildMockLabApp>>, g1Token: string): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: "/mock/channels",
    headers: { authorization: `Bearer ${g1Token}` },
  });
  const { channels } = response.json();
  return channels[0].id as string;
}

async function uploadFixture(
  app: Awaited<ReturnType<typeof buildMockLabApp>>,
  token: string,
  fixtureName: string,
  visibility: "public" | "members" = "public",
) {
  const fileBuffer = await fs.readFile(path.join(fixturesDir, fixtureName));
  const payload = buildMultipartPayload([
    { name: "visibility", value: visibility },
    { name: "file", filename: fixtureName, contentType: "video/mp4", data: fileBuffer },
  ]);
  return app.inject({
    method: "POST",
    url: "/mock/videos",
    headers: multipartHeaders(token),
    payload,
  });
}

describe("POST /mock/videos (upload)", () => {
  it("rejects an upload with no auth token", async () => {
    const { app } = await appWithAuth();
    const fileBuffer = await fs.readFile(path.join(fixturesDir, "sample.mp4"));
    const payload = buildMultipartPayload([{ name: "file", filename: "sample.mp4", data: fileBuffer }]);
    const response = await app.inject({ method: "POST", url: "/mock/videos", headers: multipartHeaders(), payload });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("accepts a valid MP4 upload and processes it to ready", async () => {
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");

    const uploadResponse = await uploadFixture(app, token, "sample.mp4");
    expect(uploadResponse.statusCode).toBe(202);
    const { id, status } = uploadResponse.json();
    expect(status).toBe("uploaded");

    const { status: finalStatus, body } = await waitForVideoStatus(app, id);
    expect(finalStatus).toBe("ready");
    expect(body.segmentCount).toBeGreaterThan(0);
    expect(body.durationSeconds).toBeCloseTo(2, 0);

    await app.close();
  }, 20_000);

  it("rejects a file that isn't a recognized video format (checked by signature)", async () => {
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");

    const badBuffer = await fs.readFile(path.join(fixturesDir, "not-a-video.mp4"));
    const payload = buildMultipartPayload([
      { name: "file", filename: "not-a-video.mp4", contentType: "video/mp4", data: badBuffer },
    ]);
    const response = await app.inject({ method: "POST", url: "/mock/videos", headers: multipartHeaders(token), payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("unsupported_format");

    await app.close();
  });

  it("rejects an oversized upload with 413", async () => {
    const { app } = await appWithAuth({ maxUploadBytes: 1000 });
    const { token } = await login(app, "G1");

    const response = await uploadFixture(app, token, "sample.mp4");
    expect(response.statusCode).toBe(413);

    await app.close();
  });

  it("rejects a request with no file field", async () => {
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");

    const payload = buildMultipartPayload([{ name: "visibility", value: "public" }]);
    const response = await app.inject({ method: "POST", url: "/mock/videos", headers: multipartHeaders(token), payload });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("fails processing cleanly for a video exceeding the duration limit, without disclosing the data directory", async () => {
    const { app } = await appWithAuth({ maxDurationSeconds: 1 });
    const { token } = await login(app, "G1");

    const uploadResponse = await uploadFixture(app, token, "sample.mp4");
    const { id } = uploadResponse.json();

    const { status, body } = await waitForVideoStatus(app, id);
    expect(status).toBe("failed");
    expect(String(body.error)).not.toContain(dataDir);
    expect(String(body.error)).not.toContain("/tmp/");

    await app.close();
  }, 20_000);
});

describe("GET /mock/videos (listing)", () => {
  it("lists uploaded videos with no auth required, and does not include the static demo fixtures", async () => {
    // The Prompt 1 static demo videos (demo-public/demo-members) use placeholder text as segment
    // "content" — never real MPEG-TS — so they're intentionally excluded from the real video
    // library a player could select from; they remain reachable directly by id for the existing
    // fixture-based tests in auth-and-access.test.ts.
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");
    const uploadResponse = await uploadFixture(app, token, "sample.mp4");
    const { id } = uploadResponse.json();
    await waitForVideoStatus(app, id);

    const response = await app.inject({ method: "GET", url: "/mock/videos" });
    expect(response.statusCode).toBe(200);
    const { videos } = response.json();
    expect(videos.map((v: { id: string }) => v.id)).toContain(id);
    expect(videos.map((v: { id: string }) => v.id)).not.toContain("demo-public");
    expect(videos.map((v: { id: string }) => v.id)).not.toContain("demo-members");

    await app.close();
  }, 20_000);
});

describe("manifest, playlist, segment inventory, and segment delivery for uploaded videos", () => {
  async function uploadAndWaitReady(
    app: Awaited<ReturnType<typeof buildMockLabApp>>,
    token: string,
    visibility: "public" | "members" = "public",
  ) {
    const uploadResponse = await uploadFixture(app, token, "sample.mp4", visibility);
    const { id } = uploadResponse.json();
    await waitForVideoStatus(app, id);
    return id;
  }

  it("serves a public video's manifest, playlist, inventory, and segments without auth", async () => {
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");
    const id = await uploadAndWaitReady(app, token, "public");

    const manifest = await app.inject({ method: "GET", url: `/mock/videos/${id}/manifest` });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.body).toContain("#EXT-X-STREAM-INF");
    expect(manifest.body).toContain("playlist.m3u8");
    expect(manifest.headers["content-type"]).toBe("application/vnd.apple.mpegurl");

    const playlist = await app.inject({ method: "GET", url: `/mock/videos/${id}/playlist.m3u8` });
    expect(playlist.statusCode).toBe(200);
    expect(playlist.body).toContain("#EXT-X-ENDLIST");

    const inventory = await app.inject({ method: "GET", url: `/mock/videos/${id}/segments` });
    expect(inventory.statusCode).toBe(200);
    const { segments } = inventory.json();
    expect(segments.length).toBeGreaterThan(0);

    const segmentResponse = await app.inject({
      method: "GET",
      url: `/mock/videos/${id}/segments/${segments[0].id}`,
    });
    expect(segmentResponse.statusCode).toBe(200);
    expect(segmentResponse.headers["content-type"]).toBe("video/mp2t");
    expect(segmentResponse.headers["accept-ranges"]).toBe("bytes");

    await app.close();
  }, 20_000);

  it("supports HTTP range requests on a segment (206) and rejects an out-of-range request (416)", async () => {
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");
    const id = await uploadAndWaitReady(app, token, "public");

    const inventory = await app.inject({ method: "GET", url: `/mock/videos/${id}/segments` });
    const segmentId = inventory.json().segments[0].id;
    const fullResponse = await app.inject({ method: "GET", url: `/mock/videos/${id}/segments/${segmentId}` });
    const fullSize = Number(fullResponse.headers["content-length"]);

    const rangeResponse = await app.inject({
      method: "GET",
      url: `/mock/videos/${id}/segments/${segmentId}`,
      headers: { range: "bytes=0-99" },
    });
    expect(rangeResponse.statusCode).toBe(206);
    expect(rangeResponse.headers["content-range"]).toBe(`bytes 0-99/${fullSize}`);
    expect(rangeResponse.headers["content-length"]).toBe("100");

    const unsatisfiableResponse = await app.inject({
      method: "GET",
      url: `/mock/videos/${id}/segments/${segmentId}`,
      headers: { range: `bytes=${fullSize + 1000}-${fullSize + 2000}` },
    });
    expect(unsatisfiableResponse.statusCode).toBe(416);
    expect(unsatisfiableResponse.json().error).toBe("range_not_satisfiable");

    await app.close();
  }, 20_000);

  it("404s for an unknown video id and an unknown segment id", async () => {
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");
    const id = await uploadAndWaitReady(app, token, "public");

    const unknownVideo = await app.inject({ method: "GET", url: "/mock/videos/does-not-exist/manifest" });
    expect(unknownVideo.statusCode).toBe(404);

    const unknownSegment = await app.inject({ method: "GET", url: `/mock/videos/${id}/segments/segment-999.ts` });
    expect(unknownSegment.statusCode).toBe(404);

    await app.close();
  }, 20_000);

  it("returns 409 for a video that is still processing", async () => {
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");
    const uploadResponse = await uploadFixture(app, token, "sample.mp4", "public");
    const { id } = uploadResponse.json();

    // Hit it immediately, before processing has necessarily finished.
    const response = await app.inject({ method: "GET", url: `/mock/videos/${id}/manifest` });
    expect([200, 409]).toContain(response.statusCode);
    if (response.statusCode === 409) {
      expect(response.json().error).toBe("not_ready");
    }

    await waitForVideoStatus(app, id);
    await app.close();
  }, 20_000);

  describe("authorization for members-only uploaded videos (Prompt 4 channel/membership model)", () => {
    it("rejects manifest access with no token", async () => {
      const { app } = await appWithAuth();
      const { token } = await login(app, "G1");
      const id = await uploadAndWaitReady(app, token, "members");

      const response = await app.inject({ method: "GET", url: `/mock/videos/${id}/manifest` });
      expect(response.statusCode).toBe(401);

      await app.close();
    }, 20_000);

    it("rejects an authenticated non-member (G2, no membership) with 403", async () => {
      const { app } = await appWithAuth();
      const { token } = await login(app, "G1");
      const id = await uploadAndWaitReady(app, token, "members");

      const g2 = await login(app, "G2");
      const response = await app.inject({
        method: "GET",
        url: `/mock/videos/${id}/manifest`,
        headers: { authorization: `Bearer ${g2.token}` },
      });
      expect(response.statusCode).toBe(403);

      await app.close();
    }, 20_000);

    it("allows the channel owner (G1) to access their own members-only video without any membership", async () => {
      const { app } = await appWithAuth();
      const g1 = await login(app, "G1");
      const id = await uploadAndWaitReady(app, g1.token, "members");

      const authHeader = { authorization: `Bearer ${g1.token}` };
      const manifest = await app.inject({ method: "GET", url: `/mock/videos/${id}/manifest`, headers: authHeader });
      expect(manifest.statusCode).toBe(200);

      await app.close();
    }, 20_000);

    it("allows an authenticated member (G2, active membership) for manifest, playlist, inventory, and segments", async () => {
      const { app } = await appWithAuth();
      const g1 = await login(app, "G1");
      const id = await uploadAndWaitReady(app, g1.token, "members");
      const channelId = await g1ChannelId(app, g1.token);

      const g2 = await login(app, "G2");
      const activated = await activateMembership(app, g2.token, channelId);
      const authHeader = { authorization: `Bearer ${activated.session.token}` };

      const manifest = await app.inject({ method: "GET", url: `/mock/videos/${id}/manifest`, headers: authHeader });
      expect(manifest.statusCode).toBe(200);

      const inventory = await app.inject({ method: "GET", url: `/mock/videos/${id}/segments`, headers: authHeader });
      expect(inventory.statusCode).toBe(200);
      const segmentId = inventory.json().segments[0].id;

      const segment = await app.inject({
        method: "GET",
        url: `/mock/videos/${id}/segments/${segmentId}`,
        headers: authHeader,
      });
      expect(segment.statusCode).toBe(200);

      await app.close();
    }, 20_000);

    it("knowing a protected video's segment id alone does not grant access — a non-member is still rejected", async () => {
      const { app } = await appWithAuth();
      const g1 = await login(app, "G1");
      const id = await uploadAndWaitReady(app, g1.token, "members");

      // Learn the real segment id as the owner (simulating an attacker who saw it once).
      const inventory = await app.inject({
        method: "GET",
        url: `/mock/videos/${id}/segments`,
        headers: { authorization: `Bearer ${g1.token}` },
      });
      const segmentId = inventory.json().segments[0].id;

      const g2 = await login(app, "G2");
      const asNonMember = await app.inject({
        method: "GET",
        url: `/mock/videos/${id}/segments/${segmentId}`,
        headers: { authorization: `Bearer ${g2.token}` },
      });
      expect(asNonMember.statusCode).toBe(403);

      const noAuth = await app.inject({ method: "GET", url: `/mock/videos/${id}/segments/${segmentId}` });
      expect(noAuth.statusCode).toBe(401);

      await app.close();
    }, 20_000);

    it("the segment inventory itself is gated the same way as segment content", async () => {
      const { app } = await appWithAuth();
      const { token } = await login(app, "G1");
      const id = await uploadAndWaitReady(app, token, "members");

      const response = await app.inject({ method: "GET", url: `/mock/videos/${id}/segments` });
      expect(response.statusCode).toBe(401);

      await app.close();
    }, 20_000);
  });
});

describe("DELETE /mock/videos/:id (ownership)", () => {
  it("rejects deletion with no auth token", async () => {
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");
    const uploadResponse = await uploadFixture(app, token, "sample.mp4");
    const { id } = uploadResponse.json();

    const response = await app.inject({ method: "DELETE", url: `/mock/videos/${id}` });
    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("rejects deletion by a user who isn't the owner", async () => {
    const { app } = await appWithAuth();
    const g1 = await login(app, "G1");
    const uploadResponse = await uploadFixture(app, g1.token, "sample.mp4");
    const { id } = uploadResponse.json();

    const g2 = await login(app, "G2");
    const response = await app.inject({
      method: "DELETE",
      url: `/mock/videos/${id}`,
      headers: { authorization: `Bearer ${g2.token}` },
    });
    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it("allows deletion by the owner and cleans up the store and on-disk files", async () => {
    const { app } = await appWithAuth();
    const g1 = await login(app, "G1");
    const uploadResponse = await uploadFixture(app, g1.token, "sample.mp4");
    const { id } = uploadResponse.json();
    await waitForVideoStatus(app, id);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/mock/videos/${id}`,
      headers: { authorization: `Bearer ${g1.token}` },
    });
    expect(deleteResponse.statusCode).toBe(204);

    const getResponse = await app.inject({ method: "GET", url: `/mock/videos/${id}` });
    expect(getResponse.statusCode).toBe(404);

    const dirExists = await fs
      .stat(videoDir(dataDir, id))
      .then(() => true)
      .catch(() => false);
    expect(dirExists).toBe(false);

    await app.close();
  }, 20_000);

  // Note: Prompt 3's global "admin" role no longer exists as a separate override — ownership in
  // the Prompt 4 model is channel ownership, and a video's owner and its channel's owner are
  // always the same account (channels are auto-created per uploader). There is intentionally no
  // separate admin-delete-anything capability in this stage.

  it("refuses to delete a built-in demo video regardless of auth state", async () => {
    const { app } = await appWithAuth();

    const unauthenticated = await app.inject({ method: "DELETE", url: "/mock/videos/demo-public" });
    expect(unauthenticated.statusCode).toBe(403);

    await app.close();
  });
});

describe("path traversal resistance", () => {
  it("rejects a segment id containing a traversal sequence", async () => {
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");
    const uploadResponse = await uploadFixture(app, token, "sample.mp4");
    const { id } = uploadResponse.json();
    await waitForVideoStatus(app, id);

    const response = await app.inject({
      method: "GET",
      url: `/mock/videos/${id}/segments/${encodeURIComponent("../../../etc/passwd")}`,
    });
    expect(response.statusCode).toBe(404);

    await app.close();
  }, 20_000);

  it("never includes a filesystem path in any API response", async () => {
    const { app } = await appWithAuth();
    const { token } = await login(app, "G1");
    const uploadResponse = await uploadFixture(app, token, "sample.mp4");
    const { id } = uploadResponse.json();
    const { body } = await waitForVideoStatus(app, id);

    expect(JSON.stringify(body)).not.toContain(dataDir);
    expect(JSON.stringify(body)).not.toMatch(/\/(Users|home|tmp)\//);

    await app.close();
  }, 20_000);
});
