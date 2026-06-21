import { loadConfig } from "../runtime/config.mjs";
import { OpenAiCompatibleProvider } from "../runtime/openai-compatible-provider.mjs";

async function main() {
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
