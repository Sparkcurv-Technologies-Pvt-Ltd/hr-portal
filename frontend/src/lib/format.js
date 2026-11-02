// Convert decimal hours (e.g., 8.57) to "Xh Ym" format
export const formatHours = (decimalHours) => {
  if (!decimalHours) return "—";
  // Round to whole minutes first so 7.9997h shows "8h 0m", not "7h 60m"
  const totalMinutes = Math.round(decimalHours * 60);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
};

// "Jane Doe" -> "JD"
export const getInitials = (name) => {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
};
