import express from "express";
import jwt from "jsonwebtoken";
import { comparePassword, hashPassword } from "../utils/password.js";
import { config } from "../config.js";
import { issueVerificationEmail, verifyEmailToken } from "../services/emailVerificationService.js";

const router = express.Router();

function issueToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: "7d"
  });
}

router.post("/register", (req, res, next) => {
  (async () => {
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
      INSERT INTO users (name, email, password_hash, role, is_verified, verification_token_hash, verification_expires_at, verified_at, status)
      VALUES (?, ?, ?, 'student', 0, NULL, NULL, NULL, 'active')
    `).run(name.trim(), normalizedEmail, hashPassword(password));

    const user = req.db.prepare("SELECT id, name, email, role, status, is_verified FROM users WHERE id = ?").get(result.lastInsertRowid);
    const { verificationUrl } = await issueVerificationEmail(req.db, user);
    res.status(201).json({
      message: "Account created. Please verify your @auk.org email before signing in.",
      user,
      previewUrl: verificationUrl
    });
  })().catch((error) => {
    next(error);
  });
});

router.post("/login", (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const user = req.db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);

    if (!user || !comparePassword(password || "", user.password_hash)) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your @auk.org email before signing in.",
        email: user.email
      });
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

router.post("/verify-email", (req, res, next) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) {
      return res.status(400).json({ message: "Verification token is required." });
    }

    const user = verifyEmailToken(req.db, token);
    res.json({
      message: "Email verified successfully.",
      token: issueToken(user),
      user
    });
  } catch (error) {
    next(error);
  }
});

router.post("/resend-verification", (req, res, next) => {
  (async () => {
    const normalizedEmail = String(req.body?.email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      return res.status(400).json({ message: "Email is required." });
    }

    const user = req.db.prepare(`
      SELECT id, name, email, role, status, is_verified
      FROM users
      WHERE email = ?
    `).get(normalizedEmail);

    if (!user) {
      return res.status(404).json({ message: "No account exists for that email." });
    }

    if (user.is_verified) {
      return res.json({ message: "This email is already verified." });
    }

    const { verificationUrl } = await issueVerificationEmail(req.db, user);
    res.json({
      message: "A new verification email has been sent.",
      previewUrl: verificationUrl
    });
  })().catch((error) => {
    next(error);
  });
});

router.post("/google", (req, res) => {
  res.status(501).json({ message: "Google login is not enabled in this demo build." });
});

export default router;
