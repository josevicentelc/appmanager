import { loadConfig } from "../config.js";
import { openEngineeringMemoryDb } from "../db/database.js";
import { readFlag } from "./args.js";

async function main(): Promise<void> {
  const configPath = readFlag(process.argv.slice(2), "config") ?? "config/application.yaml";
  const config = await loadConfig(configPath);
  const db = await openEngineeringMemoryDb(config.database.path);

  try {
    const counts = await db.get<{
      repositories: number;
      commits: number;
      files: number;
      facts: number;
      reference_count: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM repositories) AS repositories,
        (SELECT COUNT(*) FROM commits) AS commits,
        (SELECT COUNT(*) FROM commit_files) AS files,
        (SELECT COUNT(*) FROM knowledge_facts) AS facts,
        (SELECT COUNT(*) FROM source_references) AS reference_count
    `);
    const latest = await db.all<{
      repository_key: string;
      hash: string;
      subject: string;
      summary: string;
      model: string;
      created_at: string;
    }[]>(`
      SELECT r.key AS repository_key, c.hash, c.subject, ck.summary, ck.model, ck.created_at
      FROM commit_knowledge ck
      JOIN commits c ON c.id = ck.commit_id
      JOIN repositories r ON r.id = c.repository_id
      ORDER BY ck.created_at DESC
      LIMIT 10
    `);

    console.log(JSON.stringify({
      database: config.database.path,
      counts,
      latest
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
