import nodemailer from "nodemailer";
import { config } from "../config.js";

let transporter;

function hasSmtpConfig() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return false;
  }

  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
}

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  if (hasSmtpConfig()) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass
      }
    });
    return transporter;
  }

  transporter = nodemailer.createTransport({
    jsonTransport: true
  });
  return transporter;
}

export async function sendMail(message) {
  const info = await getTransporter().sendMail({
    from: config.smtpFrom,
    ...message
  });

  return {
    configured: hasSmtpConfig(),
    info
  };
}
