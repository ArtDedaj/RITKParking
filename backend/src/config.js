import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "change-this-secret",
  dbPath: process.env.DB_PATH || "./data/auk-parking.db",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173"
};
