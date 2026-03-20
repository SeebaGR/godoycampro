// Servicio para procesar datos recibidos de la cámara DAHUA
const crypto = require('crypto');
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
    const redactedRawData = this.redactImageData(cameraData);

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
      raw_data: redactedRawData
    };
  }

  // Validar que los datos recibidos sean válidos
  validateDetectionData(data) {
    if (!data?.license_plate && !data?.vehicle_type) {
      return {
        valid: false,
        error: 'Datos insuficientes: se requiere al menos placa o tipo de vehículo'
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

  extractImageBase64(payload) {
    const parseMaybeJson = (value) => {
      if (typeof value !== 'string') return null;
      const t = value.trim();
      if (!t) return null;
      if (!(t.startsWith('{') || t.startsWith('['))) return null;
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    };

    const normalizeBase64 = (value) => {
      if (typeof value !== 'string') return null;
      let s = value.trim();
      if (!s) return null;
      const idx = s.indexOf('base64,');
      if (idx !== -1) s = s.slice(idx + 'base64,'.length).trim();
      if (s.length < 128) return null;
      return s;
    };

    const tryFromObject = (obj) => {
      if (!obj || typeof obj !== 'object') return null;

      const directCandidates = [
        obj?.Picture?.NormalPic?.Content,
        obj?.Picture?.NormalPic?.content,
        obj?.Picture?.VehiclePic?.Content,
        obj?.Picture?.VehiclePic?.content,
        obj?.NormalPic?.Content,
        obj?.VehiclePic?.Content
      ];
      for (const c of directCandidates) {
        const b64 = normalizeBase64(c);
        if (b64) return b64;
      }

      const nestedCandidates = [obj.__raw, obj.raw, obj.raw_data, obj.payload, obj.data, obj.info];
      for (const v of nestedCandidates) {
        const parsed = parseMaybeJson(v);
        if (parsed) {
          const b64 = tryFromObject(parsed);
          if (b64) return b64;
        }
      }

      return null;
    };

    if (payload == null) return null;
    if (typeof payload === 'string') {
      const parsed = parseMaybeJson(payload);
      return parsed ? tryFromObject(parsed) : null;
    }
    return tryFromObject(payload);
  }

  async uploadImageBase64ToStorage(supabaseClient, bucket, base64, meta) {
    if (!supabaseClient || !bucket || !base64) return null;

    let bytes;
    try {
      bytes = Buffer.from(base64, 'base64');
    } catch {
      return null;
    }

    if (!bytes || bytes.length < 32) return null;

    let contentType = 'image/jpeg';
    let ext = 'jpg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      contentType = 'image/png';
      ext = 'png';
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      contentType = 'image/jpeg';
      ext = 'jpg';
    }

    const cameraId = meta?.cameraId ? String(meta.cameraId).trim() : 'camera';
    const licensePlate = meta?.licensePlate ? String(meta.licensePlate).trim() : 'unknown';
    const ts = meta?.timestamp ? String(meta.timestamp).trim() : '';
    const tsSafe = ts ? ts.replace(/[:.]/g, '-').replace(/\s+/g, '_') : String(Date.now());
    const name = `${tsSafe}-${crypto.randomUUID()}.${ext}`;
    const path = `${cameraId}/${licensePlate}/${name}`;

    const { error } = await supabaseClient.storage.from(bucket).upload(path, bytes, {
      contentType,
      upsert: false
    });

    if (error) return null;

    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || null;
  }

  redactImageData(payload) {
    const tryClone = (value) => {
      try {
        return structuredClone(value);
      } catch {
        try {
          return JSON.parse(JSON.stringify(value));
        } catch {
          return value;
        }
      }
    };

    const parseMaybeJson = (value) => {
      if (typeof value !== 'string') return null;
      const t = value.trim();
      if (!t) return null;
      if (!(t.startsWith('{') || t.startsWith('['))) return null;
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    };

    const redactInObject = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      const pic = obj.Picture;
      if (pic && typeof pic === 'object') {
        if (pic.NormalPic && typeof pic.NormalPic === 'object' && typeof pic.NormalPic.Content === 'string') pic.NormalPic.Content = null;
        if (pic.VehiclePic && typeof pic.VehiclePic === 'object' && typeof pic.VehiclePic.Content === 'string') pic.VehiclePic.Content = null;
        if (pic.NormalPic && typeof pic.NormalPic === 'object' && typeof pic.NormalPic.content === 'string') pic.NormalPic.content = null;
        if (pic.VehiclePic && typeof pic.VehiclePic === 'object' && typeof pic.VehiclePic.content === 'string') pic.VehiclePic.content = null;
      }
      if (obj.NormalPic && typeof obj.NormalPic === 'object' && typeof obj.NormalPic.Content === 'string') obj.NormalPic.Content = null;
      if (obj.VehiclePic && typeof obj.VehiclePic === 'object' && typeof obj.VehiclePic.Content === 'string') obj.VehiclePic.Content = null;
      return obj;
    };

    if (!payload || typeof payload !== 'object') return payload;
    const cloned = tryClone(payload);
    redactInObject(cloned);

    if (cloned && typeof cloned === 'object' && typeof cloned.__raw === 'string') {
      const parsed = parseMaybeJson(cloned.__raw);
      if (parsed) {
        redactInObject(parsed);
        try {
          cloned.__raw = JSON.stringify(parsed);
        } catch {
        }
      }
    }

    return cloned;
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
