import { randomUUID } from "node:crypto";
import type { EngineeringMemoryDb } from "../db/database.js";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

const maxHistoryMessages = 12;
const maxHistoryCharacters = 12_000;

export async function beginConversationTurn(
  db: EngineeringMemoryDb,
  requestedId: string | null,
  question: string
): Promise<{ conversationId: string; history: ConversationMessage[] }> {
  const conversationId = normalizeConversationId(requestedId) ?? randomUUID();
  await db.run("INSERT OR IGNORE INTO conversations (id) VALUES (?)", conversationId);
  const history = await loadConversationHistory(db, conversationId);
  await appendConversationMessage(db, conversationId, "user", question);
  return { conversationId, history };
}

export async function appendConversationMessage(
  db: EngineeringMemoryDb,
  conversationId: string,
  role: ConversationMessage["role"],
  content: string
): Promise<void> {
  await db.run(
    "INSERT INTO conversation_messages (conversation_id, role, content) VALUES (?, ?, ?)",
    conversationId,
    role,
    content
  );
  await db.run("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", conversationId);
}

export async function loadConversationHistory(
  db: EngineeringMemoryDb,
  conversationId: string
): Promise<ConversationMessage[]> {
  const rows = await db.all<Array<ConversationMessage & { id: number }>>(`
    SELECT id, role, content FROM conversation_messages
    WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
  `, conversationId, maxHistoryMessages);
  const selected: ConversationMessage[] = [];
  let characters = 0;
  for (const row of rows) {
    if (characters + row.content.length > maxHistoryCharacters && selected.length > 0) break;
    selected.push({ role: row.role, content: row.content.slice(-maxHistoryCharacters) });
    characters += row.content.length;
  }
  return selected.reverse();
}

function normalizeConversationId(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(normalized) ? normalized : null;
}
