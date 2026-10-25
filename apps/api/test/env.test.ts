import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";

describe("loadEnv", () => {
  it("defaults HOST to loopback-only, not all interfaces", () => {
    const env = loadEnv({} as NodeJS.ProcessEnv);
    expect(env.HOST).toBe("127.0.0.1");
  });

  it("honors an explicit HOST override", () => {
    const env = loadEnv({ HOST: "0.0.0.0" } as NodeJS.ProcessEnv);
    expect(env.HOST).toBe("0.0.0.0");
  });
});
