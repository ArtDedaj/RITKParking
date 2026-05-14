import { hasOverlap, isFutureRange, isHalfHourIncrement } from "../utils/time.js";
import { isAdminRole, isStaffLikeRole, isStudentRole, isStudentRoleLevel1 } from "../utils/roles.js";
import { sendMail } from "./mailService.js";
import Stripe from "stripe";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getSettings(db) {
  return db.prepare("SELECT * FROM app_settings WHERE id = 1").get();
}

function getUserRecord(db, userId) {
  return db.prepare(`
    SELECT
      users.id,
      users.role,
      users.is_verified,
      users.status,
      users.approval_mode_override,
      COALESCE(role_scheduling_rules.max_days_ahead, 10) AS max_days_ahead,
      role_scheduling_rules.max_daily_active_reservations,
      role_scheduling_rules.max_reservation_hours
    FROM users
    LEFT JOIN role_scheduling_rules ON role_scheduling_rules.role_name = users.role
    WHERE id = ?
  `).get(userId);
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
  const userRecord = db.prepare(`
    SELECT users.approval_mode_override, role_scheduling_rules.approval_mode
    FROM users
    LEFT JOIN role_scheduling_rules ON role_scheduling_rules.role_name = users.role
    WHERE users.id = ?
  `).get(actor.id);
  if (isAdminRole(actor.role)) {
    return "approved";
  }

  if (userRecord?.approval_mode) {
    return userRecord.approval_mode;
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
  if (isAdminRole(actor.role)) return true;
  if (isStudentRole(actor.role)) return lotType === "general";
  if (isStaffLikeRole(actor.role)) return ["general", "staff"].includes(lotType);
  return false;
}

function getRoleMaxDaysAhead(userRecord) {
  return Number(userRecord?.max_days_ahead || 10);
}

function getDayEndIso(dateValue) {
  return `${dateValue}T23:59:59.999Z`;
}

function validateDaysAheadLimit(actor, userRecord, startTime) {
  if (isAdminRole(actor.role)) {
    return;
  }

  const selectedDate = startTime.slice(0, 10);
  const maxDaysAhead = getRoleMaxDaysAhead(userRecord);
  const now = new Date();
  const latestAllowed = new Date(now);
  latestAllowed.setHours(23, 59, 59, 999);
  latestAllowed.setDate(latestAllowed.getDate() + maxDaysAhead);
  const selectedEnd = new Date(getDayEndIso(selectedDate));

  if (selectedEnd.getTime() > latestAllowed.getTime()) {
    throw httpError(400, `Your role can reserve up to ${maxDaysAhead} day(s) ahead.`);
  }
}

function countRoleLevelOneActiveReservationsForDay(db, userId, dateValue) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM reservations
    WHERE user_id = ?
      AND status IN ('pending', 'approved')
      AND date(start_time) = date(?)
  `).get(userId, dateValue).count;
}

function countActiveReservationsForDay(db, userId, dateValue) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM reservations
    WHERE user_id = ?
      AND status IN ('pending', 'approved')
      AND date(start_time) = date(?)
  `).get(userId, dateValue).count;
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

function notifyUserByEmail(db, userId, subject, text) {
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(userId);
  if (!user?.email) return;
  sendMail({ to: user.email, subject, text }).catch(() => {});
}

function ensureReservationAllowed(actor, userRecord) {
  if (userRecord?.status === "banned" && !isAdminRole(actor.role)) {
    throw httpError(403, "Your account is currently banned from making reservations.");
  }

  if (!isAdminRole(actor.role) && !userRecord?.is_verified) {
    throw httpError(403, "Verify your email before reserving a parking spot.");
  }
}

// ─── Stripe ────────────────────────────────────────────────────────────────

function countOccurrences(dayOfWeek, semesterStart, semesterEnd) {
  let count = 0;
  const current = new Date(semesterStart);
  const end = new Date(semesterEnd);

  while (current.getDay() !== Number(dayOfWeek)) {
    current.setDate(current.getDate() + 1);
  }

  while (current <= end) {
    count++;
    current.setDate(current.getDate() + 7);
  }

  return count;
}

