export const investigationAudiences = ["developer", "user"] as const;

export type InvestigationAudience = typeof investigationAudiences[number];

export function isInvestigationAudience(value: unknown): value is InvestigationAudience {
  return typeof value === "string" && investigationAudiences.includes(value as InvestigationAudience);
}
