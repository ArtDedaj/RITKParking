import { hasOverlap, isFutureRange, isHalfHourIncrement } from "../utils/time.js";

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function getSettings(db) {
  const [rows] = await db.execute("SELECT * FROM app_settings WHERE id = 1");
  return rows[0];
}

async function getUserRecord(db, userId) {
  const [rows] = await db.execute("SELECT id, role, is_verified FROM users WHERE id = ?", [userId]);
  return rows[0];
}

async function getSpot(db, spotId) {
  const [rows] = await db.execute("SELECT * FROM parking_spots WHERE id = ?", [spotId]);
  return rows[0];
}

async function countActiveReservations(db, userId) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS count
     FROM reservations
     WHERE user_id = ?
       AND status IN ('pending','approved')
       AND end_time >= ?`,
    [userId, new Date().toISOString()]
  );
  return rows[0].count;
}

function isLotTypeAllowed(actor, lotType) {
  if (!lotType) return true;
  if (actor.role === "security") return true;
  if (actor.role === "student") return lotType === "general";
  if (actor.role === "staff") return ["general", "staff"].includes(lotType);
  return false;
}

async function getConflictingReservation(db, spotId, startTime, endTime) {
  const [rows] = await db.execute(
    `SELECT * FROM reservations
     WHERE spot_id = ? AND status IN ('pending','approved')`,
    [spotId]
  );
  return rows.find((r) => hasOverlap(r.start_time, r.end_time, startTime, endTime));
}

function parseClockToMinutes(clockValue) {
  if (!clockValue || !/^\d{2}:\d{2}$/.test(clockValue)) return null;
  const [hours, minutes] = clockValue.split(":").map(Number);
  return hours * 60 + minutes;
}

async function findAvailableSpot(db, actor, lotType, startTime, endTime) {
  if (!isLotTypeAllowed(actor, lotType)) {
    throw httpError(403, "You do not have permission to reserve that parking lot.");
  }

  const [spots] = await db.execute(
    `SELECT * FROM parking_spots
     WHERE is_available = 1 AND lot_type = ?
     ORDER BY CASE side WHEN 'left' THEN 1 WHEN 'right' THEN 2 ELSE 3 END, code`,
    [lotType]
  );

  for (const spot of spots) {
    const conflict = await getConflictingReservation(db, spot.id, startTime, endTime);
    if (!conflict) return spot;
  }
  throw httpError(409, `No ${lotType} parking spots are available for that time.`);
}

export async function createReservation(db, actor, payload) {
  const { spotId, startTime, endTime, lotType, startClock, endClock } = payload;
  const settings = await getSettings(db);
  const userRecord = await getUserRecord(db, actor.id);
  const spot = spotId
    ? await getSpot(db, spotId)
    : await findAvailableSpot(db, actor, lotType || "general", startTime, endTime);

  if (!spot) throw httpError(404, "Parking spot not found.");
  if (!isLotTypeAllowed(actor, spot.lot_type)) {
    throw httpError(403, "You do not have permission to reserve that parking lot.");
  }
  if (!spot.is_available) throw httpError(400, "This parking spot is currently unavailable.");
  if (!isFutureRange(startTime, endTime)) {
    throw httpError(400, "Reservation end time must be after start time.");
  }
  if (!isHalfHourIncrement(startTime) || !isHalfHourIncrement(endTime)) {
    throw httpError(400, "Reservations must use 30-minute increments.");
  }

  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  const durationHours = durationMs / (1000 * 60 * 60);
  const durationMinutes = durationMs / (1000 * 60);

  if (actor.role !== "security" && !userRecord?.is_verified) {
    throw httpError(403, "Verify your email before reserving a parking spot.");
  }
  if (actor.role !== "security" && durationMinutes < 90) {
    throw httpError(400, "Reservations must be at least 90 minutes.");
  }

  if (actor.role === "student") {
    const startMin = parseClockToMinutes(startClock);
    const endMin = parseClockToMinutes(endClock);
    if (startMin === null || endMin === null) {
      throw httpError(400, "Students must choose valid start and end times.");
    }
    if (startMin < 7 * 60 + 30 || endMin > 20 * 60 || startMin >= endMin) {
      throw httpError(400, "Students can only reserve between 07:30 and 20:00.");
    }
    if (startMin % 30 !== 0 || endMin % 30 !== 0) {
      throw httpError(400, "Student reservations must use 30-minute time slots.");
    }
    if (durationHours > settings.student_max_hours) {
      throw httpError(400, `Students may only reserve up to ${settings.student_max_hours} hours.`);
    }
    if ((await countActiveReservations(db, actor.id)) >= settings.student_max_active_reservations) {
      throw httpError(400, `Students may only have ${settings.student_max_active_reservations} active reservations.`);
    }
  }

  if (actor.role === "staff" && durationHours > settings.staff_max_hours) {
    throw httpError(400, `Staff may only reserve up to ${settings.staff_max_hours} hours.`);
  }

  const conflict = await getConflictingReservation(db, spot.id, startTime, endTime);
  if (conflict && actor.role !== "security") {
    throw httpError(409, "This parking spot is already booked for the selected time.");
  }

  const status = actor.role === "security" ? "approved" : settings.default_reservation_mode;
  const [result] = await db.execute(
    `INSERT INTO reservations (user_id, spot_id, start_time, end_time, status)
     VALUES (?, ?, ?, ?, ?)`,
    [actor.id, spot.id, startTime, endTime, status]
  );

  const [rows] = await db.execute(
    `SELECT reservations.*, parking_spots.code AS spot_code, parking_spots.lot_type
     FROM reservations
     JOIN parking_spots ON parking_spots.id = reservations.spot_id
     WHERE reservations.id = ?`,
    [result.insertId]
  );
  return rows[0];
}

export async function updateReservationStatus(db, actor, reservationId, status, approvalNote = "") {
  if (actor.role !== "security") {
    throw httpError(403, "Only security can approve or reject reservations.");
  }
  const [found] = await db.execute("SELECT * FROM reservations WHERE id = ?", [reservationId]);
  if (!found[0]) throw httpError(404, "Reservation not found.");

  await db.execute(
    "UPDATE reservations SET status = ?, approved_by = ?, approval_note = ? WHERE id = ?",
    [status, actor.id, approvalNote, reservationId]
  );

  const [rows] = await db.execute("SELECT * FROM reservations WHERE id = ?", [reservationId]);
  return rows[0];
}

export async function cancelReservation(db, actor, reservationId) {
  const [found] = await db.execute("SELECT * FROM reservations WHERE id = ?", [reservationId]);
  const reservation = found[0];
  if (!reservation) throw httpError(404, "Reservation not found.");
  if (actor.role !== "security" && reservation.user_id !== actor.id) {
    throw httpError(403, "You can only cancel your own reservations.");
  }
  await db.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ?", [reservationId]);
  const [rows] = await db.execute("SELECT * FROM reservations WHERE id = ?", [reservationId]);
  return rows[0];
}
