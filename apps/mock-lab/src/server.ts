import { loadRootEnvFile } from "./loadRootEnv.js";
import { loadEnv } from "./env.js";
import { buildMockLabApp } from "./app.js";

loadRootEnvFile();

async function main() {
  const env = loadEnv();
  const app = await buildMockLabApp(
    {
      sessionSecret: env.MOCK_LAB_SESSION_SECRET,
      dashboardOrigin: env.DASHBOARD_ORIGIN,
      dataDir: env.MOCK_LAB_DATA_DIR,
      maxUploadBytes: env.MOCK_LAB_MAX_UPLOAD_BYTES,
      maxDurationSeconds: env.MOCK_LAB_MAX_DURATION_SECONDS,
      segmentDurationSeconds: env.MOCK_LAB_SEGMENT_DURATION_SECONDS,
    },
    true,
  );
  try {
    await app.listen({ port: env.MOCK_LAB_PORT, host: "0.0.0.0" });
    app.log.info(`Mock lab listening on http://localhost:${env.MOCK_LAB_PORT}`);
  } catch (error) {
    app.log.error(error, "Failed to start mock lab server");
    process.exit(1);
  }
}

main();