export async function createRecurringInvoiceCheckout(db, recurringId) {
  const recurring = db.prepare("SELECT * FROM recurring_reservations WHERE id = ?").get(recurringId);
if (!recurring) {
  console.warn("No recurring reservation found for ID:", recurringId);
  return null;
}
  const slotHours =
    (new Date(`1970-01-01T${recurring.end_time}`) -
      new Date(`1970-01-01T${recurring.start_time}`)) /
    (1000 * 60 * 60);

  const occurrences = countOccurrences(
    recurring.day_of_week,
    recurring.semester_start,
    recurring.semester_end
  );

  const totalHours = occurrences * slotHours;
  const hourlyRate = 2; // €2/hr
  const amountCents = Math.round(totalHours * hourlyRate * 100);

  if (amountCents <= 0) throw new Error("Calculated amount is zero, nothing to charge");

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: "Parking Permit — Recurring Reservation",
            description: `${occurrences} session(s) × ${slotHours}h × €${hourlyRate}/hr`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    success_url: `${frontendUrl}/booking-summary/${recurringId}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/dashboard`,
    metadata: { recurring_id: String(recurringId) },
  });

  db.prepare(`
    UPDATE recurring_reservations
    SET payment_status    = 'pending',
        payment_url       = ?,
        total_amount      = ?,
        stripe_session_id = ?
    WHERE id = ?
  `).run(session.url, amountCents, session.id, recurringId);

  return { url: session.url, amount_total: amountCents, sessionId: session.id };
}

// ─── Exports ───────────────────────────────────────────────────────────────

export function createReservation(db, actor, payload) {
  const { spotId, startTime, endTime, lotType, startClock, endClock } = payload;
  const settings = getSettings(db);
  const userRecord = getUserRecord(db, actor.id);
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
  const durationMinutes =
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60);

  ensureReservationAllowed(actor, userRecord);

  if (!isAdminRole(actor.role) && durationMinutes < 60) {
    throw httpError(400, "Reservations must be at least 1 hour.");
  }

  if (isStudentRole(actor.role)) {
    const startMinutes = parseClockToMinutes(startClock);
    const endMinutes = parseClockToMinutes(endClock);

    if (startMinutes === null || endMinutes === null) {
      throw httpError(400, "Students must choose valid start and end times.");
    }

    if (startMinutes < 7 * 60 + 30 || endMinutes > 20 * 60 || startMinutes >= endMinutes) {
      throw httpError(400, "Students can only reserve between 07:30 and 20:00.");
    }

    if (startMinutes % 30 !== 0 || endMinutes % 30 !== 0) {
      throw httpError(400, "Student reservations must use 30-minute time slots.");
    }
  }

  validateDaysAheadLimit(actor, userRecord, startTime);

  const roleMaxHours = userRecord?.max_reservation_hours;
  if (roleMaxHours !== null && roleMaxHours !== undefined) {
    if (durationHours > Number(roleMaxHours)) {
      throw httpError(400, `Your role allows up to ${roleMaxHours} hour(s) per reservation.`);
    }
  } else if (isStudentRole(actor.role) && durationHours > settings.student_max_hours) {
    throw httpError(400, `Students may only reserve up to ${settings.student_max_hours} hours.`);
  } else if (isStaffLikeRole(actor.role) && durationHours > settings.staff_max_hours) {
    throw httpError(400, `Staff may only reserve up to ${settings.staff_max_hours} hours.`);
  }

  if (isStudentRole(actor.role) && countActiveReservations(db, actor.id) >= settings.student_max_active_reservations) {
    throw httpError(400, `Students may only have ${settings.student_max_active_reservations} active reservations.`);
  }

  const dailyRoleLimit = userRecord?.max_daily_active_reservations;
  if (dailyRoleLimit !== null && dailyRoleLimit !== undefined) {
    const dateValue = startTime.slice(0, 10);
    const activeForDay = countActiveReservationsForDay(db, actor.id, dateValue);
    if (activeForDay >= Number(dailyRoleLimit)) {
      throw httpError(400, `Your role can only have ${dailyRoleLimit} active reservation(s) per day.`);
    }
  } else if (isStudentRoleLevel1(actor.role)) {
    if (durationHours > 2) {
      throw httpError(400, "Student role 1 reservations are limited to 2 hours each.");
    }
    const dateValue = startTime.slice(0, 10);
    const activeForDay = countRoleLevelOneActiveReservationsForDay(db, actor.id, dateValue);
    if (activeForDay >= 2) {
      throw httpError(400, "Student role 1 can only have 2 active reservations per day.");
    }
  }

  const conflictingReservation = getConflictingReservation(db, spot.id, startTime, endTime);
  if (conflictingReservation && !isAdminRole(actor.role)) {
    throw httpError(409, "This parking spot is already booked for the selected time.");
  }

  const status = getUserApprovalMode(db, actor, settings);
  const result = db.prepare(`
    INSERT INTO reservations (user_id, spot_id, start_time, end_time, status,  recurring_group_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(actor.id, spot.id, startTime, endTime, status,  payload.recurringGroupId || null);

  createAuditLog(db, actor.id, "reservation_created", "reservation", result.lastInsertRowid, JSON.stringify(payload));
  notifyUserByEmail(
    db,
    actor.id,
    "AUK Parking: Reservation created",
    `Your reservation for spot ${spot.code} on ${startTime} to ${endTime} was created with status: ${status}.`
  );

  return db.prepare(`
    SELECT reservations.*, parking_spots.code AS spot_code, parking_spots.lot_type
    FROM reservations
    JOIN parking_spots ON parking_spots.id = reservations.spot_id
    WHERE reservations.id = ?
  `).get(result.lastInsertRowid);
}

export function createRecurringReservation(db, actor, payload) {
  if (!(isStaffLikeRole(actor.role) || isAdminRole(actor.role))) {
    throw httpError(403, "Only staff and security can create recurring reservations.");
  }

  const { spotId, lotType = "general", dayOfWeek, startTime, endTime, semesterStart, semesterEnd, recurrenceType = "weekly" } = payload;
  const userRecord = getUserRecord(db, actor.id);
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

  const durationMinutes =
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60);

  ensureReservationAllowed(actor, userRecord);

  if (!isAdminRole(actor.role) && durationMinutes < 60) {
    throw httpError(400, "Recurring reservations must be at least 1 hour.");
  }

  validateDaysAheadLimit(actor, userRecord, startTime);

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
  const recurringGroupId = result.lastInsertRowid;
  createAuditLog(db, actor.id, "recurring_reservation_created", "recurring_reservation", result.lastInsertRowid, JSON.stringify(payload));

  return db.prepare(`
    SELECT recurring_reservations.*, parking_spots.code AS spot_code, parking_spots.lot_type
    FROM recurring_reservations
    JOIN parking_spots ON parking_spots.id = recurring_reservations.spot_id
    WHERE recurring_reservations.id = ?
  `).get(result.lastInsertRowid);
}

export async function updateReservationStatus(db, actor, reservationId, status, approvalNote = "") {
  if (!isAdminRole(actor.role)) {
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

  // Generate Stripe checkout session stored on the recurring row.
  // We do NOT return it to the admin — the student picks it up via
  // payment_status = 'pending' on their next dashboard load.
// Generate Stripe checkout session stored on the recurring row.
// We do NOT return it to the admin — the student picks it up via
// payment_status = 'pending' on their next dashboard load.

const result = db.prepare(`
  INSERT INTO recurring_reservations
    (user_id, spot_id, day_of_week, start_time, end_time,
     semester_start, semester_end, recurrence_type, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  actor.id,
  spot.id,
  dayOfWeek,
  startTime,
  endTime,
  semesterStart,
  semesterEnd,
  recurrenceType,
  'active'
);

const recurringId = result.lastInsertRowid;


// immediately create Stripe session here
await createRecurringInvoiceCheckout(db, recurringId);

  createAuditLog(db, actor.id, "reservation_status_updated", "reservation", reservationId, status);
  notifyUserByEmail(
    db,
    reservation.user_id,
    "AUK Parking: Reservation status updated",
    `Your reservation #${reservationId} is now ${status}. ${approvalNote ? `Note: ${approvalNote}` : ""}`.trim()
  );

  return db.prepare("SELECT * FROM reservations WHERE id = ?").get(reservationId);
}

