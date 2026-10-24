import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import { buildApp } from "../src/app.js";

describe("GET /api/findings", () => {
  it("returns an empty list when no findings have been recorded", async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      FINDINGS_STORE_PATH: "./data/test-findings-empty.json",
    } as NodeJS.ProcessEnv);
    const app = await buildApp(env);
    const response = await app.inject({ method: "GET", url: "/api/findings" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ findings: [] });
    await app.close();
  });
});
