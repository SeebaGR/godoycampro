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
    .moreTitle { font-weight: 650; font-size: 12px; margin-bottom: 8px; }
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

    function safeHtml(text) {
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

      const match = imgUrl ? imgUrl.match(/\\/assets\\/([0-9a-fA-F-]{36})/) : null;
      if (match && match[1]) {
        imgUrl = new URL('/api/assets/' + match[1], window.location.origin).toString();
      } else if (imgUrl && /^[0-9a-fA-F-]{36}$/.test(imgUrl)) {
        imgUrl = new URL('/api/assets/' + imgUrl, window.location.origin).toString();
      } else if (imgUrl && imgUrl.startsWith('/')) {
        imgUrl = new URL(imgUrl, window.location.origin).toString();
      }
      const canShowImg = typeof imgUrl === 'string' && (imgUrl.startsWith('http') || imgUrl.startsWith('data:image'));
      const id = item && item.id ? String(item.id) : '';
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

      const rows = fields.map(([k, v]) => \`<div class="row"><div class="k">\${safeHtml(k)}</div><div class="v">\${safeHtml(v)}</div></div>\`).join('');
      const img = canShowImg ? \`<div class="img"><img src="\${safeHtml(imgUrl)}" alt="snapshot" loading="lazy"></div>\` : '';
      const actions = id ? \`<div class="actions"><button class="more" data-id="\${safeHtml(id)}" type="button">Ver más</button></div>\` : '';
      const more = id ? \`<div class="moreBox" id="more-\${safeHtml(id)}" hidden></div>\` : '';
      return \`<div class="card" data-id="\${safeHtml(id)}"><h2>\${title}</h2>\${rows}\${img}\${actions}\${more}</div>\`;
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

    function renderMoreData(payload) {
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
        } else if (reason === 'invalid_plate' || upstream === 422) {
          hint = 'Formato de patente inválido.';
        } else if (reason === 'no_plate') {
          hint = 'No hay patente para consultar.';
        }

        const extra = message ? (' · ' + message) : '';
        const plateRow = plate ? `<div class="row"><div class="k">Patente</div><div class="v">${safeHtml(plate)}</div></div>` : '';
        const upRow = upstream ? `<div class="row"><div class="k">Estado</div><div class="v">${safeHtml(String(upstream))}</div></div>` : '';
        return `<div class="moreTitle">Sin información</div>${plateRow}${upRow}<div class="row"><div class="k">Detalle</div><div class="v">${safeHtml(hint + extra)}</div></div>`;
      }
      const vehicle = data.vehicle || null;
      const appraisal = data.appraisal || null;

      const rows = [];
      rows.push(['Patente', data.plate || '—']);
      rows.push(['Marca', vehicle?.brand?.name || vehicle?.brand || '—']);
      rows.push(['Modelo', vehicle?.model?.name || vehicle?.model || '—']);
      rows.push(['Año', vehicle?.year || '—']);
      rows.push(['Color', vehicle?.color || vehicle?.model?.color || '—']);
      rows.push(['VIN', vehicle?.vinNumber || vehicle?.vin || '—']);
      rows.push(['N° Motor', vehicle?.engineNumber || '—']);
      rows.push(['Transmisión', vehicle?.transmission || '—']);
      rows.push(['Puertas', vehicle?.doors || '—']);
      rows.push(['RT Mes', vehicle?.monthRT || '—']);
      rows.push(['RT Vence', vehicle?.rtDate && vehicle?.rtDate !== '0000-00-00 00:00:00' ? formatDateTime(vehicle.rtDate) : '—']);
      rows.push(['RT Resultado', vehicle?.rtResult || '—']);
      rows.push(['RT Gas', vehicle?.rtResultGas || '—']);
      rows.push(['Tasación usado', appraisal?.precioUsado?.precio ? formatMoney(appraisal.precioUsado.precio) : '—']);
      rows.push(['Tasación retoma', appraisal?.precioRetoma ? formatMoney(appraisal.precioRetoma) : '—']);
      const htmlRows = rows.map(([k, v]) => \`<div class="row"><div class="k">\${safeHtml(k)}</div><div class="v">\${safeHtml(toText(v))}</div></div>\`).join('');
      return \`<div class="moreTitle">Información vehículo</div>\${htmlRows}\`;
    }

    async function fetchMore(id) {
      const url = new URL('/api/detections/' + encodeURIComponent(id) + '/enrich', window.location.origin);
      const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!res.ok) return { success: true, data: null };
      return res.json();
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
    grid.addEventListener('click', async (ev) => {
      const btn = ev && ev.target && ev.target.closest ? ev.target.closest('button.more') : null;
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (!id) return;
      const box = document.getElementById('more-' + id);
      if (!box) return;
      const isHidden = box.hasAttribute('hidden');
      if (!isHidden) {
        box.setAttribute('hidden', '');
        btn.textContent = 'Ver más';
        return;
      }
      btn.textContent = 'Cargando…';
      box.removeAttribute('hidden');
      if (!box.getAttribute('data-loaded')) {
        const payload = await fetchMore(id).catch(() => ({ success: true, data: null }));
        box.innerHTML = renderMoreData(payload);
        if (payload && payload.data) {
          box.setAttribute('data-loaded', '1');
        }
      }
      btn.textContent = 'Ocultar';
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
  console.log(`\n✅ Listo para recibir detecciones de la cámara DAHUA\n`);
});
