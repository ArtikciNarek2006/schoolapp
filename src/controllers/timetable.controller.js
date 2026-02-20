/**
 * timetable.controller.js  —  Timetable CRUD (Senior Admin manages, all realm users read)
 *
 * GET    /api/realms/:realmId/timetable
 *          → full timetable for the realm (odd + even schedule)
 *
 * PUT    /api/realms/:realmId/timetable
 *          → replace the entire schedule object (senior_admin only)
 *
 * POST   /api/realms/:realmId/timetable/:weekType/:day
 *          → append a new period to a specific week/day (senior_admin only)
 *
 * PATCH  /api/realms/:realmId/timetable/:weekType/:day/:periodId
 *          → update a single period (senior_admin only)
 *
 * DELETE /api/realms/:realmId/timetable/:weekType/:day/:periodId
 *          → remove a single period (senior_admin only)
 *
 * GET    /api/realms/:realmId/timetable/today
 *          → today's periods with live attendance status for the requesting user
 */

'use strict';

const { v4: uuidv4 }  = require('uuid');
const db              = require('../db/jsonDb');
const { getWeekType, getDayName, getLocalDateString, isCheckinWindowOpen }
                      = require('../utils/dateUtils');
const { HTTP, WEEK_TYPES, DAYS, ATTENDANCE_STATUS } = require('../../config/constants');

// ── Helpers ───────────────────────────────────────────────────────────────────
const VALID_WEEK_TYPES = Object.values(WEEK_TYPES);

function getRealm(realmId, res) {
  const realm = db.findOne('realms', (r) => r.id === realmId);
  if (!realm) { res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Realm not found.' }); return null; }
  return realm;
}

function getTimetableDoc(realmId, res) {
  const tt = db.findOne('timetables', (t) => t.realmId === realmId);
  if (!tt) { res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Timetable not found for this realm.' }); return null; }
  return tt;
}

// ── GET /api/realms/:realmId/timetable ────────────────────────────────────────
function getTimetable(req, res, next) {
  try {
    const tt = getTimetableDoc(req.params.realmId, res);
    if (!tt) return;
    return res.status(HTTP.OK).json({ success: true, data: tt });
  } catch (err) { next(err); }
}

// ── GET /api/realms/:realmId/timetable/today ──────────────────────────────────
/**
 * Returns today's list of periods (for the correct odd/even week),
 * each augmented with the requesting user's attendance status.
 */
function getTodaySchedule(req, res, next) {
  try {
    const { realmId } = req.params;
    const realm = getRealm(realmId, res);
    if (!realm) return;

    const now      = new Date();
    const timezone = realm.settings?.timezone || 'UTC';
    const weekType = getWeekType(now);
    const dayName  = getDayName(now, timezone);
    const dateStr  = getLocalDateString(now, timezone);

    const tt = getTimetableDoc(realmId, res);
    if (!tt) return;

    const periods = tt.schedule?.[weekType]?.[dayName] || [];

    // Fetch today's attendance records for this user in this realm
    const userId = req.user.id;
    const todayAttendance = db.findAll('attendance',
      (a) => a.realmId === realmId && a.userId === userId && a.date === dateStr
    );
    const attendanceByPeriod = Object.fromEntries(todayAttendance.map((a) => [a.periodId, a]));

    const enriched = periods.map((period) => {
      const att = attendanceByPeriod[period.id];
      const windowOpen = period.attendanceRequired
        ? isCheckinWindowOpen(period.startTime, now, timezone)
        : false;
      return {
        ...period,
        attendanceStatus:   att?.status || (period.attendanceRequired ? ATTENDANCE_STATUS.PENDING : null),
        checkedInAt:        att?.checkedInAt || null,
        checkinWindowOpen:  windowOpen,
      };
    });

    return res.status(HTTP.OK).json({
      success: true,
      data: {
        date:      dateStr,
        weekType,
        dayName,
        timezone,
        periods:   enriched,
      },
    });
  } catch (err) { next(err); }
}

// ── PUT /api/realms/:realmId/timetable ────────────────────────────────────────
/**
 * Full replace of the timetable schedule.
 * Body: { schedule: { odd: {...}, even: {...} } }
 */
async function upsertTimetable(req, res, next) {
  try {
    const { realmId } = req.params;
    const { schedule } = req.body;

    if (!schedule || typeof schedule !== 'object') {
      return res.status(HTTP.BAD_REQUEST).json({
        success: false, message: '"schedule" object is required.',
      });
    }

    // Validate week types and day keys
    for (const wt of Object.keys(schedule)) {
      if (!VALID_WEEK_TYPES.includes(wt)) {
        return res.status(HTTP.BAD_REQUEST).json({
          success: false, message: `Invalid week type "${wt}". Use: ${VALID_WEEK_TYPES.join(', ')}.`,
        });
      }
    }

    const existing = db.findOne('timetables', (t) => t.realmId === realmId);
    let result;

    if (existing) {
      result = await db.update('timetables', existing.id, {
        schedule,
        updatedAt: new Date().toISOString(),
      });
    } else {
      // Build a full empty schedule skeleton, then merge the provided schedule
      const emptySchedule = {};
      for (const wt of VALID_WEEK_TYPES) {
        emptySchedule[wt] = Object.fromEntries(DAYS.map((d) => [d, []]));
      }
      result = await db.insert('timetables', {
        realmId,
        createdBy: req.user.id,
        schedule: { ...emptySchedule, ...schedule },
      });
    }

    return res.status(HTTP.OK).json({ success: true, data: result });
  } catch (err) { next(err); }
}

// ── POST /api/realms/:realmId/timetable/:weekType/:day ────────────────────────
/**
 * Append a new period.
 * Body: { subjectCode, subjectName, teacher, room, startTime, endTime, attendanceRequired }
 */
async function addPeriod(req, res, next) {
  try {
    const { realmId, weekType, day } = req.params;
    const { subjectCode, subjectName, teacher, room, startTime, endTime, attendanceRequired } = req.body;

    if (!VALID_WEEK_TYPES.includes(weekType)) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: `Invalid weekType "${weekType}".` });
    }
    if (!DAYS.includes(day.toLowerCase())) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: `Invalid day "${day}".` });
    }
    if (!subjectCode || !startTime || !endTime) {
      return res.status(HTTP.BAD_REQUEST).json({ success: false, message: 'subjectCode, startTime, and endTime are required.' });
    }

    // Auto-create timetable doc if this realm doesn't have one yet
    let tt = db.findOne('timetables', (t) => t.realmId === realmId);
    if (!tt) {
      const emptySchedule = {};
      for (const wt of VALID_WEEK_TYPES) {
        emptySchedule[wt] = Object.fromEntries(DAYS.map((d) => [d, []]));
      }
      tt = await db.insert('timetables', {
        realmId,
        createdBy: req.user.id,
        schedule:  emptySchedule,
      });
    }

    const newPeriod = {
      id:                 uuidv4(),
      subjectCode:        subjectCode.trim().toUpperCase(),
      subjectName:        (subjectName || subjectCode).trim(),
      teacher:            teacher || null,
      room:               room || null,
      startTime,
      endTime,
      attendanceRequired: attendanceRequired !== false,
    };

    const dayPeriods = tt.schedule?.[weekType]?.[day] || [];

    // Sort periods by startTime after insertion
    const updated = [...dayPeriods, newPeriod].sort((a, b) => a.startTime.localeCompare(b.startTime));

    tt.schedule[weekType][day] = updated;
    await db.update('timetables', tt.id, { schedule: tt.schedule });

    return res.status(HTTP.CREATED).json({ success: true, data: newPeriod });
  } catch (err) { next(err); }
}

