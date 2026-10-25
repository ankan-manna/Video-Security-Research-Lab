import { loadRootEnvFile } from "./loadRootEnv.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { buildApp } from "./app.js";

loadRootEnvFile();

async function main() {
  const env = loadEnv();
  const logger = createLogger(env);
  const { app } = await buildApp(env, logger as never);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }

  try {
    await app.listen({ port: env.INSPECTOR_PORT, host: "0.0.0.0" });
    logger.info(`Inspector listening on http://localhost:${env.INSPECTOR_PORT}`);
  } catch (error) {
    logger.error(error, "Failed to start inspector server");
    process.exit(1);
  }
}

main();
