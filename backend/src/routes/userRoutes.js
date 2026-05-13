import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { hashPassword } from "../utils/password.js";
import { roleSortWeight } from "../utils/roles.js";

const router = express.Router();

router.get("/", authenticate, authorize("security"), (req, res) => {
  const name = String(req.query.name || "").trim().toLowerCase();
  const email = String(req.query.email || "").trim().toLowerCase();
  const role = String(req.query.role || "").trim().toLowerCase();
  const licensePlate = String(req.query.licensePlate || "").trim().toLowerCase();

  const users = req.db.prepare(`
    SELECT
      users.id,
      users.name,
      users.email,
      users.role,
      users.status,
      users.is_verified,
      users.license_plates,
      users.phone_number,
      users.profile_note,
      users.approval_mode_override,
      users.created_at,
      COALESCE(role_scheduling_rules.max_days_ahead, 10) AS role_max_days_ahead,
      COALESCE(role_scheduling_rules.role_description, '') AS role_description
    FROM users
    LEFT JOIN role_scheduling_rules ON role_scheduling_rules.role_name = users.role
    WHERE (? = '' OR lower(name) LIKE '%' || ? || '%')
      AND (? = '' OR lower(email) LIKE '%' || ? || '%')
      AND (? = '' OR lower(role) = ?)
      AND (? = '' OR lower(license_plates) LIKE '%' || ? || '%')
    ORDER BY created_at DESC
  `).all(name, name, email, email, role, role, licensePlate, licensePlate)
    .sort((first, second) => {
      const firstWeight = roleSortWeight(first.role);
      const secondWeight = roleSortWeight(second.role);
      if (firstWeight !== secondWeight) return firstWeight - secondWeight;
      return new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
    });
  res.json(users);
});

router.post("/", authenticate, authorize("security"), (req, res) => {
  const { name, email, password, role = "staff" } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!name || !normalizedEmail || !password) {
    return res.status(400).json({ message: "Name, email, and password are required." });
  }

  const existing = req.db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ message: "An account already exists for this email." });
  }

  const result = req.db.prepare(`
    INSERT INTO users (name, email, password_hash, role, is_verified, verified_at, status)
    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, 'active')
  `).run(name.trim(), normalizedEmail, hashPassword(password), role);

  req.db.prepare(`
    INSERT INTO role_scheduling_rules (role_name, max_days_ahead, role_description, updated_at)
    VALUES (?, 10, '', CURRENT_TIMESTAMP)
    ON CONFLICT(role_name) DO NOTHING
  `).run(role);

  const user = req.db.prepare(`
    SELECT id, name, email, role, status, is_verified, license_plates, phone_number, profile_note
    FROM users
    WHERE id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(user);
});

router.patch("/:id/status", authenticate, authorize("security"), (req, res) => {
  const { status } = req.body;
  req.db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status || "active", req.params.id);
  const user = req.db.prepare(`
    SELECT id, name, email, role, status, is_verified, license_plates, phone_number, profile_note, approval_mode_override
    FROM users
    WHERE id = ?
  `).get(req.params.id);
  res.json(user);
});

router.patch("/:id/ban", authenticate, authorize("security"), (req, res) => {
  req.db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(req.params.id);
  const user = req.db.prepare(`
    SELECT id, name, email, role, status, is_verified, license_plates, phone_number, profile_note, approval_mode_override
    FROM users
    WHERE id = ?
  `).get(req.params.id);
  res.json(user);
});

router.patch("/:id/unban", authenticate, authorize("security"), (req, res) => {
  req.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(req.params.id);
  const user = req.db.prepare(`
    SELECT id, name, email, role, status, is_verified, license_plates, phone_number, profile_note, approval_mode_override
    FROM users
    WHERE id = ?
  `).get(req.params.id);
  res.json(user);
});

router.patch("/:id/role", authenticate, authorize("security"), (req, res) => {
  const role = String(req.body?.role || "").trim();
  if (!role) {
    return res.status(400).json({ message: "Role is required." });
  }

  req.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, req.params.id);
  req.db.prepare(`
    INSERT INTO role_scheduling_rules (role_name, max_days_ahead, role_description, updated_at)
    VALUES (?, 10, '', CURRENT_TIMESTAMP)
    ON CONFLICT(role_name) DO NOTHING
  `).run(role);

  const user = req.db.prepare(`
    SELECT id, name, email, role, status, is_verified, license_plates, phone_number, profile_note, approval_mode_override
    FROM users
    WHERE id = ?
  `).get(req.params.id);
  res.json(user);
});

router.patch("/:id/approval-mode", authenticate, authorize("security"), (req, res) => {
  const { approvalModeOverride } = req.body;
  const normalizedValue = approvalModeOverride === "default" ? null : approvalModeOverride;

  if (![null, "pending", "approved"].includes(normalizedValue)) {
    return res.status(400).json({ message: "Approval mode must be default, pending, or approved." });
  }

  req.db.prepare("UPDATE users SET approval_mode_override = ? WHERE id = ?").run(normalizedValue, req.params.id);
  const user = req.db.prepare(`
    SELECT id, name, email, role, status, is_verified, license_plates, phone_number, profile_note, approval_mode_override
    FROM users
    WHERE id = ?
  `).get(req.params.id);
  res.json(user);
});

export default router;
