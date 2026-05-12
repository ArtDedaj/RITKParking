import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { hashPassword } from "../utils/password.js";

const router = express.Router();

router.get("/", authenticate, authorize("security"), async (req, res, next) => {
  try {
    const [rows] = await req.db.execute(`
      SELECT id, name, email, role, status, is_verified, created_at
      FROM users
      ORDER BY role DESC, created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post("/", authenticate, authorize("security"), async (req, res, next) => {
  try {
    const { name, email, password, role = "staff" } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!name || !normalizedEmail || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }
    if (!["staff", "security"].includes(role)) {
      return res.status(400).json({ message: "Only staff or security accounts can be created here." });
    }

    const [existing] = await req.db.execute("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    if (existing.length) {
      return res.status(409).json({ message: "An account already exists for this email." });
    }

    const [result] = await req.db.execute(
      `INSERT INTO users (name, email, password_hash, role, is_verified, status)
       VALUES (?, ?, ?, ?, 1, 'active')`,
      [name.trim(), normalizedEmail, hashPassword(password), role]
    );

    const [rows] = await req.db.execute(
      "SELECT id, name, email, role, status, is_verified FROM users WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/status", authenticate, authorize("security"), async (req, res, next) => {
  try {
    const { status } = req.body;
    await req.db.execute("UPDATE users SET status = ? WHERE id = ?", [status || "active", req.params.id]);
    const [rows] = await req.db.execute(
      "SELECT id, name, email, role, status, is_verified FROM users WHERE id = ?",
      [req.params.id]
    );
    res.json(rows[0] || null);
  } catch (error) {
    next(error);
  }
});

export default router;
