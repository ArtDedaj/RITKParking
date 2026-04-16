import crypto from "crypto";
import { config } from "../config.js";
import { sendMail } from "./mailService.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildResetUrl(token) {
  const baseUrl = config.frontendUrl.replace(/\/$/, "");
  return `${baseUrl}/?reset=${encodeURIComponent(token)}`;
}

export async function issuePasswordResetEmail(db, user) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.passwordResetTtlHours * 60 * 60 * 1000).toISOString();
  const resetUrl = buildResetUrl(token);

  db.prepare(`
    UPDATE users
    SET password_reset_token_hash = ?,
        password_reset_expires_at = ?
    WHERE id = ?
  `).run(tokenHash, expiresAt, user.id);

  await sendMail({
    to: user.email,
    subject: "Reset your AUK Smart Parking password",
    text: [
      `Hello ${user.name},`,
      "",
      "Open the link below to reset your AUK Smart Parking password:",
      resetUrl,
      "",
      `This link expires in ${config.passwordResetTtlHours} hours.`
    ].join("\n"),
    html: `
      <p>Hello ${user.name},</p>
      <p>Open the link below to reset your AUK Smart Parking password:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in ${config.passwordResetTtlHours} hours.</p>
    `
  });
}

export function consumePasswordResetToken(db, token) {
  const tokenHash = hashToken(token);
  const user = db.prepare(`
    SELECT id, name, email, role, status, is_verified, password_reset_expires_at
    FROM users
    WHERE password_reset_token_hash = ?
  `).get(tokenHash);

  if (!user) {
    const error = new Error("This password reset link is invalid.");
    error.status = 400;
    throw error;
  }

  if (!user.password_reset_expires_at || new Date(user.password_reset_expires_at).getTime() < Date.now()) {
    const error = new Error("This password reset link has expired. Please request a new one.");
    error.status = 400;
    throw error;
  }

  return user;
}

export function clearPasswordResetToken(db, userId) {
  db.prepare(`
    UPDATE users
    SET password_reset_token_hash = NULL,
        password_reset_expires_at = NULL
    WHERE id = ?
  `).run(userId);
}
