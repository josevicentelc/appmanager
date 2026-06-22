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
});
