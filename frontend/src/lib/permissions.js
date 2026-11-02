// Per-employee module access (View / Edit / Delete), granted by admins in Employees → Access.
// Keys match the admin sidebar tab ids and the backend's MODULES in app/core/permissions.py.
export const PERMISSION_MODULES = [
  { key: "employees", label: "Employees" },
  { key: "payroll", label: "Payroll & Payslips" },
  { key: "finance", label: "Income & Expense" },
  { key: "leaves", label: "Leave Requests" },
  { key: "wfh", label: "WFH Requests" },
  { key: "permissions", label: "Permission Requests" },
  { key: "change-requests", label: "Change Requests" },
  { key: "attendance", label: "Attendance" },
  { key: "org-chart", label: "Worker Tree" },
  { key: "policy", label: "Company Policy" },
  { key: "holidays", label: "Holidays" },
];

export const PERMISSION_ACTIONS = ["view", "edit", "delete"];

export const NO_ACCESS = { view: false, edit: false, delete: false };

// Flip one action, keeping the rules: Edit/Delete turn View on; turning View off clears all three
export function toggleAction(perm, action) {
  const cur = { ...NO_ACCESS, ...(perm || {}) };
  const next = { ...cur, [action]: !cur[action] };
  if (action !== "view" && next[action]) next.view = true;
  if (action === "view" && !next.view) { next.edit = false; next.delete = false; }
  return next;
}

// Roles that can hold management modules (nothing by default). The backend only reports grants
// that count: employees' only when a superadmin made them.
export const GRANTABLE_ROLES = ["manager", "employee"];

// Admins can do everything; others need the flag an admin saved in user.module_permissions.
// Edit or delete implies view.
export function canDo(user, module, action = "view") {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (!GRANTABLE_ROLES.includes(user.role)) return false;
  const perm = user.module_permissions?.[module];
  if (!perm) return false;
  if (action === "view") return !!(perm.view || perm.edit || perm.delete);
  return !!perm[action];
}

// True when the user can open at least one management module (non-admins an admin granted access)
export function hasAnyModuleAccess(user) {
  return PERMISSION_MODULES.some(m => canDo(user, m.key, "view"));
}
