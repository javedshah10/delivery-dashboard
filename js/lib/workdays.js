/** @param {string} iso YYYY-MM-DD */
function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** @param {Date} dt */
function formatISO(dt) {
  return dt.toISOString().slice(0, 10);
}

/** @param {Date} dt @param {'MON_FRI'|'SUN_THU'} workWeek */
export function isWorkDay(dt, workWeek) {
  const w = dt.getUTCDay();
  if (workWeek === 'MON_FRI') return w >= 1 && w <= 5;
  return w === 0 || (w >= 1 && w <= 4);
}

/**
 * @param {string} startISO
 * @param {'MON_FRI'|'SUN_THU'} workWeek
 * @param {string[]} holidays ISO dates
 * @param {number} n count of working days
 * @returns {string[]} date of Day 1..n (index 0 = day 1)
 */
export function workDates(startISO, workWeek, holidays, n) {
  const hol = new Set(holidays);
  const out = [];
  let cur = parseISO(startISO);
  while (out.length < n) {
    const iso = formatISO(cur);
    if (isWorkDay(cur, workWeek) && !hol.has(iso)) out.push(iso);
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
}

/**
 * @param {string} dateISO
 * @param {string} startISO
 * @param {'MON_FRI'|'SUN_THU'} workWeek
 * @param {string[]} holidays
 */
export function dayNumber(dateISO, startISO, workWeek, holidays) {
  const target = parseISO(dateISO);
  const start = parseISO(startISO);
  if (target < start) return 0;
  const hol = new Set(holidays);
  let n = 0;
  let cur = start;
  while (cur <= target) {
    const iso = formatISO(cur);
    if (isWorkDay(cur, workWeek) && !hol.has(iso)) {
      n += 1;
      if (iso === dateISO) return n;
    }
    cur = new Date(cur.getTime() + 86400000);
  }
  return n;
}
