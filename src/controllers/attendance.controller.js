/**
 * attendance.controller.js  —  Check-in and analytics
 *
 * POST /api/realms/:realmId/attendance/checkin
 *        → Student marks present for the currently-active period.
 *
 * GET  /api/realms/:realmId/attendance/me
 *        → Student's own attendance history (optional ?from=YYYY-MM-DD&to=YYYY-MM-DD)
 *
 * GET  /api/realms/:realmId/attendance/analytics/me
 *        → Per-student dashboard: absent count vs maxAbsences, by subject
 *
 * GET  /api/realms/:realmId/attendance/analytics/:userId   (senior_admin)
 *        → Same analytics for any student
 *
 * GET  /api/realms/:realmId/attendance          (senior_admin)
 *        → All attendance records; filterable by ?userId=&date=&periodId=
 *
 * GET  /api/realms/:realmId/attendance/today    (senior_admin)
 *        → Today's full class attendance register (all students × all periods)
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../db/jsonDb');
const {
  getWeekType, getDayName, getLocalDateString, isCheckinWindowOpen,
} = require('../utils/dateUtils');
const { HTTP, ROLES, ATTENDANCE_STATUS } = require('../../config/constants');

// ── Helpers ───────────────────────────────────────────────────────────────────
function getRealm(realmId, res) {
  const realm = db.findOne('realms', (r) => r.id === realmId);
  if (!realm) { res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Realm not found.' }); return null; }
  return realm;
}

// ── POST /api/realms/:realmId/attendance/checkin ──────────────────────────────
/**
 * Body: { periodId }
 * The server validates that:
 *   1. The period exists in today's timetable (correct odd/even week).
 *   2. The current time is within the check-in window.
 *   3. The student has not already checked in.
 */
async function checkIn(req, res, next) {
  try {
    const { realmId } = req.params;
    const { periodId } = req.body;

    if (!periodId) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'periodId is required.' });
    }

    const realm = getRealm(realmId, res);
    if (!realm) return;

    const timezone = realm.settings?.timezone || 'UTC';
    const now      = new Date();
    const weekType = getWeekType(now);
    const dayName  = getDayName(now, timezone);
    const dateStr  = getLocalDateString(now, timezone);

    // Find the timetable and locate the period
    const tt = db.findOne('timetables', (t) => t.realmId === realmId);
    if (!tt) {
      return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'No timetable configured for this realm.' });
    }

    const dayPeriods = tt.schedule?.[weekType]?.[dayName] || [];
    const period     = dayPeriods.find((p) => p.id === periodId);

    if (!period) {
      return res.status(HTTP.NOT_FOUND).json({
        success: false,
        message: `Period "${periodId}" not found in today's (${weekType} week, ${dayName}) schedule.`,
      });
    }

    if (!period.attendanceRequired) {
      return res.status(HTTP.BAD_REQUEST).json({
        success: false, message: 'Attendance is not required for this period.',
      });
    }

    // Check window
    if (!isCheckinWindowOpen(period.startTime, now, timezone)) {
      return res.status(HTTP.BAD_REQUEST).json({
        success: false,
        message: `Check-in window for this period is closed. It opens ${5} min before and closes ${15} min after ${period.startTime}.`,
      });
    }

    // Idempotency: already checked in?
    const existing = db.findOne('attendance',
      (a) => a.realmId === realmId && a.userId === req.user.id && a.date === dateStr && a.periodId === periodId,
    );
    if (existing) {
      if (existing.status === ATTENDANCE_STATUS.PRESENT) {
        return res.status(HTTP.CONFLICT).json({
          success: false, message: 'You have already checked in for this period.', data: existing,
        });
      }
      // Was marked absent by system, allow override
      const updated = await db.update('attendance', existing.id, {
        status:      ATTENDANCE_STATUS.PRESENT,
        checkedInAt: now.toISOString(),
      });
      return res.status(HTTP.OK).json({ success: true, data: updated });
    }

    // Create attendance record
    const record = await db.insert('attendance', {
      realmId,
      userId:      req.user.id,
      date:        dateStr,
      weekType,
      periodId,
      status:      ATTENDANCE_STATUS.PRESENT,
      checkedInAt: now.toISOString(),
    });

    return res.status(HTTP.CREATED).json({ success: true, data: record });
  } catch (err) { next(err); }
}

// ── GET /api/realms/:realmId/attendance/me ────────────────────────────────────
function getMyAttendance(req, res, next) {
  try {
    const { realmId } = req.params;
    const { from, to } = req.query;

    let records = db.findAll('attendance',
      (a) => a.realmId === realmId && a.userId === req.user.id,
    );

    if (from) records = records.filter((a) => a.date >= from);
    if (to)   records = records.filter((a) => a.date <= to);

    records.sort((a, b) => a.date.localeCompare(b.date) || a.periodId.localeCompare(b.periodId));

    return res.status(HTTP.OK).json({ success: true, count: records.length, data: records });
  } catch (err) { next(err); }
}

