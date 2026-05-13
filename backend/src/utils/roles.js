function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

export function isAdminRole(role) {
  const normalized = normalizeRole(role);
  return normalized.includes("security") || normalized.includes("admin");
}

export function isStaffLikeRole(role) {
  const normalized = normalizeRole(role);
  return normalized.includes("staff") || normalized.includes("professor");
}

export function isStudentRole(role) {
  return normalizeRole(role).includes("student");
}

export function isStudentRoleLevel1(role) {
  const normalized = normalizeRole(role);
  return normalized === "student role 1";
}

export function roleSortWeight(role) {
  if (isAdminRole(role)) return 1;
  if (isStaffLikeRole(role)) return 2;
  if (isStudentRole(role)) return 3;
  return 4;
}

export function defaultRoleRules(roleName) {
  const role = normalizeRole(roleName);

  if (isAdminRole(role)) {
    return {
      maxDaysAhead: 30,
      maxDailyActiveReservations: null,
      maxReservationHours: null,
      approvalMode: "approved",
      roleDescription: "Admin/security role with full controls."
    };
  }

  if (role === "student role 1") {
    return {
      maxDaysAhead: 10,
      maxDailyActiveReservations: 2,
      maxReservationHours: 2,
      approvalMode: "pending",
      roleDescription: "Default student level. Up to 2 active daily reservations, 2 hours max each."
    };
  }

  if (role === "student role 2") {
    return {
      maxDaysAhead: 14,
      maxDailyActiveReservations: 3,
      maxReservationHours: 3,
      approvalMode: "pending",
      roleDescription: "Student level 2 with extended planning window."
    };
  }

  if (role === "student role 3") {
    return {
      maxDaysAhead: 21,
      maxDailyActiveReservations: 4,
      maxReservationHours: 4,
      approvalMode: "pending",
      roleDescription: "Student level 3 with longer planning window."
    };
  }

  if (isStaffLikeRole(role)) {
    return {
      maxDaysAhead: 30,
      maxDailyActiveReservations: null,
      maxReservationHours: 12,
      approvalMode: "approved",
      roleDescription: "Staff/professor role with longer scheduling window."
    };
  }

  return {
    maxDaysAhead: 10,
    maxDailyActiveReservations: null,
    maxReservationHours: null,
    approvalMode: "approved",
    roleDescription: ""
  };
}
