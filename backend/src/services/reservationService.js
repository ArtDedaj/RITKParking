import { hasOverlap, isFutureRange, isHalfHourIncrement } from "../utils/time.js";

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getSettings(db) {
  return db.prepare("SELECT * FROM app_settings WHERE id = 1").get();
}

function countActiveReservations(db, userId) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM reservations
    WHERE user_id = ?
      AND status IN ('pending', 'approved')
      AND datetime(end_time) >= datetime('now')
  `).get(userId).count;
}

function getSpot(db, spotId) {
  return db.prepare("SELECT * FROM parking_spots WHERE id = ?").get(spotId);
}

function getConflictingReservation(db, spotId, startTime, endTime) {
  const reservations = db.prepare(`
    SELECT *
    FROM reservations
    WHERE spot_id = ?
      AND status IN ('pending', 'approved')
  `).all(spotId);

  return reservations.find((reservation) =>
    hasOverlap(reservation.start_time, reservation.end_time, startTime, endTime)
  );
}

function createAuditLog(db, actorUserId, action, entityType, entityId, details = "") {
  db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorUserId || null, action, entityType, entityId || null, details);
}

export function createReservation(db, actor, payload) {
  const { spotId, startTime, endTime } = payload;
  const settings = getSettings(db);
  const spot = getSpot(db, spotId);

  if (!spot) {
    throw httpError(404, "Parking spot not found.");
  }

  if (!spot.is_available) {
    throw httpError(400, "This parking spot is currently unavailable.");
  }

  if (!isFutureRange(startTime, endTime)) {
    throw httpError(400, "Reservation end time must be after start time.");
  }

  if (!isHalfHourIncrement(startTime) || !isHalfHourIncrement(endTime)) {
    throw httpError(400, "Reservations must use 30-minute increments.");
  }

  const durationHours =
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60);

  if (actor.role === "student" && durationHours > settings.student_max_hours) {
    throw httpError(400, `Students may only reserve up to ${settings.student_max_hours} hours.`);
  }

  if (actor.role === "staff" && durationHours > settings.staff_max_hours) {
    throw httpError(400, `Staff may only reserve up to ${settings.staff_max_hours} hours.`);
  }

  if (actor.role === "student" && countActiveReservations(db, actor.id) >= settings.student_max_active_reservations) {
    throw httpError(400, `Students may only have ${settings.student_max_active_reservations} active reservations.`);
  }

  const conflictingReservation = getConflictingReservation(db, spotId, startTime, endTime);
  if (conflictingReservation && actor.role !== "security") {
    throw httpError(409, "This parking spot is already booked for the selected time.");
  }

  const status = actor.role === "security" || !settings.require_admin_approval ? "approved" : "pending";
  const result = db.prepare(`
    INSERT INTO reservations (user_id, spot_id, start_time, end_time, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(actor.id, spotId, startTime, endTime, status);

  createAuditLog(db, actor.id, "reservation_created", "reservation", result.lastInsertRowid, JSON.stringify(payload));

  return db.prepare(`
    SELECT reservations.*, parking_spots.code AS spot_code
    FROM reservations
    JOIN parking_spots ON parking_spots.id = reservations.spot_id
    WHERE reservations.id = ?
  `).get(result.lastInsertRowid);
}

export function createRecurringReservation(db, actor, payload) {
  if (!["staff", "security"].includes(actor.role)) {
    throw httpError(403, "Only staff and security can create recurring reservations.");
  }

  const { spotId, dayOfWeek, startTime, endTime, semesterStart, semesterEnd, recurrenceType = "weekly" } = payload;
  const spot = getSpot(db, spotId);

  if (!spot) {
    throw httpError(404, "Parking spot not found.");
  }

  if (!spot.is_available) {
    throw httpError(400, "This parking spot is currently unavailable.");
  }

  if (!isFutureRange(startTime, endTime)) {
    throw httpError(400, "Recurring reservation end time must be after start time.");
  }

  if (new Date(semesterStart).getTime() >= new Date(semesterEnd).getTime()) {
    throw httpError(400, "Semester end date must be after semester start date.");
  }

  const result = db.prepare(`
    INSERT INTO recurring_reservations
      (user_id, spot_id, day_of_week, start_time, end_time, semester_start, semester_end, recurrence_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(actor.id, spotId, dayOfWeek, startTime, endTime, semesterStart, semesterEnd, recurrenceType);

  createAuditLog(db, actor.id, "recurring_reservation_created", "recurring_reservation", result.lastInsertRowid, JSON.stringify(payload));

  return db.prepare("SELECT * FROM recurring_reservations WHERE id = ?").get(result.lastInsertRowid);
}

export function updateReservationStatus(db, actor, reservationId, status, approvalNote = "") {
  if (actor.role !== "security") {
    throw httpError(403, "Only security can approve or reject reservations.");
  }

  const reservation = db.prepare("SELECT * FROM reservations WHERE id = ?").get(reservationId);
  if (!reservation) {
    throw httpError(404, "Reservation not found.");
  }

  db.prepare(`
    UPDATE reservations
    SET status = ?, approved_by = ?, approval_note = ?
    WHERE id = ?
  `).run(status, actor.id, approvalNote, reservationId);

  createAuditLog(db, actor.id, "reservation_status_updated", "reservation", reservationId, status);

  return db.prepare("SELECT * FROM reservations WHERE id = ?").get(reservationId);
}

export function cancelReservation(db, actor, reservationId) {
  const reservation = db.prepare("SELECT * FROM reservations WHERE id = ?").get(reservationId);
  if (!reservation) {
    throw httpError(404, "Reservation not found.");
  }

  if (actor.role !== "security" && reservation.user_id !== actor.id) {
    throw httpError(403, "You can only cancel your own reservations.");
  }

  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(reservationId);
  createAuditLog(db, actor.id, "reservation_cancelled", "reservation", reservationId);

  return db.prepare("SELECT * FROM reservations WHERE id = ?").get(reservationId);
}
