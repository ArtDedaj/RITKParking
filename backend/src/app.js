import cors from "cors";
import express from "express";
import Stripe from "stripe";
import { createDatabase } from "./db.js";
import { config } from "./config.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import spotRoutes from "./routes/spotRoutes.js";
import reservationRoutes from "./routes/reservationRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { ensureDemoUsers } from "./seed.js";

export function createApp(options = {}) {
  const db = options.db || createDatabase(options.dbPath);
  if (options.bootstrapDemoUsers !== false) {
    ensureDemoUsers(db);
  }

  const app = express();

  app.use(cors({ origin: config.frontendUrl, credentials: true }));

  // Stripe webhook — must be before express.json() to receive raw body
 app.post(
  "/reservations/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let event;

    try {
      if (process.env.NODE_ENV === "test") {
        event = JSON.parse(req.body.toString());
      } else {
        const sig = req.headers["stripe-signature"];

        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      }
    } catch (err) {
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const recurringId = event.data.object.metadata?.recurring_id;

      if (recurringId) {
        db.prepare(`
          UPDATE recurring_reservations
          SET payment_status = 'paid'
          WHERE id = ?
        `).run(Number(recurringId));
      }
    }

    if (event.type === "checkout.session.expired") {
      const recurringId = event.data.object.metadata?.recurring_id;

      if (recurringId) {
        req.db.prepare(`
          UPDATE recurring_reservations
          SET payment_status = 'cancelled'
          WHERE id = ?
        `).run(Number(recurringId));
      }
    }

    res.json({ received: true });
  }
);

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