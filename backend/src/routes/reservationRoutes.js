import express from "express";
import { authenticate } from "../middleware/auth.js";
import { isAdminRole } from "../utils/roles.js";
import {
  cancelReservation,
  createRecurringReservation,
  createReservation,
  updateReservationStatus,
  createRecurringInvoiceCheckout
} from "../services/reservationService.js";

const router = express.Router();

// Stripe - create recurring payment session
router.post("/create-recurring-payment", authenticate, async (req, res) => {
  const { recurringId } = req.body;

  try {
    const session = await createRecurringInvoiceCheckout(req.db, recurringId);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stripe - payment success callback
router.post("/recurring/payment-success", authenticate, (req, res) => {
  const { recurringId } = req.body;

  try {
    req.db.prepare(`
      UPDATE recurring_reservations
      SET payment_status = 'paid'
      WHERE id = ?
    `).run(recurringId);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", authenticate, (req, res) => {
  const isSecurity = isAdminRole(req.user.role);
  const reservations = isSecurity
    ? req.db.prepare(`
        SELECT reservations.*, users.name AS user_name, users.role AS user_role, parking_spots.code AS spot_code, parking_spots.lot_type
        FROM reservations
        JOIN users ON users.id = reservations.user_id
        JOIN parking_spots ON parking_spots.id = reservations.spot_id
        ORDER BY reservations.start_time DESC
      `).all()
    : req.db.prepare(`
        SELECT reservations.*, parking_spots.code AS spot_code, parking_spots.lot_type
        FROM reservations
        JOIN parking_spots ON parking_spots.id = reservations.spot_id
        WHERE reservations.user_id = ?
        ORDER BY reservations.start_time DESC
      `).all(req.user.id);

  res.json(reservations);
});

router.post("/", authenticate, (req, res, next) => {
  try {
    const reservation = createReservation(req.db, req.user, req.body);
    res.status(201).json(reservation);
  } catch (error) {
    next(error);
  }
});

router.post("/recurring", authenticate, (req, res, next) => {
  try {
    const recurringReservation = createRecurringReservation(req.db, req.user, req.body);
    res.status(201).json(recurringReservation);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/status", authenticate, async (req, res, next) => {
  try {
    const reservation = await updateReservationStatus(
      req.db,
      req.user,
      Number(req.params.id),
      req.body.status,
      req.body.approvalNote || ""
    );
    res.json(reservation);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/cancel", authenticate, async (req, res, next) => {
  try {
    const reservation = await cancelReservation(req.db, req.user, Number(req.params.id));
    res.json(reservation);
  } catch (error) {
    next(error);
  }
});

router.get("/recurring/list", authenticate, (req, res) => {
  const rows = isAdminRole(req.user.role)
    ? req.db.prepare(`
        SELECT recurring_reservations.*, parking_spots.code AS spot_code, parking_spots.lot_type, users.name AS user_name
        FROM recurring_reservations
        JOIN parking_spots ON parking_spots.id = recurring_reservations.spot_id
        JOIN users ON users.id = recurring_reservations.user_id
        ORDER BY recurring_reservations.created_at DESC
      `).all()
    : req.db.prepare(`
        SELECT recurring_reservations.*, parking_spots.code AS spot_code, parking_spots.lot_type
        FROM recurring_reservations
        JOIN parking_spots ON parking_spots.id = recurring_reservations.spot_id
        WHERE recurring_reservations.user_id = ?
        ORDER BY recurring_reservations.created_at DESC
      `).all(req.user.id);

  res.json(rows);
});

export default router;