import { loadRootEnvFile } from "./loadRootEnv.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { buildApp } from "./app.js";

loadRootEnvFile();

async function main() {
  const env = loadEnv();
  const logger = createLogger(env);
  const app = await buildApp(env, logger as never);

  try {
    await app.listen({ port: env.API_PORT, host: env.HOST });
    logger.info(`API listening on http://${env.HOST}:${env.API_PORT}`);
  } catch (error) {
    logger.error(error, "Failed to start API server");
    process.exit(1);
  }
}

main();
