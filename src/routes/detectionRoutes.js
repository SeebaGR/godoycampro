const express = require('express');
const router = express.Router();
const cameraService = require('../services/cameraService');
const supabase = require('../config/supabase');

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

    if (dedupeSeconds > 0 && detectionData.license_plate) {
      const isDup = await cameraService.isRecentDuplicate(supabase, detectionData.license_plate, dedupeSeconds * 1000);
      if (isDup) {
        return res.status(200).json({
          success: true,
          ignored: true,
          reason: `Duplicado reciente (<${Math.round(dedupeSeconds / 60)}m)`
        });
      }
    }

    if (!detectionData.image_url) {
      const base64 = cameraService.extractImageBase64(req.body);
      if (base64) {
        const bucket = process.env.SUPABASE_PHOTOS_BUCKET || 'FotosAutos';
        const publicUrl = await cameraService.uploadImageBase64ToStorage(supabase, bucket, base64, {
          cameraId: detectionData.camera_id,
          licensePlate: detectionData.license_plate,
          timestamp: detectionData.timestamp
        });
        if (publicUrl) {
          detectionData.image_url = publicUrl;
          console.log('Imagen subida a Storage:', publicUrl.slice(0, 180));
        }
      }
    }

    // Guardar en Supabase
    const { data, error } = await supabase
      .from('vehicle_detections')
      .insert([detectionData])
      .select();

    if (error) {
      console.error('❌ Error guardando en Supabase:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }

    console.log('Detección guardada exitosamente:', data[0].id);

    res.json({ 
      success: true, 
      message: 'Detección guardada correctamente',
      id: data[0].id 
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

    const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(rawLimit ?? '50', 10) || 50));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('vehicle_detections')
      .select('*')
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit);

    // Filtros opcionales
    if (license_plate) {
      query = query.ilike('license_plate', `%${license_plate}%`);
    }
    if (start_date) {
      query = query.gte('timestamp', start_date);
    }
    if (end_date) {
      query = query.lte('timestamp', end_date);
    }

    const { data, error } = await query;

    if (error) throw error;

    const items = Array.isArray(data) ? data : [];
    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;

    res.json({
      success: true,
      data: sliced,
      pagination: {
        page,
        limit,
        hasMore,
        nextPage: hasMore ? page + 1 : null
      }
    });

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
    const { data, error } = await supabase
      .from('vehicle_detections')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

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

    let query = supabase
      .from('vehicle_detections')
      .select('vehicle_type, vehicle_color, direction');

    if (start_date) query = query.gte('timestamp', start_date);
    if (end_date) query = query.lte('timestamp', end_date);

    const { data, error } = await query;

    if (error) throw error;

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
    const { data, error } = await supabase
      .from('vehicle_detections')
      .select('*')
      .ilike('license_plate', `%${req.params.plate}%`)
      .order('timestamp', { ascending: false });

    if (error) throw error;

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
