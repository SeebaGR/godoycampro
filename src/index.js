require('dotenv').config();
const express = require('express');
const cors = require('cors');
const detectionRoutes = require('./routes/detectionRoutes');
const cameraService = require('./services/cameraService');
const directus = require('./config/directus');
const { createPlateDedupeGate } = require('./services/plateDedupeGate');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.APP_URL || process.env.BASE_URL || '').trim().replace(/\/+$/, '');

function safeOrigin(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

const isapiStatus = {
  keepAlive: { count: 0, lastAt: null, lastPath: null },
  deviceInfo: { count: 0, lastAt: null, lastPath: null },
  tollgateInfo: { count: 0, lastAt: null, lastPath: null },
  other: { count: 0, lastAt: null, lastPath: null }
};

const isapiPlateGate = createPlateDedupeGate();

// Middleware
app.use((req, res, next) => {
  if (typeof req.url === 'string' && req.url.includes('//')) {
    req.url = req.url.replace(/\/{2,}/g, '/');
  }
  next();
});
app.use(cors());
app.use(express.text({ type: ['application/xml', 'text/xml', 'application/*+xml'], limit: '10mb' }));
app.use(express.json({ limit: '10mb' })); // Aumentar límite para imágenes
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((err, req, res, next) => {
  if (!err) return next();
  if (typeof req.path === 'string' && req.path.startsWith('/NotificationInfo/')) {
    console.warn('Error parseando payload ISAPI:', err.message);
    return res.status(200).send('OK');
  }
  return res.status(400).json({ success: false, error: 'Invalid request body' });
});

function extractXmlTag(xml, tagNames) {
  const tags = Array.isArray(tagNames) ? tagNames : [tagNames];
  for (const tag of tags) {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    if (match && match[1] != null) return match[1].trim();
  }
  return null;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickPayloadString(body) {
  if (!body || typeof body !== 'object') return null;
  const candidateKeys = ['payload', 'data', 'info', 'event', 'xml', 'json', 'message', 'body'];
  for (const key of candidateKeys) {
    if (typeof body[key] === 'string' && body[key].trim().length > 0) return body[key];
  }
  const keys = Object.keys(body);
  if (keys.length === 1 && typeof body[keys[0]] === 'string') return body[keys[0]];
  return null;
}

function findValueDeep(input, keyCandidates, maxDepth = 8) {
  const keys = new Set((Array.isArray(keyCandidates) ? keyCandidates : [keyCandidates]).map(k => String(k).toLowerCase()));
  const queue = [{ value: input, depth: 0 }];

  while (queue.length > 0) {
    const { value, depth } = queue.shift();
    if (value == null) continue;
    if (depth > maxDepth) continue;

    if (typeof value !== 'object') continue;

    if (Array.isArray(value)) {
      for (const item of value) queue.push({ value: item, depth: depth + 1 });
      continue;
    }

    for (const [k, v] of Object.entries(value)) {
      if (keys.has(String(k).toLowerCase())) {
        if (v == null) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
      }
      if (typeof v === 'object' && v !== null) queue.push({ value: v, depth: depth + 1 });
    }
  }

  return null;
}

function parseIsapiEventBody(req) {
  const body = req.body;
  if (body == null) return { raw: null, data: {} };

  if (typeof body === 'string') {
    const trimmed = body.trim();
    const parsedJson = tryParseJson(trimmed);
    if (parsedJson) return { raw: trimmed, data: parsedJson };

    const xml = trimmed;
    const data = {
      PlateNumber: extractXmlTag(xml, ['PlateNumber', 'plateNumber', 'LicensePlate', 'licensePlate', 'Plate', 'plate', 'PlateNo', 'plateNo', 'License', 'license', 'LicenseNo', 'licenseNo', 'Licence', 'licence', 'LicenceNo', 'licenceNo']),
      VehicleType: extractXmlTag(xml, ['VehicleType', 'vehicleType']),
      VehicleColor: extractXmlTag(xml, ['VehicleColor', 'vehicleColor']),
      Speed: extractXmlTag(xml, ['Speed', 'speed']),
      Direction: extractXmlTag(xml, ['Direction', 'direction']),
      Confidence: extractXmlTag(xml, ['Confidence', 'confidence']),
      UTC: extractXmlTag(xml, ['UTC', 'Time', 'CaptureTime', 'EventTime']),
      SerialID: extractXmlTag(xml, ['SerialID', 'DeviceID', 'SerialNo', 'DeviceSN']),
      ImageUrl: extractXmlTag(xml, ['ImageUrl', 'ImageURL', 'ImageURI', 'PicUrl', 'PicURL'])
    };

    return { raw: xml, data };
  }

  if (typeof body === 'object') {
    const payloadString = pickPayloadString(body);
    if (payloadString) {
      const trimmed = payloadString.trim();
      const parsedJson = tryParseJson(trimmed);
      if (parsedJson) return { raw: trimmed, data: parsedJson };
      const xml = trimmed;
      const data = {
        PlateNumber: extractXmlTag(xml, ['PlateNumber', 'plateNumber', 'LicensePlate', 'licensePlate', 'Plate', 'plate', 'PlateNo', 'plateNo', 'License', 'license', 'LicenseNo', 'licenseNo', 'Licence', 'licence', 'LicenceNo', 'licenceNo']),
        VehicleType: extractXmlTag(xml, ['VehicleType', 'vehicleType']),
        VehicleColor: extractXmlTag(xml, ['VehicleColor', 'vehicleColor']),
        Speed: extractXmlTag(xml, ['Speed', 'speed']),
        Direction: extractXmlTag(xml, ['Direction', 'direction']),
        Confidence: extractXmlTag(xml, ['Confidence', 'confidence']),
        UTC: extractXmlTag(xml, ['UTC', 'Time', 'CaptureTime', 'EventTime']),
        SerialID: extractXmlTag(xml, ['SerialID', 'DeviceID', 'SerialNo', 'DeviceSN']),
        ImageUrl: extractXmlTag(xml, ['ImageUrl', 'ImageURL', 'ImageURI', 'PicUrl', 'PicURL'])
      };
      return { raw: xml, data };
    }

    const data = {
      PlateNumber: findValueDeep(body, ['PlateNumber', 'plateNumber', 'LicensePlate', 'licensePlate', 'Plate', 'plate', 'PlateNo', 'plateNo', 'License', 'license', 'LicenseNo', 'licenseNo', 'Licence', 'licence', 'LicenceNo', 'licenceNo']) ?? body.PlateNumber ?? body.plateNumber ?? null,
      VehicleType: findValueDeep(body, ['VehicleType', 'vehicleType']) ?? body.VehicleType ?? body.vehicleType ?? null,
      VehicleColor: findValueDeep(body, ['VehicleColor', 'vehicleColor']) ?? body.VehicleColor ?? body.vehicleColor ?? null,
      Speed: findValueDeep(body, ['Speed', 'speed']) ?? body.Speed ?? body.speed ?? null,
      Direction: findValueDeep(body, ['Direction', 'direction']) ?? body.Direction ?? body.direction ?? null,
      Confidence: findValueDeep(body, ['Confidence', 'confidence']) ?? body.Confidence ?? body.confidence ?? null,
      UTC: findValueDeep(body, ['UTC', 'Time', 'CaptureTime', 'EventTime', 'timestamp']) ?? body.UTC ?? body.timestamp ?? null,
      SerialID: findValueDeep(body, ['SerialID', 'DeviceID', 'SerialNo', 'DeviceSN', 'deviceId']) ?? body.SerialID ?? body.cameraId ?? null,
      ImageUrl: findValueDeep(body, ['ImageUrl', 'imageUrl', 'ImageURL', 'PicUrl', 'PicURL', 'imageURI']) ?? body.ImageUrl ?? body.imageUrl ?? null,
      __rawObject: body
    };

    return { raw: JSON.stringify(body), data };
  }

  return { raw: String(body), data: { value: body } };
}

// Log de requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Rutas
app.use('/api', detectionRoutes);

app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

app.get('/isapi/status', (req, res) => {
  res.json({
    now: new Date().toISOString(),
    isapi: isapiStatus
  });
});

app.all('/NotificationInfo/KeepAlive', (req, res) => {
  const { raw, data } = parseIsapiEventBody(req);
  isapiStatus.keepAlive.count += 1;
  isapiStatus.keepAlive.lastAt = new Date().toISOString();
  isapiStatus.keepAlive.lastPath = req.path;
  if (raw) console.log('ISAPI KeepAlive recibido:', raw);
  else console.log('ISAPI KeepAlive recibido:', JSON.stringify(data, null, 2));
  res.status(200).send('OK');
});

app.all('/NotificationInfo/DeviceInfo', (req, res) => {
  const { raw, data } = parseIsapiEventBody(req);
  isapiStatus.deviceInfo.count += 1;
  isapiStatus.deviceInfo.lastAt = new Date().toISOString();
  isapiStatus.deviceInfo.lastPath = req.path;
  if (raw) console.log('ISAPI DeviceInfo recibido (raw):', raw);
  else console.log('ISAPI DeviceInfo recibido:', JSON.stringify(data, null, 2));
  res.status(200).send('OK');
});

app.all('/NotificationInfo/TollgateInfo', async (req, res) => {
  try {
    const { raw, data } = parseIsapiEventBody(req);
    isapiStatus.tollgateInfo.count += 1;
    isapiStatus.tollgateInfo.lastAt = new Date().toISOString();
    isapiStatus.tollgateInfo.lastPath = req.path;

    if (raw) console.log('ISAPI TollgateInfo recibido (raw):', raw);
    else console.log('ISAPI TollgateInfo recibido:', JSON.stringify(data, null, 2));

    const enrichedData = {
      ...data,
      __meta: {
        path: req.path,
        method: req.method,
        receivedAt: new Date().toISOString(),
        contentType: req.headers['content-type'] || null,
        contentLength: req.headers['content-length'] || null,
        userAgent: req.headers['user-agent'] || null
      },
      __raw: raw || null
    };

    const detectionData = cameraService.normalizeDetectionData(enrichedData);
    const validation = cameraService.validateDetectionData(detectionData);

    if (!validation.valid) {
      console.warn('ISAPI TollgateInfo ignorado:', {
        reason: validation.error,
        license_plate: detectionData.license_plate,
        timestamp: detectionData.timestamp
      });
      return res.status(200).send('OK');
    }

    const dedupeSeconds = Number.parseInt(process.env.DEDUPE_WINDOW_SECONDS ?? '900', 10) || 900;
    const windowMs = Math.max(0, dedupeSeconds * 1000);
    const gateCurrentMs = detectionData.timestamp ? Date.parse(detectionData.timestamp) : Number.NaN;
    const gate = (windowMs > 0 && detectionData.license_plate) ? isapiPlateGate.begin(detectionData.license_plate, gateCurrentMs, windowMs) : null;
    if (gate && !gate.allow) {
      console.warn('ISAPI TollgateInfo ignorado:', {
        reason: gate.reason,
        license_plate: detectionData.license_plate,
        timestamp: detectionData.timestamp
      });
      return res.status(200).send('OK');
    }

    let acceptGate = false;
    try {
      if (windowMs > 0 && detectionData.license_plate) {
        const latest = await directus.getLatestTimestampByPlate(detectionData.license_plate);
        const lastMs = latest?.timestamp ? Date.parse(latest.timestamp) : Number.NaN;
        if (Number.isFinite(lastMs) && Number.isFinite(gateCurrentMs)) {
          const deltaMs = gateCurrentMs - lastMs;
          if (deltaMs >= 0 && deltaMs <= windowMs) {
            console.warn('ISAPI TollgateInfo duplicado por placa:', {
              license_plate: detectionData.license_plate,
              delta_seconds: Math.round(deltaMs / 1000),
              window_seconds: dedupeSeconds
            });
            acceptGate = true;
            return res.status(200).send('OK');
          }
          if (deltaMs < 0) {
            console.warn('ISAPI TollgateInfo fuera de orden:', {
              license_plate: detectionData.license_plate,
              current: detectionData.timestamp,
              last: latest.timestamp
            });
            acceptGate = true;
            return res.status(200).send('OK');
          }
        }
      }

      if (!detectionData.image_url) {
        const base64 = cameraService.extractImageBase64(enrichedData);
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
                filename: `${detectionData.license_plate || 'unknown'}-${Date.now()}.jpg`,
                title: `${detectionData.license_plate || 'unknown'}`
              });
              if (uploaded?.fileId) {
                detectionData.image_url = `/api/assets/${uploaded.fileId}`;
                console.log('Imagen ISAPI subida a Directus:', uploaded.assetUrl?.slice(0, 180) || uploaded.fileId);
              }
            } catch (e) {
              console.error('Error subiendo imagen ISAPI a Directus (se continúa sin imagen):', e?.message || e);
            }
          }
        }
      }

      const inserted = await directus.createDetection(detectionData);
      console.log('ISAPI TollgateInfo guardado exitosamente:', inserted?.id);
      acceptGate = true;
      return res.status(200).send('OK');
    } finally {
      if (gate?.key) isapiPlateGate.end(gate.key, acceptGate ? { acceptedEventMs: gateCurrentMs } : {});
    }
  } catch (error) {
    console.error('❌ Error procesando ISAPI TollgateInfo:', error);
    return res.status(200).send('OK');
  }
});

