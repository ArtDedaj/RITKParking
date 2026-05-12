import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

router.get("/settings", authenticate, authorize("security"), async (req, res, next) => {
  try {
    const [rows] = await req.db.execute("SELECT * FROM app_settings WHERE id = 1");
    res.json(rows[0] || null);
  } catch (error) {
    next(error);
  }
});

router.patch("/settings", authenticate, authorize("security"), async (req, res, next) => {
  try {
    const {
      studentMaxActiveReservations,
      studentMaxHours,
      staffMaxHours,
      defaultReservationMode
    } = req.body;

    if (defaultReservationMode !== undefined && !["pending", "approved"].includes(defaultReservationMode)) {
      return res.status(400).json({ message: "Default reservation mode must be pending or approved." });
    }

    await req.db.execute(
      `UPDATE app_settings
       SET student_max_active_reservations = COALESCE(?, student_max_active_reservations),
           student_max_hours               = COALESCE(?, student_max_hours),
           staff_max_hours                 = COALESCE(?, staff_max_hours),
           default_reservation_mode        = COALESCE(?, default_reservation_mode)
       WHERE id = 1`,
      [
        studentMaxActiveReservations ?? null,
        studentMaxHours ?? null,
        staffMaxHours ?? null,
        defaultReservationMode ?? null
      ]
    );

    const [rows] = await req.db.execute("SELECT * FROM app_settings WHERE id = 1");
    res.json(rows[0] || null);
  } catch (error) {
    next(error);
  }
});

router.get("/dashboard", authenticate, authorize("security"), async (req, res, next) => {
  try {
    const pick = async (sql) => {
      const [rows] = await req.db.execute(sql);
      return rows[0].count;
    };

    res.json({
      users:                await pick("SELECT COUNT(*) AS count FROM users"),
      activeStudents:       await pick("SELECT COUNT(*) AS count FROM users WHERE role = 'student' AND status = 'active'"),
      activeStaff:          await pick("SELECT COUNT(*) AS count FROM users WHERE role = 'staff'   AND status = 'active'"),
      totalSpots:           await pick("SELECT COUNT(*) AS count FROM parking_spots"),
      unavailableSpots:     await pick("SELECT COUNT(*) AS count FROM parking_spots WHERE is_available = 0"),
      pendingReservations:  await pick("SELECT COUNT(*) AS count FROM reservations WHERE status = 'pending'"),
      approvedReservations: await pick("SELECT COUNT(*) AS count FROM reservations WHERE status = 'approved'")
    });
  } catch (error) {
    next(error);
  }
});

router.get("/approvals", authenticate, authorize("security"), async (req, res, next) => {
  try {
    const [rows] = await req.db.execute(`
      SELECT reservations.*, users.name AS user_name, parking_spots.code AS spot_code
      FROM reservations
      JOIN users         ON users.id         = reservations.user_id
      JOIN parking_spots ON parking_spots.id = reservations.spot_id
      WHERE reservations.status = 'pending'
      ORDER BY reservations.start_time ASC
    `);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

export default router;
