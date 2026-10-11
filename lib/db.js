// SQLite backing store for users, sessions, history, share links, API keys,
// and e-sign requests. Uses Node's built-in node:sqlite (stable since v22).

import sqlite from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'pdftk.db');

await mkdir(DATA_DIR, { recursive: true });

export const db = new sqlite.DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    key        TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tool       TEXT NOT NULL,
    filename   TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    blob       BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS history_user_created ON history(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS share_links (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    filename   TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    blob       BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    downloads  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS esign_requests (
    token         TEXT PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    pdf_blob      BLOB NOT NULL,
    signer_email  TEXT NOT NULL,
    signer_name   TEXT,
    message       TEXT,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',  -- pending | signed | expired | revoked
    signed_at     INTEGER,
    signed_blob   BLOB
  );
`);
