import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";

const router = express.Router();

router.get("/settings", authenticate, authorize("security"), (req, res) => {
  res.json(req.db.prepare("SELECT * FROM app_settings WHERE id = 1").get());
});

router.patch("/settings", authenticate, authorize("security"), (req, res) => {
  const {
    studentMaxActiveReservations,
    studentMaxHours,
    staffMaxHours,
    requireAdminApproval
  } = req.body;

  req.db.prepare(`
    UPDATE app_settings
    SET student_max_active_reservations = COALESCE(?, student_max_active_reservations),
        student_max_hours = COALESCE(?, student_max_hours),
        staff_max_hours = COALESCE(?, staff_max_hours),
        require_admin_approval = COALESCE(?, require_admin_approval),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    studentMaxActiveReservations ?? null,
    studentMaxHours ?? null,
    staffMaxHours ?? null,
    requireAdminApproval === undefined ? null : Number(Boolean(requireAdminApproval))
  );

  res.json(req.db.prepare("SELECT * FROM app_settings WHERE id = 1").get());
});

router.get("/dashboard", authenticate, authorize("security"), (req, res) => {
  res.json({
    users: req.db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    activeStudents: req.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'student' AND status = 'active'").get().count,
    activeStaff: req.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'staff' AND status = 'active'").get().count,
    totalSpots: req.db.prepare("SELECT COUNT(*) AS count FROM parking_spots").get().count,
    unavailableSpots: req.db.prepare("SELECT COUNT(*) AS count FROM parking_spots WHERE is_available = 0").get().count,
    pendingReservations: req.db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE status = 'pending'").get().count,
    approvedReservations: req.db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE status = 'approved'").get().count
  });
});

router.get("/approvals", authenticate, authorize("security"), (req, res) => {
  const reservations = req.db.prepare(`
    SELECT reservations.*, users.name AS user_name, parking_spots.code AS spot_code
    FROM reservations
    JOIN users ON users.id = reservations.user_id
    JOIN parking_spots ON parking_spots.id = reservations.spot_id
    WHERE reservations.status = 'pending'
    ORDER BY reservations.start_time ASC
  `).all();

  res.json(reservations);
});

export default router;
