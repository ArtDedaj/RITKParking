import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { createDatabase } from "../db.js";

export function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    const decoded = jwt.verify(header.slice(7), config.jwtSecret);

    const db = createDatabase();

    const user = db.prepare(
      "SELECT id, role FROM users WHERE id = ?"
    ).get(decoded.id);

    if (!user) {
      return res.status(401).json({
        message: "User no longer exists. Please log in again."
      });
    }

    req.user = user;
    next();

  } catch {
    res.status(401).json({ message: "Invalid or expired token." });
  }
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission for this action."
      });
    }
    next();
  };
}