// Servicio para procesar datos recibidos de la cámara DAHUA
class CameraService {
  // Normalizar datos recibidos de la cámara al formato de nuestra base de datos
  normalizeDetectionData(cameraData) {
    return {
      license_plate: cameraData.PlateNumber || cameraData.plateNumber || null,
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
    // Al menos debe tener placa o tipo de vehículo
    if (!data.license_plate && !data.vehicle_type) {
      return {
        valid: false,
        error: 'Datos insuficientes: se requiere al menos placa o tipo de vehículo'
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
