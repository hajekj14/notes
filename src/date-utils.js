const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDateParts(year, month, day) {
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

function getTodayString() {
  const now = new Date();
  return formatDateParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function parseDateInput(input) {
  const value = typeof input === "string" ? input.trim() : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);

  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return {
    value: formatDateParts(year, month, day),
    year: match[1],
    month: match[2],
    day: match[3]
  };
}

function normalizeYear(input) {
  const value = typeof input === "string" ? input.trim() : "";
  return /^\d{4}$/.test(value) ? value : null;
}

function normalizeMonth(input) {
  const value = typeof input === "string" ? input.trim() : "";

  if (!/^\d{1,2}$/.test(value)) {
    return null;
  }

  const numeric = Number(value);

  if (numeric < 1 || numeric > 12) {
    return null;
  }

  return pad(numeric);
}

function getMonthLabel(month) {
  const numeric = Number(month);

  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 12) {
    return month;
  }

  return MONTH_NAMES[numeric - 1];
}

function formatHumanDate(dateInput) {
  const parsedDate = typeof dateInput === "string" ? parseDateInput(dateInput) : dateInput;

  if (!parsedDate) {
    return "Unknown date";
  }

  return `${getMonthLabel(parsedDate.month)} ${Number(parsedDate.day)}, ${parsedDate.year}`;
}

function formatTimestamp(isoTimestamp) {
  if (!isoTimestamp) {
    return "Not saved yet.";
  }

  return `Last saved ${isoTimestamp.replace("T", " ").slice(0, 16)}`;
}

module.exports = {
  formatDateParts,
  formatHumanDate,
  formatTimestamp,
  getMonthLabel,
  getTodayString,
  normalizeMonth,
  normalizeYear,
  parseDateInput
};