// Servicio para procesar datos recibidos de la cámara DAHUA
class CameraService {
  // Normalizar datos recibidos de la cámara al formato de nuestra base de datos
  normalizeDetectionData(cameraData) {
    const rawPlate = cameraData?.PlateNumber ?? cameraData?.plateNumber ?? null;
    let licensePlate = null;
    if (typeof rawPlate === 'string') {
      const cleaned = rawPlate.trim().replace(/\s+/g, '').toUpperCase();
      if (cleaned && cleaned !== 'SINPATENTE' && cleaned !== 'SINPLACA') {
        licensePlate = cleaned;
      }
    } else if (rawPlate != null) {
      licensePlate = String(rawPlate).trim().replace(/\s+/g, '').toUpperCase() || null;
    }

    const rawImageUrl =
      cameraData?.ImageUrl ??
      cameraData?.imageUrl ??
      cameraData?.ImageURL ??
      cameraData?.imageURL ??
      cameraData?.ImageURI ??
      cameraData?.imageURI ??
      cameraData?.PicUrl ??
      cameraData?.picUrl ??
      cameraData?.PicURL ??
      cameraData?.picURL ??
      null;
    const imageUrl = typeof rawImageUrl === 'string' ? (rawImageUrl.trim() || null) : (rawImageUrl != null ? String(rawImageUrl).trim() || null : null);

    return {
      license_plate: licensePlate,
      vehicle_type: cameraData.VehicleType || cameraData.vehicleType || null,
      vehicle_color: cameraData.VehicleColor || cameraData.vehicleColor || null,
      speed: cameraData.Speed || cameraData.speed || null,
      direction: cameraData.Direction || cameraData.direction || null,
      confidence: cameraData.Confidence || cameraData.confidence || null,
      timestamp: cameraData.UTC || cameraData.timestamp || new Date().toISOString(),
      image_url: imageUrl,
      camera_id: cameraData.SerialID || cameraData.cameraId || process.env.CAMERA_ID || 'DAHUA-001',
      location: process.env.CAMERA_LOCATION || 'Pantalla Publicitaria',
      raw_data: cameraData // Guardar datos originales por si acaso
    };
  }

  // Validar que los datos recibidos sean válidos
  validateDetectionData(data) {
    if (!data?.license_plate) {
      return {
        valid: false,
        error: 'Sin patente'
      };
    }

    return { valid: true };
  }

  async isRecentDuplicate(supabaseClient, licensePlate, windowMs) {
    if (!supabaseClient || !licensePlate) return false;
    const ms = Number.isFinite(windowMs) ? windowMs : 15000;

    const { data, error } = await supabaseClient
      .from('vehicle_detections')
      .select('id,created_at')
      .eq('license_plate', licensePlate)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) return false;
    const last = Array.isArray(data) ? data[0] : null;
    if (!last || !last.created_at) return false;

    const lastMs = Date.parse(last.created_at);
    if (!Number.isFinite(lastMs)) return false;

    return (Date.now() - lastMs) <= ms;
  }

  // Procesar imagen si viene en base64
  processImage(imageData) {
    if (!imageData) return null;
    
    // Si ya es una URL, retornarla
    if (imageData.startsWith('http')) {
      return imageData;
    }
    
    // Si es base64, podríamos subirla a Supabase Storage
    // Por ahora la retornamos tal cual
    return imageData;
  }
}

module.exports = new CameraService();
