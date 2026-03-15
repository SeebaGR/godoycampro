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

    return {
      license_plate: licensePlate,
      vehicle_type: cameraData.VehicleType || cameraData.vehicleType || null,
      vehicle_color: cameraData.VehicleColor || cameraData.vehicleColor || null,
      speed: cameraData.Speed || cameraData.speed || null,
      direction: cameraData.Direction || cameraData.direction || null,
      confidence: cameraData.Confidence || cameraData.confidence || null,
      timestamp: cameraData.UTC || cameraData.timestamp || new Date().toISOString(),
      image_url: cameraData.ImageUrl || cameraData.imageUrl || null,
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
