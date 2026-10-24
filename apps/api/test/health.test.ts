import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import { buildApp } from "../src/app.js";

describe("GET /health", () => {
  it("reports ok status", async () => {
    const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    const app = await buildApp(env);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", service: "api" });
    await app.close();
  });
});
