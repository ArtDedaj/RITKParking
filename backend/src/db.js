import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config.js";

function ensureColumn(db, tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

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
      is_verified INTEGER NOT NULL DEFAULT 1,
      verification_token_hash TEXT DEFAULT NULL,
      verification_expires_at TEXT DEFAULT NULL,
      password_reset_token_hash TEXT DEFAULT NULL,
      password_reset_expires_at TEXT DEFAULT NULL,
      verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
      approval_mode_override TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS parking_spots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'standard',
      lot_type TEXT NOT NULL DEFAULT 'general',
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
      default_reservation_mode TEXT NOT NULL DEFAULT 'approved',
      require_admin_approval INTEGER NOT NULL DEFAULT 0,
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

  ensureColumn(db, "users", "is_verified", "is_verified INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "users", "verification_token_hash", "verification_token_hash TEXT DEFAULT NULL");
  ensureColumn(db, "users", "verification_expires_at", "verification_expires_at TEXT DEFAULT NULL");
  ensureColumn(db, "users", "password_reset_token_hash", "password_reset_token_hash TEXT DEFAULT NULL");
  ensureColumn(db, "users", "password_reset_expires_at", "password_reset_expires_at TEXT DEFAULT NULL");
  ensureColumn(db, "users", "verified_at", "verified_at TEXT DEFAULT CURRENT_TIMESTAMP");
  ensureColumn(db, "users", "approval_mode_override", "approval_mode_override TEXT DEFAULT NULL");
  ensureColumn(db, "parking_spots", "lot_type", "lot_type TEXT NOT NULL DEFAULT 'general'");
  ensureColumn(db, "app_settings", "default_reservation_mode", "default_reservation_mode TEXT NOT NULL DEFAULT 'approved'");

  db.prepare(`
    UPDATE users
    SET is_verified = 1,
        verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
    WHERE is_verified IS NULL
  `).run();

  db.prepare(`
    UPDATE users
    SET verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
    WHERE is_verified = 1
  `).run();

  db.prepare(`
    INSERT INTO app_settings (id, student_max_active_reservations, student_max_hours, staff_max_hours, default_reservation_mode, require_admin_approval)
    VALUES (1, 5, 6, 12, 'approved', 0)
    ON CONFLICT(id) DO NOTHING
  `).run();

  db.prepare(`
    UPDATE app_settings
    SET default_reservation_mode = 'approved',
        require_admin_approval = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
      AND default_reservation_mode = 'pending'
      AND require_admin_approval = 1
  `).run();

  db.prepare(`
    UPDATE app_settings
    SET default_reservation_mode = CASE
      WHEN default_reservation_mode IS NULL OR default_reservation_mode = ''
      THEN CASE WHEN require_admin_approval = 1 THEN 'pending' ELSE 'approved' END
      ELSE default_reservation_mode
    END
    WHERE id = 1
  `).run();

  db.prepare(`
    UPDATE parking_spots
    SET lot_type = CASE
      WHEN side = 'right' THEN 'staff'
      ELSE 'general'
    END
    WHERE code LIKE 'L-%' OR code LIKE 'R-%' OR code LIKE 'E-%'
  `).run();

  return db;
}
