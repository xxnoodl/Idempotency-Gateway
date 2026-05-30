const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'payments.db');
const TTL_SECONDS = 24 * 60 * 60; // 24 hours

const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key          TEXT    PRIMARY KEY,
    body_hash    TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending',
    status_code  INTEGER,
    response_body TEXT,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at   INTEGER NOT NULL
  )
`);

db.prepare(`DELETE FROM idempotency_keys WHERE expires_at < unixepoch()`).run();

setInterval(() => {
  db.prepare(`DELETE FROM idempotency_keys WHERE expires_at < unixepoch()`).run();
}, 60 * 60 * 1000).unref();

const stmts = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO idempotency_keys (key, body_hash, status, expires_at)
    VALUES (?, ?, 'pending', unixepoch() + ${TTL_SECONDS})
  `),

  findActive: db.prepare(`
    SELECT key, body_hash, status, status_code, response_body
    FROM idempotency_keys
    WHERE key = ? AND expires_at > unixepoch()
  `),

  complete: db.prepare(`
    UPDATE idempotency_keys
    SET status = 'complete', status_code = ?, response_body = ?
    WHERE key = ?
  `),

  fail: db.prepare(`
    DELETE FROM idempotency_keys WHERE key = ?
  `),
};

function claimKey(key, bodyHash) {
  const info = stmts.insert.run(key, bodyHash);
  return info.changes === 1;
}

function findActiveRecord(key) {
  return stmts.findActive.get(key) ?? null;
}

function completeRecord(key, statusCode, responseBody) {
  stmts.complete.run(statusCode, JSON.stringify(responseBody), key);
}

function deleteRecord(key) {
  stmts.fail.run(key);
}

module.exports = { claimKey, findActiveRecord, completeRecord, deleteRecord };
