import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";
import { schemaSql } from "./schema.js";

export type EngineeringMemoryDb = Database<sqlite3.Database, sqlite3.Statement>;

export async function openEngineeringMemoryDb(path: string): Promise<EngineeringMemoryDb> {
  await mkdir(dirname(path), { recursive: true });
  const db = await open({
    filename: path,
    driver: sqlite3.Database
  });
  await db.exec(schemaSql);
  await db.exec("PRAGMA foreign_keys = ON;");
  return db;
}
