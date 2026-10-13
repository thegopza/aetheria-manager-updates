'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createCoordinatedScriptCoordinator({
  legacyCoordinator,
  offlineCoordinator,
  service,
  getSettings,
  dataDir,
  intervalMs = 30000,
  now = Date.now
}) {
  const activationFile = dataDir ? path.join(dataDir, 'script_coordinator_activation.json') : null;
  let detectedMode = null;
  let timer = null;
  let inFlight = false;
  let stopped = false;
  let lastKnownAccountId = null;

  function atomicWriteJSON(filePath, data) {
    if (!filePath) return;
    const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  function loadActivationRecord() {
    if (!activationFile || !fs.existsSync(activationFile)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(activationFile, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
    return null;
  }

  function saveActivationRecord(record) {
    if (!activationFile) return;
    try {
      fs.mkdirSync(path.dirname(activationFile), { recursive: true });
      atomicWriteJSON(activationFile, record);
    } catch (_) {}
  }

  function clearActivationRecord() {
    if (!activationFile) return;
    try {
      if (fs.existsSync(activationFile)) fs.unlinkSync(activationFile);
    } catch (_) {}
  }

  function getEffectiveAccountId() {
    const settings = getSettings?.() || {};
    if (typeof settings.accountId === 'string' && settings.accountId) return settings.accountId;
    const serviceSettings = service?.loadSettings?.() || {};
    if (typeof serviceSettings.accountId === 'string' && serviceSettings.accountId) return serviceSettings.accountId;
    return null;
  }

  function isActivationValid(record) {
    if (!record || record.schemaVersion !== 'owner-v1') return false;
    const accountId = getEffectiveAccountId();
    // ต้องผูกกับ account ปัจจุบัน
    if (!accountId || accountId !== record.accountId) return false;
    // ต้องผูกกับ origin ปัจจุบัน
    if (service?.serviceOrigin && record.serviceOrigin && service.serviceOrigin !== record.serviceOrigin) return false;
    // ต้องมี signed cache รุ่นหนี้ที่ verify ผ่าน
    const release = offlineCoordinator?.release?.();
    if (!release || !release.version || !release.hash) return false;
    return true;
  }

  function determineMode() {
    if (process.env.PMHEE_SCRIPT_LEGACY_MODE === '1') return 'legacy';
    const settings = getSettings?.() || {};
    if (settings.offlineCoordinatorEnabled === false) return 'legacy';
    if (process.env.PMHEE_OFFLINE_COORDINATOR === '1' || process.env.PMHEE_SCRIPT_LEGACY_MODE === '0') return 'offline';
    if (settings.offlineCoordinatorEnabled === true) return 'offline';

    // ตรวจ runtime detectedMode (in memory จาก health สำเร็จ)
    if (detectedMode === 'offline') return 'offline';

    // ตรวจ persisted activation จาก disk (สำหรับ restart ตอน host offline)
    const activation = loadActivationRecord();
    if (isActivationValid(activation)) {
      return 'offline';
    }

    return 'legacy';
  }

  function syncWalletBinding(currentMode) {
    if (currentMode === 'offline') {
      offlineCoordinator?.bindWallet?.();
    } else {
      offlineCoordinator?.detachWallet?.();
    }
  }

  function checkCredentialChange() {
    const currentAccountId = getEffectiveAccountId();
    if (lastKnownAccountId !== null && currentAccountId !== lastKnownAccountId) {
      const activation = loadActivationRecord();
      if (activation && activation.accountId !== currentAccountId) {
        clearActivationRecord();
        detectedMode = null;
      }
    }
    lastKnownAccountId = currentAccountId;
  }

  async function checkServerEndpoint() {
    if (stopped) return;
    if (process.env.PMHEE_SCRIPT_LEGACY_MODE === '1') return;
    const settings = getSettings?.() || {};
    if (settings.offlineCoordinatorEnabled === false) return;

    try {
      const res = await service?.serviceRequest?.('/v1/aetheria/health');
      if (stopped) return;
      // maintenance ยังไม่ activate
      if (res?.success === true && res?.maintenance !== true && res?.schemaVersion === 'owner-v1') {
        detectedMode = 'offline';
        const accountId = getEffectiveAccountId();
        if (accountId && service?.serviceOrigin) {
          saveActivationRecord({
            accountId,
            serviceOrigin: service.serviceOrigin,
            schemaVersion: 'owner-v1',
            activatedAt: now()
          });
        }
      }
    } catch (_) {}
  }

  // Initial wallet binding sync
  syncWalletBinding(determineMode());

  async function cycle() {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      checkCredentialChange();
      await checkServerEndpoint();
      if (stopped) return;

      const current = determineMode();
      syncWalletBinding(current);

      if (current === 'offline') {
        return await offlineCoordinator?.cycle?.();
      } else {
        return await legacyCoordinator?.cycle?.();
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    cycle,
    statement() {
      const current = determineMode();
      if (current === 'offline' && offlineCoordinator?.statement) return offlineCoordinator.statement();
      return { success: false, error: 'LEGACY_MODE', legacyStatus: legacyCoordinator?.status?.() };
    },
    status() {
      const current = determineMode();
      const base = current === 'offline' ? offlineCoordinator?.status?.() : legacyCoordinator?.status?.();
      return {
        ...base,
        coordinatorMode: current,
        optIn: process.env.PMHEE_OFFLINE_COORDINATOR === '1' || Boolean(getSettings?.()?.offlineCoordinatorEnabled)
      };
    },
    release() {
      const current = determineMode();
      return current === 'offline' ? offlineCoordinator?.release?.() : undefined;
    },
    async refreshRelease() {
      const current = determineMode();
      if (current === 'offline') {
        if (offlineCoordinator?.refreshRelease) return await offlineCoordinator.refreshRelease();
        return offlineCoordinator?.release?.();
      }
      return undefined;
    },
    profileScriptSource(profileId) {
      const current = determineMode();
      return current === 'offline' ? offlineCoordinator?.profileScriptSource?.(profileId) : legacyCoordinator?.profileScriptSource?.(profileId);
    },
    async prepareCredentialChange(profile) {
      const current = determineMode();
      return current === 'offline' ? offlineCoordinator?.prepareCredentialChange?.(profile) : legacyCoordinator?.prepareCredentialChange?.(profile);
    },
    start() {
      stopped = false;
      if (timer) return;
      cycle().catch(() => {});
      timer = setInterval(() => {
        if (stopped) return;
        cycle().catch(() => {});
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      legacyCoordinator?.stop?.();
      offlineCoordinator?.stop?.();
    },
    // Exposed for tests and explicit inspection
    determineMode,
    checkServerEndpoint,
    syncWalletBinding,
    isActivationValid,
    loadActivationRecord,
    saveActivationRecord,
    clearActivationRecord,
    getEffectiveAccountId
  };
}

module.exports = { createCoordinatedScriptCoordinator };
