import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config.js";

export function createDatabase(dbPath = config.dbPath) {
  if (dbPath !== ":memory:") {
    const absolutePath = path.resolve(process.cwd(), dbPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'staff', 'security')),
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS parking_spots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'standard',
      is_available INTEGER NOT NULL DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      spot_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
      recurring_group_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_by INTEGER,
      approval_note TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (spot_id) REFERENCES parking_spots(id) ON DELETE CASCADE,
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      spot_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      semester_start TEXT NOT NULL,
      semester_end TEXT NOT NULL,
      recurrence_type TEXT NOT NULL DEFAULT 'weekly',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (spot_id) REFERENCES parking_spots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      student_max_active_reservations INTEGER NOT NULL DEFAULT 5,
      student_max_hours INTEGER NOT NULL DEFAULT 6,
      staff_max_hours INTEGER NOT NULL DEFAULT 12,
      require_admin_approval INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  db.prepare(`
    INSERT INTO app_settings (id, student_max_active_reservations, student_max_hours, staff_max_hours, require_admin_approval)
    VALUES (1, 5, 6, 12, 1)
    ON CONFLICT(id) DO NOTHING
  `).run();

  return db;
}
