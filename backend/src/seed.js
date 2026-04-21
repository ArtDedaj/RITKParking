import { fileURLToPath } from "url";
import { createDatabase } from "./db.js";
import { hashPassword } from "./utils/password.js";

export function ensureDemoUsers(targetDb) {
  const insert = targetDb.prepare(`
    INSERT INTO users (name, email, password_hash, role, is_verified, verified_at, status)
    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, 'active')
  `);

  targetDb.prepare(`
    DELETE FROM users
    WHERE email IN ('student2@auk.org', 'student3@auk.org')
  `).run();

  [
    ["Security Admin", "security@auk.org", "Admin123!", "security"],
    ["Staff One", "staff1@auk.org", "Staff123!", "staff"],
    ["Staff Two", "staff2@auk.org", "Staff123!", "staff"],
    ["Student One", "student1@auk.org", "Student123!", "student"]
  ].forEach(([name, email, password, role]) => {
    const existingUser = targetDb.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (!existingUser) {
      insert.run(name, email, hashPassword(password), role);
    } else {
      targetDb.prepare(`
        UPDATE users
        SET is_verified = 1,
            verification_token_hash = NULL,
            verification_expires_at = NULL,
            verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
        WHERE email = ?
      `).run(email);
    }
  });
}

function resetTables(targetDb) {
  targetDb.exec(`
    DELETE FROM audit_logs;
    DELETE FROM recurring_reservations;
    DELETE FROM reservations;
    DELETE FROM parking_spots;
    DELETE FROM users;
  `);
}

function seedUsers(targetDb) {
  ensureDemoUsers(targetDb);
}

function seedSpots(targetDb) {
  const insert = targetDb.prepare(`
    INSERT INTO parking_spots (code, side, type, lot_type, is_available, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (let index = 1; index <= 20; index += 1) {
    insert.run(`L-${String(index).padStart(2, "0")}`, "left", "standard", "general", 1, "");
  }

  for (let index = 1; index <= 18; index += 1) {
    insert.run(`R-${String(index).padStart(2, "0")}`, "right", "standard", "staff", 1, "");
  }

  insert.run("E-01", "entrance", "accessible", "general", 1, "Accessible parking near the entrance.");
  insert.run("E-02", "entrance", "vip", "staff", 0, "Temporarily unavailable for maintenance.");
}

function seedReservations(targetDb) {
  const securityId = targetDb.prepare("SELECT id FROM users WHERE email = 'security@auk.org'").get()?.id;
  const staff1Id = targetDb.prepare("SELECT id FROM users WHERE email = 'staff1@auk.org'").get()?.id;
  const staff2Id = targetDb.prepare("SELECT id FROM users WHERE email = 'staff2@auk.org'").get()?.id;
  const student1Id = targetDb.prepare("SELECT id FROM users WHERE email = 'student1@auk.org'").get()?.id;
  const insertReservation = targetDb.prepare(`
    INSERT INTO reservations (user_id, spot_id, start_time, end_time, status, approved_by, approval_note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRecurring = targetDb.prepare(`
    INSERT INTO recurring_reservations (user_id, spot_id, day_of_week, start_time, end_time, semester_start, semester_end, recurrence_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertReservation.run(student1Id, 1, "2026-04-18T08:00:00.000Z", "2026-04-18T10:00:00.000Z", "approved", securityId, "Approved for demo.");
  insertReservation.run(staff1Id, 22, "2026-04-18T06:30:00.000Z", "2026-04-18T15:30:00.000Z", "approved", securityId, "Faculty recurring slot.");
  insertReservation.run(staff2Id, 39, "2026-04-19T09:00:00.000Z", "2026-04-19T11:00:00.000Z", "pending", null, "");

  insertRecurring.run(staff1Id, 20, 1, "2026-04-21T07:00:00.000Z", "2026-04-21T15:00:00.000Z", "2026-04-20", "2026-08-31", "semester", "active");
  insertRecurring.run(staff2Id, 38, 3, "2026-04-22T08:00:00.000Z", "2026-04-22T14:00:00.000Z", "2026-04-20", "2026-08-31", "weekly", "active");
}

export function runSeed(targetDb = createDatabase()) {
  resetTables(targetDb);
  seedUsers(targetDb);
  seedSpots(targetDb);
  seedReservations(targetDb);
  console.log("Database seeded with demo users, 40 parking spots, and sample reservations.");
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] === currentFilePath) {
  runSeed();
}