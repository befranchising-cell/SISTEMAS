/**
 * Recurrence engine — generates concrete dates from a recurrence configuration.
 * Used by both payment scheduling (§7) and operational routines (§12).
 *
 * All dates are handled as YYYY-MM-DD strings in local (business) time to avoid
 * timezone drift. A hard cap prevents runaway generation.
 */

const MAX_OCCURRENCES = 730; // ~2 years of daily occurrences

function toDate(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDays(date, n) {
  const c = new Date(date);
  c.setDate(c.getDate() + n);
  return c;
}
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Applies the weekend/holiday adjustment strategy.
 *   'anticipate' -> move earlier to the previous business day
 *   'postpone'   -> move later to the next business day
 *   'keep'       -> leave as is
 */
function adjust(date, strategy, holidays) {
  if (strategy === 'keep' || !strategy) return date;
  const isBlocked = (d) => isWeekend(d) || holidays.has(fmt(d));
  let cur = new Date(date);
  let guard = 0;
  while (isBlocked(cur) && guard < 14) {
    cur = addDays(cur, strategy === 'anticipate' ? -1 : 1);
    guard += 1;
  }
  return cur;
}

/**
 * @param {object} cfg
 * @param {string} cfg.frequency  weekly|biweekly|monthly|specific|custom|daily
 * @param {string} cfg.startDate  YYYY-MM-DD
 * @param {string} [cfg.endDate]  YYYY-MM-DD (inclusive)
 * @param {number[]} [cfg.weekdays] 0..6 (Sun..Sat) for weekly/custom
 * @param {number} [cfg.intervalWeeks] interval in weeks (weekly)
 * @param {number[]} [cfg.monthDays]  days of month (monthly/biweekly-as-two-days)
 * @param {string[]} [cfg.specificDates] explicit list for 'specific'
 * @param {string} [cfg.weekendStrategy] anticipate|postpone|keep
 * @param {string[]} [cfg.holidays] extra blocked dates
 * @param {number} [cfg.count] optional cap on number of occurrences
 * @returns {string[]} sorted unique date strings
 */
export function generateOccurrences(cfg) {
  const {
    frequency,
    startDate,
    endDate,
    weekdays = [],
    intervalWeeks = 1,
    monthDays = [],
    specificDates = [],
    weekendStrategy = 'keep',
    holidays = [],
    count,
  } = cfg;

  if (!startDate) return [];
  const holidaySet = new Set(holidays);
  const start = toDate(startDate);
  // Default horizon: 1 year if no end date is given.
  const end = endDate ? toDate(endDate) : addDays(start, 365);
  const hardCount = Math.min(count || MAX_OCCURRENCES, MAX_OCCURRENCES);

  const raw = [];
  const push = (d) => {
    if (d >= start && d <= end) raw.push(d);
  };

  switch (frequency) {
    case 'daily': {
      for (let d = new Date(start); d <= end && raw.length < hardCount; d = addDays(d, 1)) {
        push(new Date(d));
      }
      break;
    }
    case 'weekly':
    case 'biweekly': {
      const step = frequency === 'biweekly' ? 2 : Math.max(1, intervalWeeks);
      const days = weekdays.length ? weekdays : [start.getDay()];
      // Walk week by week from the Sunday of the start week.
      let weekStart = addDays(start, -start.getDay());
      let weekIndex = 0;
      while (weekStart <= end && raw.length < hardCount) {
        if (weekIndex % step === 0) {
          for (const wd of days) push(addDays(weekStart, wd));
        }
        weekStart = addDays(weekStart, 7);
        weekIndex += 1;
      }
      break;
    }
    case 'monthly': {
      const days = monthDays.length ? monthDays : [start.getDate()];
      let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= end && raw.length < hardCount) {
        const y = cursor.getFullYear();
        const m = cursor.getMonth();
        const lastDay = new Date(y, m + 1, 0).getDate();
        for (const dm of days) {
          const day = Math.min(dm, lastDay); // clamp e.g. day 31 in Feb
          push(new Date(y, m, day));
        }
        cursor = new Date(y, m + 1, 1);
      }
      break;
    }
    case 'specific':
    case 'custom': {
      for (const ds of specificDates) {
        if (ds) push(toDate(ds));
      }
      break;
    }
    default:
      return [];
  }

  // Adjust for weekends/holidays, dedupe, sort, cap.
  const adjusted = raw.map((d) => fmt(adjust(d, weekendStrategy, holidaySet)));
  const unique = [...new Set(adjusted)].sort();
  return unique.slice(0, hardCount);
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
