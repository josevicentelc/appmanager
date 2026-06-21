import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRepositoryConfigs } from "./repository-config.js";

describe("loadRepositoryConfigs", () => {
  let temporaryDirectory: string | null = null;

  afterEach(async () => {
    if (temporaryDirectory !== null) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  it("expands monorepo projects into independently filtered repositories", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "engineering-memory-config-"));
    const configPath = join(temporaryDirectory, "repositories.yaml");
    await writeFile(configPath, `
repositories:
  - id: platform
    displayName: Platform
    checkout:
      localPath: C:\\repos\\platform
      branch: main
    analysis:
      exclude:
        - "**/generated/**"
    projects:
      - id: api
        displayName: API
        rootPath: services/api
        analysis:
          include: ["src/**"]
          exclude: ["**/*.generated.ts"]
        versioning:
          tags:
            include: ["api-v*"]
      - id: web
        displayName: Web
        rootPath: apps/web
`, "utf8");

    const repositories = await loadRepositoryConfigs(configPath);

    expect(repositories.map((repository) => repository.id)).toEqual(["platform/api", "platform/web"]);
    expect(repositories[0]?.analysis).toEqual({
      include: ["services/api/src/**"],
      exclude: ["**/generated/**", "services/api/**/*.generated.ts"]
    });
    expect(repositories[0]?.versioning.tags.include).toEqual(["api-v*"]);
    expect(repositories[1]?.analysis.include).toEqual(["apps/web/**/*"]);
    expect(repositories[1]?.projectRoot).toBe("apps/web");
    expect(repositories[1]?.versioning.tags.include).toEqual(["**"]);
  });
});
