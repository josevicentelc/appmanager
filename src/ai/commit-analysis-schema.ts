import { z } from "zod";

export const sourceReferenceSchema = z.object({
  sourceId: z.string().min(1),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable()
});

export const commitAnalysisSchema = z.object({
  summary: z.string().min(1),
  intent: z.string().nullable(),
  domains: z.array(z.string()),
  components: z.array(z.string()),
  symbols: z.array(z.string()),
  behaviorChanges: z.array(z.object({
    before: z.string().nullable(),
    after: z.string().min(1),
    evidence: z.array(sourceReferenceSchema).max(2)
  })).max(3),
  possibleSymptoms: z.array(z.object({
    symptom: z.string().min(1),
    evidence: z.array(sourceReferenceSchema).max(2)
  })).max(5),
  riskAreas: z.array(z.object({
    risk: z.string().min(1),
    evidence: z.array(sourceReferenceSchema).max(2)
  })).max(5),
  tests: z.array(z.object({
    description: z.string().min(1),
    evidence: z.array(sourceReferenceSchema).max(2)
  })).max(5),
  configurationChanges: z.array(z.object({
    description: z.string().min(1),
    evidence: z.array(sourceReferenceSchema).max(2)
  })).max(5),
  compatibilityNotes: z.array(z.string()).max(5),
  investigationQuestions: z.array(z.string()).max(5),
  confidence: z.number().min(0).max(1),
  sourceReferences: z.array(sourceReferenceSchema).max(3)
});

export type CommitAnalysis = z.infer<typeof commitAnalysisSchema>;

export const commitAnalysisJsonSchema = {
  name: "commit_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "intent",
      "domains",
      "components",
      "symbols",
      "behaviorChanges",
      "possibleSymptoms",
      "riskAreas",
      "tests",
      "configurationChanges",
      "compatibilityNotes",
      "investigationQuestions",
      "confidence",
      "sourceReferences"
    ],
    properties: {
      summary: { type: "string" },
      intent: { anyOf: [{ type: "string" }, { type: "null" }] },
      domains: { type: "array", maxItems: 5, items: { type: "string" } },
      components: { type: "array", maxItems: 8, items: { type: "string" } },
      symbols: { type: "array", maxItems: 10, items: { type: "string" } },
      behaviorChanges: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["before", "after", "evidence"],
          properties: {
            before: { anyOf: [{ type: "string" }, { type: "null" }] },
            after: { type: "string" },
            evidence: { type: "array", maxItems: 2, items: { "$ref": "#/$defs/sourceReference" } }
          }
        }
      },
      possibleSymptoms: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["symptom", "evidence"],
          properties: {
            symptom: { type: "string" },
            evidence: { type: "array", maxItems: 2, items: { "$ref": "#/$defs/sourceReference" } }
          }
        }
      },
      riskAreas: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["risk", "evidence"],
          properties: {
            risk: { type: "string" },
            evidence: { type: "array", maxItems: 2, items: { "$ref": "#/$defs/sourceReference" } }
          }
        }
      },
      tests: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "evidence"],
          properties: {
            description: { type: "string" },
            evidence: { type: "array", maxItems: 2, items: { "$ref": "#/$defs/sourceReference" } }
          }
        }
      },
      configurationChanges: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "evidence"],
          properties: {
            description: { type: "string" },
            evidence: { type: "array", maxItems: 2, items: { "$ref": "#/$defs/sourceReference" } }
          }
        }
      },
      compatibilityNotes: { type: "array", maxItems: 5, items: { type: "string" } },
      investigationQuestions: { type: "array", maxItems: 5, items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      sourceReferences: { type: "array", maxItems: 3, items: { "$ref": "#/$defs/sourceReference" } }
    },
    "$defs": {
      sourceReference: {
        type: "object",
        additionalProperties: false,
        required: ["sourceId", "startLine", "endLine"],
        properties: {
          sourceId: { type: "string" },
          startLine: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          endLine: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] }
        }
      }
    }
  }
} as const;
