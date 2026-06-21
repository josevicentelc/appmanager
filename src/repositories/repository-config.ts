import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const analysisSchema = z.object({
  include: z.array(z.string()).default(["**/*"]),
  exclude: z.array(z.string()).default([])
}).default({ include: ["**/*"], exclude: [] });

const versioningSchema = z.object({
  tags: z.object({
    include: z.array(z.string()).default(["**"]),
    exclude: z.array(z.string()).default([])
  }).default({ include: ["**"], exclude: [] })
}).default({ tags: { include: ["**"], exclude: [] } });

const projectSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean().default(true),
  rootPath: z.string().min(1).refine(isSafeRelativePath, "rootPath must stay inside the repository"),
  analysis: analysisSchema,
  versioning: versioningSchema.optional()
});

const configuredRepositorySchema = z.object({
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
  analysis: analysisSchema,
  versioning: versioningSchema,
  projects: z.array(projectSchema).optional()
});

const repositoryConfigSchema = z.object({
  repositories: z.array(configuredRepositorySchema)
}).superRefine((config, context) => {
  const ids = new Set<string>();
  for (const repository of config.repositories) {
    if (ids.has(repository.id)) {
      context.addIssue({ code: "custom", message: `Duplicate repository id: ${repository.id}` });
    }
    ids.add(repository.id);
    const projectIds = new Set<string>();
    for (const project of repository.projects ?? []) {
      if (projectIds.has(project.id)) {
        context.addIssue({ code: "custom", message: `Duplicate project id in ${repository.id}: ${project.id}` });
      }
      projectIds.add(project.id);
    }
  }
});

type ConfiguredRepository = z.infer<typeof configuredRepositorySchema>;

export interface RepositoryConfig extends Omit<ConfiguredRepository, "projects"> {
  sourceRepositoryId: string;
  projectId: string | null;
  projectRoot: string | null;
}

export async function loadRepositoryConfigs(path = "config/repositories.yaml"): Promise<RepositoryConfig[]> {
  const raw = await readFile(path, "utf8");
  return expandRepositoryConfigs(repositoryConfigSchema.parse(parse(raw)).repositories);
}

export function expandRepositoryConfigs(repositories: ConfiguredRepository[]): RepositoryConfig[] {
  const expanded: RepositoryConfig[] = [];
  for (const repository of repositories) {
    if (repository.projects === undefined || repository.projects.length === 0) {
      expanded.push({
        ...withoutProjects(repository),
        sourceRepositoryId: repository.id,
        projectId: null,
        projectRoot: null
      });
      continue;
    }

    for (const project of repository.projects) {
      if (!repository.enabled || !project.enabled) {
        continue;
      }
      expanded.push({
        ...withoutProjects(repository),
        id: `${repository.id}/${project.id}`,
        displayName: `${repository.displayName} / ${project.displayName}`,
        enabled: true,
        analysis: {
          include: project.analysis.include.map((pattern) => scopePattern(project.rootPath, pattern)),
          exclude: [
            ...repository.analysis.exclude,
            ...project.analysis.exclude.map((pattern) => scopePattern(project.rootPath, pattern))
          ]
        },
        versioning: project.versioning ?? repository.versioning,
        sourceRepositoryId: repository.id,
        projectId: project.id,
        projectRoot: normalizeRoot(project.rootPath)
      });
    }
  }
  return expanded;
}

export function getEnabledRepository(repositories: RepositoryConfig[], id: string): RepositoryConfig {
  const repository = repositories.find((candidate) => candidate.id === id);
  if (!repository) {
    throw new Error(`Repository or project not found in config: ${id}`);
  }
  if (!repository.enabled) {
    throw new Error(`Repository or project is disabled in config: ${id}`);
  }
  return repository;
}

function withoutProjects(repository: ConfiguredRepository): Omit<ConfiguredRepository, "projects"> {
  const { projects: _projects, ...rest } = repository;
  return rest;
}

function isSafeRelativePath(path: string): boolean {
  const normalized = normalizeRoot(path);
  return !/^[A-Za-z]:/.test(path) && !path.startsWith("/") &&
    normalized.split("/").every((part) => part !== "..");
}

function normalizeRoot(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
}

function scopePattern(rootPath: string, pattern: string): string {
  const root = normalizeRoot(rootPath);
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\/+/, "");
  return root === "" || root === "." ? normalizedPattern : `${root}/${normalizedPattern}`;
}
