import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";
import { hashPassword } from "../src/utils/password.js";
import { ensureDemoUsers, runSeed } from "../src/seed.js";

let app;
let db;

function futureIso(hoursAhead = 24) {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

function futureDateAt(hoursAhead, hour, minute = 0) {
  const date = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function createUser(name, email, role, password = "Password123!") {
  return db.prepare(`
    INSERT INTO users (name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run(name, email, hashPassword(password), role).lastInsertRowid;
}

function createSpot(code = "L-01", side = "left", lotType = "general") {
  return db.prepare(`
    INSERT INTO parking_spots (code, side, type, lot_type, is_available, notes)
    VALUES (?, ?, 'standard', ?, 1, '')
  `).run(code, side, lotType).lastInsertRowid;
}

async function login(email, password) {
  return (await request(app).post("/auth/login").send({ email, password })).body.token;
}

beforeEach(() => {
  db = createDatabase(":memory:");
  ({ app } = createApp({ db, bootstrapDemoUsers: false }));
});

describe("auth", () => {
  it("allows student self-registration with @auk.org emails and requires verification", async () => {
    const response = await request(app).post("/auth/register").send({
      name: "Student Test",
      email: "student@auk.org",
      password: "Student123!"
    });

    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe("student role 1");
    expect(response.body.user.is_verified).toBe(0);
    expect(response.body.message).toContain("verify");
  });

  it("blocks self-registration for non-@auk.org emails", async () => {
    const response = await request(app).post("/auth/register").send({
      name: "Wrong Domain",
      email: "user@gmail.com",
      password: "Student123!"
    });

    expect(response.status).toBe(400);
  });

  it("allows login before email verification but marks the account unverified", async () => {
    await request(app).post("/auth/register").send({
      name: "Student Test",
      email: "student@auk.org",
      password: "Student123!"
    });

    const response = await request(app).post("/auth/login").send({
      email: "student@auk.org",
      password: "Student123!"
    });

    expect(response.status).toBe(200);
    expect(response.body.user.is_verified).toBe(false);
  });

  it("verifies the email token and then allows login", async () => {
    await request(app).post("/auth/register").send({
      name: "Student Test",
      email: "student@auk.org",
      password: "Student123!"
    });
    const token = "known-verification-token";
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    db.prepare(`
      UPDATE users
      SET verification_token_hash = ?,
          verification_expires_at = ?
      WHERE email = 'student@auk.org'
    `).run(tokenHash, futureIso());

    const verifyResponse = await request(app).post("/auth/verify-email").send({ token });
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.user.is_verified).toBe(1);
    expect(verifyResponse.body.token).toBeTruthy();

    const loginResponse = await request(app).post("/auth/login").send({
      email: "student@auk.org",
      password: "Student123!"
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.is_verified).toBe(true);
  });

  it("resends a verification link for unverified accounts", async () => {
    await request(app).post("/auth/register").send({
      name: "Student Test",
      email: "student@auk.org",
      password: "Student123!"
    });

    const response = await request(app).post("/auth/resend-verification").send({
      email: "student@auk.org"
    });

    expect(response.status).toBe(200);
    expect(response.body.message).toContain("sent");
  });

  it("sends a forgot password response and resets the password from a reset token", async () => {
    createUser("Student", "student@auk.org", "student");

    const forgotResponse = await request(app).post("/auth/forgot-password").send({
      email: "student@auk.org"
    });

    expect(forgotResponse.status).toBe(200);
    expect(forgotResponse.body.message).toContain("reset link");

    const token = "known-reset-token";
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    db.prepare(`
      UPDATE users
      SET password_reset_token_hash = ?,
          password_reset_expires_at = ?
      WHERE email = 'student@auk.org'
    `).run(tokenHash, futureIso());

    const resetResponse = await request(app).post("/auth/reset-password").send({
      token,
      password: "NewPassword123!"
    });

    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body.token).toBeTruthy();

    const loginResponse = await request(app).post("/auth/login").send({
      email: "student@auk.org",
      password: "NewPassword123!"
    });

    expect(loginResponse.status).toBe(200);
  });

  it("keeps only student1 as the demo student account", async () => {
    createUser("Student Two", "student2@auk.org", "student");
    createUser("Student Three", "student3@auk.org", "student");

    ensureDemoUsers(db);

    const demoStudents = db.prepare(`
      SELECT email
      FROM users
      WHERE email LIKE 'student%@auk.org'
      ORDER BY email
    `).all().map((row) => row.email);

    expect(demoStudents).toEqual(["student1@auk.org"]);
  });
});

describe("role restrictions", () => {
  it("prevents students from creating staff accounts", async () => {
    createUser("Student", "student@auk.org", "student");
    const token = await login("student@auk.org", "Password123!");

    const response = await request(app)
      .post("/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Staff", email: "newstaff@auk.org", password: "Staff123!", role: "staff" });

    expect(response.status).toBe(403);
  });

  it("prevents regular users from accessing admin-only user management and reports", async () => {
    createUser("Student", "student@auk.org", "student");
    const token = await login("student@auk.org", "Password123!");

    const usersResponse = await request(app)
      .get("/users?licensePlate=ABC")
      .set("Authorization", `Bearer ${token}`);

    const reportsResponse = await request(app)
      .get("/spots/reports")
      .set("Authorization", `Bearer ${token}`);

    expect(usersResponse.status).toBe(403);
    expect(reportsResponse.status).toBe(403);
  });
});

describe("reservation rules", () => {
  it("prevents overlapping reservations for the same spot", async () => {
    const firstStudentId = createUser("Student", "student@auk.org", "student");
    createUser("Student Two", "student2@auk.org", "student");
    const spotId = createSpot();

    db.prepare(`
      INSERT INTO reservations (user_id, spot_id, start_time, end_time, status)
      VALUES (?, ?, ?, ?, 'approved')
    `).run(firstStudentId, spotId, "2026-04-18T08:00:00.000Z", "2026-04-18T10:00:00.000Z");

    const token = await login("student2@auk.org", "Password123!");
    const response = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        spotId,
        startClock: "09:00",
        endClock: "11:00",
        startTime: "2026-04-18T09:00:00.000Z",
        endTime: "2026-04-18T11:00:00.000Z"
      });

    expect(response.status).toBe(409);
  });

  it("enforces the student active reservation cap", async () => {
    const studentId = createUser("Student", "student@auk.org", "student");
    const token = await login("student@auk.org", "Password123!");

    for (let index = 0; index < 5; index += 1) {
      const spotId = createSpot(`L-${String(index + 1).padStart(2, "0")}`);
      db.prepare(`
        INSERT INTO reservations (user_id, spot_id, start_time, end_time, status)
        VALUES (?, ?, ?, ?, 'approved')
      `).run(studentId, spotId, `2026-04-${20 + index}T08:00:00.000Z`, `2026-04-${20 + index}T10:00:00.000Z`);
    }

    const newSpotId = createSpot("R-01");
    const response = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        spotId: newSpotId,
        startTime: "2026-04-30T08:00:00.000Z",
        endTime: "2026-04-30T10:00:00.000Z"
      });

    expect(response.status).toBe(400);
  });

  it("supports the admin approval flow", async () => {
    createUser("Security", "security@auk.org", "security");
    createUser("Student", "student@auk.org", "student");
    const spotId = createSpot();
    db.prepare(`
      UPDATE app_settings
      SET default_reservation_mode = 'pending',
          require_admin_approval = 1
      WHERE id = 1
    `).run();

    const studentToken = await login("student@auk.org", "Password123!");
    const createResponse = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({
        spotId,
        startClock: "08:00",
        endClock: "10:00",
        startTime: "2026-04-20T08:00:00.000Z",
        endTime: "2026-04-20T10:00:00.000Z"
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.status).toBe("pending");

    const securityToken = await login("security@auk.org", "Password123!");
    const approvalResponse = await request(app)
      .patch(`/reservations/${createResponse.body.id}/status`)
      .set("Authorization", `Bearer ${securityToken}`)
      .send({ status: "approved", approvalNote: "Looks good." });

    expect(approvalResponse.status).toBe(200);
    expect(approvalResponse.body.status).toBe("approved");
  });

  it("lets students reserve freely from the general lot by default", async () => {
    const studentId = createUser("Student", "student@auk.org", "student");
    createSpot("L-01", "left", "general");
    db.prepare("UPDATE users SET is_verified = 1 WHERE id = ?").run(studentId);
    const token = await login("student@auk.org", "Password123!");

    const response = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lotType: "general",
        startClock: "07:30",
        endClock: "09:00",
        startTime: "2026-04-28T07:30:00.000Z",
        endTime: "2026-04-28T09:00:00.000Z"
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("approved");
    expect(response.body.spot_code).toBe("L-01");
  });

  it("auto-assigns a spot from the requested lot", async () => {
    createUser("Staff", "staff@auk.org", "staff");
    createSpot("L-01", "left", "general");
    createSpot("R-01", "right", "staff");
    const token = await login("staff@auk.org", "Password123!");

    const response = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lotType: "staff",
        startTime: "2026-04-24T08:00:00.000Z",
        endTime: "2026-04-24T10:00:00.000Z"
      });

    expect(response.status).toBe(201);
    expect(response.body.spot_code).toBe("R-01");
  });

  it("uses a user-specific approval override when set", async () => {
    createUser("Student", "student@auk.org", "student");
    const spotId = createSpot("L-01", "left", "general");
    db.prepare("UPDATE users SET approval_mode_override = 'approved', is_verified = 1 WHERE email = 'student@auk.org'").run();
    const token = await login("student@auk.org", "Password123!");

    const response = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        spotId,
        startClock: "07:30",
        endClock: "09:00",
        startTime: "2026-04-26T07:30:00.000Z",
        endTime: "2026-04-26T09:00:00.000Z"
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("approved");
  });

  it("blocks reservations for users who have not verified their email", async () => {
    const studentId = createUser("Student", "student@auk.org", "student");
    const spotId = createSpot("L-01", "left", "general");
    db.prepare("UPDATE users SET is_verified = 0 WHERE id = ?").run(studentId);
    const token = await login("student@auk.org", "Password123!");

    const response = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        spotId,
        startClock: "07:30",
        endClock: "09:00",
        startTime: "2026-04-26T07:30:00.000Z",
        endTime: "2026-04-26T09:00:00.000Z"
      });

    expect(response.status).toBe(403);
  });

  it("limits student reservations to the 07:30 to 20:00 window with 1 hour minimums", async () => {
    const studentId = createUser("Student", "student@auk.org", "student");
    const spotId = createSpot("L-01", "left", "general");
    db.prepare("UPDATE users SET is_verified = 1 WHERE id = ?").run(studentId);
    const token = await login("student@auk.org", "Password123!");

    const response = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        spotId,
        startClock: "07:30",
        endClock: "08:00",
        startTime: "2026-04-26T07:30:00.000Z",
        endTime: "2026-04-26T08:00:00.000Z"
      });

    expect(response.status).toBe(400);
  });

  it("blocks banned users from creating reservations", async () => {
    const studentId = createUser("Student", "student@auk.org", "student");
    const spotId = createSpot("L-01", "left", "general");
    db.prepare("UPDATE users SET is_verified = 1, status = 'banned' WHERE id = ?").run(studentId);
    const token = await login("student@auk.org", "Password123!");

    const response = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        spotId,
        startClock: "07:30",
        endClock: "09:00",
        startTime: "2026-04-26T07:30:00.000Z",
        endTime: "2026-04-26T09:00:00.000Z"
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain("banned");
  });

  it("enforces student role 1 limits of max 2 active bookings per day and max 2 hours each", async () => {
    const studentId = createUser("Student", "student@auk.org", "student role 1");
    db.prepare("UPDATE users SET is_verified = 1 WHERE id = ?").run(studentId);
    createSpot("L-01", "left", "general");
    createSpot("L-02", "left", "general");
    createSpot("L-03", "left", "general");
    const token = await login("student@auk.org", "Password123!");

    const firstStart = futureDateAt(24, 8, 0);
    const firstEnd = futureDateAt(24, 10, 0);
    const secondStart = futureDateAt(24, 10, 30);
    const secondEnd = futureDateAt(24, 12, 30);
    const thirdStart = futureDateAt(24, 13, 0);
    const thirdEnd = futureDateAt(24, 14, 0);
    const tooLongStart = futureDateAt(48, 8, 0);
    const tooLongEnd = futureDateAt(48, 11, 0);

    const first = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lotType: "general",
        startClock: "08:00",
        endClock: "10:00",
        startTime: firstStart,
        endTime: firstEnd
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lotType: "general",
        startClock: "10:30",
        endClock: "12:30",
        startTime: secondStart,
        endTime: secondEnd
      });
    expect(second.status).toBe(201);

    const third = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lotType: "general",
        startClock: "13:00",
        endClock: "14:00",
        startTime: thirdStart,
        endTime: thirdEnd
      });
    expect(third.status).toBe(400);

    const tooLong = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lotType: "general",
        startClock: "08:00",
        endClock: "11:00",
        startTime: tooLongStart,
        endTime: tooLongEnd
      });
    expect(tooLong.status).toBe(400);
  });
});

describe("admin user controls", () => {
  it("lets security search users by license plate and ban or unban them", async () => {
    createUser("Security", "security@auk.org", "security");
    const staffId = createUser("Staff", "staff@auk.org", "staff");
    db.prepare("UPDATE users SET license_plates = 'AA-123-BB', profile_note = 'Professor account' WHERE id = ?").run(staffId);
    const token = await login("security@auk.org", "Password123!");

    const searchResponse = await request(app)
      .get("/users?licensePlate=123")
      .set("Authorization", `Bearer ${token}`);

    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body).toHaveLength(1);
    expect(searchResponse.body[0].email).toBe("staff@auk.org");

    const banResponse = await request(app)
      .patch(`/users/${staffId}/ban`)
      .set("Authorization", `Bearer ${token}`);

    expect(banResponse.status).toBe(200);
    expect(banResponse.body.status).toBe("banned");

    const unbanResponse = await request(app)
      .patch(`/users/${staffId}/unban`)
      .set("Authorization", `Bearer ${token}`);

    expect(unbanResponse.status).toBe(200);
    expect(unbanResponse.body.status).toBe("active");
  });

  it("allows security to edit role scheduling rules", async () => {
    createUser("Security", "security@auk.org", "security");
    const token = await login("security@auk.org", "Password123!");

    const response = await request(app)
      .patch("/admin/role-rules/student%20role%201")
      .set("Authorization", `Bearer ${token}`)
      .send({ maxDaysAhead: 7, roleDescription: "Tier 1 students" });

    expect(response.status).toBe(200);
    expect(response.body.max_days_ahead).toBe(7);
  });
});

describe("profile updates and reports", () => {
  it("lets staff update license plates and profile notes", async () => {
    createUser("Staff", "staff@auk.org", "staff");
    const token = await login("staff@auk.org", "Password123!");

    const response = await request(app)
      .patch("/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ licensePlates: "STAFF-001, STAFF-002", profileNote: "Professor office hours account." });

    expect(response.status).toBe(200);
    expect(response.body.license_plates).toContain("STAFF-001");
    expect(response.body.profile_note).toContain("Professor");
  });

  it("saves occupied spot reports and lets security view them", async () => {
    createUser("Security", "security@auk.org", "security");
    createUser("Staff", "staff@auk.org", "staff");
    const spotId = createSpot("R-01", "right", "staff");
    const staffToken = await login("staff@auk.org", "Password123!");
    const securityToken = await login("security@auk.org", "Password123!");

    const createResponse = await request(app)
      .post("/spots/reports")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        spotId,
        licensePlate: "REP-777",
        description: "Occupied without a visible permit."
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.spot_code).toBe("R-01");

    const listResponse = await request(app)
      .get("/spots/reports?lotType=staff")
      .set("Authorization", `Bearer ${securityToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].license_plate).toBe("REP-777");
  });
});

describe("seed layout", () => {
  it("removes E-01 and E-02 and keeps exactly 20 staff spots", () => {
    runSeed(db);

    const entranceSpots = db.prepare("SELECT code FROM parking_spots WHERE code IN ('E-01', 'E-02')").all();
    const staffSpotCount = db.prepare("SELECT COUNT(*) AS count FROM parking_spots WHERE lot_type = 'staff'").get().count;

    expect(entranceSpots).toHaveLength(0);
    expect(staffSpotCount).toBe(20);
  });
});
