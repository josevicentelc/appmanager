import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { RepositoryConfig } from "./repositories/repository-config.js";
import { isValidHistoryDate } from "./repositories/repository-config.js";

const runtimeSettingsPath = "config/runtime-settings.json";
const repositorySettingsSchema = z.object({
  syncEnabled: z.boolean(),
  commitCount: z.number().int().positive().max(100_000).nullable(),
  since: z.string().nullable().refine((value) => value === null || isValidHistoryDate(value), "since must be an ISO date")
});
const runtimeSettingsSchema = z.object({
  chatModel: z.string().min(1),
  repositories: z.record(z.string(), repositorySettingsSchema)
});

export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;
export type RuntimeRepositorySettings = z.infer<typeof repositorySettingsSchema>;

let settings: RuntimeSettings | null = null;
const registeredConfigs = new Set<AppConfig>();
let configuredRepositories: RepositoryConfig[] = [];

export async function registerRuntimeSettings(config: AppConfig, repositories: RepositoryConfig[] = []): Promise<void> {
  registeredConfigs.add(config);
  if (repositories.length > 0) configuredRepositories = repositories;
  if (settings === null) settings = await readSettingsFile(config, configuredRepositories);
  applyModelToRegisteredConfigs();
}

export function getRuntimeSettings(baseConfig: AppConfig, repositories: RepositoryConfig[]): RuntimeSettings {
  const current = settings ?? defaults(baseConfig, repositories);
  return {
    chatModel: current.chatModel,
    repositories: Object.fromEntries(repositories.map((repository) => [
      repository.id,
      current.repositories[repository.id] ?? defaultRepositorySettings(repository)
    ]))
  };
}

export function getRuntimeRepositorySettings(repository: RepositoryConfig): RuntimeRepositorySettings {
  return settings?.repositories[repository.id] ?? defaultRepositorySettings(repository);
}

export async function saveRuntimeSettings(value: unknown, baseConfig: AppConfig, repositories: RepositoryConfig[]): Promise<RuntimeSettings> {
  const parsed = runtimeSettingsSchema.parse(value);
  const validIds = new Set(repositories.map((repository) => repository.id));
  for (const id of Object.keys(parsed.repositories)) {
    if (!validIds.has(id)) throw new Error(`Unknown configured repository: ${id}`);
  }
  settings = {
    chatModel: parsed.chatModel,
    repositories: Object.fromEntries(repositories.map((repository) => [
      repository.id,
      parsed.repositories[repository.id] ?? defaultRepositorySettings(repository)
    ]))
  };
  configuredRepositories = repositories;
  applyModelToRegisteredConfigs();
  await mkdir(dirname(runtimeSettingsPath), { recursive: true });
  const temporaryPath = `${runtimeSettingsPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(temporaryPath, runtimeSettingsPath);
  return getRuntimeSettings(baseConfig, repositories);
}

function applyModelToRegisteredConfigs(): void {
  if (settings === null) return;
  for (const config of registeredConfigs) config.ai.chatModel = settings.chatModel;
}

async function readSettingsFile(config: AppConfig, repositories: RepositoryConfig[]): Promise<RuntimeSettings> {
  try {
    return runtimeSettingsSchema.parse(JSON.parse(await readFile(runtimeSettingsPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[settings] Ignoring invalid ${runtimeSettingsPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return defaults(config, repositories);
  }
}

function defaults(config: AppConfig, repositories: RepositoryConfig[]): RuntimeSettings {
  return {
    chatModel: config.ai.chatModel,
    repositories: Object.fromEntries(repositories.map((repository) => [repository.id, defaultRepositorySettings(repository)]))
  };
}

function defaultRepositorySettings(repository: RepositoryConfig): RuntimeRepositorySettings {
  const history = repository.polling.initialHistory;
  return {
    syncEnabled: repository.enabled,
    commitCount: history.count ?? null,
    since: history.mode === "since" ? history.since ?? null : null
  };
}
