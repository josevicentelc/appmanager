import { loadConfig } from "../config.js";
import { OpenAiCompatibleProvider } from "../ai/openai-compatible-provider.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const provider = new OpenAiCompatibleProvider(config.ai);
  const health = await provider.healthCheck();

  console.log(JSON.stringify({
    configuredModel: config.ai.chatModel,
    ok: health.ok,
    availableModels: health.models
  }, null, 2));

  if (!health.ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
