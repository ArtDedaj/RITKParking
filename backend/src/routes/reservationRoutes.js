import express from "express";
import { authenticate } from "../middleware/auth.js";
import {
  cancelReservation,
  createReservation,
  updateReservationStatus
} from "../services/reservationService.js";

const router = express.Router();

router.get("/recurring/list", authenticate, async (req, res) => {
  res.json([]);
});

router.get("/", authenticate, async (req, res, next) => {
  try {
    const isSecurity = req.user.role === "security";
    const [rows] = isSecurity
      ? await req.db.execute(`
          SELECT reservations.*, users.name AS user_name, users.role AS user_role, parking_spots.code AS spot_code
          FROM reservations
          JOIN users         ON users.id         = reservations.user_id
          JOIN parking_spots ON parking_spots.id = reservations.spot_id
          ORDER BY reservations.start_time DESC
        `)
      : await req.db.execute(`
          SELECT reservations.*, parking_spots.code AS spot_code
          FROM reservations
          JOIN parking_spots ON parking_spots.id = reservations.spot_id
          WHERE reservations.user_id = ?
          ORDER BY reservations.start_time DESC
        `, [req.user.id]);

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post("/", authenticate, async (req, res, next) => {
  try {
    res.status(201).json(await createReservation(req.db, req.user, req.body));
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
    res.json(await cancelReservation(req.db, req.user, Number(req.params.id)));
  } catch (error) {
    next(error);
  }
});

export default router;
