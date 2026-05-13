import { fileURLToPath } from "url";
import { createDatabase } from "./db.js";
import { hashPassword } from "./utils/password.js";

function mustGet(db, query, param, label) {
  const row = db.prepare(query).get(param);
  if (!row) throw new Error(`Seed error: missing ${label}`);
  return row;
}

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

  function getOne(query, param) {
  const row = targetDb.prepare(query).get(param);
  if (!row) throw new Error("Missing seed data");
  return row;
}

  function getAny(query) {
    const row = targetDb.prepare(query).get();
    if (!row) throw new Error("No matching spots found");
    return row;
  }
  //mustGet helper find id
  const security = mustGet(
    targetDb,
    "SELECT id FROM users WHERE email = ?",
    "security@auk.org",
    "security user"
  );

  const staff1 = mustGet(
    targetDb,
    "SELECT id FROM users WHERE email = ?",
    "staff1@auk.org",
    "staff1 user"
  );

  const staff2 = mustGet(
    targetDb,
    "SELECT id FROM users WHERE email = ?",
    "staff2@auk.org",
    "staff2 user"
  );

  const student1 = mustGet(
    targetDb,
    "SELECT id FROM users WHERE email = ?",
    "student1@auk.org",
    "student1 user"
  );

  const staffSpot1 = getAny(`
    SELECT id FROM parking_spots
    WHERE lot_type = 'staff'
    LIMIT 1
  `);

  const staffSpot2 = getAny(`
    SELECT id FROM parking_spots
    WHERE lot_type = 'staff'
    LIMIT 1 OFFSET 1
  `);

  const studentSpot = getAny(`
    SELECT id FROM parking_spots
    WHERE lot_type = 'general'
    LIMIT 1
  `);

  const insertReservation = targetDb.prepare(`
    INSERT INTO reservations (user_id, spot_id, start_time, end_time, status, approved_by, approval_note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRecurring = targetDb.prepare(`
    INSERT INTO recurring_reservations (user_id, spot_id, day_of_week, start_time, end_time, semester_start, semester_end, recurrence_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // ───── FIXED RESERVATIONS ─────

  insertReservation.run(
  student1.id,
  studentSpot.id,
  "2026-04-18T08:00:00.000Z",
  "2026-04-18T10:00:00.000Z",
  "approved",
  security.id,
  "Approved for demo."
);

insertReservation.run(
  staff1.id,
  staffSpot1.id,
  "2026-04-18T06:30:00.000Z",
  "2026-04-18T15:30:00.000Z",
  "approved",
  security.id,
  "Faculty recurring slot."
);

insertReservation.run(
  staff2.id,
  staffSpot2.id,
  "2026-04-19T09:00:00.000Z",
  "2026-04-19T11:00:00.000Z",
  "pending",
  null,
  ""
);

  // ───── FIXED RECURRING ─────

  insertRecurring.run(
    staff1.id,
    staffSpot1.id,
    1,
    "2026-04-21T07:00:00.000Z",
    "2026-04-21T15:00:00.000Z",
    "2026-04-20",
    "2026-08-31",
    "semester",
    "active"
  );

  insertRecurring.run(
    staff2.id,
    staffSpot2.id,
    3,
    "2026-04-22T08:00:00.000Z",
    "2026-04-22T14:00:00.000Z",
    "2026-04-20",
    "2026-08-31",
    "weekly",
    "active"
  );
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