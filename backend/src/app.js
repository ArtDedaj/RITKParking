import cors from "cors";
import express from "express";
import { createDatabase } from "./db.js";
import { config } from "./config.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import spotRoutes from "./routes/spotRoutes.js";
import reservationRoutes from "./routes/reservationRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp(options = {}) {
  const db = options.db || createDatabase(options.dbPath);
  const app = express();

  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.db = db;
    next();
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", authRoutes);
  app.use("/users", userRoutes);
  app.use("/spots", spotRoutes);
  app.use("/reservations", reservationRoutes);
  app.use("/admin", adminRoutes);
  app.use(errorHandler);

  return { app, db };
}
