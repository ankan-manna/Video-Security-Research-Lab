import { loadRootEnvFile } from "./loadRootEnv.js";
import { buildMockLabApp } from "./app.js";

loadRootEnvFile();

const PORT = Number(process.env.MOCK_LAB_PORT ?? 4002);
const SESSION_SECRET = process.env.MOCK_LAB_SESSION_SECRET ?? "change-me-dev-only-synthetic-secret";
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000";

async function main() {
  const app = await buildMockLabApp(
    { sessionSecret: SESSION_SECRET, dashboardOrigin: DASHBOARD_ORIGIN },
    true,
  );
  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    app.log.info(`Mock lab listening on http://localhost:${PORT}`);
  } catch (error) {
    app.log.error(error, "Failed to start mock lab server");
    process.exit(1);
  }
}

main();
