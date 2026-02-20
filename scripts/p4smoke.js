/**
 * Phase 4 smoke test — group CRUD + message list
 * Run: node scripts/p4smoke.js
 */
'use strict';

const http = require('http');

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const r = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const ok  = (label, cond, val) => console.log(`  [${cond ? '✅' : '❌'}] ${label}${val !== undefined ? ': ' + val : ''}`);
const fail = (label, err) => { console.error(`  [❌] ${label}: ${err}`); process.exitCode = 1; };

async function run() {
  console.log('\n=== Phase 4 Smoke Test ===\n');

  // 1. Login
  console.log('[1] Login as superadmin');
  const login = await req('POST', '/api/auth/login', { username: 'superadmin', password: 'Admin@1234' });
  ok('status 200', login.status === 200, login.status);
  ok('has token', !!login.body.token);
  const TOKEN = login.body.token;
  if (!TOKEN) { fail('Cannot continue without token'); return; }

  // 2. Get realm
  console.log('\n[2] Get first realm');
  const realms = await req('GET', '/api/realms', null, TOKEN);
  ok('has realms', realms.body.count > 0, realms.body.count);
  const REALM = realms.body.data[0].id;
  ok('realmId', !!REALM, REALM);

  // 3. List groups
  console.log('\n[3] List groups (?all=true)');
  const groups = await req('GET', `/api/realms/${REALM}/groups?all=true`, null, TOKEN);
  ok('success', groups.body.success, groups.status);
  ok('has general group', groups.body.data?.some(g => g.type === 'general'));
  console.log(`     count: ${groups.body.count}`);

  // 4. Create voluntary group
  console.log('\n[4] Create voluntary group');
  const created = await req('POST', `/api/realms/${REALM}/groups`, { name: 'P4 Test Room', type: 'voluntary' }, TOKEN);
  ok('status 201', created.status === 201, created.status);
  ok('success', created.body.success);
  ok('correct name', created.body.data?.name === 'P4 Test Room', created.body.data?.name);
  ok('creator is member', created.body.data?.members?.length >= 1);
  const GID = created.body.data?.id;
  ok('has groupId', !!GID, GID);

  // 5. Get group
  console.log('\n[5] Get group');
  const got = await req('GET', `/api/realms/${REALM}/groups/${GID}`, null, TOKEN);
  ok('status 200', got.status === 200, got.status);
  ok('success', got.body.success);

  // 6. List messages (should be empty)
  console.log('\n[6] List messages (new group — should be empty)');
  const msgs = await req('GET', `/api/realms/${REALM}/groups/${GID}/messages`, null, TOKEN);
  ok('status 200', msgs.status === 200, msgs.status);
  ok('success', msgs.body.success);
  ok('count = 0', msgs.body.count === 0, msgs.body.count);

  // 7. Patch group
  console.log('\n[7] Patch group name');
  const patched = await req('PATCH', `/api/realms/${REALM}/groups/${GID}`, { name: 'P4 Updated' }, TOKEN);
  ok('status 200', patched.status === 200, patched.status);
  ok('name updated', patched.body.data?.name === 'P4 Updated', patched.body.data?.name);

  // 8. Cross-realm isolation: try to access group from wrong realm
  console.log('\n[8] Cross-realm isolation (wrong realmId)');
  const cross = await req('GET', `/api/realms/fake-realm/groups/${GID}`, null, TOKEN);
  ok('blocked (403 or 404)', cross.status === 403 || cross.status === 404, cross.status);

  // 9. Attempt to leave general group (should fail)
  console.log('\n[9] Leave general group (should fail)');
  const generalGroup = groups.body.data?.find(g => g.type === 'general');
  if (generalGroup) {
    const leave = await req('POST', `/api/realms/${REALM}/groups/${generalGroup.id}/leave`, {}, TOKEN);
    ok('blocked 403', leave.status === 403, leave.status);
  } else {
    console.log('     (no general group found, skip)');
  }

  // 10. Archive group
  console.log('\n[10] Archive group');
  const archived = await req('DELETE', `/api/realms/${REALM}/groups/${GID}`, null, TOKEN);
  ok('status 200', archived.status === 200, archived.status);
  ok('success', archived.body.success);

  console.log(`\n=== Phase 4 smoke test complete. Exit: ${process.exitCode || 0} ===\n`);
}

run().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
