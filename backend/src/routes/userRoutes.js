import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { hashPassword } from "../utils/password.js";

const router = express.Router();

router.get("/", authenticate, authorize("security"), (req, res) => {
  const users = req.db.prepare(`
    SELECT id, name, email, role, status, is_verified, approval_mode_override, created_at
    FROM users
    ORDER BY role DESC, created_at DESC
  `).all();
  res.json(users);
});

router.post("/", authenticate, authorize("security"), (req, res) => {
  const { name, email, password, role = "staff" } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!name || !normalizedEmail || !password) {
    return res.status(400).json({ message: "Name, email, and password are required." });
  }

  if (!["staff", "security"].includes(role)) {
    return res.status(400).json({ message: "Security can only create staff or security accounts here." });
  }

  const existing = req.db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ message: "An account already exists for this email." });
  }

  const result = req.db.prepare(`
    INSERT INTO users (name, email, password_hash, role, is_verified, verified_at, status)
    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, 'active')
  `).run(name.trim(), normalizedEmail, hashPassword(password), role);

  const user = req.db.prepare("SELECT id, name, email, role, status, is_verified FROM users WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(user);
});

router.patch("/:id/status", authenticate, authorize("security"), (req, res) => {
  const { status } = req.body;
  req.db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status || "active", req.params.id);
  const user = req.db.prepare("SELECT id, name, email, role, status, is_verified, approval_mode_override FROM users WHERE id = ?").get(req.params.id);
  res.json(user);
});

router.patch("/:id/approval-mode", authenticate, authorize("security"), (req, res) => {
  const { approvalModeOverride } = req.body;
  const normalizedValue = approvalModeOverride === "default" ? null : approvalModeOverride;

  if (![null, "pending", "approved"].includes(normalizedValue)) {
    return res.status(400).json({ message: "Approval mode must be default, pending, or approved." });
  }

  req.db.prepare("UPDATE users SET approval_mode_override = ? WHERE id = ?").run(normalizedValue, req.params.id);
  const user = req.db.prepare("SELECT id, name, email, role, status, is_verified, approval_mode_override FROM users WHERE id = ?").get(req.params.id);
  res.json(user);
});

export default router;
