import { describe, expect, it } from "vitest";
import type { EmployeeWorkReport } from "./employee-work-report-schema.js";
import { employeeWorkReportJsonSchemaForEvidence } from "./employee-work-report-schema.js";
import { normalizeEmployeeReportEvidence } from "./openai-compatible-provider.js";

describe("employee report evidence normalization", () => {
  it("repairs a repository key only when the commit hash is unambiguous", () => {
    const report: EmployeeWorkReport = {
      summary: "Summary",
      repositories: [{
        repositoryKey: "wrong-repository",
        summary: "Repository summary",
        focusAreas: [],
        tasks: [{
          title: "Task",
          description: "Description",
          outcome: "Outcome",
          confidence: 1,
          evidence: [{
            repositoryKey: "wrong-repository",
            commitHash: "a".repeat(40),
            reason: "Reason"
          }]
        }]
      }],
      limitations: []
    };

    normalizeEmployeeReportEvidence(report, [{
      repositoryKey: "actual-repository",
      commitHash: "a".repeat(40)
    }]);

    expect(report.repositories[0]?.repositoryKey).toBe("actual-repository");
    expect(report.repositories[0]?.tasks[0]?.evidence[0]?.repositoryKey).toBe("actual-repository");
  });

  it("restricts model evidence identifiers to supplied values", () => {
    const schema = employeeWorkReportJsonSchemaForEvidence(
      ["aurora"],
      ["a".repeat(40)]
    );
    const evidenceProperties = schema.schema.properties.repositories.items.properties.tasks.items.properties.evidence.items.properties;

    expect(schema.schema.properties.repositories.items.properties.repositoryKey.enum).toEqual(["aurora"]);
    expect(evidenceProperties.repositoryKey.enum).toEqual(["aurora"]);
    expect(evidenceProperties.commitHash.enum).toEqual(["a".repeat(40)]);
  });
});
