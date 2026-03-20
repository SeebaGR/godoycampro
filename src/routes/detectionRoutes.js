const express = require('express');
const router = express.Router();
const cameraService = require('../services/cameraService');
const directus = require('../config/directus');

const detectionsCache = new Map();

router.get('/assets/:id', async (req, res) => {
  try {
    const { baseUrl, token } = directus.getDirectusConfig();
    if (!baseUrl) return res.status(500).send('DIRECTUS_URL no está configurado');
    if (!token) return res.status(500).send('DIRECTUS_TOKEN no está configurado');

    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).send('id requerido');

    const upstream = await fetch(`${baseUrl}/assets/${encodeURIComponent(id)}`, {
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
    const dedupeSeconds = Number.parseInt(process.env.DEDUPE_WINDOW_SECONDS ?? '900', 10) || 900;

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

    // Normalizar datos
    const detectionData = cameraService.normalizeDetectionData(req.body);
    console.log('Detección normalizada:', {
      license_plate: detectionData.license_plate,
      timestamp: detectionData.timestamp,
      has_image_url: Boolean(detectionData.image_url),
      image_url_preview: typeof detectionData.image_url === 'string' ? detectionData.image_url.slice(0, 160) : null
    });

    // Validar datos
    const validation = cameraService.validateDetectionData(detectionData);
    if (!validation.valid) {
      console.warn('Detección ignorada:', {
        reason: validation.error,
        license_plate: detectionData.license_plate,
        timestamp: detectionData.timestamp
      });
      return res.status(200).json({
        success: true,
        ignored: true,
        reason: validation.error
      });
    }

    if (dedupeSeconds > 0 && detectionData.license_plate) {
      const latest = await directus.getLatestTimestampByPlate(detectionData.license_plate);
      const lastMs = latest?.timestamp ? Date.parse(latest.timestamp) : Number.NaN;
      const currentMs = detectionData.timestamp ? Date.parse(detectionData.timestamp) : Number.NaN;
      if (Number.isFinite(lastMs) && Number.isFinite(currentMs)) {
        const deltaMs = currentMs - lastMs;
        if (deltaMs >= 0 && deltaMs <= (dedupeSeconds * 1000)) {
          console.warn('Detección ignorada (duplicado por placa):', {
            license_plate: detectionData.license_plate,
            delta_seconds: Math.round(deltaMs / 1000),
            window_seconds: dedupeSeconds
          });
          return res.status(200).json({
            success: true,
            ignored: true,
            reason: `Duplicado reciente (<${Math.round(dedupeSeconds / 60)}m)`
          });
        }
        if (deltaMs < 0) {
          console.warn('Detección ignorada (fuera de orden):', {
            license_plate: detectionData.license_plate,
            current: detectionData.timestamp,
            last: latest.timestamp
          });
          return res.status(200).json({
            success: true,
            ignored: true,
            reason: 'Evento fuera de orden'
          });
        }
      }
    }

    if (!detectionData.image_url) {
      const base64 = cameraService.extractImageBase64(req.body);
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
              console.log('Imagen subida a Directus:', uploaded.assetUrl?.slice(0, 180) || uploaded.fileId);
            }
          } catch (e) {
            console.error('Error subiendo imagen a Directus (se continúa sin imagen):', e?.message || e);
          }
        }
      }
    }

    const inserted = await directus.createDetection(detectionData);
    console.log('Detección guardada exitosamente:', inserted?.id);

    res.json({ 
      success: true, 
      message: 'Detección guardada correctamente',
      id: inserted?.id || null
    });

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

    const cacheMs = Number.parseInt(process.env.DETECTIONS_CACHE_MS ?? '2000', 10) || 2000;
    const minPollMs = Number.parseInt(process.env.DETECTIONS_MIN_POLL_MS ?? '2500', 10) || 2500;
    const maxPollMs = Number.parseInt(process.env.DETECTIONS_MAX_POLL_MS ?? '20000', 10) || 20000;
    const basePollMs = Math.min(maxPollMs, Math.max(minPollMs, cacheMs));
    const cacheKey = JSON.stringify({
      page: rawPage ?? '1',
      limit: rawLimit ?? '50',
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
      limit: rawLimit ?? '50',
      license_plate,
      start_date,
      end_date
    });
    const elapsedMs = Date.now() - startedAt;
    const pollAfterMs = Math.min(maxPollMs, Math.max(basePollMs, Math.round(elapsedMs * 1.25)));

    const payload = { success: true, data: result.data, pagination: result.pagination, poll_after_ms: pollAfterMs };
    if (cacheMs > 0) {
      detectionsCache.set(cacheKey, { expiresAt: Date.now() + cacheMs, payload });
    }
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
    res.status(502).json({ 
      success: false, 
      error: error?.message || 'Error consultando Directus',
      retry_after_ms: retryAfterMs
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
