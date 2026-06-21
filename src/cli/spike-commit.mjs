import { loadConfig } from "../runtime/config.mjs";
import { OpenAiCompatibleProvider } from "../runtime/openai-compatible-provider.mjs";
import { readCommitSnapshot } from "../runtime/git-client.mjs";
import { redactSecrets } from "../runtime/redact-secrets.mjs";
import { hasFlag, readFlag } from "./args.mjs";

async function main() {
  const args = process.argv.slice(2);
  const repositoryPath = readFlag(args, "repo");
  const commitish = readFlag(args, "commit") ?? "HEAD";
  const configPath = readFlag(args, "config") ?? "config/application.yaml";
  const dryRun = hasFlag(args, "dry-run");

  if (!repositoryPath) {
    throw new Error("Usage: npm run spike:commit -- --repo <path> [--commit HEAD] [--config config/application.yaml] [--dry-run]");
  }

  const config = await loadConfig(configPath);
  const snapshot = await readCommitSnapshot(repositoryPath, commitish, config.analysis.maxDiffChars);
  const redacted = redactSecrets(snapshot.diff);
  const input = {
    repositoryPath: snapshot.repositoryPath,
    commitHash: snapshot.metadata.hash,
    subject: snapshot.metadata.subject,
    body: snapshot.metadata.body,
    files: snapshot.files,
    diff: redacted.text,
    diffWasTruncated: snapshot.diffWasTruncated,
    redactions: redacted.redactions
  };

  if (dryRun) {
    console.log(JSON.stringify(input, null, 2));
    return;
  }

  const provider = new OpenAiCompatibleProvider(config.ai);
  const analysis = await provider.analyzeCommit(input);
  console.log(JSON.stringify({
    commit: snapshot.metadata,
    files: snapshot.files,
    analysis
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
