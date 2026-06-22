export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  local_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  first_parent_hash TEXT,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  authored_at TEXT NOT NULL,
  committer_name TEXT NOT NULL,
  committer_email TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  reachable INTEGER NOT NULL DEFAULT 1,
  raw_metadata TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(repository_id, hash)
);

CREATE TABLE IF NOT EXISTS commit_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  previous_path TEXT,
  change_type TEXT NOT NULL,
  additions INTEGER,
  deletions INTEGER,
  is_binary INTEGER NOT NULL DEFAULT 0,
  is_generated INTEGER NOT NULL DEFAULT 0,
  language TEXT,
  UNIQUE(commit_id, path)
);

CREATE TABLE IF NOT EXISTS commit_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(commit_id, tag)
);

CREATE TABLE IF NOT EXISTS diff_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_file_id INTEGER NOT NULL REFERENCES commit_files(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL UNIQUE,
  old_start INTEGER,
  old_end INTEGER,
  new_start INTEGER,
  new_end INTEGER,
  content TEXT NOT NULL,
  token_count INTEGER,
  content_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commit_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  summary TEXT NOT NULL,
  intent TEXT,
  confidence REAL NOT NULL,
  analysis_status TEXT NOT NULL,
  raw_model_output TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(commit_id, schema_version, prompt_version, model)
);

CREATE TABLE IF NOT EXISTS knowledge_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_knowledge_id INTEGER NOT NULL REFERENCES commit_knowledge(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL,
  is_inference INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS source_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_fact_id INTEGER REFERENCES knowledge_facts(id) ON DELETE CASCADE,
  commit_knowledge_id INTEGER REFERENCES commit_knowledge(id) ON DELETE CASCADE,
  diff_chunk_id INTEGER,
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  reference_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation
  ON conversation_messages(conversation_id, id);
`;
