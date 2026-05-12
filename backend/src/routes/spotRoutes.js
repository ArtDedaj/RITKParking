import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

router.get("/public-settings", async (req, res, next) => {
  try {
    const [rows] = await req.db.execute(`
      SELECT student_max_active_reservations, student_max_hours, staff_max_hours, default_reservation_mode
      FROM app_settings WHERE id = 1
    `);
    res.json(rows[0] || null);
  } catch (error) {
    next(error);
  }
});

router.get("/", authenticate, async (req, res, next) => {
  try {
    const selectedDate = req.query.date ? String(req.query.date) : null;

    const spotsSql = selectedDate
      ? `SELECT
            parking_spots.*,
            (
              SELECT status FROM reservations
              WHERE reservations.spot_id = parking_spots.id
                AND reservations.status IN ('pending','approved')
                AND reservations.start_time < ?
                AND reservations.end_time   > ?
              ORDER BY reservations.start_time ASC
              LIMIT 1
            ) AS current_reservation_status
          FROM parking_spots
          ORDER BY CASE side WHEN 'left' THEN 1 WHEN 'right' THEN 2 ELSE 3 END, code`
      : `SELECT
            parking_spots.*,
            (
              SELECT status FROM reservations
              WHERE reservations.spot_id = parking_spots.id
                AND reservations.status IN ('pending','approved')
                AND reservations.end_time >= ?
              ORDER BY reservations.start_time ASC
              LIMIT 1
            ) AS current_reservation_status
          FROM parking_spots
          ORDER BY CASE side WHEN 'left' THEN 1 WHEN 'right' THEN 2 ELSE 3 END, code`;

    const params = selectedDate
      ? [`${selectedDate}T23:59:59.999Z`, `${selectedDate}T00:00:00.000Z`]
      : [new Date().toISOString()];

    const [rows] = await req.db.execute(spotsSql, params);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post("/", authenticate, authorize("security"), async (req, res, next) => {
  try {
    const { code, side, type = "standard", lotType = "general", isAvailable = true, notes = "" } = req.body;
    const [result] = await req.db.execute(
      `INSERT INTO parking_spots (code, side, type, lot_type, is_available, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, side, type, lotType, isAvailable ? 1 : 0, notes]
    );
    const [rows] = await req.db.execute("SELECT * FROM parking_spots WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", authenticate, authorize("security"), async (req, res, next) => {
  try {
    const { isAvailable, notes, type, lotType } = req.body;
    await req.db.execute(
      `UPDATE parking_spots
       SET is_available = COALESCE(?, is_available),
           notes        = COALESCE(?, notes),
           type         = COALESCE(?, type),
           lot_type     = COALESCE(?, lot_type)
       WHERE id = ?`,
      [
        isAvailable === undefined ? null : Number(Boolean(isAvailable)),
        notes ?? null,
        type ?? null,
        lotType ?? null,
        req.params.id
      ]
    );
    const [rows] = await req.db.execute("SELECT * FROM parking_spots WHERE id = ?", [req.params.id]);
    res.json(rows[0] || null);
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", authenticate, authorize("security"), async (req, res, next) => {
  try {
    await req.db.execute("DELETE FROM parking_spots WHERE id = ?", [req.params.id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
