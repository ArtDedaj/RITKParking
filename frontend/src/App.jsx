import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

const navByRole = {
  student: ["map", "reservations", "profile"],
  staff: ["map", "reservations", "profile"],
  security: ["map", "admin", "reservations", "profile"]
};

const labels = {
  map: "Map",
  reservations: "My Bookings",
  profile: "Profile",
  admin: "Admin"
};

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function spotVisualStatus(spot) {
  if (!spot.is_available) return "unavailable";
  if (spot.current_reservation_status === "pending") return "pending";
  if (spot.current_reservation_status === "approved") return "reserved";
  return "available";
}

function formatDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLongDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function getNextTenDays() {
  return Array.from({ length: 10 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + index);

    return {
      value: formatDateValue(date),
      shortLabel: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      dayLabel: date.toLocaleDateString([], { weekday: "short" })
    };
  });
}

function getDayOfWeek(dateValue) {
  return new Date(`${dateValue}T12:00:00`).getDay();
}

function getMonday(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function getWeekdays(weekStart) {
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);

    return {
      value: formatDateValue(date),
      shortLabel: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      dayLabel: date.toLocaleDateString([], { weekday: "short" })
    };
  });
}

function getStoredSession() {
  const raw = localStorage.getItem("auk-user");
  return raw ? JSON.parse(raw) : null;
}

