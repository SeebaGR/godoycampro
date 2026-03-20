const express = require('express');
const router = express.Router();
const cameraService = require('../services/cameraService');
const directus = require('../config/directus');

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
      return res.status(200).json({
        success: true,
        ignored: true,
        reason: validation.error
      });
    }

    void dedupeSeconds;

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
            const publicUrl = await directus.uploadImageBytes(bytes, {
              contentType: 'image/jpeg',
              filename: `${detectionData.license_plate || 'unknown'}-${Date.now()}.jpg`,
              title: `${detectionData.license_plate || 'unknown'}`
            });
            if (publicUrl) {
              detectionData.image_url = publicUrl;
              console.log('Imagen subida a Directus:', publicUrl.slice(0, 180));
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

    const result = await directus.listDetections({
      page: rawPage ?? '1',
      limit: rawLimit ?? '50',
      license_plate,
      start_date,
      end_date
    });

    res.json({ success: true, data: result.data, pagination: result.pagination });

  } catch (error) {
    console.error('Error obteniendo detecciones:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
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
