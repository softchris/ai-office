import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlWasmPath = path.join(__dirname, "node_modules", "sql.js", "dist");
const databasePath = path.join(__dirname, "agent_memory.sqlite");

let sqlModulePromise = null;

function getSqlModule() {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file) => path.join(sqlWasmPath, file),
    });
  }

  return sqlModulePromise;
}

async function openDatabase() {
  const SQL = await getSqlModule();
  if (fs.existsSync(databasePath)) {
    return new SQL.Database(fs.readFileSync(databasePath));
  }

  return new SQL.Database();
}

function saveDatabase(db) {
  const data = db.export();
  fs.writeFileSync(databasePath, Buffer.from(data));
}

export async function ensureAgentDatabase() {
  const db = await openDatabase();

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        display_name TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.run(
      "INSERT OR IGNORE INTO users (username, password, display_name) VALUES (?, ?, ?)",
      ["Chris", "abcd1234", "Chris"],
    );

    saveDatabase(db);
  } finally {
    db.close();
  }

  return databasePath;
}

export async function verifyUserCredentials(username, password) {
  const db = await openDatabase();

  try {
    const statement = db.prepare(
      "SELECT id, username, display_name FROM users WHERE username = ? AND password = ? LIMIT 1",
    );
    statement.bind([username, password]);

    let user = null;
    if (statement.step()) {
      const row = statement.getAsObject();
      user = {
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
      };
    }

    statement.free();
    return user;
  } finally {
    db.close();
  }
}

export async function getUserById(userId) {
  const db = await openDatabase();

  try {
    const statement = db.prepare(
      "SELECT id, username, display_name FROM users WHERE id = ? LIMIT 1",
    );
    statement.bind([Number(userId)]);

    let user = null;
    if (statement.step()) {
      const row = statement.getAsObject();
      user = {
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
      };
    }

    statement.free();
    return user;
  } finally {
    db.close();
  }
}

export async function appendConversationMessage(userId, role, content) {
  const db = await openDatabase();

  try {
    db.run(
      "INSERT INTO conversations (user_id, role, content) VALUES (?, ?, ?)",
      [Number(userId), String(role), String(content)],
    );
    saveDatabase(db);
  } finally {
    db.close();
  }
}

export async function getConversationHistory(userId, limit = 100) {
  const db = await openDatabase();

  try {
    const statement = db.prepare(
      `
      SELECT id, role, content, created_at
      FROM conversations
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
      `,
    );
    statement.bind([Number(userId), Number(limit)]);

    const rows = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      rows.push({
        id: Number(row.id),
        role: String(row.role),
        content: String(row.content),
        createdAt: String(row.created_at),
      });
    }

    statement.free();
    return rows.reverse();
  } finally {
    db.close();
  }
}
