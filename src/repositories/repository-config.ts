import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const repositoryConfigSchema = z.object({
  repositories: z.array(z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    enabled: z.boolean().default(true),
    checkout: z.object({
      localPath: z.string().min(1),
      branch: z.string().min(1)
    }),
    polling: z.object({
      intervalSeconds: z.number().int().positive().default(300),
      initialHistory: z.object({
        mode: z.enum(["latest", "since"]).default("latest"),
        count: z.number().int().positive().optional(),
        since: z.string().optional()
      }).default({ mode: "latest", count: 50 })
    }).default({
      intervalSeconds: 300,
      initialHistory: { mode: "latest", count: 50 }
    }),
    analysis: z.object({
      include: z.array(z.string()).default(["**/*"]),
      exclude: z.array(z.string()).default([])
    }).default({
      include: ["**/*"],
      exclude: []
    })
  }))
});

export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>["repositories"][number];

export async function loadRepositoryConfigs(path = "config/repositories.yaml"): Promise<RepositoryConfig[]> {
  const raw = await readFile(path, "utf8");
  return repositoryConfigSchema.parse(parse(raw)).repositories;
}

export function getEnabledRepository(
  repositories: RepositoryConfig[],
  id: string
): RepositoryConfig {
  const repository = repositories.find((candidate) => candidate.id === id);
  if (!repository) {
    throw new Error(`Repository not found in config: ${id}`);
  }
  if (!repository.enabled) {
    throw new Error(`Repository is disabled in config: ${id}`);
  }
  return repository;
}
