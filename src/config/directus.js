function normalizeDirectusBaseUrl(value) {
  if (typeof value !== 'string') return null;
  let url = value.trim();
  if (!url) return null;
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/collections$/, '');
  url = url.replace(/\/items$/, '');
  url = url.replace(/\/+$/, '');
  return url;
}

function buildQueryString(params) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function readResponseBody(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  try {
    return await res.text();
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ms = Number.isFinite(timeoutMs) ? timeoutMs : 8000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function getDirectusConfig() {
  const baseUrl =
    normalizeDirectusBaseUrl(process.env.DIRECTUS_URL) ||
    normalizeDirectusBaseUrl(process.env.DIRECTUSURL) ||
    normalizeDirectusBaseUrl(process.env.DIRECTUS_BASE_URL) ||
    null;
  const token =
    (typeof process.env.DIRECTUS_TOKEN === 'string' ? process.env.DIRECTUS_TOKEN.trim() : '') ||
    (typeof process.env.TOKENDIRECTUS === 'string' ? process.env.TOKENDIRECTUS.trim() : '') ||
    null;
  const collection =
    (typeof process.env.DIRECTUS_COLLECTION === 'string' ? process.env.DIRECTUS_COLLECTION.trim() : '') ||
    'vehicle_detections';
  return { baseUrl, token, collection };
}

async function directusRequest(method, path, { query, body, headers } = {}) {
  const { baseUrl, token } = getDirectusConfig();
  if (!baseUrl) throw new Error('Falta DIRECTUS_URL (o DIRECTUSURL / DIRECTUS_BASE_URL)');
  const url = `${baseUrl}${path}${buildQueryString(query)}`;

  const reqHeaders = { Accept: 'application/json', ...(headers || {}) };
  if (token) reqHeaders.Authorization = `Bearer ${token}`;

  const init = { method, headers: reqHeaders };
  if (body !== undefined) init.body = body;

  const timeoutMs = Number.parseInt(process.env.DIRECTUS_TIMEOUT_MS ?? '20000', 10) || 20000;
  const maxRetries = Number.parseInt(process.env.DIRECTUS_MAX_RETRIES ?? '3', 10) || 3;
  const retryableStatus = new Set([429, 502, 503, 504]);

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs);
      const payload = await readResponseBody(res);

      if (!res.ok) {
        const message =
          (payload && typeof payload === 'object' && Array.isArray(payload.errors) && payload.errors[0]?.message) ||
          (payload && typeof payload === 'object' && payload.error) ||
          (typeof payload === 'string' && payload) ||
          `HTTP ${res.status}`;

        const err = new Error(message);
        err.status = res.status;
        err.url = url;
        err.method = method;

        if (retryableStatus.has(res.status) && attempt < maxRetries) {
          lastError = err;
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw err;
      }

      if (payload && typeof payload === 'object' && Array.isArray(payload.errors) && payload.errors.length > 0) {
        const err = new Error(payload.errors[0]?.message || 'Error de Directus');
        err.status = res.status;
        err.url = url;
        err.method = method;
        throw err;
      }

      return payload;
    } catch (e) {
      const retryable = (e && (e.name === 'AbortError' || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT')) || false;
      if ((retryable || !('status' in (e || {}))) && attempt < maxRetries) {
        lastError = e;
        await sleep(250 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }

  throw lastError || new Error('Error de Directus');
}

async function listDetections({ page, limit, license_plate, start_date, end_date } = {}) {
  const { collection } = getDirectusConfig();
  const safePage = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit ?? '25', 10) || 25));
  const offset = (safePage - 1) * safeLimit;

  const query = {
    limit: safeLimit + 1,
    offset,
    sort: '-timestamp,-id'
  };

  if (license_plate) query['filter[license_plate][_contains]'] = String(license_plate);
  if (start_date) query['filter[timestamp][_gte]'] = String(start_date);
  if (end_date) query['filter[timestamp][_lte]'] = String(end_date);

  const payload = await directusRequest('GET', `/items/${encodeURIComponent(collection)}`, { query });
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const hasMore = items.length > safeLimit;
  const sliced = hasMore ? items.slice(0, safeLimit) : items;
  return {
    data: sliced,
    pagination: {
      page: safePage,
      limit: safeLimit,
      hasMore,
      nextPage: hasMore ? safePage + 1 : null
    }
  };
}

async function getDetectionById(id) {
  const { collection } = getDirectusConfig();
  const payload = await directusRequest('GET', `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`);
  return payload?.data || null;
}

async function searchByPlate(plate) {
  const { collection } = getDirectusConfig();
  const query = {
    limit: 200,
    sort: '-timestamp,-id',
    'filter[license_plate][_contains]': String(plate)
  };
  const payload = await directusRequest('GET', `/items/${encodeURIComponent(collection)}`, { query });
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function listStatsFields({ start_date, end_date } = {}) {
  const { collection } = getDirectusConfig();
  const query = {
    limit: -1,
    fields: 'vehicle_type,vehicle_color,direction'
  };
  if (start_date) query['filter[timestamp][_gte]'] = String(start_date);
  if (end_date) query['filter[timestamp][_lte]'] = String(end_date);
  const payload = await directusRequest('GET', `/items/${encodeURIComponent(collection)}`, { query });
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function getLatestByPlate(plate) {
  const { collection } = getDirectusConfig();
  const query = {
    limit: 1,
    sort: '-date_created,-id',
    fields: 'id,date_created',
    'filter[license_plate][_eq]': String(plate)
  };
  const payload = await directusRequest('GET', `/items/${encodeURIComponent(collection)}`, { query });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows[0] || null;
}

async function getLatestTimestampByPlate(plate) {
  const { collection } = getDirectusConfig();
  const query = {
    limit: 1,
    sort: '-timestamp,-id',
    fields: 'id,timestamp',
    'filter[license_plate][_eq]': String(plate)
  };
  const payload = await directusRequest('GET', `/items/${encodeURIComponent(collection)}`, { query });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows[0] || null;
}

async function createDetection(data) {
  const { collection } = getDirectusConfig();
  const payload = await directusRequest('POST', `/items/${encodeURIComponent(collection)}`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return payload?.data || null;
}

async function updateDetectionById(id, patch) {
  const { collection } = getDirectusConfig();
  const payload = await directusRequest('PATCH', `/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch || {})
  });
  return payload?.data || null;
}

async function uploadImageBytes(bytes, { contentType, filename, title } = {}) {
  const form = new FormData();
  const blob = new Blob([bytes], { type: contentType || 'application/octet-stream' });
  form.append('file', blob, filename || 'image');
  if (title) form.append('title', String(title));

  const payload = await directusRequest('POST', '/files', { body: form });
  const fileId = payload?.data?.id || null;
  if (!fileId) return null;

  const { baseUrl } = getDirectusConfig();
  return { fileId, assetUrl: `${baseUrl}/assets/${fileId}` };
}

module.exports = {
  getDirectusConfig,
  listDetections,
  getDetectionById,
  searchByPlate,
  listStatsFields,
  getLatestByPlate,
  getLatestTimestampByPlate,
  createDetection,
  updateDetectionById,
  uploadImageBytes
};
