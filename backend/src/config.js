import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

export const config = {
  port: Number(process.env.PORT_TUTORIAL || 5000),
  jwtSecret: process.env.JWT_SECRET || "change-this-secret",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",

  db: {
    host:     process.env.MYSQL_HOST     || "127.0.0.1",
    port:     Number(process.env.MYSQL_PORT || 3306),
    user:     process.env.MYSQL_USER     || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "auk_parking_tutorial"
  }
};
