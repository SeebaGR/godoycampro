const express = require('express');
const router = express.Router();
const cameraService = require('../services/cameraService');
const directus = require('../config/directus');
const { createPlateDedupeGate } = require('../services/plateDedupeGate');

const detectionsCache = new Map();
const plateGate = createPlateDedupeGate();
let lastDetectionsOk = null;
let lastDetectionsOkAt = 0;

function safeJsonParse(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function cleanPlateText(input) {
  if (typeof input !== 'string') return null;
  const upper = input.trim().toUpperCase();
  const mapped = upper.replace(/[\u0400-\u04FF\u0370-\u03FF]/g, (ch) => {
    const map = {
      'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'І': 'I', 'Ј': 'J',
      'З': 'Z',
      'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X'
    };
    return map[ch] || '';
  });
  const cleaned = mapped.replace(/[^A-Z0-9]/g, '');
  if (!cleaned || cleaned.length < 5) return null;
  const modern = cleaned.match(/[A-Z]{4}\d{2}/);
  if (modern) return modern[0];
  const old = cleaned.match(/[A-Z]{2}\d{4}/);
  if (old) return old[0];
  if (cleaned.length >= 6) return cleaned.slice(0, 6);
  return cleaned;
}

function isChileanPlate(plate) {
  if (typeof plate !== 'string') return false;
  const p = cleanPlateText(plate);
  if (!p) return false;
  return /^[A-Z]{4}\d{2}$/.test(p) || /^[A-Z]{2}\d{4}$/.test(p);
}

let getApiCooldownUntilMs = 0;
const enrichInFlight = new Set();

function getGetApiKey() {
  const v =
    process.env.GETAPI_API_KEY ||
    process.env.GETAPI_KEY ||
    process.env.GETAPI_X_API_KEY ||
    process.env.X_API_KEY_GETAPI ||
    '';
  const t = String(v).trim();
  return t || null;
}

function absolutizePublicUrl(pathOrUrl) {
  if (typeof pathOrUrl !== 'string') return null;
  const s = pathOrUrl.trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  const base = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || process.env.BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  if (s.startsWith('/')) return base + s;
  return base + '/' + s;
}

async function fetchGetApiJson(path) {
  const base = (process.env.GETAPI_BASE_URL || 'https://chile.getapi.cl').trim().replace(/\/+$/, '');
  const key = getGetApiKey();
  if (!key) return { ok: false, status: 401, data: null, reason: 'missing_getapi_key', message: 'Falta GETAPI_API_KEY' };
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  console.log('Consultando GetAPI:', url);
  const res = await fetch(url, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const parsed = safeJsonParse(text);
    const msg =
      parsed?.data?.message ||
      parsed?.message ||
      parsed?.error?.message ||
      (typeof text === 'string' && text.trim()) ||
      `HTTP ${res.status}`;
    const reason =
      res.status === 429 ? 'rate_limited' :
      res.status === 404 ? 'not_found' :
      res.status === 422 ? 'invalid_plate' :
      res.status === 401 ? 'unauthorized' :
      res.status === 403 ? 'forbidden' :
      'upstream_error';
    return { ok: false, status: res.status, data: null, reason, message: msg };
  }
  const json = await res.json().catch(() => null);
  return { ok: true, status: res.status, data: json, reason: null, message: null };
}

async function enrichAndPersistDetection({ id, plate }) {
  const detId = String(id || '').trim();
  if (!detId) return;
  if (enrichInFlight.has(detId)) return;
  const key = getGetApiKey();
  if (!key) return;

  const cleanPlate = cleanPlateText(plate) || null;
  if (!cleanPlate) return;
  if (!isChileanPlate(cleanPlate)) return;
  if (Date.now() < getApiCooldownUntilMs) return;

  enrichInFlight.add(detId);
  try {
    console.log('Iniciando enriquecimiento GetAPI para detección:', detId, 'patente:', cleanPlate);
    const vehicleRes = await fetchGetApiJson(`/v1/vehicles/plate/${encodeURIComponent(cleanPlate)}`);
    if (!vehicleRes.ok) {
      if (vehicleRes.reason === 'rate_limited' || vehicleRes.status === 429) {
        getApiCooldownUntilMs = Math.max(getApiCooldownUntilMs, Date.now() + 60000);
        console.warn('GetAPI limitado por tasa, se pausará solicitudes por 60s');
        return;
      }
      if (vehicleRes.status === 401 || vehicleRes.status === 403) return;
      const failure = {
        plate: cleanPlate,
        fetched_at: new Date().toISOString(),
        vehicle: null,
        appraisal: null,
        error: {
          upstream_status: vehicleRes.status,
          reason: vehicleRes.reason || null,
          message: vehicleRes.message || null
        }
      };
      try {
        await directus.updateDetectionById(detId, { getapi: failure });
        console.log('Persistido fallo GetAPI en Directus para id:', detId);
      } catch (e1) {
        try {
          await directus.updateDetectionById(detId, { getapi: JSON.stringify(failure) });
          console.log('Persistido fallo GetAPI (string) en Directus para id:', detId);
        } catch (e2) {
          console.error('No se pudo persistir fallo GetAPI en Directus:', e2?.message || e2);
        }
      }
      return;
    }

    const vehiclePayload = vehicleRes.data;
    const vehicleData = (vehiclePayload && typeof vehiclePayload === 'object' && vehiclePayload.data) ? vehiclePayload.data : vehiclePayload;
    if (vehicleData?.model?.brand && !vehicleData.brand) {
      vehicleData.brand = vehicleData.model.brand;
    }

    const appraisalRes = await fetchGetApiJson(`/v1/vehicles/appraisal/${encodeURIComponent(cleanPlate)}`);
    if (!appraisalRes.ok && (appraisalRes.reason === 'rate_limited' || appraisalRes.status === 429)) {
      getApiCooldownUntilMs = Math.max(getApiCooldownUntilMs, Date.now() + 60000);
      console.warn('GetAPI tasación limitado por tasa, se pausará solicitudes por 60s');
      return;
    }

    const appraisalPayload = appraisalRes.ok ? appraisalRes.data : null;
    const appraisalData = appraisalPayload?.data || null;

    const result = {
      plate: cleanPlate,
      fetched_at: new Date().toISOString(),
      vehicle: vehicleData || null,
      appraisal: appraisalData || null
    };

    try {
      await directus.updateDetectionById(detId, { getapi: result });
      console.log('Enriquecimiento GetAPI persistido en Directus para id:', detId);
    } catch (e1) {
      try {
        await directus.updateDetectionById(detId, { getapi: JSON.stringify(result) });
        console.log('Enriquecimiento GetAPI persistido como string en Directus para id:', detId);
      } catch (e2) {
        console.error('No se pudo persistir enriquecimiento GetAPI en Directus:', e2?.message || e2);
      }
    }
  } finally {
    enrichInFlight.delete(detId);
  }
}

router.get('/assets/:id', async (req, res) => {
  try {
    const { baseUrl, token } = directus.getDirectusConfig();
    if (!baseUrl) return res.status(500).send('DIRECTUS_URL no está configurado');
    if (!token) return res.status(500).send('DIRECTUS_TOKEN no está configurado');

    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).send('id requerido');

    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query || {})) {
      if (Array.isArray(v)) {
        for (const x of v) sp.append(k, String(x));
      } else if (v !== undefined && v !== null) {
        sp.set(k, String(v));
      }
    }
    const qs = sp.toString();
    const upstreamUrl = `${baseUrl}/assets/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`;

    const upstream = await fetch(upstreamUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status).send(text || upstream.statusText);
    }

    const contentType = upstream.headers.get('content-type');
    const contentLength = upstream.headers.get('content-length');
    const cacheControl = upstream.headers.get('cache-control');
    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', cacheControl || 'public, max-age=31536000, immutable');

    const arrayBuffer = await upstream.arrayBuffer();
    return res.status(200).send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Error sirviendo asset de Directus:', error);
    return res.status(500).send('Error');
  }
});