export async function cancelReservation(db, actor, reservationId) {
  const reservation = db.prepare("SELECT * FROM reservations WHERE id = ?").get(reservationId);
  if (!reservation) {
    throw httpError(404, "Reservation not found.");
  }

  if (!isAdminRole(actor.role) && reservation.user_id !== actor.id) {
    throw httpError(403, "You can only cancel your own reservations.");
  }

  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(reservationId);

  // Student cancelled → charge full amount → return checkout URL so
  // frontend can redirect them to Stripe immediately.
let checkoutSession = null;

if (reservation.recurring_group_id) {
  try {
    checkoutSession = await createRecurringInvoiceCheckout(
      db,
      reservation.recurring_group_id
    );
  } catch (err) {
    console.error("Stripe checkout failed:", err.message);
    checkoutSession = null; // don’t crash cancel flow
  }
}

  createAuditLog(db, actor.id, "reservation_cancelled", "reservation", reservationId);
  notifyUserByEmail(
    db,
    reservation.user_id,
    "AUK Parking: Reservation cancelled",
    `Reservation #${reservationId} has been cancelled and the parking spot is now free for reuse.`
  );

  const updated = db.prepare("SELECT * FROM reservations WHERE id = ?").get(reservationId);
return {
  ...updated,
  checkoutSession: checkoutSession
    ? {
        url: checkoutSession.url,
        sessionId: checkoutSession.sessionId,
        amount: checkoutSession.amount_total
      }
    : null
};
}

