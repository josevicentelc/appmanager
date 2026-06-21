import { loadConfig } from "../config.js";
import { openEngineeringMemoryDb } from "../db/database.js";
import { answerInvestigationQuestion } from "../application/investigation-service.js";
import { hasFlag, readFlag } from "./args.js";
import { isInvestigationAudience } from "../domain/investigation-audience.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const question = readFlag(args, "question") ?? readFlag(args, "q");
  const repositoryKey = readFlag(args, "repository");
  const limitFlag = readFlag(args, "limit");
  const configPath = readFlag(args, "config") ?? "config/application.yaml";
  const showContext = hasFlag(args, "show-context");
  const audienceFlag = readFlag(args, "audience") ?? "developer";

  if (!question) {
    throw new Error("Usage: npm run chat -- --question \"¿qué cambios tocaron memoria persistente?\" [--repository aurora] [--limit 5]");
  }

  const limit = limitFlag === null ? 5 : Number(limitFlag);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  if (!isInvestigationAudience(audienceFlag)) {
    throw new Error("--audience must be developer or user");
  }

  const config = await loadConfig(configPath);
  const db = await openEngineeringMemoryDb(config.database.path);
  try {
    const result = await answerInvestigationQuestion(db, config, {
      question,
      repositoryKey,
      limit,
      audience: audienceFlag
    });

    if (showContext) {
      console.log("===== CONTEXTO RECUPERADO =====");
      console.log(result.context);
      console.log("===== RESPUESTA =====");
    }

    console.log(result.answer);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
