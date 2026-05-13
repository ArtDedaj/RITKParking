import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { isAdminRole } from "../utils/roles.js";

export function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    const decoded = jwt.verify(header.slice(7), config.jwtSecret);
    const user = req.db.prepare(
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
    if (!req.user) {
      return res.status(403).json({ message: "You do not have permission for this action." });
    }

    const allowed = roles.map((role) => String(role).toLowerCase());
    const currentRole = String(req.user.role || "").toLowerCase();
    const hasAccess = allowed.includes(currentRole) || (allowed.includes("security") && isAdminRole(req.user.role));

    if (!hasAccess) {
      return res.status(403).json({ message: "You do not have permission for this action." });
    }
    next();
  };
}
