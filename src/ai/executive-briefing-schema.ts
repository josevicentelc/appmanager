import { z } from "zod";

const evidenceSchema = z.object({
  repositoryKey: z.string(),
  commitHash: z.string(),
  reason: z.string()
});

const findingSchema = z.object({
  title: z.string(),
  summary: z.string(),
  businessImpact: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSchema).max(3)
});

const riskSchema = findingSchema.extend({
  severity: z.enum(["low", "medium", "high"]),
  recommendedAction: z.string()
});

const decisionSchema = z.object({
  question: z.string(),
  context: z.string(),
  recommendation: z.string(),
  urgency: z.enum(["monitor", "soon", "now"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSchema).max(3)
});

export const executiveBriefingSchema = z.object({
  headline: z.string(),
  executiveSummary: z.string(),
  overallAttention: z.enum(["normal", "watch", "action"]),
  achievements: z.array(findingSchema).max(5),
  risks: z.array(riskSchema).max(5),
  decisions: z.array(decisionSchema).max(5),
  watchItems: z.array(findingSchema).max(5),
  limitations: z.array(z.string()).max(5)
});

export type ExecutiveBriefing = z.infer<typeof executiveBriefingSchema>;

export const executiveBriefingJsonSchema = {
  name: "executive_briefing",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["headline", "executiveSummary", "overallAttention", "achievements", "risks", "decisions", "watchItems", "limitations"],
    properties: {
      headline: { type: "string" },
      executiveSummary: { type: "string" },
      overallAttention: { type: "string", enum: ["normal", "watch", "action"] },
      achievements: { type: "array", maxItems: 5, items: findingJsonSchema() },
      risks: { type: "array", maxItems: 5, items: riskJsonSchema() },
      decisions: { type: "array", maxItems: 5, items: decisionJsonSchema() },
      watchItems: { type: "array", maxItems: 5, items: findingJsonSchema() },
      limitations: { type: "array", maxItems: 5, items: { type: "string" } }
    }
  }
} as const;

function evidenceJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["repositoryKey", "commitHash", "reason"],
    properties: {
      repositoryKey: { type: "string" },
      commitHash: { type: "string" },
      reason: { type: "string" }
    }
  } as const;
}

function findingJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "businessImpact", "confidence", "evidence"],
    properties: {
      title: { type: "string" }, summary: { type: "string" }, businessImpact: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidence: { type: "array", maxItems: 3, items: evidenceJsonSchema() }
    }
  } as const;
}

function riskJsonSchema() {
  const base = findingJsonSchema();
  return {
    ...base,
    required: [...base.required, "severity", "recommendedAction"],
    properties: {
      ...base.properties,
      severity: { type: "string", enum: ["low", "medium", "high"] },
      recommendedAction: { type: "string" }
    }
  } as const;
}

function decisionJsonSchema() {
  return {
    type: "object", additionalProperties: false,
    required: ["question", "context", "recommendation", "urgency", "confidence", "evidence"],
    properties: {
      question: { type: "string" }, context: { type: "string" }, recommendation: { type: "string" },
      urgency: { type: "string", enum: ["monitor", "soon", "now"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidence: { type: "array", maxItems: 3, items: evidenceJsonSchema() }
    }
  } as const;
}