// ── Analytics helper ──────────────────────────────────────────────────────────
function buildAnalytics(realmId, userId, realm) {
  const maxAbsences = realm.settings?.maxAbsences ?? 5;

  // All attendance records for this user
  const records = db.findAll('attendance', (a) => a.realmId === realmId && a.userId === userId);

  const totalPresent = records.filter((a) => a.status === ATTENDANCE_STATUS.PRESENT).length;
  const totalAbsent  = records.filter((a) => a.status === ATTENDANCE_STATUS.ABSENT).length;
  const totalPending = records.filter((a) => a.status === ATTENDANCE_STATUS.PENDING).length;

  // Per-subject breakdown
  const tt = db.findOne('timetables', (t) => t.realmId === realmId);
  const periodMeta = {}; // periodId → { subjectCode, subjectName }
  if (tt) {
    for (const wt of Object.values(tt.schedule || {})) {
      for (const dayPeriods of Object.values(wt)) {
        for (const p of dayPeriods) {
          if (p.attendanceRequired) {
            periodMeta[p.id] = { subjectCode: p.subjectCode, subjectName: p.subjectName };
          }
        }
      }
    }
  }

  const bySubject = {};
  for (const r of records) {
    const meta = periodMeta[r.periodId];
    const key  = meta?.subjectCode || r.periodId;
    if (!bySubject[key]) {
      bySubject[key] = {
        subjectCode: meta?.subjectCode || r.periodId,
        subjectName: meta?.subjectName || r.periodId,
        present: 0, absent: 0, pending: 0,
      };
    }
    bySubject[key][r.status]++;
  }

  return {
    userId,
    maxAbsences,
    totalPresent,
    totalAbsent,
    totalPending,
    absencesRemaining: Math.max(0, maxAbsences - totalAbsent),
    atRisk:            totalAbsent >= Math.ceil(maxAbsences * 0.8),
    exceeded:          totalAbsent > maxAbsences,
    bySubject:         Object.values(bySubject),
  };
}

// ── GET /api/realms/:realmId/attendance/analytics/me ─────────────────────────
function getMyAnalytics(req, res, next) {
  try {
    const { realmId } = req.params;
    const realm = getRealm(realmId, res);
    if (!realm) return;
    const analytics = buildAnalytics(realmId, req.user.id, realm);
    return res.status(HTTP.OK).json({ success: true, data: analytics });
  } catch (err) { next(err); }
}

// ── GET /api/realms/:realmId/attendance/analytics/:userId  (senior_admin) ─────
function getUserAnalytics(req, res, next) {
  try {
    const { realmId, userId } = req.params;
    const realm = getRealm(realmId, res);
    if (!realm) return;

    const user = db.findOne('users', (u) => u.id === userId && u.realmId === realmId);
    if (!user) return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'User not found.' });

    const analytics = buildAnalytics(realmId, userId, realm);
    return res.status(HTTP.OK).json({ success: true, data: analytics });
  } catch (err) { next(err); }
}

// ── GET /api/realms/:realmId/attendance  (senior_admin) ───────────────────────
function listAttendance(req, res, next) {
  try {
    const { realmId } = req.params;
    const { userId, date, periodId, from, to } = req.query;

    let records = db.findAll('attendance', (a) => a.realmId === realmId);

    if (userId)   records = records.filter((a) => a.userId   === userId);
    if (date)     records = records.filter((a) => a.date     === date);
    if (periodId) records = records.filter((a) => a.periodId === periodId);
    if (from)     records = records.filter((a) => a.date     >= from);
    if (to)       records = records.filter((a) => a.date     <= to);

    records.sort((a, b) => b.date.localeCompare(a.date));

    return res.status(HTTP.OK).json({ success: true, count: records.length, data: records });
  } catch (err) { next(err); }
}

// ── GET /api/realms/:realmId/attendance/today  (senior_admin) ─────────────────
/**
 * Returns a class register: for every student in the realm, for every
 * attendance-required period today, show their status.
 */
function getTodayRegister(req, res, next) {
  try {
    const { realmId } = req.params;
    const realm = getRealm(realmId, res);
    if (!realm) return;

    const timezone = realm.settings?.timezone || 'UTC';
    const now      = new Date();
    const weekType = getWeekType(now);
    const dayName  = getDayName(now, timezone);
    const dateStr  = getLocalDateString(now, timezone);

    const tt = db.findOne('timetables', (t) => t.realmId === realmId);
    const todayPeriods = (tt?.schedule?.[weekType]?.[dayName] || [])
      .filter((p) => p.attendanceRequired);

    const students = db.findAll('users', (u) => u.realmId === realmId && u.role === ROLES.STUDENT && u.isActive);
    const todayAtt  = db.findAll('attendance', (a) => a.realmId === realmId && a.date === dateStr);

    const register = students.map((student) => {
      const studentAtt = todayAtt.filter((a) => a.userId === student.id);
      const byPeriod   = Object.fromEntries(studentAtt.map((a) => [a.periodId, a.status]));
      return {
        userId:      student.id,
        displayName: student.displayName,
        periods:     todayPeriods.map((p) => ({
          periodId:    p.id,
          subjectCode: p.subjectCode,
          startTime:   p.startTime,
          status:      byPeriod[p.id] || ATTENDANCE_STATUS.PENDING,
        })),
        absentToday: todayPeriods.filter((p) => byPeriod[p.id] === ATTENDANCE_STATUS.ABSENT).length,
      };
    });

    return res.status(HTTP.OK).json({
      success: true,
      data: {
        date: dateStr, weekType, dayName,
        periods: todayPeriods.map((p) => ({ id: p.id, subjectCode: p.subjectCode, startTime: p.startTime })),
        register,
      },
    });
  } catch (err) { next(err); }
}

module.exports = {
  checkIn,
  getMyAttendance,
  getMyAnalytics,
  getUserAnalytics,
  listAttendance,
  getTodayRegister,
};
