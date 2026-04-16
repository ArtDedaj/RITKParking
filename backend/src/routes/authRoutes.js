import express from "express";
import jwt from "jsonwebtoken";
import { comparePassword, hashPassword } from "../utils/password.js";
import { config } from "../config.js";

const router = express.Router();

function issueToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: "7d"
  });
}

router.post("/register", (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.endsWith("@auk.org")) {
      return res.status(400).json({ message: "Students can only register with an @auk.org email address." });
    }

    const existingUser = req.db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
    if (existingUser) {
      return res.status(409).json({ message: "An account already exists for this email." });
    }

    const result = req.db.prepare(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES (?, ?, ?, 'student', 'active')
    `).run(name.trim(), normalizedEmail, hashPassword(password));

    const user = req.db.prepare("SELECT id, name, email, role, status FROM users WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ token: issueToken(user), user });
  } catch (error) {
    next(error);
  }
});

router.post("/login", (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const user = req.db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);

    if (!user || !comparePassword(password || "", user.password_hash)) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status
    };

    res.json({ token: issueToken(safeUser), user: safeUser });
  } catch (error) {
    next(error);
  }
});

router.post("/google", (req, res) => {
  res.status(501).json({ message: "Google login is not enabled in this demo build." });
});

export default router;
