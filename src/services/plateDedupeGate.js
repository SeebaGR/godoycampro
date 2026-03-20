function normalizePlateKey(value) {
  if (typeof value !== 'string') return null;
  const p = value.trim().toUpperCase();
  return p ? p : null;
}

function createPlateDedupeGate({ inflightMs = 10000, minCleanupSize = 250, minTtlMs = 15 * 60 * 1000 } = {}) {
  const state = new Map();

  function cleanup(now) {
    if (state.size < minCleanupSize) return;
    for (const [k, v] of state.entries()) {
      if (!v || typeof v !== 'object') {
        state.delete(k);
        continue;
      }
      if ((v.expiresAt || 0) <= now) state.delete(k);
    }
  }

  function begin(plate, eventMs, windowMs) {
    const now = Date.now();
    cleanup(now);
    const key = normalizePlateKey(plate);
    if (!key) return { allow: true };

    const window = Math.max(0, Number(windowMs) || 0);
    const s = state.get(key) || { lastEventMs: null, inflightUntil: 0, expiresAt: 0 };

    if (s.inflightUntil && s.inflightUntil > now) {
      return { allow: false, reason: 'Duplicado en proceso' };
    }

    if (Number.isFinite(eventMs) && Number.isFinite(s.lastEventMs)) {
      const deltaMs = eventMs - s.lastEventMs;
      if (deltaMs < 0) return { allow: false, reason: 'Evento fuera de orden' };
      if (deltaMs <= window) return { allow: false, reason: `Duplicado reciente (<${Math.round(window / 60000)}m)` };
    }

    s.inflightUntil = now + inflightMs;
    s.expiresAt = now + Math.max(window, minTtlMs);
    state.set(key, s);
    return { allow: true, key };
  }

  function end(key, { acceptedEventMs } = {}) {
    if (!key) return;
    const now = Date.now();
    const s = state.get(key);
    if (!s) return;
    s.inflightUntil = 0;
    if (Number.isFinite(acceptedEventMs)) {
      if (!Number.isFinite(s.lastEventMs) || acceptedEventMs > s.lastEventMs) {
        s.lastEventMs = acceptedEventMs;
      }
    }
    s.expiresAt = now + Math.max(minTtlMs, (s.expiresAt || 0) - now);
    state.set(key, s);
  }

  return { begin, end, normalizePlateKey };
}

module.exports = { createPlateDedupeGate, normalizePlateKey };
