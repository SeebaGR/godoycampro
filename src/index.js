require('dotenv').config();
const express = require('express');
const cors = require('cors');
const detectionRoutes = require('./routes/detectionRoutes');
const cameraService = require('./services/cameraService');
const directus = require('./config/directus');

const app = express();
const PORT = process.env.PORT || 3000;

const isapiStatus = {
  keepAlive: { count: 0, lastAt: null, lastPath: null },
  deviceInfo: { count: 0, lastAt: null, lastPath: null },
  tollgateInfo: { count: 0, lastAt: null, lastPath: null },
  other: { count: 0, lastAt: null, lastPath: null }
};

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
      console.warn('ISAPI TollgateInfo ignorado:', validation.error);
      return res.status(200).send('OK');
    }

    const dedupeSeconds = Number.parseInt(process.env.DEDUPE_WINDOW_SECONDS ?? '900', 10) || 900;
    if (dedupeSeconds > 0 && detectionData.license_plate) {
      const last = await directus.getLatestByPlate(detectionData.license_plate);
      const lastAt = last?.date_created || last?.created_at || last?.timestamp || null;
      const lastMs = lastAt ? Date.parse(lastAt) : Number.NaN;
      if (Number.isFinite(lastMs) && (Date.now() - lastMs) <= (dedupeSeconds * 1000)) {
        console.warn(`ISAPI TollgateInfo duplicado reciente (<${Math.round(dedupeSeconds / 60)}m):`, detectionData.license_plate);
        return res.status(200).send('OK');
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
          const publicUrl = await directus.uploadImageBytes(bytes, {
            contentType: 'image/jpeg',
            filename: `${detectionData.license_plate || 'unknown'}-${Date.now()}.jpg`,
            title: `${detectionData.license_plate || 'unknown'}`
          });
          if (publicUrl) {
            detectionData.image_url = publicUrl;
            console.log('Imagen ISAPI subida a Directus:', publicUrl.slice(0, 180));
          }
        }
      }
    }

    const inserted = await directus.createDetection(detectionData);
    console.log('ISAPI TollgateInfo guardado exitosamente:', inserted?.id);
    return res.status(200).send('OK');
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
    .empty { padding: 18px; opacity: .75; border: 1px dashed rgba(127,127,127,.35); border-radius: 12px; }
    button { border: 1px solid rgba(127,127,127,.35); background: transparent; padding: 6px 10px; border-radius: 10px; cursor: pointer; }
    button:active { transform: translateY(1px); }
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
    let lastKey = null;

    function toText(value) {
      if (value === null || value === undefined || value === '') return '—';
      return String(value);
    }

    function formatTime(value) {
      if (!value) return '—';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);
      return d.toLocaleString();
    }

    function safeHtml(text) {
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderCard(item) {
      const plate = item.license_plate || 'Sin patente';
      const title = safeHtml(plate);
      const imgUrl = item.image_url;
      const canShowImg = typeof imgUrl === 'string' && (imgUrl.startsWith('http') || imgUrl.startsWith('data:image'));
      const fields = [
        ['Fecha', formatTime(item.timestamp)],
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
      return \`<div class="card"><h2>\${title}</h2>\${rows}\${img}</div>\`;
    }

    async function fetchDetections() {
      const url = new URL('/api/detections', window.location.origin);
      url.searchParams.set('page', '1');
      url.searchParams.set('limit', '24');
      const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
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
      }
    }

    refreshBtn.addEventListener('click', refresh);
    refresh();
    setInterval(refresh, 2500);
  </script>
</body>
</html>`);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'API lista para recibir detecciones de la cámara DAHUA'
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
  console.log(`\n🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 Webhook URL: http://localhost:${PORT}/api/webhook/detection`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`\n✅ Listo para recibir detecciones de la cámara DAHUA\n`);
});
