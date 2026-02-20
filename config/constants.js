// ─────────────────────────────────────────────────────────────────────────────
//  Application-wide constants
//  All magic numbers and enum-like values live here so there is a single
//  source of truth across the entire codebase.
// ─────────────────────────────────────────────────────────────────────────────

// ── Roles ────────────────────────────────────────────────────────────────────
const ROLES = Object.freeze({
  PROJECT_ADMIN: 'project_admin',  // System overlord – manages realms only
  SENIOR_ADMIN:  'senior_admin',   // Realm administrator (class senior)
  STUDENT:       'student',        // Regular user inside a realm
});

// ── Group / Chat types ────────────────────────────────────────────────────────
const GROUP_TYPES = Object.freeze({
  GENERAL:   'general',    // Realm-wide, every member auto-joined
  MANDATORY: 'mandatory',  // Created by senior admin – members cannot leave
  VOLUNTARY: 'voluntary',  // Created by students – joinable / leavable
});

// ── Chat message content types ────────────────────────────────────────────────
const MESSAGE_TYPES = Object.freeze({
  TEXT:   'text',
  IMAGE:  'image',  // Previewed inline in the UI
  FILE:   'file',   // Rendered as a downloadable link
  SYSTEM: 'system', // Server-generated event messages (join, leave, etc.)
});

// ── Timetable week parity ─────────────────────────────────────────────────────
const WEEK_TYPES = Object.freeze({
  ODD:  'odd',
  EVEN: 'even',
});

// Days of the week (index-safe, Mon = 0 … Sun = 6)
const DAYS = Object.freeze([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

// ── Attendance states ─────────────────────────────────────────────────────────
const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: 'present',
  ABSENT:  'absent',
  PENDING: 'pending', // Window open but student has not checked in yet
});

// ── Realm status ──────────────────────────────────────────────────────────────
const REALM_STATUS = Object.freeze({
  ACTIVE:   'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived',
});

// ── HTTP status shortcuts (avoids typos in controllers) ───────────────────────
const HTTP = Object.freeze({
  OK:         200,
  CREATED:    201,
  NO_CONTENT: 204,
  BAD_REQUEST:  400,
  UNAUTHORIZED: 401,
  FORBIDDEN:    403,
  NOT_FOUND:    404,
  CONFLICT:     409,
  SERVER_ERROR: 500,
});

// ── File upload limits ────────────────────────────────────────────────────────
const UPLOAD = Object.freeze({
  MAX_SIZE_BYTES: (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 25) * 1024 * 1024,
  ALLOWED_IMAGES: (process.env.ALLOWED_IMAGE_TYPES || 'image/jpeg,image/png,image/gif,image/webp').split(','),
  DIR: process.env.UPLOAD_DIR || 'uploads',
});

// ── Check-in window (minutes before and after a lesson start) ─────────────────
const CHECKIN_WINDOW_MINUTES = Object.freeze({
  BEFORE: 5,
  AFTER:  15,
});

// ── Socket.io event names ─────────────────────────────────────────────────────
const SOCKET_EVENTS = Object.freeze({
  // Emitted to the client
  NEW_MESSAGE:       'new_message',
  MESSAGE_DELETED:   'message_deleted',
  LESSON_REMINDER:   'lesson_reminder',   // Notification when a lesson starts
  NOTICE_PUBLISHED:  'notice_published',
  GROUP_UPDATED:     'group_updated',
  USER_JOINED_GROUP: 'user_joined_group',
  USER_LEFT_GROUP:   'user_left_group',

  // Received from the client
  JOIN_ROOM:         'join_room',
  LEAVE_ROOM:        'leave_room',
  SEND_MESSAGE:      'send_message',
  TYPING:            'typing',
  STOP_TYPING:       'stop_typing',
});

module.exports = {
  ROLES,
  GROUP_TYPES,
  MESSAGE_TYPES,
  WEEK_TYPES,
  DAYS,
  ATTENDANCE_STATUS,
  REALM_STATUS,
  HTTP,
  UPLOAD,
  CHECKIN_WINDOW_MINUTES,
  SOCKET_EVENTS,
};
