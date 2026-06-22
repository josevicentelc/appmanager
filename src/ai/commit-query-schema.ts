import { z } from "zod";

export const commitQueryPlanSchema = z.object({
  action: z.enum(["semantic_search", "structured_search"]),
  retrievalQuery: z.string(),
  filters: z.object({
    repositoryKeys: z.array(z.string()),
    author: z.string().nullable(), committer: z.string().nullable(),
    contentTerms: z.array(z.string()), fromDate: isoDate().nullable(), toDate: isoDate().nullable(),
    versions: z.array(z.string()), hashes: z.array(z.string()), filePaths: z.array(z.string()),
    factTypes: z.array(z.string()), statuses: z.array(z.string()),
    match: z.enum(["all", "any"]), sort: z.enum(["newest", "oldest"])
  })
});

export type CommitQueryPlan = z.infer<typeof commitQueryPlanSchema>;

export const commitQueryPlanJsonSchema = {
  name: "commit_query_plan", strict: true,
  schema: {
    type: "object", additionalProperties: false, required: ["action", "retrievalQuery", "filters"],
    properties: {
      action: { type: "string", enum: ["semantic_search", "structured_search"] },
      retrievalQuery: { type: "string" },
      filters: {
        type: "object", additionalProperties: false,
        required: ["repositoryKeys", "author", "committer", "contentTerms", "fromDate", "toDate", "versions", "hashes", "filePaths", "factTypes", "statuses", "match", "sort"],
        properties: {
          repositoryKeys: stringArray(),
          author: nullableString(), committer: nullableString(), contentTerms: stringArray(),
          fromDate: nullableString(), toDate: nullableString(), versions: stringArray(), hashes: stringArray(),
          filePaths: stringArray(), factTypes: stringArray(), statuses: stringArray(),
          match: { type: "string", enum: ["all", "any"] }, sort: { type: "string", enum: ["newest", "oldest"] }
        }
      }
    }
  }
} as const;

function nullableString() { return { type: ["string", "null"] } as const; }
function stringArray() { return { type: "array", items: { type: "string" }, maxItems: 20 } as const; }
function isoDate() { return z.string().regex(/^\d{4}-\d{2}-\d{2}$/); }
