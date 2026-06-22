import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openEngineeringMemoryDb, type EngineeringMemoryDb } from "../db/database.js";
import { appendConversationMessage, beginConversationTurn, loadConversationHistory } from "./conversation-service.js";

let directory: string | null = null;
let db: EngineeringMemoryDb | null = null;

afterEach(async () => {
  await db?.close();
  db = null;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = null;
});

describe("conversation memory", () => {
  it("returns prior turns and excludes the current question until it is stored", async () => {
    directory = await mkdtemp(join(tmpdir(), "conversation-"));
    db = await openEngineeringMemoryDb(join(directory, "memory.sqlite"));
    const first = await beginConversationTurn(db, "conversation_test_1", "Pregunta inicial");
    expect(first.history).toEqual([]);
    await appendConversationMessage(db, first.conversationId, "assistant", "Respuesta inicial");

    const second = await beginConversationTurn(db, first.conversationId, "¿Y qué riesgo tiene?");
    expect(second.history).toEqual([
      { role: "user", content: "Pregunta inicial" },
      { role: "assistant", content: "Respuesta inicial" }
    ]);
    expect(await loadConversationHistory(db, first.conversationId)).toHaveLength(3);
  });
});
