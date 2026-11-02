import { format } from "date-fns";

// Saturday and Sunday are weekly holidays for everyone (matches backend is_weekend)
export const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;

// Set of "YYYY-MM-DD" public-holiday dates from /holidays/list
export const holidayDateSet = (holidays) => new Set((holidays || []).map(h => h.date));

// Weekend or public holiday: no login, no WFH, not counted as a leave day
export const isOffDay = (date, holidaySet) => isWeekend(date) || holidaySet.has(format(date, "yyyy-MM-dd"));
