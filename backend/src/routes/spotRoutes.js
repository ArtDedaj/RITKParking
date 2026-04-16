import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

router.get("/public-settings", (req, res) => {
  const settings = req.db.prepare("SELECT student_max_active_reservations, student_max_hours, staff_max_hours, require_admin_approval FROM app_settings WHERE id = 1").get();
  res.json(settings);
});

router.get("/", authenticate, (req, res) => {
  const selectedDate = req.query.date ? String(req.query.date) : null;
  const overlapStart = selectedDate ? `${selectedDate}T00:00:00.000Z` : null;
  const overlapEnd = selectedDate ? `${selectedDate}T23:59:59.999Z` : null;

  const spots = selectedDate
    ? req.db.prepare(`
        SELECT
          parking_spots.*,
          (
            SELECT status
            FROM reservations
            WHERE reservations.spot_id = parking_spots.id
              AND reservations.status IN ('pending', 'approved')
              AND datetime(reservations.start_time) < datetime(?)
              AND datetime(reservations.end_time) > datetime(?)
            ORDER BY reservations.start_time ASC
            LIMIT 1
          ) AS current_reservation_status
        FROM parking_spots
        ORDER BY
          CASE side WHEN 'left' THEN 1 WHEN 'right' THEN 2 ELSE 3 END,
          code
      `).all(overlapEnd, overlapStart)
    : req.db.prepare(`
        SELECT
          parking_spots.*,
          (
            SELECT status
            FROM reservations
            WHERE reservations.spot_id = parking_spots.id
              AND reservations.status IN ('pending', 'approved')
              AND datetime(reservations.end_time) >= datetime('now')
            ORDER BY reservations.start_time ASC
            LIMIT 1
          ) AS current_reservation_status
        FROM parking_spots
        ORDER BY
          CASE side WHEN 'left' THEN 1 WHEN 'right' THEN 2 ELSE 3 END,
          code
      `).all();

  res.json(spots);
});

router.post("/", authenticate, authorize("security"), (req, res) => {
  const { code, side, type = "standard", isAvailable = true, notes = "" } = req.body;
  const result = req.db.prepare(`
    INSERT INTO parking_spots (code, side, type, is_available, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(code, side, type, isAvailable ? 1 : 0, notes);
  const spot = req.db.prepare("SELECT * FROM parking_spots WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(spot);
});

router.delete("/:id", authenticate, authorize("security"), (req, res) => {
  req.db.prepare("DELETE FROM parking_spots WHERE id = ?").run(req.params.id);
  res.status(204).send();
});

router.patch("/:id", authenticate, authorize("security"), (req, res) => {
  const { isAvailable, notes, type } = req.body;
  req.db.prepare(`
    UPDATE parking_spots
    SET is_available = COALESCE(?, is_available),
        notes = COALESCE(?, notes),
        type = COALESCE(?, type)
    WHERE id = ?
  `).run(isAvailable === undefined ? null : Number(Boolean(isAvailable)), notes ?? null, type ?? null, req.params.id);

  const spot = req.db.prepare("SELECT * FROM parking_spots WHERE id = ?").get(req.params.id);
  res.json(spot);
});

export default router;