// Endpoint para recibir detecciones desde la cámara DAHUA
router.post('/webhook/detection', async (req, res) => {
  try {
    const logPayload = process.env.LOG_DETECTION_PAYLOAD === '1' || process.env.LOG_DETECTION_PAYLOAD === 'true';
    const logMax = Number.parseInt(process.env.LOG_DETECTION_PAYLOAD_MAX ?? '8000', 10) || 8000;
    const dedupeSeconds = Number.parseInt((process.env.DEDUPE_WINDOW_SECONDS ?? process.env.EVENT_DEDUPE_WINDOW_SECONDS ?? '900'), 10) || 900;

    const safeStringify = (value) => {
      try {
        const text = JSON.stringify(
          value,
          (k, v) => {
            if (typeof v === 'string' && v.length > 800) return v.slice(0, 800) + '…';
            return v;
          },
          2
        );
        return text.length > logMax ? text.slice(0, logMax) + '…' : text;
      } catch {
        return '[unserializable]';
      }
    };

    if (logPayload) {
      console.log('Detección recibida de la cámara (raw):', safeStringify(req.body));
    }

    const rawItems = Array.isArray(req.body) ? req.body : [req.body];
    const normalizedPairs = rawItems.map((raw) => ({ raw, data: cameraService.normalizeDetectionData(raw) }));

    const byPlate = new Map();
    const noPlate = [];
    for (const p of normalizedPairs) {
      const plate = plateGate.normalizePlateKey(p.data?.license_plate);
      if (!plate) {
        noPlate.push(p);
        continue;
      }
      const existing = byPlate.get(plate);
      const ms = p.data?.timestamp ? Date.parse(p.data.timestamp) : Number.NaN;
      const exMs = existing?.data?.timestamp ? Date.parse(existing.data.timestamp) : Number.NaN;
      if (!existing || (!Number.isFinite(exMs) && Number.isFinite(ms)) || (Number.isFinite(ms) && Number.isFinite(exMs) && ms > exMs)) {
        byPlate.set(plate, p);
      }
    }

    const selected = rawItems.length > 1 ? [...byPlate.values(), ...noPlate] : normalizedPairs;

    const insertedIds = [];
    const ignored = [];

    for (const { raw, data } of selected) {
      console.log('Detección normalizada:', {
        license_plate: data.license_plate,
        timestamp: data.timestamp,
        has_image_url: Boolean(data.image_url),
        image_url_preview: typeof data.image_url === 'string' ? data.image_url.slice(0, 160) : null
      });

      const validation = cameraService.validateDetectionData(data);
      if (!validation.valid) {
        console.warn('Detección ignorada:', {
          reason: validation.error,
          license_plate: data.license_plate,
          timestamp: data.timestamp
        });
        ignored.push({ license_plate: data.license_plate || null, reason: validation.error });
        continue;
      }

      const windowMs = Math.max(0, dedupeSeconds * 1000);
      const eventMs = data.timestamp ? Date.parse(data.timestamp) : Number.NaN;
      const gate = windowMs > 0 ? plateGate.begin(data.license_plate, eventMs, windowMs) : { allow: true, key: plateGate.normalizePlateKey(data.license_plate) };
      if (!gate.allow) {
        console.warn('Detección ignorada:', { reason: gate.reason, license_plate: data.license_plate, timestamp: data.timestamp });
        ignored.push({ license_plate: data.license_plate || null, reason: gate.reason });
        continue;
      }

      try {
        if (windowMs > 0 && data.license_plate) {
          const latest = await directus.getLatestTimestampByPlate(data.license_plate);
          const lastMs = latest?.timestamp ? Date.parse(latest.timestamp) : Number.NaN;
          if (Number.isFinite(lastMs) && Number.isFinite(eventMs)) {
            const deltaMs = eventMs - lastMs;
            if (deltaMs >= 0 && deltaMs <= windowMs) {
              console.warn('Detección ignorada (duplicado por placa):', {
                license_plate: data.license_plate,
                delta_seconds: Math.round(deltaMs / 1000),
                window_seconds: dedupeSeconds
              });
              ignored.push({ license_plate: data.license_plate, reason: `Duplicado reciente (<${Math.round(dedupeSeconds / 60)}m)` });
              plateGate.end(gate.key, { acceptedEventMs: eventMs });
              continue;
            }
            if (deltaMs < 0) {
              console.warn('Detección ignorada (fuera de orden):', {
                license_plate: data.license_plate,
                current: data.timestamp,
                last: latest.timestamp
              });
              ignored.push({ license_plate: data.license_plate, reason: 'Evento fuera de orden' });
              plateGate.end(gate.key, { acceptedEventMs: eventMs });
              continue;
            }
          }
        }

        if (!data.image_url) {
          const base64 = cameraService.extractImageBase64(raw);
          if (base64) {
            let bytes;
            try {
              bytes = Buffer.from(base64, 'base64');
            } catch {
              bytes = null;
            }
            if (bytes) {
              try {
                const uploaded = await directus.uploadImageBytes(bytes, {
                  contentType: 'image/jpeg',
                  filename: `${data.license_plate || 'unknown'}-${Date.now()}.jpg`,
                  title: `${data.license_plate || 'unknown'}`
                });
                if (uploaded?.fileId) {
                  data.image_url = `/api/assets/${uploaded.fileId}`;
                  console.log('Imagen subida a Directus:', uploaded.assetUrl?.slice(0, 180) || uploaded.fileId);
                }
              } catch (e) {
                console.error('Error subiendo imagen a Directus (se continúa sin imagen):', e?.message || e);
              }
            }
          }
        }

        const inserted = await directus.createDetection(data);
        console.log('Detección guardada exitosamente:', inserted?.id);
        insertedIds.push(inserted?.id || null);
        if (inserted?.id && data?.license_plate) {
          enrichAndPersistDetection({ id: inserted.id, plate: data.license_plate }).catch(() => null);
        }
        plateGate.end(gate.key, { acceptedEventMs: eventMs });
      } catch (e) {
        plateGate.end(gate.key);
        throw e;
      }
    }

    if (!Array.isArray(req.body)) {
      return res.json({
        success: true,
        message: insertedIds.length > 0 ? 'Detección guardada correctamente' : 'Detección ignorada',
        id: insertedIds[0] || null,
        ignored: insertedIds.length === 0 ? ignored?.[0]?.reason || null : null
      });
    }

    return res.json({ success: true, inserted_ids: insertedIds.filter(Boolean), ignored });

  } catch (error) {
    console.error('❌ Error procesando detección:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Obtener todas las detecciones (con paginación)
router.get('/detections', async (req, res) => {
  try {
    const rawPage = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const license_plate = Array.isArray(req.query.license_plate) ? req.query.license_plate[0] : req.query.license_plate;
    const start_date = Array.isArray(req.query.start_date) ? req.query.start_date[0] : req.query.start_date;
    const end_date = Array.isArray(req.query.end_date) ? req.query.end_date[0] : req.query.end_date;

    const cacheMs = Number.parseInt(process.env.DETECTIONS_CACHE_MS ?? '8000', 10) || 8000;
    const minPollMs = Number.parseInt(process.env.DETECTIONS_MIN_POLL_MS ?? '8000', 10) || 8000;
    const maxPollMs = Number.parseInt(process.env.DETECTIONS_MAX_POLL_MS ?? '20000', 10) || 20000;
    const basePollMs = Math.min(maxPollMs, Math.max(minPollMs, cacheMs));
    const cacheKey = JSON.stringify({
      page: rawPage ?? '1',
      limit: rawLimit ?? '25',
      license_plate: license_plate || '',
      start_date: start_date || '',
      end_date: end_date || ''
    });
    const cached = detectionsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.payload);
    }

    const startedAt = Date.now();
    const result = await directus.listDetections({
      page: rawPage ?? '1',
      limit: rawLimit ?? '25',
      license_plate,
      start_date,
      end_date
    });
    const elapsedMs = Date.now() - startedAt;
    const pollAfterMs = Math.min(maxPollMs, Math.max(basePollMs, Math.round(elapsedMs * 1.25)));

    const baseItems = Array.isArray(result.data) ? result.data : [];
    const dataWithGetApi = baseItems.map((item) => ({ ...(item || {}), getapi: item?.getapi || null }));
    const missingIds = dataWithGetApi.filter((x) => !x.getapi && x.id).map((x) => x.id);
    if (missingIds.length) {
      console.log('Detecciones sin getapi:', missingIds.length);
    }
    for (const id of missingIds) {
      try {
        const full = await directus.getDetectionById(id);
        const getapi = full?.getapi || null;
        const idx = dataWithGetApi.findIndex((x) => x.id === id);
        if (idx !== -1) dataWithGetApi[idx] = { ...dataWithGetApi[idx], getapi };
      } catch {
      }
    }

    const enrichCandidates = dataWithGetApi
      .filter((x) => x && x.id && !x.getapi && typeof x.license_plate === 'string' && isChileanPlate(x.license_plate))
      .slice(0, 2);
    if (enrichCandidates.length) {
      console.log('Agendando enriquecimiento de getapi para ids:', enrichCandidates.map((x) => x.id).join(', '));
    }
    for (const x of enrichCandidates) {
      enrichAndPersistDetection({ id: x.id, plate: x.license_plate }).catch(() => null);
    }

    const payload = { success: true, data: dataWithGetApi, pagination: result.pagination, poll_after_ms: pollAfterMs };
    if (cacheMs > 0) {
      detectionsCache.set(cacheKey, { expiresAt: Date.now() + cacheMs, payload });
    }
    lastDetectionsOk = payload;
    lastDetectionsOkAt = Date.now();
    return res.json(payload);

  } catch (error) {
    console.error('Error obteniendo detecciones:', {
      message: error?.message,
      status: error?.status,
      method: error?.method,
      url: error?.url
    });
    const retryAfterMs = Number.parseInt(process.env.DETECTIONS_RETRY_AFTER_MS ?? '5000', 10) || 5000;
    res.setHeader('Retry-After', String(Math.max(1, Math.round(retryAfterMs / 1000))));
    const staleMaxMs = Number.parseInt(process.env.DETECTIONS_STALE_MAX_MS ?? '60000', 10) || 60000;
    if (lastDetectionsOk && (Date.now() - lastDetectionsOkAt) <= Math.max(0, staleMaxMs)) {
      res.setHeader('X-Data-Stale', '1');
      return res.status(200).json({
        ...lastDetectionsOk,
        stale: true,
        upstream_error: {
          message: error?.message || 'Error consultando Directus',
          status: error?.status ?? null
        }
      });
    }

    res.status(502).json({
      success: false,
      error: error?.message || 'Error consultando Directus',
      retry_after_ms: retryAfterMs,
      upstream: {
        status: error?.status ?? null,
        method: error?.method ?? null,
        url: typeof error?.url === 'string' ? error.url.replace(/(Bearer\\s+)[^\\s]+/gi, '$1***') : null
      }
    });
  }
});

// Obtener detección por ID
router.get('/detections/:id', async (req, res) => {
  try {
    const data = await directus.getDetectionById(req.params.id);
    if (!data) {
      return res.status(404).json({ 
        success: false, 
        error: 'Detección no encontrada' 
      });
    }

    res.json({ success: true, data });

  } catch (error) {
    console.error('Error obteniendo detección:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

router.get('/detections/:id/enrich', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'id requerido' });

    const item = await directus.getDetectionById(id);
    if (!item) return res.status(404).json({ success: false, error: 'Detección no encontrada' });
    console.log('Solicitud de enriquecimiento manual para id:', id);

    function isGetApiData(data) {
      if (!data || typeof data !== 'object') return false;
      if (typeof data.fetched_at === 'string' && data.fetched_at) return true;
      if (data.vehicle && typeof data.vehicle === 'object') return true;
      if (data.appraisal && typeof data.appraisal === 'object') return true;
      return false;
    }

    const rawDataObj = safeJsonParse(item.raw_data) || {};
    const existing = rawDataObj?.enrichment?.getapi || null;
    let existingField = item ? item.getapi : null;
    if (typeof existingField === 'string') existingField = safeJsonParse(existingField);
    const cached = isGetApiData(existingField) ? existingField : (isGetApiData(existing) ? existing : null);
    if (cached) {
      return res.json({ success: true, data: cached, cached: true });
    }

    let plate = cleanPlateText(item.license_plate) || null;
    if (!plate) {
      console.warn('Detección sin patente para enriquecimiento:', id);
      return res.json({ success: true, data: null, cached: false, reason: 'no_plate' });
    }

    if (!isChileanPlate(plate)) {
      console.warn('Formato de patente inválido para enriquecimiento:', { id, raw: item.license_plate, cleaned: plate });
      return res.json({ success: true, data: null, cached: false, reason: 'invalid_plate_format', plate });
    }

    const vehicleRes = await fetchGetApiJson(`/v1/vehicles/plate/${encodeURIComponent(plate)}`);
    if (!vehicleRes.ok) {
      console.warn('Fallo consulta vehículo en GetAPI:', { id, plate, status: vehicleRes.status, reason: vehicleRes.reason, message: vehicleRes.message });
      return res.json({
        success: true,
        data: null,
        cached: false,
        plate,
        upstream_status: vehicleRes.status,
        reason: vehicleRes.reason || null,
        message: vehicleRes.message || null
      });
    }

    const vehiclePayload = vehicleRes.data;
    const vehicleData = (vehiclePayload && typeof vehiclePayload === 'object' && vehiclePayload.data) ? vehiclePayload.data : vehiclePayload;
    if (vehicleData?.model?.brand && !vehicleData.brand) {
      vehicleData.brand = vehicleData.model.brand;
    }

    const appraisalRes = await fetchGetApiJson(`/v1/vehicles/appraisal/${encodeURIComponent(plate)}`);
    const appraisalPayload = appraisalRes.ok ? appraisalRes.data : null;
    const appraisalData = appraisalPayload?.data || null;

    const result = {
      plate,
      fetched_at: new Date().toISOString(),
      vehicle: vehicleData || null,
      appraisal: appraisalData || null
    };

    const nextRaw = {
      ...rawDataObj,
      enrichment: {
        ...(rawDataObj.enrichment && typeof rawDataObj.enrichment === 'object' ? rawDataObj.enrichment : {}),
        getapi: result
      }
    };

    try {
      await directus.updateDetectionById(id, { getapi: result, raw_data: nextRaw });
      console.log('Persistido enriquecimiento en Directus desde endpoint manual para id:', id);
    } catch (e) {
      try {
        await directus.updateDetectionById(id, { getapi: result, raw_data: JSON.stringify(nextRaw) });
        console.log('Persistido enriquecimiento (raw_data string) en Directus para id:', id);
      } catch (e2) {
        try {
          await directus.updateDetectionById(id, { getapi: result });
        } catch (e3) {
          console.warn('No se pudo persistir getapi:', e3?.message || e3);
        }
      }
    }

    return res.json({ success: true, data: result, cached: false });
  } catch (e) {
    return res.json({ success: true, data: null, cached: false, reason: 'internal_error' });
  }
});

// Estadísticas de detecciones
router.get('/stats', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const data = await directus.listStatsFields({ start_date, end_date });

    // Calcular estadísticas
    const stats = {
      total_detections: data.length,
      by_vehicle_type: {},
      by_color: {},
      by_direction: {}
    };

    data.forEach(detection => {
      // Por tipo de vehículo
      if (detection.vehicle_type) {
        stats.by_vehicle_type[detection.vehicle_type] = 
          (stats.by_vehicle_type[detection.vehicle_type] || 0) + 1;
      }
      // Por color
      if (detection.vehicle_color) {
        stats.by_color[detection.vehicle_color] = 
          (stats.by_color[detection.vehicle_color] || 0) + 1;
      }
      // Por dirección
      if (detection.direction) {
        stats.by_direction[detection.direction] = 
          (stats.by_direction[detection.direction] || 0) + 1;
      }
    });

    res.json({ success: true, stats });

  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Buscar por placa
router.get('/search/plate/:plate', async (req, res) => {
  try {
    const data = await directus.searchByPlate(req.params.plate);

    res.json({ 
      success: true, 
      data,
      count: data.length 
    });

  } catch (error) {
    console.error('Error buscando placa:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;
