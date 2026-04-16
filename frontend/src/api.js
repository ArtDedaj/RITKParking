const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

async function request(path, options = {}) {
  const token = localStorage.getItem("auk-token");
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

export const api = {
  login: (payload) => request("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  register: (payload) => request("/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  meReservations: () => request("/reservations"),
  recurringReservations: () => request("/reservations/recurring/list"),
  createReservation: (payload) => request("/reservations", { method: "POST", body: JSON.stringify(payload) }),
  createRecurringReservation: (payload) => request("/reservations/recurring", { method: "POST", body: JSON.stringify(payload) }),
  cancelReservation: (id) => request(`/reservations/${id}/cancel`, { method: "PATCH" }),
  spots: (date) => request(date ? `/spots?date=${encodeURIComponent(date)}` : "/spots"),
  publicSettings: () => request("/spots/public-settings"),
  users: () => request("/users"),
  createUser: (payload) => request("/users", { method: "POST", body: JSON.stringify(payload) }),
  updateUserApprovalMode: (id, payload) => request(`/users/${id}/approval-mode`, { method: "PATCH", body: JSON.stringify(payload) }),
  createSpot: (payload) => request("/spots", { method: "POST", body: JSON.stringify(payload) }),
  deleteSpot: (id) => request(`/spots/${id}`, { method: "DELETE" }),
  dashboard: () => request("/admin/dashboard"),
  approvals: () => request("/admin/approvals"),
  updateReservationStatus: (id, payload) => request(`/reservations/${id}/status`, { method: "PATCH", body: JSON.stringify(payload) }),
  settings: () => request("/admin/settings"),
  updateSettings: (payload) => request("/admin/settings", { method: "PATCH", body: JSON.stringify(payload) }),
  updateSpot: (id, payload) => request(`/spots/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
};
