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

function parseClockToMinutes(clockValue) {
  if (!clockValue || !/^\d{2}:\d{2}$/.test(clockValue)) {
    return null;
  }

  const [hours, minutes] = clockValue.split(":").map(Number);
  return hours * 60 + minutes;
}

function getUserApprovalMode(db, actor, settings) {
  const userRecord = db.prepare("SELECT approval_mode_override FROM users WHERE id = ?").get(actor.id);
  if (actor.role === "security") {
    return "approved";
  }

  if (userRecord?.approval_mode_override) {
    return userRecord.approval_mode_override;
  }

  if (settings.default_reservation_mode) {
    return settings.default_reservation_mode;
  }

  return settings.require_admin_approval ? "pending" : "approved";
}

function isLotTypeAllowed(actor, lotType) {
  if (!lotType) return true;
  if (actor.role === "security") return true;
  if (actor.role === "student") return lotType === "general";
  if (actor.role === "staff") return ["general", "staff"].includes(lotType);
  return false;
}

function findAvailableSpot(db, actor, lotType, startTime, endTime) {
  if (!isLotTypeAllowed(actor, lotType)) {
    throw httpError(403, "You do not have permission to reserve that parking lot.");
  }

  const spots = db.prepare(`
    SELECT *
    FROM parking_spots
    WHERE is_available = 1
      AND lot_type = ?
    ORDER BY
      CASE side WHEN 'left' THEN 1 WHEN 'right' THEN 2 ELSE 3 END,
      code
  `).all(lotType);

  const availableSpot = spots.find((spot) => !getConflictingReservation(db, spot.id, startTime, endTime));
  if (!availableSpot) {
    throw httpError(409, `No ${lotType} parking spots are available for that time.`);
  }

  return availableSpot;
}

function getRecurringConflicts(db, spotId, dayOfWeek, startTime, endTime) {
  const recurringReservations = db.prepare(`
    SELECT *
    FROM recurring_reservations
    WHERE spot_id = ?
      AND day_of_week = ?
      AND status = 'active'
  `).all(spotId, dayOfWeek);

  return recurringReservations.find((reservation) =>
    hasOverlap(reservation.start_time, reservation.end_time, startTime, endTime)
  );
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
  const { spotId, startTime, endTime, lotType, startClock, endClock } = payload;
  const settings = getSettings(db);
  const spot = spotId ? getSpot(db, spotId) : findAvailableSpot(db, actor, lotType || "general", startTime, endTime);

  if (!spot) {
    throw httpError(404, "Parking spot not found.");
  }

  if (!isLotTypeAllowed(actor, spot.lot_type)) {
    throw httpError(403, "You do not have permission to reserve that parking lot.");
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

  if (actor.role === "student") {
    const startMinutes = parseClockToMinutes(startClock);
    const endMinutes = parseClockToMinutes(endClock);

    if (startMinutes === null || endMinutes === null) {
      throw httpError(400, "Students must choose valid start and end times.");
    }

    if (startMinutes < 8 * 60 || endMinutes > 20 * 60 || startMinutes >= endMinutes) {
      throw httpError(400, "Students can only reserve between 08:00 and 20:00.");
    }

    if (startMinutes % 60 !== 0 || endMinutes % 60 !== 0) {
      throw httpError(400, "Student reservations must use whole-hour time slots.");
    }
  }

  if (actor.role === "student" && durationHours > settings.student_max_hours) {
    throw httpError(400, `Students may only reserve up to ${settings.student_max_hours} hours.`);
  }

  if (actor.role === "staff" && durationHours > settings.staff_max_hours) {
    throw httpError(400, `Staff may only reserve up to ${settings.staff_max_hours} hours.`);
  }

  if (actor.role === "student" && countActiveReservations(db, actor.id) >= settings.student_max_active_reservations) {
    throw httpError(400, `Students may only have ${settings.student_max_active_reservations} active reservations.`);
  }

  const conflictingReservation = getConflictingReservation(db, spot.id, startTime, endTime);
  if (conflictingReservation && actor.role !== "security") {
    throw httpError(409, "This parking spot is already booked for the selected time.");
  }

  const status = getUserApprovalMode(db, actor, settings);
  const result = db.prepare(`
    INSERT INTO reservations (user_id, spot_id, start_time, end_time, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(actor.id, spot.id, startTime, endTime, status);

  createAuditLog(db, actor.id, "reservation_created", "reservation", result.lastInsertRowid, JSON.stringify(payload));

  return db.prepare(`
    SELECT reservations.*, parking_spots.code AS spot_code, parking_spots.lot_type
    FROM reservations
    JOIN parking_spots ON parking_spots.id = reservations.spot_id
    WHERE reservations.id = ?
  `).get(result.lastInsertRowid);
}

export function createRecurringReservation(db, actor, payload) {
  if (!["staff", "security"].includes(actor.role)) {
    throw httpError(403, "Only staff and security can create recurring reservations.");
  }

  const { spotId, lotType = "general", dayOfWeek, startTime, endTime, semesterStart, semesterEnd, recurrenceType = "weekly" } = payload;
  const spot = spotId ? getSpot(db, spotId) : findAvailableSpot(db, actor, lotType, startTime, endTime);

  if (!spot) {
    throw httpError(404, "Parking spot not found.");
  }

  if (!isLotTypeAllowed(actor, spot.lot_type)) {
    throw httpError(403, "You do not have permission to reserve that parking lot.");
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

  if (getRecurringConflicts(db, spot.id, dayOfWeek, startTime, endTime)) {
    throw httpError(409, "This parking spot already has a recurring reservation for that time.");
  }

  const result = db.prepare(`
    INSERT INTO recurring_reservations
      (user_id, spot_id, day_of_week, start_time, end_time, semester_start, semester_end, recurrence_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(actor.id, spot.id, dayOfWeek, startTime, endTime, semesterStart, semesterEnd, recurrenceType);

  createAuditLog(db, actor.id, "recurring_reservation_created", "recurring_reservation", result.lastInsertRowid, JSON.stringify(payload));

  return db.prepare(`
    SELECT recurring_reservations.*, parking_spots.code AS spot_code, parking_spots.lot_type
    FROM recurring_reservations
    JOIN parking_spots ON parking_spots.id = recurring_reservations.spot_id
    WHERE recurring_reservations.id = ?
  `).get(result.lastInsertRowid);
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
