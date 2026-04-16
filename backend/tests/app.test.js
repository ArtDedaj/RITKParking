import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";
import { hashPassword } from "../src/utils/password.js";

let app;
let db;

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
  it("allows student self-registration with @auk.org emails", async () => {
    const response = await request(app).post("/auth/register").send({
      name: "Student Test",
      email: "student@auk.org",
      password: "Student123!"
    });

    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe("student");
  });

  it("blocks self-registration for non-@auk.org emails", async () => {
    const response = await request(app).post("/auth/register").send({
      name: "Wrong Domain",
      email: "user@gmail.com",
      password: "Student123!"
    });

    expect(response.status).toBe(400);
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

    const studentToken = await login("student@auk.org", "Password123!");
    const createResponse = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({
        spotId,
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
    db.prepare("UPDATE users SET approval_mode_override = 'approved' WHERE email = 'student@auk.org'").run();
    const token = await login("student@auk.org", "Password123!");

    const response = await request(app)
      .post("/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        spotId,
        startTime: "2026-04-26T08:00:00.000Z",
        endTime: "2026-04-26T10:00:00.000Z"
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("approved");
  });
});
