/**
 * api.js  —  Lightweight REST client
 *
 * All API calls go through `API.request()`.
 * Token is read from `localStorage.getItem('token')` on every call.
 */
'use strict';

const API = (() => {
  const BASE = '/api';

  function getToken() { return localStorage.getItem('token') || ''; }

  async function request(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = getToken();
    if (tok) headers['Authorization'] = `Bearer ${tok}`;

    const init = { method, headers, ...opts };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(`${BASE}${path}`, init);
    let data;
    try { data = await res.json(); } catch { data = {}; }

    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data   = data;
      throw err;
    }
    return data;
  }

  async function upload(method, path, formData) {
    const headers = {};
    const tok = getToken();
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
    const res  = await fetch(`${BASE}${path}`, { method, headers, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return data;
  }

  const get  = (p, q)    => request('GET',    q ? `${p}?${new URLSearchParams(q)}` : p);
  const post = (p, b)    => request('POST',   p, b);
  const put  = (p, b)    => request('PUT',    p, b);
  const patch = (p, b)   => request('PATCH',  p, b);
  const del  = (p)       => request('DELETE', p);

  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = {
    login:          (username, password) => post('/auth/login', { username, password }),
    logout:         ()                   => post('/auth/logout'),
    me:             ()                   => get('/auth/me'),
    changePassword: (currentPassword, newPassword) => post('/auth/change-password', { currentPassword, newPassword }),
  };

  // ── Realms ──────────────────────────────────────────────────────────────────
  const realms = {
    list:   ()              => get('/realms'),
    get:    (id)            => get(`/realms/${id}`),
    create: (body)          => post('/realms', body),
    update: (id, body)      => patch(`/realms/${id}`, body),
    archive:(id)            => del(`/realms/${id}`),
    assignSenior: (id, body)=> post(`/realms/${id}/assign-senior`, body),
  };

  // ── Users ───────────────────────────────────────────────────────────────────
  const users = (realmId) => ({
    list:   (q)          => get(`/realms/${realmId}/users`, q),
    get:    (uid)        => get(`/realms/${realmId}/users/${uid}`),
    create: (body)       => post(`/realms/${realmId}/users`, body),
    update: (uid, body)  => patch(`/realms/${realmId}/users/${uid}`, body),
    remove: (uid)        => del(`/realms/${realmId}/users/${uid}`),
  });

  // ── Timetable ───────────────────────────────────────────────────────────────
  const timetable = (realmId) => ({
    get:    ()           => get(`/realms/${realmId}/timetable`),
    today:  ()           => get(`/realms/${realmId}/timetable/today`),
    upsert: (body)       => put(`/realms/${realmId}/timetable`, body),
    addPeriod:    (body) => post(`/realms/${realmId}/timetable/periods`, body),
    updatePeriod: (pid, b) => patch(`/realms/${realmId}/timetable/periods/${pid}`, b),
    removePeriod: (pid)  => del(`/realms/${realmId}/timetable/periods/${pid}`),
  });

  // ── Attendance ─────────────────────────────────────────────────────────────
  const attendance = (realmId) => ({
    checkIn:       (body)      => post(`/realms/${realmId}/attendance/checkin`, body),
    mine:          (q)         => get(`/realms/${realmId}/attendance/me`, q),
    myAnalytics:   ()          => get(`/realms/${realmId}/attendance/me/analytics`),
    userAnalytics: (uid)       => get(`/realms/${realmId}/attendance/${uid}/analytics`),
    list:          (q)         => get(`/realms/${realmId}/attendance`, q),
    todayRegister: ()          => get(`/realms/${realmId}/attendance/today`),
  });

  // ── Notices ─────────────────────────────────────────────────────────────────
  const notices = (realmId) => ({
    list:   (q)         => get(`/realms/${realmId}/notices`, q),
    get:    (nid)       => get(`/realms/${realmId}/notices/${nid}`),
    create: (body)      => post(`/realms/${realmId}/notices`, body),
    update: (nid, body) => patch(`/realms/${realmId}/notices/${nid}`, body),
    remove: (nid)       => del(`/realms/${realmId}/notices/${nid}`),
  });

  // ── Groups ──────────────────────────────────────────────────────────────────
  const groups = (realmId) => ({
    list:         (q)         => get(`/realms/${realmId}/groups`, q),
    get:          (gid)       => get(`/realms/${realmId}/groups/${gid}`),
    create:       (body)      => post(`/realms/${realmId}/groups`, body),
    update:       (gid, body) => patch(`/realms/${realmId}/groups/${gid}`, body),
    archive:      (gid)       => del(`/realms/${realmId}/groups/${gid}`),
    join:         (gid)       => post(`/realms/${realmId}/groups/${gid}/join`),
    leave:        (gid)       => post(`/realms/${realmId}/groups/${gid}/leave`),
    addMembers:   (gid, body) => post(`/realms/${realmId}/groups/${gid}/members`, body),
    removeMember: (gid, uid)  => del(`/realms/${realmId}/groups/${gid}/members/${uid}`),
  });

  // ── Messages ─────────────────────────────────────────────────────────────────
  const messages = (realmId) => (groupId) => ({
    list:        (q)    => get(`/realms/${realmId}/groups/${groupId}/messages`, q),
    delete:      (mid)  => del(`/realms/${realmId}/groups/${groupId}/messages/${mid}`),
    uploadImage: (fd)   => upload('POST', `/realms/${realmId}/groups/${groupId}/messages/upload/image`, fd),
    uploadFile:  (fd)   => upload('POST', `/realms/${realmId}/groups/${groupId}/messages/upload/file`, fd),
  });

  return { auth, realms, users, timetable, attendance, notices, groups, messages, request };
})();

window.API = API;
