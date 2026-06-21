import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const appConfigSchema = z.object({
  ai: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string().min(1).default("lm-studio"),
    chatModel: z.string().min(1),
    timeoutMs: z.number().int().positive().default(300_000),
    temperature: z.number().min(0).max(2).default(0.1),
    maxOutputTokens: z.number().int().positive().default(4_000)
  }),
  analysis: z.object({
    maxDiffChars: z.number().int().positive().default(120_000)
  }).default({ maxDiffChars: 120_000 }),
  database: z.object({
    path: z.string().min(1).default("./data/engineering-memory.sqlite")
  }).default({ path: "./data/engineering-memory.sqlite" }),
  server: z.object({
    host: z.string().min(1).default("127.0.0.1"),
    port: z.number().int().positive().default(8080)
  }).default({ host: "127.0.0.1", port: 8080 })
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export async function loadConfig(path = "config/application.yaml"): Promise<AppConfig> {
  const raw = await readFile(path, "utf8");
  return appConfigSchema.parse(parse(interpolateEnv(raw)));
}

function interpolateEnv(input: string): string {
  return input.replace(/\$\{([A-Z0-9_]+)(?::-(.*?))?\}/g, (_match, name: string, fallback: string | undefined) => {
    const value = process.env[name];
    if (value !== undefined && value !== "") {
      return value;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Missing required environment variable: ${name}`);
  });
}
