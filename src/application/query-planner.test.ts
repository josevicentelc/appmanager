import { describe, expect, it } from "vitest";
import { planInvestigationQuery } from "./query-planner.js";

describe("planInvestigationQuery", () => {
  it("detects a request for all commits by a Git author", () => {
    expect(planInvestigationQuery("dame todos los commits hechos por Juan")).toEqual({
      kind: "author_search",
      authorQuery: "Juan",
      rawText: "todos los commits hechos por Juan"
    });
  });

  it("supports the shorter commits de form", () => {
    expect(planInvestigationQuery("commits de Juan Sevila")).toMatchObject({
      kind: "author_search",
      authorQuery: "Juan Sevila"
    });
  });

  it("resolves relative version counts without asking the model to invent filters", () => {
    expect(planInvestigationQuery("resume los cambios de las últimas 3 versiones")).toMatchObject({
      kind: "recent_versions",
      count: 3
    });
  });

  it("extracts an author and multiple repository filters from a work-summary question", () => {
    expect(planInvestigationQuery("en que ha estado trabajando jose vicente en los repositorios de electronics y webapp?")).toMatchObject({
      kind: "author_repositories",
      authorQuery: "jose vicente",
      repositoryQueries: ["electronics", "webapp"]
    });
  });

  it("treats latest repository changes as a bounded metadata query, not a version query", () => {
    expect(planInvestigationQuery("listame los ultimos cambios en webapp")).toMatchObject({
      kind: "recent_repository_changes",
      repositoryQueries: ["webapp"],
      count: 20
    });
  });
});