function saveSession(token, user) {
  localStorage.setItem("auk-token", token);
  localStorage.setItem("auk-user", JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem("auk-token");
  localStorage.removeItem("auk-user");
}

function SplashScreen({ onContinue }) {
  return (
    <div className="screen splash-screen">
      <div className="badge">AUK Faculty Parking</div>
      <h1>AUK Smart Parking System</h1>
      <p>Reserve faculty parking in seconds with a mobile-first experience.</p>
      <button className="primary-button" onClick={onContinue}>Enter App</button>
    </div>
  );
}

function AuthScreen({ mode, onModeChange, onAuthenticated }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const payload = mode === "register"
        ? await api.register(form)
        : await api.login({ email: form.email, password: form.password });

      saveSession(payload.token, payload.user);
      onAuthenticated(payload.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen auth-screen">
      <div className="hero-card">
        <span className="eyebrow">Faculty Reservation Portal</span>
        <h2>{mode === "register" ? "Create student account" : "Sign in"}</h2>
        <p>{mode === "register" ? "Students can self-register with an @auk.org email." : "Use your AUK account to continue."}</p>
      </div>

      <form className="panel form-panel" onSubmit={handleSubmit}>
        {mode === "register" ? (
          <label>
            Full name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
        ) : null}

        <label>
          Email
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>

        <label>
          Password
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </label>

        {error ? <div className="inline-message error">{error}</div> : null}

        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Please wait..." : mode === "register" ? "Register" : "Login"}
        </button>
      </form>

      <div className="panel note-panel">
        <p>{mode === "register" ? "Staff and security accounts are created by Security/Admin." : "Need a student account?"}</p>
        <button className="ghost-button" onClick={() => onModeChange(mode === "register" ? "login" : "register")}>
          {mode === "register" ? "Back to login" : "Register as student"}
        </button>
      </div>
    </div>
  );
}

function PhoneShell({ children, title }) {
  return (
    <div className="app-shell">
      <div className="phone-frame">
        <div className="phone-notch" />
        <div className="app-screen">
          {title ? (
            <header className="topbar">
              <div>
                <span className="eyebrow">AUK Smart Parking</span>
                <h1>{title}</h1>
              </div>
            </header>
          ) : null}
          <main className="content">{children}</main>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ value }) {
  return <span className={`status-pill status-${value}`}>{value}</span>;
}

function HomeScreen({ user, stats, settings, onQuickTab }) {
  const cards = user.role === "security"
    ? [
        { label: "Pending approvals", value: stats.pendingReservations ?? 0 },
        { label: "Available spots", value: (stats.totalSpots ?? 0) - (stats.unavailableSpots ?? 0) },
        { label: "Active users", value: stats.users ?? 0 }
      ]
    : [
        { label: "Active booking cap", value: settings.student_max_active_reservations ?? 5 },
        { label: "Today status", value: user.role === "staff" ? "Faculty access" : "Student access" },
        { label: "Booking mode", value: user.role === "staff" ? "Recurring enabled" : "Single slots" }
      ];

  return (
    <div className="screen">
      <div className="hero-card compact">
        <span className="eyebrow">Welcome back</span>
        <h2>{user.name}</h2>
        <p>{user.role === "security" ? "Manage approvals, spots, and user settings." : "Reserve a spot and manage your parking schedule."}</p>
      </div>

      <div className="card-grid">
        {cards.map((card) => (
          <div className="panel stat-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </div>

      <div className="panel action-panel">
        <h3>Quick actions</h3>
        <div className="action-stack">
          <button className="secondary-button" onClick={() => onQuickTab("map")}>Open parking map</button>
          <button className="secondary-button" onClick={() => onQuickTab("reservations")}>View reservations</button>
          {user.role === "security" ? <button className="secondary-button" onClick={() => onQuickTab("admin")}>Review admin tools</button> : null}
        </div>
      </div>
    </div>
  );
}

function ParkingMap({ spots, selectedSpotId, onSelect }) {
  const left = spots.filter((spot) => spot.side === "left");
  const right = spots.filter((spot) => spot.side === "right");
  const extras = spots.filter((spot) => spot.side === "entrance");

  return (
    <div className="map-shell">
      <div className="map-side">
        {left.map((spot) => (
          <button key={spot.id} className={`spot-card spot-${spotVisualStatus(spot)} ${selectedSpotId === spot.id ? "selected" : ""}`} onClick={() => onSelect(spot)}>
            <span>{spot.code}</span>
            <small>{spotVisualStatus(spot)}</small>
          </button>
        ))}
      </div>

      <div className="drive-lane">
        <span>Entrance</span>
        <div className="lane-line" />
        <div className="extra-row">
          {extras.map((spot) => (
            <button key={spot.id} className={`spot-card spot-${spotVisualStatus(spot)} compact ${selectedSpotId === spot.id ? "selected" : ""}`} onClick={() => onSelect(spot)}>
              <span>{spot.code}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="map-side">
        {right.map((spot) => (
          <button key={spot.id} className={`spot-card spot-${spotVisualStatus(spot)} ${selectedSpotId === spot.id ? "selected" : ""}`} onClick={() => onSelect(spot)}>
            <span>{spot.code}</span>
            <small>{spotVisualStatus(spot)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function WeekStrip({ dates, selectedDate, onSelect, onPreviousWeek, onNextWeek, canGoPrevious, todayValue }) {
  return (
    <div className="week-strip">
      <button className={`week-arrow ${!canGoPrevious ? "disabled" : ""}`} onClick={onPreviousWeek} disabled={!canGoPrevious}>
        ‹
      </button>
      <div className="date-strip" role="tablist" aria-label="Choose reservation date">
        {dates.map((date) => {
          const isPast = date.value < todayValue;
          return (
            <button
              key={date.value}
              className={`date-chip ${selectedDate === date.value ? "active" : ""} ${isPast ? "disabled" : ""}`}
              onClick={() => onSelect(date.value)}
              disabled={isPast}
            >
              <span>{date.dayLabel}</span>
              <strong>{date.shortLabel}</strong>
            </button>
          );
        })}
      </div>
      <button className="week-arrow" onClick={onNextWeek}>
        ›
      </button>
    </div>
  );
}

function SpotModal({
  user,
  spot,
  selectedDate,
  reservationForm,
  recurringForm,
  onReservationChange,
  onRecurringChange,
  onClose,
  onReserve,
  onCreateRecurring,
  onToggleAvailability,
  loading,
  message,
  error
}) {
  if (!spot) return null;

  const status = spotVisualStatus(spot);
  const isAvailable = status === "available";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <div>
            <h3>{spot.code}</h3>
            <p>{formatLongDate(selectedDate)} | {spot.side} side | {spot.type}</p>
          </div>
          <button className="icon-button" onClick={onClose}>Close</button>
        </div>

        <StatusPill value={status} />

        {!isAvailable ? (
          <div className="inline-message error">
            This spot is not currently open for reservation for the selected date.
          </div>
        ) : null}

        {error ? <div className="inline-message error">{error}</div> : null}
        {message ? <div className="inline-message success">{message}</div> : null}

        {isAvailable ? (
          <form className="stack-form" onSubmit={onReserve}>
            <h4>Choose your time slot</h4>
            <label>
              Start time
              <input
                type="time"
                step="1800"
                value={reservationForm.startClock}
                onChange={(event) => onReservationChange("startClock", event.target.value)}
              />
            </label>
            <label>
              End time
              <input
                type="time"
                step="1800"
                value={reservationForm.endClock}
                onChange={(event) => onReservationChange("endClock", event.target.value)}
              />
            </label>
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Saving..." : "Reserve spot"}
            </button>
          </form>
        ) : null}

        {isAvailable && user.role !== "student" ? (
          <form className="stack-form recurring-form" onSubmit={onCreateRecurring}>
            <h4>Recurring booking</h4>
            <label>
              Start time
              <input
                type="time"
                step="1800"
                value={recurringForm.startClock}
                onChange={(event) => onRecurringChange("startClock", event.target.value)}
              />
            </label>
            <label>
              End time
              <input
                type="time"
                step="1800"
                value={recurringForm.endClock}
                onChange={(event) => onRecurringChange("endClock", event.target.value)}
              />
            </label>
            <label>
              Semester start
              <input
                type="date"
                value={recurringForm.semesterStart}
                onChange={(event) => onRecurringChange("semesterStart", event.target.value)}
              />
            </label>
            <label>
              Semester end
              <input
                type="date"
                value={recurringForm.semesterEnd}
                onChange={(event) => onRecurringChange("semesterEnd", event.target.value)}
              />
            </label>
            <label>
              Recurrence type
              <select
                value={recurringForm.recurrenceType}
                onChange={(event) => onRecurringChange("recurrenceType", event.target.value)}
              >
                <option value="weekly">Weekly</option>
                <option value="semester">Semester-long</option>
              </select>
            </label>
            <button className="secondary-button" type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save recurring slot"}
            </button>
          </form>
        ) : null}

        {user.role === "security" ? (
          <button className="ghost-button full-width" onClick={onToggleAvailability}>
            {spot.is_available ? "Mark unavailable" : "Mark available"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MapScreen({ user, spots, onCreateReservation, onCreateRecurring, onUpdateSpot }) {
  const todayValue = useMemo(() => formatDateValue(new Date()), []);
  const currentWeekStart = useMemo(() => getMonday(new Date()), []);
  const initialWeekStart = useMemo(() => {
    const currentWeekDates = getWeekdays(currentWeekStart);
    if (currentWeekDates.some((date) => date.value >= todayValue)) {
      return currentWeekStart;
    }

    const nextWeek = new Date(currentWeekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek;
  }, [currentWeekStart, todayValue]);
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const weekDates = useMemo(() => getWeekdays(weekStart), [weekStart]);
  const [selectedDate, setSelectedDate] = useState(
    weekDates.find((date) => date.value >= todayValue)?.value || weekDates[0]?.value || formatDateValue(new Date())
  );
  const [mapSpots, setMapSpots] = useState(spots);
  const [activeSpot, setActiveSpot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reservationForm, setReservationForm] = useState({
    startClock: "08:00",
    endClock: user.role === "staff" ? "16:00" : "10:00"
  });
  const [recurringForm, setRecurringForm] = useState({
    startClock: "08:00",
    endClock: "16:00",
    semesterStart: weekDates[0]?.value || formatDateValue(new Date()),
    semesterEnd: weekDates[4]?.value || formatDateValue(new Date()),
    recurrenceType: "weekly"
  });

  useEffect(() => {
    if (selectedDate && recurringForm.semesterStart < selectedDate) {
      setRecurringForm((current) => ({ ...current, semesterStart: selectedDate }));
    }
  }, [selectedDate, recurringForm.semesterStart]);

  useEffect(() => {
    if (!weekDates.some((date) => date.value === selectedDate && date.value >= todayValue)) {
      setSelectedDate(
        weekDates.find((date) => date.value >= todayValue)?.value ||
        weekDates[0]?.value ||
        selectedDate
      );
    }
  }, [weekDates, selectedDate, todayValue]);

  useEffect(() => {
    setMapSpots(spots);
  }, [spots]);

  useEffect(() => {
    if (!activeSpot) return;
    const updatedSpot = mapSpots.find((spot) => spot.id === activeSpot.id);
    if (updatedSpot) {
      setActiveSpot(updatedSpot);
    }
  }, [mapSpots, activeSpot]);

  async function refreshMapSpots(dateValue) {
    try {
      const nextSpots = await api.spots(dateValue);
      setMapSpots(nextSpots);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    if (selectedDate) {
      refreshMapSpots(selectedDate);
    }
  }, [selectedDate]);

  function handleDateSelect(value) {
    setSelectedDate(value);
    setMessage("");
    setError("");
    setActiveSpot(null);
  }

  function handleSpotSelect(spot) {
    setActiveSpot(spot);
    setMessage("");
    setError("");
  }

  async function reserveSpot(event) {
    event.preventDefault();
    if (!activeSpot || !selectedDate) return;

    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response = await onCreateReservation({
        spotId: activeSpot.id,
        startTime: new Date(`${selectedDate}T${reservationForm.startClock}`).toISOString(),
        endTime: new Date(`${selectedDate}T${reservationForm.endClock}`).toISOString()
      });
      await refreshMapSpots(selectedDate);
      setMessage(`Reservation saved as ${response.status}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function reserveRecurring(event) {
    event.preventDefault();
    if (!activeSpot || !selectedDate) return;

    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response = await onCreateRecurring({
        spotId: activeSpot.id,
        dayOfWeek: getDayOfWeek(selectedDate),
        startTime: new Date(`${selectedDate}T${recurringForm.startClock}`).toISOString(),
        endTime: new Date(`${selectedDate}T${recurringForm.endClock}`).toISOString(),
        semesterStart: recurringForm.semesterStart,
        semesterEnd: recurringForm.semesterEnd,
        recurrenceType: recurringForm.recurrenceType
      });
      await refreshMapSpots(selectedDate);
      setMessage(`Recurring ${response.recurrence_type} reservation created.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleAvailability() {
    if (!activeSpot) return;
    try {
      const updated = await onUpdateSpot(activeSpot.id, {
        isAvailable: !activeSpot.is_available,
        notes: activeSpot.is_available ? "Marked unavailable by security." : "Reopened for reservations."
      });
      await refreshMapSpots(selectedDate);
      setActiveSpot(updated);
      setMessage(`Spot ${updated.code} updated.`);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function goToPreviousWeek() {
    const previous = new Date(weekStart);
    previous.setDate(weekStart.getDate() - 7);
    if (previous < currentWeekStart) {
      return;
    }
    setWeekStart(previous);
    setActiveSpot(null);
  }

  function goToNextWeek() {
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + 7);
    setWeekStart(next);
    setActiveSpot(null);
  }

  const canGoPrevious = weekStart.getTime() > currentWeekStart.getTime();

  return (
    <div className="screen">
      <div className="panel minimal-panel">
        <WeekStrip
          dates={weekDates}
          selectedDate={selectedDate}
          onSelect={handleDateSelect}
          onPreviousWeek={goToPreviousWeek}
          onNextWeek={goToNextWeek}
          canGoPrevious={canGoPrevious}
          todayValue={todayValue}
        />

        <div className="selected-date-banner">
          <strong>{selectedDate ? formatLongDate(selectedDate) : "Choose a date"}</strong>
        </div>

        <div className="map-stage">
          <ParkingMap spots={mapSpots} selectedSpotId={activeSpot?.id} onSelect={handleSpotSelect} />
        </div>
      </div>

      <SpotModal
        user={user}
        spot={activeSpot}
        selectedDate={selectedDate}
        reservationForm={reservationForm}
        recurringForm={recurringForm}
        onReservationChange={(key, value) => setReservationForm((current) => ({ ...current, [key]: value }))}
        onRecurringChange={(key, value) => setRecurringForm((current) => ({ ...current, [key]: value }))}
        onClose={() => {
          setActiveSpot(null);
          setMessage("");
          setError("");
        }}
        onReserve={reserveSpot}
        onCreateRecurring={reserveRecurring}
        onToggleAvailability={toggleAvailability}
        loading={loading}
        message={message}
        error={error}
      />
    </div>
  );
}

function ReservationList({ title, reservations, onCancel, showUser = false }) {
  return (
    <div className="panel">
      <div className="section-heading">
        <h3>{title}</h3>
        <p>{reservations.length} records</p>
      </div>
      <div className="reservation-list">
        {reservations.map((reservation) => (
          <div className="reservation-card" key={reservation.id}>
            <div>
              <strong>{reservation.spot_code}</strong>
              <p>{formatDateTime(reservation.start_time)} to {formatDateTime(reservation.end_time)}</p>
              {showUser && reservation.user_name ? <small>{reservation.user_name} | {reservation.user_role}</small> : null}
            </div>
            <div className="reservation-actions">
              <StatusPill value={reservation.status} />
              {onCancel && ["pending", "approved"].includes(reservation.status) ? <button className="mini-button" onClick={() => onCancel(reservation.id)}>Cancel</button> : null}
            </div>
          </div>
        ))}
        {!reservations.length ? <p className="empty-state">No reservations yet.</p> : null}
      </div>
    </div>
  );
}

function AdminScreen({ dashboard, users, approvals, settings, onApprove, onReject, onCreateUser, onSaveSettings, onCreateSpot, spots }) {
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "staff" });
  const [spotForm, setSpotForm] = useState({ code: "", side: "left", type: "standard", notes: "" });
  const [settingsForm, setSettingsForm] = useState({
    studentMaxActiveReservations: settings.student_max_active_reservations ?? 5,
    studentMaxHours: settings.student_max_hours ?? 6,
    staffMaxHours: settings.staff_max_hours ?? 12,
    requireAdminApproval: Boolean(settings.require_admin_approval)
  });

  useEffect(() => {
    setSettingsForm({
      studentMaxActiveReservations: settings.student_max_active_reservations ?? 5,
      studentMaxHours: settings.student_max_hours ?? 6,
      staffMaxHours: settings.staff_max_hours ?? 12,
      requireAdminApproval: Boolean(settings.require_admin_approval)
    });
  }, [settings]);

  return (
    <div className="screen">
      <div className="card-grid">
        {Object.entries({
          "Total users": dashboard.users,
          "Pending approvals": dashboard.pendingReservations,
          "Unavailable spots": dashboard.unavailableSpots,
          "Approved reservations": dashboard.approvedReservations
        }).map(([label, value]) => (
          <div className="panel stat-card" key={label}>
            <span>{label}</span>
            <strong>{value ?? 0}</strong>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="section-heading">
          <h3>Pending approvals</h3>
          <p>Review student and staff requests</p>
        </div>
        <div className="reservation-list">
          {approvals.map((reservation) => (
            <div className="reservation-card" key={reservation.id}>
              <div>
                <strong>{reservation.user_name} | {reservation.spot_code}</strong>
                <p>{formatDateTime(reservation.start_time)} to {formatDateTime(reservation.end_time)}</p>
              </div>
              <div className="action-row">
                <button className="mini-button success" onClick={() => onApprove(reservation.id)}>Approve</button>
                <button className="mini-button danger" onClick={() => onReject(reservation.id)}>Reject</button>
              </div>
            </div>
          ))}
          {!approvals.length ? <p className="empty-state">No pending approvals.</p> : null}
        </div>
      </div>

      <div className="panel">
        <h3>Create staff or security account</h3>
        <form className="stack-form" onSubmit={(e) => {
          e.preventDefault();
          onCreateUser(userForm);
          setUserForm({ name: "", email: "", password: "", role: "staff" });
        }}>
          <label>
            Name
            <input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
          </label>
          <label>
            Email
            <input value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
          </label>
          <label>
            Password
            <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
          </label>
          <label>
            Role
            <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
              <option value="staff">Staff</option>
              <option value="security">Security</option>
            </select>
          </label>
          <button className="secondary-button" type="submit">Create account</button>
        </form>
      </div>

      <div className="panel">
        <h3>Configuration</h3>
        <form className="stack-form" onSubmit={(e) => {
          e.preventDefault();
          onSaveSettings(settingsForm);
        }}>
          <label>
            Student max active reservations
            <input type="number" value={settingsForm.studentMaxActiveReservations} onChange={(e) => setSettingsForm({ ...settingsForm, studentMaxActiveReservations: Number(e.target.value) })} />
          </label>
          <label>
            Student max hours
            <input type="number" value={settingsForm.studentMaxHours} onChange={(e) => setSettingsForm({ ...settingsForm, studentMaxHours: Number(e.target.value) })} />
          </label>
          <label>
            Staff max hours
            <input type="number" value={settingsForm.staffMaxHours} onChange={(e) => setSettingsForm({ ...settingsForm, staffMaxHours: Number(e.target.value) })} />
          </label>
          <label className="toggle-label">
            <input type="checkbox" checked={settingsForm.requireAdminApproval} onChange={(e) => setSettingsForm({ ...settingsForm, requireAdminApproval: e.target.checked })} />
            Require admin approval
          </label>
          <button className="primary-button" type="submit">Save settings</button>
        </form>
      </div>

      <div className="panel">
        <h3>Add parking spot</h3>
        <form className="stack-form" onSubmit={(e) => {
          e.preventDefault();
          onCreateSpot({ ...spotForm, isAvailable: true });
          setSpotForm({ code: "", side: "left", type: "standard", notes: "" });
        }}>
          <label>
            Spot code
            <input value={spotForm.code} onChange={(e) => setSpotForm({ ...spotForm, code: e.target.value })} />
          </label>
          <label>
            Side
            <select value={spotForm.side} onChange={(e) => setSpotForm({ ...spotForm, side: e.target.value })}>
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="entrance">Entrance</option>
            </select>
          </label>
          <label>
            Type
            <input value={spotForm.type} onChange={(e) => setSpotForm({ ...spotForm, type: e.target.value })} />
          </label>
          <label>
            Notes
            <input value={spotForm.notes} onChange={(e) => setSpotForm({ ...spotForm, notes: e.target.value })} />
          </label>
          <button className="secondary-button" type="submit">Add spot</button>
        </form>
      </div>

      <div className="panel">
        <h3>Users</h3>
        <div className="user-list">
          {users.map((account) => (
            <div className="user-row" key={account.id}>
              <div>
                <strong>{account.name}</strong>
                <p>{account.email}</p>
              </div>
              <StatusPill value={account.role} />
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Spot inventory</h3>
        <div className="user-list">
          {spots.map((spot) => (
            <div className="user-row" key={spot.id}>
              <div>
                <strong>{spot.code}</strong>
                <p>{spot.side} | {spot.type}</p>
              </div>
              <StatusPill value={spotVisualStatus(spot)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [user, setUser] = useState(getStoredSession());
  const [activeTab, setActiveTab] = useState("map");
  const [spots, setSpots] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [recurringReservations, setRecurringReservations] = useState([]);
  const [users, setUsers] = useState([]);
  const [dashboard, setDashboard] = useState({});
  const [approvals, setApprovals] = useState([]);
  const [settings, setSettings] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadData(currentUser = user) {
    if (!currentUser) return;
    try {
      const [spotData, reservationData, recurringData] = await Promise.all([
        api.spots(),
        api.meReservations(),
        api.recurringReservations()
      ]);
      setSpots(spotData);
      setReservations(reservationData);
      setRecurringReservations(recurringData);

      if (currentUser.role === "security") {
        const [dashboardData, approvalsData, usersData, settingsData] = await Promise.all([
          api.dashboard(),
          api.approvals(),
          api.users(),
          api.settings()
        ]);
        setDashboard(dashboardData);
        setApprovals(approvalsData);
        setUsers(usersData);
        setSettings(settingsData);
      } else {
        setSettings(await api.publicSettings().catch(() => ({ student_max_active_reservations: 5 })));
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (user) {
      loadData(user);
      setActiveTab("map");
    }
  }, [user]);

  const visibleReservations = useMemo(() => reservations.filter((item) => ["pending", "approved"].includes(item.status)), [reservations]);
  const historyReservations = useMemo(() => reservations.filter((item) => ["rejected", "cancelled", "completed"].includes(item.status)), [reservations]);

  async function handleCreateReservation(payload) {
    setError("");
    const response = await api.createReservation(payload);
    setMessage("Reservation submitted.");
    await loadData();
    return response;
  }

  async function handleCreateRecurring(payload) {
    setError("");
    const response = await api.createRecurringReservation(payload);
    setMessage("Recurring reservation created.");
    await loadData();
    return response;
  }

  async function handleCancelReservation(id) {
    await api.cancelReservation(id);
    setMessage("Reservation cancelled.");
    await loadData();
  }

  async function handleApprove(id) {
    await api.updateReservationStatus(id, { status: "approved", approvalNote: "Approved by security." });
    setMessage("Reservation approved.");
    await loadData();
  }

  async function handleReject(id) {
    await api.updateReservationStatus(id, { status: "rejected", approvalNote: "Rejected by security." });
    setMessage("Reservation rejected.");
    await loadData();
  }

  async function handleCreateUser(payload) {
    await api.createUser(payload);
    setMessage("Account created.");
    await loadData();
  }

  async function handleSaveSettings(payload) {
    await api.updateSettings(payload);
    setMessage("Settings updated.");
    await loadData();
  }

  async function handleCreateSpot(payload) {
    await api.createSpot(payload);
    setMessage("Spot created.");
    await loadData();
  }

  async function handleUpdateSpot(id, payload) {
    const updated = await api.updateSpot(id, payload);
    setMessage("Spot updated.");
    await loadData();
    return updated;
  }

  function handleLogout() {
    clearSession();
    setUser(null);
    setSpots([]);
    setReservations([]);
    setRecurringReservations([]);
    setUsers([]);
    setApprovals([]);
    setDashboard({});
    setSettings({});
  }

  if (booting) {
    return (
      <PhoneShell>
        <SplashScreen onContinue={() => setBooting(false)} />
      </PhoneShell>
    );
  }

  if (!user) {
    return (
      <PhoneShell title={authMode === "register" ? "Create Account" : "Sign In"}>
        <AuthScreen mode={authMode} onModeChange={setAuthMode} onAuthenticated={setUser} />
      </PhoneShell>
    );
  }

  const tabs = navByRole[user.role];

  return (
    <PhoneShell title={labels[activeTab]}>
      {message ? <div className="banner success">{message}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      {activeTab === "map" ? <MapScreen user={user} spots={spots} onCreateReservation={handleCreateReservation} onCreateRecurring={handleCreateRecurring} onUpdateSpot={handleUpdateSpot} /> : null}
      {activeTab === "reservations" ? (
        <div className="screen">
          <ReservationList title="Active reservations" reservations={visibleReservations} onCancel={handleCancelReservation} showUser={user.role === "security"} />
          {recurringReservations.length ? <ReservationList title="Recurring reservations" reservations={recurringReservations.map((item) => ({ ...item, spot_code: item.spot_code, status: item.status }))} /> : null}
        </div>
      ) : null}
      {activeTab === "profile" ? (
        <div className="screen">
          <div className="panel">
            <h3>Profile</h3>
            <p><strong>Name:</strong> {user.name}</p>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Role:</strong> {user.role}</p>
          </div>

          <div className="panel">
            <h3>Booking privileges</h3>
            <p><strong>Active booking limit:</strong> {user.role === "student" ? `${settings.student_max_active_reservations ?? 5} active bookings` : "Not limited by student cap"}</p>
            <p><strong>Single reservation length:</strong> {user.role === "student" ? `${settings.student_max_hours ?? 6} hours max` : `${settings.staff_max_hours ?? 12} hours max`}</p>
            <p><strong>Recurring reservations:</strong> {user.role === "student" ? "Not available" : "Available"}</p>
            <p><strong>Approval rights:</strong> {user.role === "security" ? "Can approve and reject reservations" : "No approval access"}</p>
            <p><strong>Spot management:</strong> {user.role === "security" ? "Can manage parking spots" : "View and reserve only"}</p>
          </div>

          <div className="panel">
            <button className="primary-button full-width" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      ) : null}
      {activeTab === "admin" && user.role === "security" ? (
        <AdminScreen
          dashboard={dashboard}
          users={users}
          approvals={approvals}
          settings={settings}
          onApprove={handleApprove}
          onReject={handleReject}
          onCreateUser={handleCreateUser}
          onSaveSettings={handleSaveSettings}
          onCreateSpot={handleCreateSpot}
          spots={spots}
        />
      ) : null}

      <nav className="bottom-nav" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => (
          <button key={tab} className={tab === activeTab ? "active" : ""} onClick={() => setActiveTab(tab)}>
            {labels[tab]}
          </button>
        ))}
      </nav>
    </PhoneShell>
  );
}
