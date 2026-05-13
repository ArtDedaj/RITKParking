import express from "express";
import jwt from "jsonwebtoken";
import { comparePassword, hashPassword } from "../utils/password.js";
import { config } from "../config.js";
import { issueVerificationEmail, verifyEmailToken } from "../services/emailVerificationService.js";
import { authenticate } from "../middleware/auth.js";
import { clearPasswordResetToken, consumePasswordResetToken, issuePasswordResetEmail } from "../services/passwordResetService.js";

const router = express.Router();

function normalizeLicensePlates(rawValue) {
  const entries = String(rawValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (entries.length > 5) {
    const error = new Error("You can save up to 5 license plates.");
    error.status = 400;
    throw error;
  }

  entries.forEach((plate) => {
    if (plate.length > 10) {
      const error = new Error("Each license plate must be 10 characters or fewer.");
      error.status = 400;
      throw error;
    }
  });

  return entries.join(", ");
}

function normalizePhoneNumber(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (value.length > 20) {
    const error = new Error("Phone number must be 20 characters or fewer.");
    error.status = 400;
    throw error;
  }
  if (!/^[0-9+\-\s()]+$/.test(value)) {
    const error = new Error("Phone number contains invalid characters.");
    error.status = 400;
    throw error;
  }
  return value;
}

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
      VALUES (?, ?, ?, 'student role 1', 0, NULL, NULL, NULL, 'active')
    `).run(name.trim(), normalizedEmail, hashPassword(password));

    const user = req.db.prepare("SELECT id, name, email, role, status, is_verified FROM users WHERE id = ?").get(result.lastInsertRowid);
    await issueVerificationEmail(req.db, user);
    res.status(201).json({
      message: "Account created. Please verify your @auk.org email before signing in.",
      user
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

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      is_verified: Boolean(user.is_verified),
      license_plates: user.license_plates || "",
      phone_number: user.phone_number || "",
      profile_note: user.profile_note || ""
    };

    res.json({ token: issueToken(safeUser), user: safeUser });
  } catch (error) {
    next(error);
  }
});

router.get("/me", authenticate, (req, res) => {
  const user = req.db.prepare(`
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
      COALESCE(role_scheduling_rules.max_days_ahead, 10) AS role_max_days_ahead,
      COALESCE(role_scheduling_rules.role_description, '') AS role_description
    FROM users
    LEFT JOIN role_scheduling_rules ON role_scheduling_rules.role_name = users.role
    WHERE id = ?
  `).get(req.user.id);

  res.json(user);
});

router.patch("/me", authenticate, (req, res) => {
  let licensePlates = "";
  let phoneNumber = "";
  try {
    licensePlates = normalizeLicensePlates(req.body?.licensePlates || "");
    phoneNumber = normalizePhoneNumber(req.body?.phoneNumber || "");
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  const profileNote = String(req.body?.profileNote || "").trim();

  req.db.prepare(`
    UPDATE users
    SET license_plates = ?,
        phone_number = ?,
        profile_note = ?
    WHERE id = ?
  `).run(licensePlates, phoneNumber, profileNote, req.user.id);

  const user = req.db.prepare(`
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
      COALESCE(role_scheduling_rules.max_days_ahead, 10) AS role_max_days_ahead,
      COALESCE(role_scheduling_rules.role_description, '') AS role_description
    FROM users
    LEFT JOIN role_scheduling_rules ON role_scheduling_rules.role_name = users.role
    WHERE id = ?
  `).get(req.user.id);

  res.json(user);
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

    await issueVerificationEmail(req.db, user);
    res.json({
      message: "A new verification email has been sent."
    });
  })().catch((error) => {
    next(error);
  });
});

router.post("/forgot-password", (req, res, next) => {
  (async () => {
    const normalizedEmail = String(req.body?.email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      return res.status(400).json({ message: "Email is required." });
    }

    const user = req.db.prepare(`
      SELECT id, name, email
      FROM users
      WHERE email = ?
    `).get(normalizedEmail);

    if (user) {
      await issuePasswordResetEmail(req.db, user);
    }

    res.json({ message: "If an account exists for that email, a reset link has been sent." });
  })().catch((error) => {
    next(error);
  });
});

router.post("/reset-password", (req, res, next) => {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");

    if (!token || !password) {
      return res.status(400).json({ message: "Reset token and new password are required." });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long." });
    }

    const user = consumePasswordResetToken(req.db, token);
    req.db.prepare(`
      UPDATE users
      SET password_hash = ?
      WHERE id = ?
    `).run(hashPassword(password), user.id);
    clearPasswordResetToken(req.db, user.id);

    const safeUser = req.db.prepare(`
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
        COALESCE(role_scheduling_rules.max_days_ahead, 10) AS role_max_days_ahead,
        COALESCE(role_scheduling_rules.role_description, '') AS role_description
      FROM users
      LEFT JOIN role_scheduling_rules ON role_scheduling_rules.role_name = users.role
      WHERE id = ?
    `).get(user.id);

    res.json({
      message: "Password updated successfully.",
      token: issueToken(safeUser),
      user: safeUser
    });
  } catch (error) {
    next(error);
  }
});

router.post("/google", (req, res) => {
  res.status(501).json({ message: "Google login is not enabled in this demo build." });
});

export default router;
