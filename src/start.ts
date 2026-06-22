import type { Server } from "node:http";
import { loadConfig } from "./config.js";
import { loadRepositoryConfigs } from "./repositories/repository-config.js";
import { CommitDigestDaemon } from "./daemon/commit-digest-daemon.js";
import { startHttpServer } from "./server/main.js";
import { registerRuntimeSettings } from "./runtime-settings.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const repositories = await loadRepositoryConfigs();
  await registerRuntimeSettings(config, repositories);
  const daemon = new CommitDigestDaemon(config, repositories);
  let server: Server | null = null;

  try {
    server = await startHttpServer();
    if (process.env.DIGEST_DAEMON_DISABLED !== "true") {
      await daemon.start();
    } else {
      console.log("[digest] Disabled by DIGEST_DAEMON_DISABLED=true");
    }
  } catch (error) {
    if (server !== null) {
      await closeServer(server);
    }
    await daemon.stop();
    throw error;
  }

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log("Shutting down Engineering Memory...");
    await daemon.stop();
    if (server !== null) {
      await closeServer(server);
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolveClose();
      }
    });
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
