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
    requireAdminApproval,
    defaultReservationMode
  } = req.body;

  if (defaultReservationMode !== undefined && !["pending", "approved"].includes(defaultReservationMode)) {
    return res.status(400).json({ message: "Default reservation mode must be pending or approved." });
  }

  req.db.prepare(`
    UPDATE app_settings
    SET student_max_active_reservations = COALESCE(?, student_max_active_reservations),
        student_max_hours = COALESCE(?, student_max_hours),
        staff_max_hours = COALESCE(?, staff_max_hours),
        default_reservation_mode = COALESCE(?, default_reservation_mode),
        require_admin_approval = COALESCE(?, require_admin_approval),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    studentMaxActiveReservations ?? null,
    studentMaxHours ?? null,
    staffMaxHours ?? null,
    defaultReservationMode ?? null,
    requireAdminApproval === undefined ? null : Number(Boolean(requireAdminApproval))
  );

  res.json(req.db.prepare("SELECT * FROM app_settings WHERE id = 1").get());
});

router.get("/dashboard", authenticate, authorize("security"), (req, res) => {
  res.json({
    users: req.db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    activeStudents: req.db.prepare("SELECT COUNT(*) AS count FROM users WHERE lower(role) LIKE 'student%' AND status = 'active'").get().count,
    activeStaff: req.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'staff' AND status = 'active'").get().count,
    totalSpots: req.db.prepare("SELECT COUNT(*) AS count FROM parking_spots").get().count,
    unavailableSpots: req.db.prepare("SELECT COUNT(*) AS count FROM parking_spots WHERE is_available = 0").get().count,
    pendingReservations: req.db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE status = 'pending'").get().count,
    approvedReservations: req.db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE status = 'approved'").get().count
  });
});

router.get("/approvals", authenticate, authorize("security"), (req, res) => {
  const reservations = req.db.prepare(`
    SELECT reservations.*, users.name AS user_name, parking_spots.code AS spot_code, parking_spots.lot_type
    FROM reservations
    JOIN users ON users.id = reservations.user_id
    JOIN parking_spots ON parking_spots.id = reservations.spot_id
    WHERE reservations.status = 'pending'
    ORDER BY reservations.start_time ASC
  `).all();

  res.json(reservations);
});

router.get("/role-rules", authenticate, authorize("security"), (req, res) => {
  const rules = req.db.prepare(`
    SELECT role_name, max_days_ahead, max_daily_active_reservations, max_reservation_hours, approval_mode, role_description, updated_at
    FROM role_scheduling_rules
    WHERE lower(trim(role_name)) <> 'student'
    ORDER BY role_name ASC
  `).all();
  res.json(rules);
});

router.patch("/role-rules/:roleName", authenticate, authorize("security"), (req, res) => {
  const roleName = decodeURIComponent(req.params.roleName);
  const maxDaysAhead = Number(req.body?.maxDaysAhead);
  const maxDailyActiveReservations = req.body?.maxDailyActiveReservations;
  const maxReservationHours = req.body?.maxReservationHours;
  const approvalMode = req.body?.approvalMode;
  const roleDescription = req.body?.roleDescription;

  if (!Number.isFinite(maxDaysAhead) || maxDaysAhead < 0 || maxDaysAhead > 365) {
    return res.status(400).json({ message: "maxDaysAhead must be a number between 0 and 365." });
  }

  const dailyLimit = maxDailyActiveReservations === undefined || maxDailyActiveReservations === null || maxDailyActiveReservations === ""
    ? null
    : Number(maxDailyActiveReservations);
  const hourLimit = maxReservationHours === undefined || maxReservationHours === null || maxReservationHours === ""
    ? null
    : Number(maxReservationHours);

  if (dailyLimit !== null && (!Number.isFinite(dailyLimit) || dailyLimit < 0 || dailyLimit > 20)) {
    return res.status(400).json({ message: "maxDailyActiveReservations must be between 0 and 20, or empty." });
  }

  if (hourLimit !== null && (!Number.isFinite(hourLimit) || hourLimit < 1 || hourLimit > 24)) {
    return res.status(400).json({ message: "maxReservationHours must be between 1 and 24, or empty." });
  }
  if (approvalMode !== undefined && !["pending", "approved"].includes(String(approvalMode))) {
    return res.status(400).json({ message: "approvalMode must be pending or approved." });
  }

  req.db.prepare(`
    INSERT INTO role_scheduling_rules (
      role_name,
      max_days_ahead,
      max_daily_active_reservations,
      max_reservation_hours,
      approval_mode,
      role_description,
      updated_at
    )
    VALUES (?, ?, ?, ?, COALESCE(?, 'approved'), COALESCE(?, ''), CURRENT_TIMESTAMP)
    ON CONFLICT(role_name) DO UPDATE SET
      max_days_ahead = excluded.max_days_ahead,
      max_daily_active_reservations = excluded.max_daily_active_reservations,
      max_reservation_hours = excluded.max_reservation_hours,
      approval_mode = excluded.approval_mode,
      role_description = COALESCE(excluded.role_description, role_scheduling_rules.role_description),
      updated_at = CURRENT_TIMESTAMP
  `).run(roleName, maxDaysAhead, dailyLimit, hourLimit, approvalMode ?? null, roleDescription ?? null);

  const updated = req.db.prepare(`
    SELECT role_name, max_days_ahead, max_daily_active_reservations, max_reservation_hours, approval_mode, role_description, updated_at
    FROM role_scheduling_rules
    WHERE role_name = ?
  `).get(roleName);

  res.json(updated);
});

export default router;