app.all('/NotificationInfo/*', (req, res) => {
  const { raw, data } = parseIsapiEventBody(req);
  isapiStatus.other.count += 1;
  isapiStatus.other.lastAt = new Date().toISOString();
  isapiStatus.other.lastPath = req.path;
  if (raw) console.log('ISAPI Otro endpoint recibido:', req.path, raw);
  else console.log('ISAPI Otro endpoint recibido:', req.path, JSON.stringify(data, null, 2));
  res.status(200).send('OK');
});

app.get('/dashboard', (req, res) => {
  const title = process.env.CAMERA_LOCATION || 'Dashboard';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${String(title).replace(/</g, '&lt;')}</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
    header { padding: 16px 20px; border-bottom: 1px solid rgba(127,127,127,.25); display: flex; gap: 12px; align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
    h1 { margin: 0; font-size: 16px; font-weight: 650; }
    .meta { display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; font-size: 12px; opacity: .85; }
    .pill { padding: 4px 8px; border: 1px solid rgba(127,127,127,.25); border-radius: 999px; }
    main { padding: 16px 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
    .card { border: 1px solid rgba(127,127,127,.25); border-radius: 12px; padding: 12px; background: rgba(127,127,127,.06); }
    .card h2 { margin: 0 0 6px; font-size: 14px; }
    .row { display: grid; grid-template-columns: 120px 1fr; gap: 6px; font-size: 12px; }
    .k { opacity: .8; }
    .v { word-break: break-word; }
    .img { margin-top: 10px; border-radius: 10px; overflow: hidden; border: 1px solid rgba(127,127,127,.25); }
    .img img { width: 100%; height: auto; display: block; }
    .actions { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .more { padding: 6px 10px; border-radius: 999px; }
    .moreBox { margin-top: 10px; border: 1px solid rgba(127,127,127,.25); border-radius: 12px; padding: 10px; background: rgba(127,127,127,.04); }
    .moreBox[hidden] { display: none; }
    .section + .section { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(127,127,127,.25); }
    .moreTitle { font-weight: 650; font-size: 12px; margin-bottom: 8px; color: rgba(78, 160, 255, 1); }
    .row + .row { margin-top: 2px; }
    .empty { padding: 18px; opacity: .75; border: 1px dashed rgba(127,127,127,.35); border-radius: 12px; }
    button { border: 1px solid rgba(127,127,127,.35); background: transparent; padding: 6px 10px; border-radius: 10px; cursor: pointer; }
    button:active { transform: translateY(1px); }
    select { border: 1px solid rgba(127,127,127,.35); background: transparent; padding: 6px 10px; border-radius: 10px; cursor: pointer; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 11px; }
  </style>
</head>
<body>
  <header>
    <h1>${String(title).replace(/</g, '&lt;')}</h1>
    <div class="meta">
      <span class="pill">Últimas detecciones</span>
      <span id="status" class="pill">Cargando…</span>
      <span id="isapi" class="pill">ISAPI: —</span>
      <button id="prevPage">◀</button>
      <span id="pageInfo" class="pill">Página 1</span>
      <button id="nextPage">▶</button>
      <select id="pageSize" aria-label="Tamaño de página">
        <option value="25">25</option>
        <option value="50">50</option>
      </select>
      <button id="refresh">Actualizar</button>
    </div>
  </header>
  <main>
    <div id="grid" class="grid"></div>
    <div id="empty" class="empty" style="display:none">Aún no hay detecciones guardadas.</div>
  </main>
  <script>
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    const statusEl = document.getElementById('status');
    const isapiEl = document.getElementById('isapi');
    const refreshBtn = document.getElementById('refresh');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageInfoEl = document.getElementById('pageInfo');
    const pageSizeEl = document.getElementById('pageSize');
    let lastKey = null;
    let currentPage = 1;
    let pageLimit = 25;
    let hasMore = false;
    let isRefreshing = false;
    let pollMs = 2500;
    let timerId = null;
    const displayTimeZone = ${JSON.stringify(process.env.CAMERA_TIMEZONE || 'America/Santiago')};
    const allowedPageSizes = new Set([25, 50]);

    try {
      const stored = Number.parseInt(localStorage.getItem('pageLimit') || '', 10);
      if (allowedPageSizes.has(stored)) pageLimit = stored;
    } catch {
    }
    if (pageSizeEl) pageSizeEl.value = String(pageLimit);

    function clampPoll(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return pollMs;
      return Math.max(1500, Math.min(20000, Math.round(n)));
    }

    function scheduleNext(ms) {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(refresh, ms);
    }

    function toText(value) {
      if (value === null || value === undefined || value === '') return '—';
      return String(value);
    }

    function normalizePlateText(value) {
      if (!value || typeof value !== 'string') return '';
      const upper = value.trim().toUpperCase();
      if (!upper) return '';
      const mapped = upper.replace(/[\u0400-\u04FF\u0370-\u03FF]/g, (ch) => {
        const map = {
          'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'І': 'I', 'Ј': 'J',
          'З': 'Z',
          'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X'
        };
        return map[ch] || '';
      });
      return mapped.replace(/[^A-Z0-9]/g, '');
    }

    function plateDebugInfo(value) {
      const raw = typeof value === 'string' ? value : String(value ?? '');
      const normalized = normalizePlateText(raw);
      const chars = Array.from(raw).slice(0, 32).map((ch) => {
        const hex = (ch.codePointAt(0) || 0).toString(16).toUpperCase().padStart(4, '0');
        return 'U+' + hex + '(' + ch + ')';
      });
      return { raw, normalized, raw_len: raw.length, normalized_len: normalized.length, sample_codepoints: chars };
    }

    function isChileanPlate(plate) {
      if (!plate || typeof plate !== 'string') return false;
      const p = normalizePlateText(plate);
      if (/^[A-Z]{4}\d{2}$/.test(p) || /^[A-Z]{2}\d{4}$/.test(p)) return true;
      if (p.length === 6) {
        const mapDigit = (ch) => {
          if (ch === 'O' || ch === 'Q') return '0';
          if (ch === 'I') return '1';
          if (ch === 'Z') return '2';
          if (ch === 'S') return '5';
          if (ch === 'B') return '8';
          return ch;
        };
        const asModern = p.slice(0, 4) + mapDigit(p[4]) + mapDigit(p[5]);
        const asOld = p.slice(0, 2) + mapDigit(p[2]) + mapDigit(p[3]) + mapDigit(p[4]) + mapDigit(p[5]);
        return /^[A-Z]{4}\d{2}$/.test(asModern) || /^[A-Z]{2}\d{4}$/.test(asOld);
      }
      return false;
    }

    function formatDateTime(value) {
      if (!value) return '—';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);
      return d.toLocaleString('es-CL', {
        timeZone: displayTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }

    function formatDateOnly(value) {
      if (!value) return '—';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);
      return d.toLocaleDateString('es-CL', {
        timeZone: displayTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    }

    function safeHtml(text) {
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function safeJsonParse(text) {
      if (!text) return null;
      if (typeof text === 'object') return text;
      if (typeof text !== 'string') return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    const enrichCache = new Map();
    const enrichInFlight = new Set();
    const captureAtById = new Map();
    const plateById = new Map();
    let getApiCooldownUntilMs = 0;
    const enrichRetry = new Map();
    const enrichMaxPerHydrate = 25;
    const enrichConcurrency = 6;

    function isRateLimitedPayload(payload) {
      if (!payload || typeof payload !== 'object') return false;
      if (payload.reason === 'rate_limited') return true;
      if (payload.upstream_status === 429) return true;
      if (payload.status === 429) return true;
      return false;
    }

    function isTerminalGetApiPayload(payload) {
      if (!payload || typeof payload !== 'object') return false;
      const reason = typeof payload.reason === 'string' ? payload.reason : null;
      const upstream = payload && (payload.upstream_status || payload.status) ? (payload.upstream_status || payload.status) : null;
      if (reason === 'invalid_plate_format') return true;
      if (reason === 'invalid_plate' || upstream === 422) return true;
      if (reason === 'not_found' || upstream === 404) return true;
      if (reason === 'no_plate') return true;
      if (reason === 'missing_getapi_key' || upstream === 401) return true;
      if (reason === 'unauthorized' || reason === 'forbidden' || upstream === 403) return true;
      return false;
    }

    function isSuccessfulGetApiPayload(payload) {
      if (!payload || typeof payload !== 'object') return false;
      const data = payload.data;
      if (!data || typeof data !== 'object') return false;
      if (typeof data.fetched_at === 'string' && data.fetched_at) return true;
      if (data.vehicle && typeof data.vehicle === 'object') return true;
      if (data.appraisal && typeof data.appraisal === 'object') return true;
      return false;
    }

    function nextRetryDelayMs(attempt, payload) {
      const reason = payload && typeof payload === 'object' ? payload.reason : null;
      const upstream = payload && typeof payload === 'object' ? (payload.upstream_status || payload.status) : null;

      let base = 4000;
      if (reason === 'no_plate') base = 6000;
      else if (reason === 'invalid_plate' || upstream === 422) base = 15000;
      else if (reason === 'not_found' || upstream === 404) base = 15000;
      else if (reason === 'missing_getapi_key' || upstream === 401) base = 30000;
      else if (reason === 'upstream_error' || reason === 'internal_error') base = 6000;
      else if (isRateLimitedPayload(payload)) base = 60000;

      const n = Math.max(0, Number(attempt) || 0);
      const backoff = Math.min(60000, base * Math.pow(2, Math.min(n, 4)));
      return Math.round(backoff);
    }

    function renderCard(item) {
      const plate = item.license_plate || 'Sin patente';
      const title = safeHtml(plate);
      const rawImgUrl = item.image_url ?? item.image ?? null;
      let imgUrl = typeof rawImgUrl === 'string' ? rawImgUrl.trim() : null;
      if (!imgUrl && rawImgUrl && typeof rawImgUrl === 'object') {
        const id = rawImgUrl.id ?? rawImgUrl?.data?.id ?? null;
        if (typeof id === 'string' && id.trim()) imgUrl = id.trim();
      }

      function buildAssetUrl(assetId) {
        const u = new URL('/api/assets/' + assetId, window.location.origin);
        u.searchParams.set('width', '640');
        return u.toString();
      }

      const match = imgUrl ? imgUrl.match(/\\/assets\\/([0-9a-fA-F-]{36})/) : null;
      if (match && match[1]) {
        imgUrl = buildAssetUrl(match[1]);
      } else if (imgUrl && /^[0-9a-fA-F-]{36}$/.test(imgUrl)) {
        imgUrl = buildAssetUrl(imgUrl);
      } else if (imgUrl && imgUrl.startsWith('/')) {
        imgUrl = new URL(imgUrl, window.location.origin).toString();
      }
      const canShowImg = typeof imgUrl === 'string' && (imgUrl.startsWith('http') || imgUrl.startsWith('data:image'));
      const id = item && item.id ? String(item.id) : '';
      if (id) {
        captureAtById.set(id, item && item.timestamp ? item.timestamp : null);
        plateById.set(id, item && item.license_plate ? String(item.license_plate) : null);
      }
      const fields = [
        ['Fecha', formatDateTime(item.timestamp)],
        ['Tipo', toText(item.vehicle_type)],
        ['Color', toText(item.vehicle_color)],
        ['Velocidad', toText(item.speed)],
        ['Dirección', toText(item.direction)],
        ['Confianza', toText(item.confidence)],
        ['Cámara', toText(item.camera_id)],
        ['Ubicación', toText(item.location)]
      ];

      const img = canShowImg ? \`<div class="img"><img src="\${safeHtml(imgUrl)}" alt="snapshot" loading="lazy"></div>\` : '';

      let existingGetApi = null;
      if (id) {
        let fromField = null;
        if (item && item.getapi) {
          fromField = typeof item.getapi === 'string' ? safeJsonParse(item.getapi) : item.getapi;
        }
        if (fromField && typeof fromField === 'object' && ((typeof fromField.fetched_at === 'string' && fromField.fetched_at) || fromField.vehicle || fromField.appraisal)) {
          existingGetApi = fromField;
        }
      }

      let moreInner = \`<div class="section"><div class="moreTitle">Información del Vehículo</div><div class="row"><div class="k">Estado</div><div class="v">Cargando…</div></div></div>\`;
      if (id && existingGetApi) {
        const payload = { success: true, data: existingGetApi, cached: true };
        enrichCache.set(id, payload);
        moreInner = renderMoreData(payload, captureAtById.get(id));
      }

      const initialInfo = id
        ? \`<div class="moreBox" id="more-\${safeHtml(id)}">\${moreInner}</div>\`
        : \`<div class="moreBox"><div class="section"><div class="moreTitle">Información del Vehículo</div><div class="row"><div class="k">Estado</div><div class="v">Sin ID</div></div></div></div>\`;
      return \`<div class="card" data-id="\${safeHtml(id)}"><h2>\${title}</h2>\${img}\${initialInfo}</div>\`;
    }

    function formatMoney(value) {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return '—';
      try {
        return '$' + n.toLocaleString('es-CL');
      } catch {
        return '$' + String(n);
      }
    }

    function renderMoreData(payload, captureAt) {
      const data = payload && payload.data ? payload.data : null;
      if (!data) {
        const plate = payload && typeof payload.plate === 'string' ? payload.plate : null;
        const upstream = payload && (payload.upstream_status || payload.status) ? (payload.upstream_status || payload.status) : null;
        const reason = payload && typeof payload.reason === 'string' ? payload.reason : null;
        const message = payload && typeof payload.message === 'string' ? payload.message : null;

        let hint = 'No se pudo obtener información.';
        if (reason === 'missing_getapi_key' || upstream === 401) {
          hint = 'Falta configurar GETAPI_API_KEY en EasyPanel.';
        } else if (reason === 'rate_limited' || upstream === 429) {
          hint = 'GetAPI sin solicitudes (rate limit). Intenta más tarde.';
        } else if (reason === 'not_found' || upstream === 404) {
          hint = 'GetAPI no encontró la patente.';
        } else if (reason === 'invalid_plate_format') {
          hint = 'Formato de patente inválido.';
        } else if (reason === 'invalid_plate' || upstream === 422) {
          hint = 'Formato de patente inválido.';
        } else if (reason === 'no_plate') {
          hint = 'No hay patente para consultar.';
        }

        const extra = message ? (' · ' + message) : '';
        const plateRow = plate ? \`<div class="row"><div class="k">Patente</div><div class="v">\${safeHtml(plate)}</div></div>\` : '';
        const upRow = upstream ? \`<div class="row"><div class="k">Estado</div><div class="v">\${safeHtml(String(upstream))}</div></div>\` : '';
        return \`<div class="section"><div class="moreTitle">Sin información</div>\${plateRow}\${upRow}<div class="row"><div class="k">Detalle</div><div class="v">\${safeHtml(hint + extra)}</div></div></div>\`;
      }
      const vehicle = data.vehicle || null;
      const appraisal = data.appraisal || null;

      function pickDisplayText(value) {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (Array.isArray(value)) {
          const parts = value.map(pickDisplayText).filter(Boolean);
          return parts.length ? parts.join(', ') : null;
        }
        if (typeof value === 'object') {
          const candidates = [
            value.name,
            value.nombre,
            value.label,
            value.title,
            value.value,
            value.concesionPlantaRevisora,
            value.comuna,
            value.region,
            value.direccion,
            value.descripcion,
            value.description
          ];
          for (const c of candidates) {
            const t = pickDisplayText(c);
            if (t) return t;
          }
          return null;
        }
        return null;
      }

      const brand =
        vehicle?.brand?.name ||
        vehicle?.brand ||
        vehicle?.model?.brand?.name ||
        vehicle?.model?.brand ||
        '—';
      const model =
        vehicle?.version ||
        vehicle?.model?.name ||
        vehicle?.model ||
        '—';
      const typeVehicle =
        vehicle?.model?.typeVehicle?.name ||
        vehicle?.typeVehicle?.name ||
        vehicle?.typeVehicle ||
        '—';

      const rtPlantName =
        vehicle?.rtPlant?.name ||
        vehicle?.rtPlantName ||
        vehicle?.plantaRevisora?.concesionPlantaRevisora ||
        vehicle?.plantaRevisora?.name ||
        vehicle?.plantaRevisora?.nombre ||
        vehicle?.plantaRevisora ||
        vehicle?.rtStation?.name ||
        vehicle?.rtStationName ||
        vehicle?.rtCompany ||
        null;
      const rtPlantLocation =
        vehicle?.rtPlant?.location ||
        vehicle?.rtPlant?.address ||
        vehicle?.rtPlantAddress ||
        vehicle?.rtLocation ||
        vehicle?.rtCommune ||
        (vehicle?.plantaRevisora && typeof vehicle.plantaRevisora === 'object'
          ? (() => {
              const comuna = pickDisplayText(vehicle.plantaRevisora.comuna);
              const region = pickDisplayText(vehicle.plantaRevisora.region);
              if (comuna && region) return comuna + ', ' + region;
              return comuna || region || pickDisplayText(vehicle.plantaRevisora.direccion) || null;
            })()
          : null) ||
        null;
      const rtPlantHtml = [pickDisplayText(rtPlantName), pickDisplayText(rtPlantLocation)].filter(Boolean).map((t) => safeHtml(String(t))).join('<br>');

      const infoRows = [];
      infoRows.push(['Horario de captura', captureAt ? formatDateTime(captureAt) : '—']);
      infoRows.push(['Marca', brand]);
      infoRows.push(['Modelo', model]);
      infoRows.push(['Año', vehicle?.year || '—']);
      infoRows.push(['Tipo', typeVehicle]);
      infoRows.push(['Combustible', vehicle?.fuel || '—']);
      infoRows.push(['Color', vehicle?.color || vehicle?.model?.color || '—']);
      infoRows.push(['VIN', vehicle?.vinNumber || vehicle?.vin || '—']);
      infoRows.push(['N° Motor', vehicle?.engineNumber || '—']);
      infoRows.push(['Transmisión', vehicle?.transmission || '—']);

      const rtRows = [];
      rtRows.push(['Mes', vehicle?.monthRT || '—']);
      rtRows.push(['Fecha Vencimiento', vehicle?.rtDate && vehicle?.rtDate !== '0000-00-00 00:00:00' ? formatDateOnly(vehicle.rtDate) : '—']);
      rtRows.push(['Resultado', vehicle?.rtResult || '—']);
      rtRows.push(['Resultado Gases', vehicle?.rtResultGas || '—']);
      rtRows.push(['Planta Revisora', rtPlantHtml || '—', true]);

      const appraisalMin = appraisal?.precioUsado?.banda_min;
      const appraisalMax = appraisal?.precioUsado?.banda_max;
      const appraisalRange = (Number.isFinite(Number(appraisalMin)) && Number.isFinite(Number(appraisalMax)))
        ? \`\${formatMoney(appraisalMin)} - \${formatMoney(appraisalMax)}\`
        : '—';

      const appraisalRows = [];
      appraisalRows.push(['Precio Usado', appraisal?.precioUsado?.precio ? formatMoney(appraisal.precioUsado.precio) : '—']);
      appraisalRows.push(['Rango', appraisalRange]);
      appraisalRows.push(['Precio Retoma', appraisal?.precioRetoma ? formatMoney(appraisal.precioRetoma) : '—']);

      const renderRows = (rows) => rows.map(([k, v, isHtml]) => {
        if (isHtml) return \`<div class="row"><div class="k">\${safeHtml(k)}</div><div class="v">\${String(v || '—')}</div></div>\`;
        return \`<div class="row"><div class="k">\${safeHtml(k)}</div><div class="v">\${safeHtml(toText(v))}</div></div>\`;
      }).join('');

      const infoHtml = \`<div class="section"><div class="moreTitle">Información del Vehículo</div>\${renderRows(infoRows)}</div>\`;
      const rtHtml = \`<div class="section"><div class="moreTitle">Revisión Técnica</div>\${renderRows(rtRows)}</div>\`;
      const appraisalHtml = \`<div class="section"><div class="moreTitle">Tasación</div>\${renderRows(appraisalRows)}</div>\`;
      return \`\${infoHtml}\${rtHtml}\${appraisalHtml}\`;
    }

    function setMoreBoxHtml(id, html) {
      const box = document.getElementById('more-' + id);
      if (!box) return;
      box.innerHTML = html;
    }

    function hasSuccessfulGetApiCached(id) {
      if (!enrichCache.has(id)) return false;
      const payload = enrichCache.get(id);
      return isSuccessfulGetApiPayload(payload) || isTerminalGetApiPayload(payload);
    }

    function applyLoadingIfMissingGetApi(id, statusText) {
      if (!id) return;
      if (hasSuccessfulGetApiCached(id)) return;
      const st = statusText ? safeHtml(statusText) : 'Cargando…';
      setMoreBoxHtml(id, \`<div class="section"><div class="moreTitle">Información del Vehículo</div><div class="row"><div class="k">Estado</div><div class="v">\${st}</div></div></div>\`);
    }

    function applyEnrichToCard(id, payload) {
      if (!id) return;
      if (isSuccessfulGetApiPayload(payload)) {
        enrichRetry.delete(id);
        setMoreBoxHtml(id, renderMoreData(payload, captureAtById.get(id)));
        return;
      }

      if (isRateLimitedPayload(payload)) {
        getApiCooldownUntilMs = Math.max(getApiCooldownUntilMs, Date.now() + 60000);
        const attempt = (enrichRetry.get(id)?.attempts || 0) + 1;
        enrichRetry.set(id, { attempts: attempt, nextAtMs: Date.now() + nextRetryDelayMs(attempt, payload) });
        setMoreBoxHtml(id, renderMoreData(payload || { success: true, data: null }, captureAtById.get(id)));
        return;
      }

      if (isTerminalGetApiPayload(payload)) {
        enrichRetry.delete(id);
        setMoreBoxHtml(id, renderMoreData(payload || { success: true, data: null }, captureAtById.get(id)));
        return;
      }

      const attempt = (enrichRetry.get(id)?.attempts || 0) + 1;
      enrichRetry.set(id, { attempts: attempt, nextAtMs: Date.now() + nextRetryDelayMs(attempt, payload) });
      applyLoadingIfMissingGetApi(id, 'Reintentando…');
    }

    async function fetchMore(id) {
      const url = new URL('/api/detections/' + encodeURIComponent(id) + '/enrich', window.location.origin);
      const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!res.ok) return { success: true, data: null };
      return res.json();
    }

    async function fetchDetectionById(id) {
      const url = new URL('/api/detections/' + encodeURIComponent(id), window.location.origin);
      const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const payload = await res.json().catch(() => null);
      const item = payload && payload.data ? payload.data : null;
      if (!item) return null;
      let ga = item.getapi || null;
      if (typeof ga === 'string') ga = safeJsonParse(ga);
      if (ga && typeof ga === 'object' && ((typeof ga.fetched_at === 'string' && ga.fetched_at) || ga.vehicle || ga.appraisal)) {
        return { success: true, data: ga };
      }
      return null;
    }

    async function runPool(ids, limit, worker) {
      const pending = ids.slice();
      const n = Math.max(1, Math.min(limit, pending.length));
      const runners = Array.from({ length: n }, async () => {
        while (pending.length) {
          const id = pending.shift();
          await worker(id);
        }
      });
      await Promise.all(runners);
    }

    async function hydrateCardsWithGetApi() {
      if (!grid) return;
      if (Date.now() < getApiCooldownUntilMs) {
        const cards = Array.from(grid.querySelectorAll('.card[data-id]'));
        for (const el of cards) {
          const id = el.getAttribute('data-id') || '';
          if (!id) continue;
          if (hasSuccessfulGetApiCached(id)) {
            applyEnrichToCard(id, enrichCache.get(id));
          } else {
            applyLoadingIfMissingGetApi(id, 'En espera…');
          }
        }
        return;
      }

      const ids = Array.from(grid.querySelectorAll('.card[data-id]'))
        .map((el) => el.getAttribute('data-id') || '')
        .filter(Boolean);

      const now = Date.now();
      const pending = ids.filter((id) => {
        if (hasSuccessfulGetApiCached(id)) return false;
        if (enrichInFlight.has(id)) return false;
        const r = enrichRetry.get(id);
        if (r && typeof r.nextAtMs === 'number' && now < r.nextAtMs) return false;
        return true;
      });
      // Evitar recursos en patentes no chilenas: marcar como terminal y no agendar
      for (const id of pending.slice()) {
        const plate = plateById.get(id) || '';
        if (plate && !isChileanPlate(plate)) {
          console.warn('Patente marcada inválida en dashboard:', { id, ...plateDebugInfo(plate) });
          const payload = { success: true, data: null, reason: 'invalid_plate_format', plate };
          enrichCache.set(id, payload);
          applyEnrichToCard(id, payload);
        }
      }
      const eligible = pending.filter((id) => {
        const plate = plateById.get(id) || '';
        return !plate || isChileanPlate(plate);
      });
      const batch = eligible.slice(0, Math.max(1, enrichMaxPerHydrate));

      await runPool(batch, enrichConcurrency, async (id) => {
        if (Date.now() < getApiCooldownUntilMs) {
          if (hasSuccessfulGetApiCached(id)) {
            applyEnrichToCard(id, enrichCache.get(id));
          } else {
            applyLoadingIfMissingGetApi(id, 'En espera…');
          }
          return;
        }

        if (hasSuccessfulGetApiCached(id)) {
          applyEnrichToCard(id, enrichCache.get(id));
          return;
        }

        const p = plateById.get(id) || '';
        if (p && !isChileanPlate(p)) {
          console.warn('Patente marcada inválida en dashboard (worker):', { id, ...plateDebugInfo(p) });
          const payload = { success: true, data: null, reason: 'invalid_plate_format', plate: p };
          enrichCache.set(id, payload);
          applyEnrichToCard(id, payload);
          return;
        }

        const saved = await fetchDetectionById(id).catch(() => null);
        if (saved && isSuccessfulGetApiPayload(saved)) {
          enrichCache.set(id, saved);
          applyEnrichToCard(id, saved);
          return;
        }

        if (enrichInFlight.has(id)) return;
        enrichInFlight.add(id);
        try {
          const payload = await fetchMore(id).catch(() => null);
          if (payload) enrichCache.set(id, payload);
          applyEnrichToCard(id, payload);
        } finally {
          enrichInFlight.delete(id);
        }
      });
    }

    function setPage(newPage) {
      const n = Math.max(1, Number.parseInt(newPage, 10) || 1);
      currentPage = n;
      lastKey = null;
    }

    async function fetchDetections() {
      const url = new URL('/api/detections', window.location.origin);
      url.searchParams.set('page', String(currentPage));
      url.searchParams.set('limit', String(pageLimit));
      const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
      if (!res.ok) {
        const retryAfter = res.headers.get('retry-after');
        const err = new Error('HTTP ' + res.status);
        err.status = res.status;
        err.retryAfterMs = retryAfter ? (Number.parseInt(retryAfter, 10) * 1000) : null;
        throw err;
      }
      return res.json();
    }

    async function fetchIsapiStatus() {
      const res = await fetch(new URL('/isapi/status', window.location.origin).toString(), { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return null;
      return res.json();
    }

    function formatAgo(iso) {
      if (!iso) return '—';
      const t = new Date(iso).getTime();
      if (Number.isNaN(t)) return '—';
      const delta = Math.max(0, Date.now() - t);
      const s = Math.floor(delta / 1000);
      if (s < 60) return s + 's';
      const m = Math.floor(s / 60);
      if (m < 60) return m + 'm';
      const h = Math.floor(m / 60);
      return h + 'h';
    }

    async function refresh() {
      if (isRefreshing) return;
      isRefreshing = true;
      try {
        statusEl.textContent = 'Actualizando…';
        const isapi = await fetchIsapiStatus();
        if (isapi && isapi.isapi) {
          const ka = isapi.isapi.keepAlive;
          const tg = isapi.isapi.tollgateInfo;
          const kaAgo = ka && ka.lastAt ? formatAgo(ka.lastAt) : '—';
          const tgAgo = tg && tg.lastAt ? formatAgo(tg.lastAt) : '—';
          isapiEl.textContent = 'ISAPI KA ' + kaAgo + ' · TG ' + tgAgo;
        } else {
          isapiEl.textContent = 'ISAPI: —';
        }
        const payload = await fetchDetections();
        const items = (payload && payload.data) ? payload.data : [];
        pollMs = clampPoll(payload && payload.poll_after_ms);
        hasMore = Boolean(payload && payload.pagination && payload.pagination.hasMore);
        pageInfoEl.textContent = 'Página ' + currentPage + ' · ' + pageLimit;
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = !hasMore;

        if (items.length === 0) {
          grid.innerHTML = '';
          empty.style.display = '';
          statusEl.textContent = 'Sin datos';
          lastKey = null;
          return;
        }

        empty.style.display = 'none';
        const first = items[0];
        const newKey = first && (first.id || first.timestamp);
        if (newKey === lastKey && grid.childElementCount > 0) {
          statusEl.textContent = 'Al día';
          return;
        }

        lastKey = newKey;
        grid.innerHTML = items.map(renderCard).join('');
        hydrateCardsWithGetApi();
        statusEl.textContent = 'Al día';
      } catch (e) {
        statusEl.textContent = 'Error';
        const retryAfterMs = e && typeof e.retryAfterMs === 'number' ? e.retryAfterMs : null;
        pollMs = clampPoll(retryAfterMs || (pollMs * 2));
      } finally {
        isRefreshing = false;
        scheduleNext(pollMs);
      }
    }

    refreshBtn.addEventListener('click', refresh);
    prevPageBtn.addEventListener('click', () => {
      if (currentPage <= 1) return;
      setPage(currentPage - 1);
      refresh();
    });
    nextPageBtn.addEventListener('click', () => {
      if (!hasMore) return;
      setPage(currentPage + 1);
      refresh();
    });
    if (pageSizeEl) {
      pageSizeEl.addEventListener('change', () => {
        const next = Number.parseInt(pageSizeEl.value || '', 10);
        if (!allowedPageSizes.has(next)) return;
        pageLimit = next;
        try {
          localStorage.setItem('pageLimit', String(pageLimit));
        } catch {
        }
        setPage(1);
        refresh();
      });
    }
    refresh();
  </script>
</body>
</html>`);
});

app.get('/health', (req, res) => {
  const cfg = directus.getDirectusConfig();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'API lista para recibir detecciones de la cámara DAHUA',
    directus: {
      configured: Boolean(cfg?.baseUrl),
      base_origin: safeOrigin(cfg?.baseUrl),
      collection: cfg?.collection || null,
      has_token: Boolean(cfg?.token)
    },
    getapi: {
      configured: Boolean((process.env.GETAPI_API_KEY || process.env.GETAPI_KEY || process.env.GETAPI_X_API_KEY || process.env.X_API_KEY_GETAPI || '').trim()),
      base_url: (process.env.GETAPI_BASE_URL || 'https://chile.getapi.cl').trim().replace(/\/+$/, '')
    },
    app: {
      node_env: process.env.NODE_ENV || null,
      public_base_url: PUBLIC_BASE_URL || null
    }
  });
});

// Ruta de prueba para simular envío de cámara
app.get('/test', (req, res) => {
  res.json({
    message: 'Para probar el webhook, envía un POST a /api/webhook/detection',
    example: {
      PlateNumber: 'ABC123',
      VehicleType: 'Car',
      VehicleColor: 'White',
      Speed: 45.5,
      Direction: 'North',
      Confidence: 95.5,
      UTC: new Date().toISOString()
    }
  });
});

app.listen(PORT, () => {
  const cfg = directus.getDirectusConfig();
  if (!cfg?.baseUrl) {
    console.warn('⚠️ DIRECTUS_URL no está configurado. La API levantará, pero no podrá guardar detecciones.');
  }
  if (!cfg?.token) {
    console.warn('⚠️ DIRECTUS_TOKEN no está configurado. Assets y carga de imágenes pueden fallar.');
  }

  const base = PUBLIC_BASE_URL || `http://localhost:${PORT}`;
  console.log(`\n🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 Webhook URL: ${base}/api/webhook/detection`);
  console.log(`📊 Health check: ${base}/health`);
  const hasGetApiKey = Boolean((process.env.GETAPI_API_KEY || process.env.GETAPI_KEY || process.env.GETAPI_X_API_KEY || process.env.X_API_KEY_GETAPI || '').trim());
  const getApiBase = (process.env.GETAPI_BASE_URL || 'https://chile.getapi.cl').trim().replace(/\/+$/, '');
  console.log(`🔑 GETAPI_API_KEY ${hasGetApiKey ? 'configurado' : 'NO configurado'} · Base: ${getApiBase}`);
  console.log(`\n✅ Listo para recibir detecciones de la cámara DAHUA\n`);
});
