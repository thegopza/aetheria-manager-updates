'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { createProxyRegisterService } = require('../proxy_register');
const { createAuthSync } = require('../auth_sync');

function fixture(t, { brokerSignup, brokerCapabilities, balance = 100 } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmhee-broker-mgr-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const solver = {
    refreshBalance: async () => ({ balanceUnits: balance, points: balance / 100 }),
    proxyBrokerCapabilities: brokerCapabilities || (async () => ({ success: true, mode: 'owner-broker', configured: true, enabled: true, country: 'th' })),
    proxyBrokerSignup: brokerSignup || (async ({ requestId, profileId, username }) => ({
      success: true,
      jobId: 'srv-job-1',
      requestId,
      profileId,
      username,
      phase: 'completed',
      outcomeCode: 'REGISTERED',
      outcomeSuccess: true,
      chargedUnits: 10,
      ip: '198.51.100.99',
      ticketId: 'srv-ticket-1'
    })),
    proxyBrokerSignupStatus: async () => ({ success: true, phase: 'completed' })
  };

  const service = createProxyRegisterService({ dataDir, solver });
  return { dataDir, solver, service };
}

test('broker mode settings: client needs no credentials and public settings report owner-broker mode', t => {
  const { service } = fixture(t);
  service.saveSettings({ mode: 'owner-broker', enabled: true });
  const pub = service.publicSettings();

  assert.equal(pub.mode, 'owner-broker');
  assert.equal(pub.configured, true);
  assert.equal(pub.enabled, true);
  assert.equal(pub.hasCredentials, false);
  assert.equal(pub.proxyHost, '');
});

test('broker signup success: invokes solver broker method and persists completed journal state', async t => {
  let brokerCalled = 0;
  const { service, dataDir } = fixture(t, {
    brokerSignup: async input => {
      brokerCalled++;
      assert.equal(input.username, 'broker_user');
      assert.equal(input.password, 'broker_pass');
      return {
        success: true,
        jobId: 'job-123',
        requestId: input.requestId,
        profileId: input.profileId,
        username: input.username,
        ticketId: 't-123',
        ip: '198.51.100.5',
        chargedPoints: 0.1
      };
    }
  });

  service.saveSettings({ mode: 'owner-broker', enabled: true });
  const result = await service.registerAccountWithProxy({
    profileId: 'p1',
    username: 'broker_user',
    password: 'broker_pass'
  });

  assert.equal(result.success, true);
  assert.equal(result.username, 'broker_user');
  assert.equal(result.ticketId, 't-123');
  assert.equal(brokerCalled, 1);

  // Journal is persisted
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'proxy_register_state_v1.json'), 'utf8'));
  assert.equal(state.entries['p1'].phase, 'done');
  assert.equal(state.entries['p1'].outcome.success, true);

  // Repeat call returns cached result without contacting broker again
  const cached = await service.registerAccountWithProxy({
    profileId: 'p1',
    username: 'broker_user',
    password: 'broker_pass'
  });
  assert.equal(cached.success, true);
  assert.equal(brokerCalled, 1);
});

test('broker username taken: returns USERNAME_TAKEN and integrates cleanly with AuthSync', async t => {
  const { service, dataDir } = fixture(t, {
    brokerSignup: async () => ({
      success: false,
      code: 'USERNAME_TAKEN',
      error: 'Username taken'
    })
  });

  service.saveSettings({ mode: 'owner-broker', enabled: true });
  let savedProfiles = null;
  const initialProfiles = [{ id: 'p2', account: 'old_user', autoRegister: true, generatedAccount: true, debugPort: 49876 }];

  const authSync = createAuthSync({
    loadProfiles: () => savedProfiles || initialProfiles,
    saveProfiles: p => { savedProfiles = p; },
    evalProfilePort: async () => ({ success: true, result: { success: true } }),
    credentials: { getPassword: () => 'pass123', setPassword: () => {} },
    proxyRegister: service
  });

  await authSync.tick();

  assert.ok(savedProfiles);
  const updated = savedProfiles.find(p => p.id === 'p2');
  assert.equal(updated.proxyRegistrationState, 'known-rejected');
  assert.notEqual(updated.account, 'old_user'); // Generated new username for next try!
  assert.equal(updated.autoRegister, true);
});

test('broker owner offline: does NOT fallback to unproxied registration and marks pending retry', async t => {
  const { service, dataDir } = fixture(t, {
    brokerSignup: async () => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:5290');
      err.code = 'ECONNREFUSED';
      throw err;
    }
  });

  service.saveSettings({ mode: 'owner-broker', enabled: true });
  const result = await service.registerAccountWithProxy({
    profileId: 'p3',
    username: 'offline_user',
    password: 'pw'
  });

  assert.equal(result.success, false);
  assert.equal(result.pending, true);
  assert.equal(result.code, 'OWNER_OFFLINE');

  // Verify journal was NOT marked done and NO secret leaked
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'proxy_register_state_v1.json'), 'utf8'));
  assert.equal(state.entries['p3'].phase, 'reserving');
});

