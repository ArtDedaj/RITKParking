import express from "express";
import jwt from "jsonwebtoken";
import { comparePassword, hashPassword } from "../utils/password.js";
import { config } from "../config.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwtSecret,
    { expiresIn: "7d" }
  );
}

router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.endsWith("@auk.org")) {
      return res.status(400).json({ message: "Students can only register with an @auk.org email address." });
    }

    const [existing] = await req.db.execute("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    if (existing.length) {
      return res.status(409).json({ message: "An account already exists for this email." });
    }

    const [result] = await req.db.execute(
      `INSERT INTO users (name, email, password_hash, role, is_verified, status)
       VALUES (?, ?, ?, 'student', 1, 'active')`,
      [name.trim(), normalizedEmail, hashPassword(password)]
    );

    const [rows] = await req.db.execute(
      "SELECT id, name, email, role, status, is_verified FROM users WHERE id = ?",
      [result.insertId]
    );
    const user = rows[0];

    res.status(201).json({
      message: "Account created.",
      token: issueToken(user),
      user
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const [rows] = await req.db.execute("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
    const user = rows[0];

    if (!user || !comparePassword(password || "", user.password_hash)) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      is_verified: Boolean(user.is_verified)
    };

    res.json({ token: issueToken(safeUser), user: safeUser });
  } catch (error) {
    next(error);
  }
});

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const [rows] = await req.db.execute(
      "SELECT id, name, email, role, status, is_verified FROM users WHERE id = ?",
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (error) {
    next(error);
  }
});

export default router;
