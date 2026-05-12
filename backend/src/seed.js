import { fileURLToPath } from "url";
import { createDatabase } from "./db.js";
import { hashPassword } from "./utils/password.js";

export async function ensureDemoUsers(db) {
  const demoAccounts = [
    ["Security Admin", "security@auk.org", "Admin123!",   "security"],
    ["Staff One",      "staff1@auk.org",   "Staff123!",   "staff"],
    ["Staff Two",      "staff2@auk.org",   "Staff123!",   "staff"],
    ["Student One",    "student1@auk.org", "Student123!", "student"]
  ];

  for (const [name, email, password, role] of demoAccounts) {
    const [existing] = await db.execute("SELECT id FROM users WHERE email = ?", [email]);
    if (!existing.length) {
      await db.execute(
        `INSERT INTO users (name, email, password_hash, role, is_verified, status)
         VALUES (?, ?, ?, ?, 1, 'active')`,
        [name, email, hashPassword(password), role]
      );
    }
  }
}

async function resetTables(db) {
  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  await db.query("TRUNCATE TABLE reservations");
  await db.query("TRUNCATE TABLE parking_spots");
  await db.query("TRUNCATE TABLE users");
  await db.query("SET FOREIGN_KEY_CHECKS = 1");
}

async function seedSpots(db) {
  const insert = async (code, side, type, lotType, isAvailable, notes) =>
    db.execute(
      `INSERT INTO parking_spots (code, side, type, lot_type, is_available, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, side, type, lotType, isAvailable, notes]
    );

  for (let i = 1; i <= 20; i += 1) {
    await insert(`L-${String(i).padStart(2, "0")}`, "left",  "standard", "general", 1, "");
  }
  for (let i = 1; i <= 18; i += 1) {
    await insert(`R-${String(i).padStart(2, "0")}`, "right", "standard", "staff",   1, "");
  }
  await insert("E-01", "entrance", "accessible", "general", 1, "Accessible parking near the entrance.");
  await insert("E-02", "entrance", "vip",        "staff",   0, "Temporarily unavailable for maintenance.");
}

async function seedReservations(db) {
  const getId = async (email) => {
    const [rows] = await db.execute("SELECT id FROM users WHERE email = ?", [email]);
    return rows[0]?.id;
  };
  const getSpotId = async (code) => {
    const [rows] = await db.execute("SELECT id FROM parking_spots WHERE code = ?", [code]);
    return rows[0]?.id;
  };

  const securityId = await getId("security@auk.org");
  const staff1Id   = await getId("staff1@auk.org");
  const student1Id = await getId("student1@auk.org");
  const spot1Id    = await getSpotId("L-01");
  const spot22Id   = await getSpotId("R-02");

  const insert = (userId, spotId, start, end, status, approvedBy, note) =>
    db.execute(
      `INSERT INTO reservations (user_id, spot_id, start_time, end_time, status, approved_by, approval_note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, spotId, start, end, status, approvedBy, note]
    );

  await insert(student1Id, spot1Id,  "2026-04-25T08:00:00.000Z", "2026-04-25T10:00:00.000Z", "approved", securityId, "Approved for demo.");
  await insert(staff1Id,   spot22Id, "2026-04-25T06:30:00.000Z", "2026-04-25T15:30:00.000Z", "approved", securityId, "Faculty slot.");
}

export async function runSeed() {
  const db = await createDatabase();
  await resetTables(db);
  await ensureDemoUsers(db);
  await seedSpots(db);
  await seedReservations(db);
  console.log("Tutorial database seeded: demo users, 40 spots, sample reservations.");
  await db.end();
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFilePath) {
  runSeed().catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
}
