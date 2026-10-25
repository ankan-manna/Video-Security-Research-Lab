import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildMockLabApp } from "../app.js";
import { createAccountContext, type AccountContext } from "../account/context.js";
import { hashSessionToken } from "../account/sessionTokens.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_VIDEO_PATH = path.join(here, "../../test/fixtures/sample.mp4");

interface LoggedInActor {
  userId: string;
  token: string;
  csrfToken: string;
}

export interface SecurityTestFixtures {
  app: FastifyInstance;
  tempDir: string;
  ctx: AccountContext;
  g1: LoggedInActor & { channelId: string };
  g2: LoggedInActor;
  outsiderChannelId: string;
  publicVideoId: string;
  membersVideoId: string;
  unrelatedChannelVideoId: string;
}

function buildMultipartPayload(boundary: string, fileBuffer: Buffer, visibility: string): Buffer {
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="visibility"\r\n\r\n${visibility}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
    ),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  return Buffer.concat(parts);
}

async function uploadFixtureVideo(
  app: FastifyInstance,
  token: string,
  visibility: "public" | "members",
): Promise<string> {
  const boundary = `----sectest${randomUUID()}`;
  const fileBuffer = await fs.readFile(FIXTURE_VIDEO_PATH);
  const payload = buildMultipartPayload(boundary, fileBuffer, visibility);
  const response = await app.inject({
    method: "POST",
    url: "/mock/videos",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      authorization: `Bearer ${token}`,
    },
    payload,
  });
  if (response.statusCode !== 202) {
    throw new Error(`Fixture upload failed: ${response.statusCode} ${response.body}`);
  }
  return response.json().id as string;
}

async function waitForReady(app: FastifyInstance, videoId: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await app.inject({ method: "GET", url: `/mock/videos/${videoId}` });
    const body = response.json();
    if (body.status === "ready") return;
    if (body.status === "failed") throw new Error(`Fixture video ${videoId} failed processing: ${body.error}`);
    if (Date.now() > deadline) throw new Error(`Timed out waiting for fixture video ${videoId}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function login(app: FastifyInstance, accountLabel: string): Promise<LoggedInActor> {
  const response = await app.inject({
    method: "POST",
    url: "/mock/session/login",
    payload: { accountLabel },
  });
  if (response.statusCode !== 200) {
    throw new Error(`Fixture login failed for ${accountLabel}: ${response.statusCode} ${response.body}`);
  }
  const body = response.json();
  return { userId: body.user.id, token: body.token, csrfToken: body.csrfToken };
}

/**
 * Builds a fully isolated mock-lab app instance — its own temp data
 * directory, never the real server's — seeded with G1/G2 plus a public
 * and a members-only video on G1's channel, and a members-only video on a
 * third, unrelated channel (for cross-channel/IDOR scenarios). Every
 * Security Testing Engine run gets a fresh one of these; nothing here
 * touches the live demo's actual data.
 */
export async function buildSecurityTestFixtures(): Promise<SecurityTestFixtures> {
  const tempDir = path.join(os.tmpdir(), `mock-lab-security-test-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const app = await buildMockLabApp(
    {
      sessionSecret: `security-test-isolated-secret-${randomUUID()}`,
      dataDir: tempDir,
      segmentDurationSeconds: 1,
      maxDurationSeconds: 600,
    },
    false,
  );

  const ctx = createAccountContext({ dataDir: tempDir });

  const g1User = await ctx.userStore.findByLabel("G1");
  const g2User = await ctx.userStore.findByLabel("G2");
  if (!g1User || !g2User) throw new Error("Expected G1/G2 to already be seeded by buildMockLabApp().");
  const g1Channel = await ctx.channelStore.findByOwner(g1User.id);
  if (!g1Channel) throw new Error("Expected G1 to already have a seeded channel.");

  const g1Login = await login(app, "G1");
  const g2Login = await login(app, "G2");

  // Uploaded and awaited one at a time, deliberately — see video/videoStore.ts's write-queue
  // comment for the lost-update race two concurrent background processVideo() calls used to hit.
  const publicVideoId = await uploadFixtureVideo(app, g1Login.token, "public");
  await waitForReady(app, publicVideoId);
  const membersVideoId = await uploadFixtureVideo(app, g1Login.token, "members");
  await waitForReady(app, membersVideoId);

  const outsiderUser = await ctx.userStore.create({
    id: randomUUID(),
    label: `SECTEST-OUTSIDER-${randomUUID().slice(0, 8)}`,
    displayName: "Unrelated Creator (security-test fixture)",
    createdAt: new Date().toISOString(),
  });
  const outsiderLogin = await login(app, outsiderUser.label);
  const unrelatedChannelVideoId = await uploadFixtureVideo(app, outsiderLogin.token, "members");
  await waitForReady(app, unrelatedChannelVideoId);
  const outsiderChannel = await ctx.channelStore.findByOwner(outsiderUser.id);
  if (!outsiderChannel) throw new Error("Expected the outsider fixture user to have an auto-created channel.");

  return {
    app,
    tempDir,
    ctx,
    g1: { ...g1Login, channelId: g1Channel.id },
    g2: g2Login,
    outsiderChannelId: outsiderChannel.id,
    publicVideoId,
    membersVideoId,
    unrelatedChannelVideoId,
  };
}

export async function teardownSecurityTestFixtures(fixtures: SecurityTestFixtures): Promise<void> {
  await fixtures.app.close();
  await fs.rm(fixtures.tempDir, { recursive: true, force: true });
}

export function sessionTokenHashOf(token: string): string {
  return hashSessionToken(token);
}