// ── PATCH /api/realms/:realmId/timetable/:weekType/:day/:periodId ─────────────
async function updatePeriod(req, res, next) {
  try {
    const { realmId, weekType, day, periodId } = req.params;

    const tt = getTimetableDoc(realmId, res);
    if (!tt) return;

    const periods = tt.schedule?.[weekType]?.[day] || [];
    const idx     = periods.findIndex((p) => p.id === periodId);
    if (idx === -1) {
      return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Period not found.' });
    }

    const allowedFields = ['subjectCode', 'subjectName', 'teacher', 'room', 'startTime', 'endTime', 'attendanceRequired'];
    const patch = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }
    if (patch.subjectCode) patch.subjectCode = patch.subjectCode.trim().toUpperCase();

    periods[idx] = { ...periods[idx], ...patch };
    // Re-sort after potential startTime change
    periods.sort((a, b) => a.startTime.localeCompare(b.startTime));

    tt.schedule[weekType][day] = periods;
    await db.update('timetables', tt.id, { schedule: tt.schedule });

    return res.status(HTTP.OK).json({ success: true, data: periods.find((p) => p.id === periodId) });
  } catch (err) { next(err); }
}

// ── DELETE /api/realms/:realmId/timetable/:weekType/:day/:periodId ────────────
async function deletePeriod(req, res, next) {
  try {
    const { realmId, weekType, day, periodId } = req.params;

    const tt = getTimetableDoc(realmId, res);
    if (!tt) return;

    const periods = tt.schedule?.[weekType]?.[day] || [];
    const filtered = periods.filter((p) => p.id !== periodId);

    if (filtered.length === periods.length) {
      return res.status(HTTP.NOT_FOUND).json({ success: false, message: 'Period not found.' });
    }

    tt.schedule[weekType][day] = filtered;
    await db.update('timetables', tt.id, { schedule: tt.schedule });

    return res.status(HTTP.NO_CONTENT).send();
  } catch (err) { next(err); }
}

module.exports = {
  getTimetable,
  getTodaySchedule,
  upsertTimetable,
  addPeriod,
  updatePeriod,
  deletePeriod,
};
