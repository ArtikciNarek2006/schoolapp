/**
 * dateUtils.js  —  Date & week-type helpers shared across the app
 */

'use strict';

const { WEEK_TYPES, DAYS, CHECKIN_WINDOW_MINUTES } = require('../../config/constants');

// ── ISO Week Number ───────────────────────────────────────────────────────────
/**
 * Returns the ISO week number (1–53) for a given Date object.
 * Week 1 = the week containing the year's first Thursday.
 */
function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayOfWeek = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek); // shift to Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Returns 'odd' or 'even' for the ISO week that contains `date`.
 * @param {Date} date
 * @returns {'odd'|'even'}
 */
function getWeekType(date) {
  return getISOWeekNumber(date) % 2 === 0 ? WEEK_TYPES.EVEN : WEEK_TYPES.ODD;
}

/**
 * Returns the lowercase day name (e.g. 'monday') for a given Date in a timezone.
 * Falls back to UTC if the Intl API is unavailable.
 * @param {Date}   date
 * @param {string} timezone  IANA timezone string (e.g. 'Europe/London')
 * @returns {string}
 */
function getDayName(date, timezone = 'UTC') {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    });
    return formatter.format(date).toLowerCase(); // 'monday', 'tuesday', …
  } catch {
    return DAYS[date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1];
  }
}

/**
 * Returns the local date string 'YYYY-MM-DD' for a given Date in a timezone.
 * @param {Date}   date
 * @param {string} timezone
 * @returns {string}
 */
function getLocalDateString(date, timezone = 'UTC') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD
      timeZone: timezone,
      year:  'numeric',
      month: '2-digit',
      day:   '2-digit',
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Returns the local 'HH:MM' string for a given Date in a timezone.
 * @param {Date}   date
 * @param {string} timezone
 * @returns {string}
 */
function getLocalTimeString(date, timezone = 'UTC') {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour:   '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(date); // 'HH:MM'
  } catch {
    const h = String(date.getUTCHours()).padStart(2, '0');
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
}

/**
 * Given a 'HH:MM' startTime string and a Date representing "now" (in the
 * realm's timezone), determines if the check-in window is currently open.
 *
 * Window: (startTime - BEFORE) ≤ now ≤ (startTime + AFTER)
 *
 * @param {string} startTime   'HH:MM' in local time
 * @param {Date}   now         current UTC Date
 * @param {string} timezone    IANA timezone
 * @returns {boolean}
 */
function isCheckinWindowOpen(startTime, now, timezone = 'UTC') {
  const [sh, sm] = startTime.split(':').map(Number);

  // Build the absolute UTC moment when this period starts, on today's local date.
  // Strategy: find today's midnight in the realm timezone (in ms since epoch),
  // then add the period's hours + minutes.
  const localDate   = getLocalDateString(now, timezone); // 'YYYY-MM-DD'
  const offsetMs    = getTimezoneOffsetMs(now, timezone); // realm TZ offset vs UTC

  // midnight of localDate *in UTC*  (append 'Z' so Date always parses as UTC)
  const midnightUTC = new Date(`${localDate}T00:00:00Z`).getTime();

  // The realm's midnight in UTC = midnightUTC - offsetMs
  // Adding the period hours/minutes gives the period start in UTC
  const periodStartUTC = midnightUTC - offsetMs + (sh * 60 + sm) * 60_000;

  const windowStart = periodStartUTC - CHECKIN_WINDOW_MINUTES.BEFORE * 60_000;
  const windowEnd   = periodStartUTC + CHECKIN_WINDOW_MINUTES.AFTER  * 60_000;
  const nowMs       = now.getTime();

  return nowMs >= windowStart && nowMs <= windowEnd;
}

/**
 * Helper: compute the timezone's UTC offset in milliseconds for a given instant.
 * @param {Date}   date
 * @param {string} timezone
 * @returns {number}  milliseconds (positive = east of UTC)
 */
function getTimezoneOffsetMs(date, timezone) {
  // Format the date in the target TZ and UTC, then compute the diff
  const utcStr  = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr   = date.toLocaleString('en-US', { timeZone: timezone });
  return Date.parse(tzStr) - Date.parse(utcStr);
}

/**
 * Returns the number of minutes from now until a period's startTime.
 * Negative means the period has already started.
 * @param {string} startTime  'HH:MM' local time
 * @param {Date}   now
 * @param {string} timezone
 * @returns {number}
 */
function minutesUntilPeriod(startTime, now, timezone = 'UTC') {
  const [sh, sm]    = startTime.split(':').map(Number);
  const localDate   = getLocalDateString(now, timezone);
  const offsetMs    = getTimezoneOffsetMs(now, timezone);
  const midnightUTC = new Date(`${localDate}T00:00:00Z`).getTime();
  const periodStartUTC = midnightUTC - offsetMs + (sh * 60 + sm) * 60_000;
  return (periodStartUTC - now.getTime()) / 60_000;
}

module.exports = {
  getISOWeekNumber,
  getWeekType,
  getDayName,
  getLocalDateString,
  getLocalTimeString,
  isCheckinWindowOpen,
  minutesUntilPeriod,
  getTimezoneOffsetMs,
};