test('broker connection test: queries broker capabilities without initiating registration', async t => {
  let capabilitiesQueried = 0;
  const { service } = fixture(t, {
    brokerCapabilities: async () => {
      capabilitiesQueried++;
      return { success: true, mode: 'owner-broker', configured: true, enabled: true, country: 'th' };
    }
  });

  service.saveSettings({ mode: 'owner-broker' });
  const testRes = await service.testConnection();

  assert.equal(testRes.success, true);
  assert.equal(testRes.mode, 'owner-broker');
  assert.equal(testRes.country, 'th');
  assert.equal(capabilitiesQueried, 1);
});

test('broker deferred billing (balance <= 0) and IP_RATE_LIMITED retry rotation work without throwing PROXY_BALANCE_NOT_READY', async t => {
  const seenRequestIds = [];
  const { service } = fixture(t, {
    balance: -1400,
    brokerSignup: async input => {
      seenRequestIds.push(input.requestId);
      if (seenRequestIds.length === 1) {
        return {
          success: false,
          code: 'IP_RATE_LIMITED',
          message: 'IP นี้สมัครครบ 3 ไอดีในชั่วโมงนี้แล้ว'
        };
      }
      return {
        success: true,
        jobId: 'job-deferred-2',
        requestId: input.requestId,
        profileId: input.profileId,
        username: input.username,
        ticketId: 't-deferred-2',
        ip: '203.0.113.77',
        chargedPoints: 0.1,
        newBalance: -14.1
      };
    }
  });

  // Enabling without local credentials automatically selects owner-broker mode
  const saved = service.saveSettings({ enabled: true });
  assert.equal(saved.mode, 'owner-broker');
  assert.equal(saved.enabled, true);

  // Attempt 1: hits IP_RATE_LIMITED, does not get stuck in done state
  const first = await service.registerAccountWithProxy({
    profileId: 'p_deferred',
    username: 'deferred_user',
    password: 'deferred_pass'
  });
  assert.equal(first.success, false);
  assert.equal(first.code, 'IP_RATE_LIMITED');

  // Attempt 2: uses a fresh requestId and succeeds even with negative balance (-1400 units)
  const second = await service.registerAccountWithProxy({
    profileId: 'p_deferred',
    username: 'deferred_user',
    password: 'deferred_pass'
  });
  assert.equal(second.success, true);
  assert.equal(second.ip, '203.0.113.77');
  assert.equal(seenRequestIds.length, 2);
  assert.notEqual(seenRequestIds[0], seenRequestIds[1]);
});

test('brokerREGISTRATION_REVIEW_REQUIRED (e.g. EGRESS_IP_CHANGED_BEFORE_SIGNUP) does not brick state file across Manager restarts', async t => {
  let attempt = 0;
  const { service, dataDir, solver } = fixture(t, {
    balance: -9090,
    brokerSignup: async input => {
      attempt++;
      if (attempt === 1) {
        return {
          success: false,
          pending: true,
          code: 'REGISTRATION_REVIEW_REQUIRED',
          error: 'IP ของ session เปลี่ยน หยุดก่อนส่งคำสั่งสมัคร'
        };
      }
      return {
        success: true,
        jobId: 'job-ok-2',
        requestId: input.requestId,
        profileId: input.profileId,
        username: input.username,
        ticketId: 't-ok-2',
        ip: '49.230.243.27',
        chargedPoints: 0.1,
        newBalance: -91.0
      };
    }
  });

  service.saveSettings({ mode: 'owner-broker', enabled: true });

  // Also simulate a legacy state file that had a broker submission-unknown entry without ip/ticketId/expiresAt
  const crypto = require('node:crypto');
  const legacyState = {
    schema: 1,
    entries: {
      profile_old_stuck: {
        identity: crypto.createHash('sha256').update('old_user\nold_pass').digest('hex'),
        username: 'old_user',
        providerFingerprint: crypto.createHash('sha256').update('owner-broker-v1').digest('hex'),
        phase: 'submission-unknown',
        requestId: crypto.randomUUID(),
        sessionTag: 'reg_' + crypto.randomUUID().replaceAll('-', '')
      }
    }
  };
  fs.writeFileSync(path.join(dataDir, 'proxy_register_state_v1.json'), JSON.stringify(legacyState));

  // Restart service with that legacy state file — must NOT set stateBlocked=true!
  const restarted = createProxyRegisterService({ dataDir, solver });
  assert.equal(restarted.publicSettings().enabled, true);
  assert.equal(restarted.publicSettings().pendingReview, 0);

  // Attempt 1 on a new profile: hits EGRESS_IP_CHANGED_BEFORE_SIGNUP -> returns retryable IP_RATE_LIMITED
  const res1 = await restarted.registerAccountWithProxy({
    profileId: 'profile_new_1',
    username: 'user_new_1',
    password: 'pass_new_1'
  });
  assert.equal(res1.success, false);
  assert.equal(res1.code, 'IP_RATE_LIMITED');

  // Restart Manager again and retry with rotated candidate credentials -> succeeds!
  const restartedAgain = createProxyRegisterService({ dataDir, solver });
  assert.equal(restartedAgain.publicSettings().enabled, true);
  const res2 = await restartedAgain.registerAccountWithProxy({
    profileId: 'profile_new_1',
    username: 'user_new_2',
    password: 'pass_new_2'
  });
  assert.equal(res2.success, true);
  assert.equal(res2.ip, '49.230.243.27');
});


