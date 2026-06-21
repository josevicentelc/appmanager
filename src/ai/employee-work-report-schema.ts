import { z } from "zod";

const evidenceSchema = z.object({
  repositoryKey: z.string(),
  commitHash: z.string(),
  reason: z.string()
});

const taskSchema = z.object({
  title: z.string(),
  description: z.string(),
  outcome: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSchema).min(1).max(5)
});

const repositoryGroupSchema = z.object({
  repositoryKey: z.string(),
  summary: z.string(),
  focusAreas: z.array(z.string()).max(8),
  tasks: z.array(taskSchema).max(12)
});

export const employeeWorkReportSchema = z.object({
  summary: z.string(),
  repositories: z.array(repositoryGroupSchema).min(1).max(20),
  limitations: z.array(z.string()).max(5)
});

export type EmployeeWorkReport = z.infer<typeof employeeWorkReportSchema>;

export function employeeWorkReportJsonSchemaForEvidence(
  repositoryKeys?: readonly string[],
  commitHashes?: readonly string[]
) {
  const repositoryKeySchema = repositoryKeys === undefined
    ? { type: "string" as const }
    : { type: "string" as const, enum: [...repositoryKeys] };
  const commitHashSchema = commitHashes === undefined
    ? { type: "string" as const }
    : { type: "string" as const, enum: [...commitHashes] };
  return {
  name: "employee_work_report",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "repositories", "limitations"],
    properties: {
      summary: { type: "string" },
      repositories: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["repositoryKey", "summary", "focusAreas", "tasks"],
          properties: {
            repositoryKey: repositoryKeySchema,
            summary: { type: "string" },
            focusAreas: { type: "array", maxItems: 8, items: { type: "string" } },
            tasks: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "description", "outcome", "confidence", "evidence"],
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  outcome: { type: "string" },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  evidence: {
                    type: "array",
                    minItems: 1,
                    maxItems: 5,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["repositoryKey", "commitHash", "reason"],
                      properties: {
                        repositoryKey: repositoryKeySchema,
                        commitHash: commitHashSchema,
                        reason: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      limitations: { type: "array", maxItems: 5, items: { type: "string" } }
    }
  }
  } as const;
}

export const employeeWorkReportJsonSchema = employeeWorkReportJsonSchemaForEvidence();
