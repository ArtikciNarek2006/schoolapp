/**
 * notificationScheduler.js  —  Lesson-start push notifications via Socket.io
 *
 * Runs a ticker every 60 seconds.  For every active realm that has a timetable,
 * it checks whether any period is starting within `realm.settings.notifyMinutesBefore`
 * minutes and emits a LESSON_REMINDER event to the realm's Socket.io room.
 *
 * Design notes:
 *  • Pure in-process scheduler — no external cron daemon needed.
 *  • Each tick is idempotent: duplicate notifications are suppressed via a
 *    recently-notified cache (periodId + date string), cleared at midnight.
 *  • The scheduler respects each realm's individual timezone and notifyMinutesBefore setting.
 */

'use strict';

const db = require('../db/jsonDb');
const {
  getWeekType,
  getDayName,
  getLocalDateString,
  minutesUntilPeriod,
} = require('../utils/dateUtils');
const { REALM_STATUS, SOCKET_EVENTS } = require('../../config/constants');

// ── Dedup cache  ──────────────────────────────────────────────────────────────
// key: `${realmId}:${dateStr}:${periodId}` → true
// Prevents re-firing the notification if the tick runs again within the window.
const _notifiedCache = new Set();

// Clear the cache at midnight UTC so a new day starts fresh
function scheduleMidnightCacheClear() {
  const now        = new Date();
  const tomorrow   = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 1, 0, 0); // 00:01 UTC
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    _notifiedCache.clear();
    console.log('[scheduler] Notification cache cleared for new day.');
    scheduleMidnightCacheClear(); // re-arm for the next midnight
  }, msUntilMidnight);
}

// ── Main tick ─────────────────────────────────────────────────────────────────
function tick(io) {
  try {
    const now    = new Date();
    const realms = db.findAll('realms', (r) => r.status === REALM_STATUS.ACTIVE);

    for (const realm of realms) {
      const timezone        = realm.settings?.timezone || 'UTC';
      const notifyBefore    = realm.settings?.notifyMinutesBefore ?? 5;
      const weekType        = getWeekType(now);
      const dayName         = getDayName(now, timezone);
      const dateStr         = getLocalDateString(now, timezone);

      const tt = db.findOne('timetables', (t) => t.realmId === realm.id);
      if (!tt) continue;

      const periods = tt.schedule?.[weekType]?.[dayName] || [];

      for (const period of periods) {
        if (!period.attendanceRequired) continue; // skip breaks/lunch

        const cacheKey = `${realm.id}:${dateStr}:${period.id}`;
        if (_notifiedCache.has(cacheKey)) continue; // already notified

        const minsUntil = minutesUntilPeriod(period.startTime, now, timezone);

        // Fire if the lesson starts within [0, notifyBefore] minutes from now
        if (minsUntil >= 0 && minsUntil <= notifyBefore) {
          const payload = {
            realmId:     realm.id,
            periodId:    period.id,
            subjectCode: period.subjectCode,
            subjectName: period.subjectName,
            teacher:     period.teacher,
            room:        period.room,
            startTime:   period.startTime,
            startsInMin: Math.round(minsUntil),
            date:        dateStr,
            weekType,
          };

          // Emit to all sockets in the realm room
          io.to(realm.id).emit(SOCKET_EVENTS.LESSON_REMINDER, payload);
          _notifiedCache.add(cacheKey);

          console.log(
            `[scheduler] LESSON_REMINDER → realm "${realm.name}" | ` +
            `${period.subjectCode} @ ${period.startTime} | starts in ${Math.round(minsUntil)} min(s)`
          );
        }
      }
    }
  } catch (err) {
    console.error('[scheduler] Error during notification tick:', err.message);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
/**
 * Start the scheduler.  Call once from server.js after Socket.io is ready.
 * @param {import('socket.io').Server} io
 * @param {number} [intervalMs=60000]  Tick interval in milliseconds (default 60 s)
 */
function startScheduler(io, intervalMs = 60_000) {
  console.log(`[scheduler] Lesson notification scheduler started (interval: ${intervalMs / 1000}s).`);
  scheduleMidnightCacheClear();

  // Run once immediately (catches any lesson starting right at boot)
  tick(io);

  // Then run on the interval
  const timer = setInterval(() => tick(io), intervalMs);

  // Allow clean shutdown
  const stop = () => {
    clearInterval(timer);
    console.log('[scheduler] Scheduler stopped.');
  };

  process.on('SIGTERM', stop);
  process.on('SIGINT',  stop);

  return stop; // caller can invoke stop() to cancel
}

module.exports = { startScheduler };
