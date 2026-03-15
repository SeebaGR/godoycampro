const express = require('express');
const router = express.Router();
const cameraService = require('../services/cameraService');
const supabase = require('../config/supabase');

// Endpoint para recibir detecciones desde la cámara DAHUA
router.post('/webhook/detection', async (req, res) => {
  try {
    console.log('Detección recibida de la cámara:', JSON.stringify(req.body, null, 2));

    // Normalizar datos
    const detectionData = cameraService.normalizeDetectionData(req.body);

    // Validar datos
    const validation = cameraService.validateDetectionData(detectionData);
    if (!validation.valid) {
      return res.status(400).json({ 
        success: false, 
        error: validation.error 
      });
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
