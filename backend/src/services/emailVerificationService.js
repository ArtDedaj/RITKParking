import crypto from "crypto";
import { config } from "../config.js";
import { sendMail } from "./mailService.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildVerificationUrl(token) {
  const baseUrl = config.frontendUrl.replace(/\/$/, "");
  return `${baseUrl}/?verify=${encodeURIComponent(token)}`;
}

export async function issueVerificationEmail(db, user) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + config.verificationTtlHours * 60 * 60 * 1000).toISOString();
  const verificationUrl = buildVerificationUrl(token);

  db.prepare(`
    UPDATE users
    SET verification_token_hash = ?,
        verification_expires_at = ?,
        verified_at = NULL
    WHERE id = ?
  `).run(hashToken(token), expiresAt, user.id);

  const { configured } = await sendMail({
    to: user.email,
    subject: "Verify your AUK Smart Parking account",
    text: [
      `Hello ${user.name},`,
      "",
      "Please verify your AUK Smart Parking account by opening the link below:",
      verificationUrl,
      "",
      `This link expires in ${config.verificationTtlHours} hours.`
    ].join("\n"),
    html: `
      <p>Hello ${user.name},</p>
      <p>Please verify your AUK Smart Parking account by opening the link below:</p>
      <p><a href="${verificationUrl}">${verificationUrl}</a></p>
      <p>This link expires in ${config.verificationTtlHours} hours.</p>
    `
  });

  if (!configured) {
    console.log(`[email-preview] Verification link for ${user.email}: ${verificationUrl}`);
  }

  return {
    verificationUrl: configured ? null : verificationUrl
  };
}

export function verifyEmailToken(db, token) {
  const tokenHash = hashToken(token);
  const user = db.prepare(`
    SELECT id, name, email, role, status, is_verified
    FROM users
    WHERE verification_token_hash = ?
  `).get(tokenHash);

  if (!user) {
    const error = new Error("This verification link is invalid.");
    error.status = 400;
    throw error;
  }

  const tokenRecord = db.prepare(`
    SELECT verification_expires_at
    FROM users
    WHERE id = ?
  `).get(user.id);

  if (!tokenRecord?.verification_expires_at || new Date(tokenRecord.verification_expires_at).getTime() < Date.now()) {
    const error = new Error("This verification link has expired. Please request a new one.");
    error.status = 400;
    throw error;
  }

  db.prepare(`
    UPDATE users
    SET is_verified = 1,
        verification_token_hash = NULL,
        verification_expires_at = NULL,
        verified_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(user.id);

  return db.prepare(`
    SELECT id, name, email, role, status, is_verified
    FROM users
    WHERE id = ?
  `).get(user.id);
}
