// Servicio para procesar datos recibidos de la cámara DAHUA
const crypto = require('crypto');
class CameraService {
  parseDahuaDateTime(value) {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    if (!s) return null;
    const m = s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/);
    if (!m) return null;
    const date = m[1];
    const time = m[2];
    const ms = m[3] ? Number.parseInt(m[3].padEnd(3, '0'), 10) : 0;
    const [year, month, day] = date.split('-').map(n => Number.parseInt(n, 10));
    const [hour, minute, second] = time.split(':').map(n => Number.parseInt(n, 10));
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
    return { year, month, day, hour, minute, second, ms };
  }

  getTimeZone() {
    const tz = typeof process.env.CAMERA_TIMEZONE === 'string' ? process.env.CAMERA_TIMEZONE.trim() : '';
    return tz || 'America/Santiago';
  }

  getPartsInTimeZone(utcMs, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const out = {};
    for (const p of parts) {
      if (p.type === 'year') out.year = Number.parseInt(p.value, 10);
      if (p.type === 'month') out.month = Number.parseInt(p.value, 10);
      if (p.type === 'day') out.day = Number.parseInt(p.value, 10);
      if (p.type === 'hour') out.hour = Number.parseInt(p.value, 10);
      if (p.type === 'minute') out.minute = Number.parseInt(p.value, 10);
      if (p.type === 'second') out.second = Number.parseInt(p.value, 10);
    }
    if (![out.year, out.month, out.day, out.hour, out.minute, out.second].every(Number.isFinite)) return null;
    return out;
  }

  zonedLocalToUtcMs(local, timeZone) {
    if (!local) return Number.NaN;
    let guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.ms || 0);
    for (let i = 0; i < 3; i += 1) {
      const parts = this.getPartsInTimeZone(guess, timeZone);
      if (!parts) break;
      const desiredLocalUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.ms || 0);
      const actualLocalUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, local.ms || 0);
      const delta = desiredLocalUtc - actualLocalUtc;
      if (!Number.isFinite(delta) || delta === 0) break;
      guess += delta;
    }
    return guess;
  }

  pickBestTimestamp(cameraData) {
    const candidates = [
      cameraData?.UTC,
      cameraData?.timestamp,
      cameraData?.Timestamp,
      cameraData?.__rawObject?.Picture?.SnapInfo?.AccurateTime,
      cameraData?.__rawObject?.Picture?.SnapInfo?.SnapTime,
      cameraData?.Picture?.SnapInfo?.AccurateTime,
      cameraData?.Picture?.SnapInfo?.SnapTime,
      cameraData?.raw_data?.Picture?.SnapInfo?.AccurateTime,
      cameraData?.raw_data?.Picture?.SnapInfo?.SnapTime
    ];

    for (const c of candidates) {
      if (typeof c !== 'string') continue;
      const trimmed = c.trim();
      if (!trimmed) continue;

      const dahua = this.parseDahuaDateTime(trimmed);
      if (dahua) {
        const utcMs = this.zonedLocalToUtcMs(dahua, this.getTimeZone());
        if (Number.isFinite(utcMs)) return new Date(utcMs).toISOString();
      }

      const ms = Date.parse(trimmed);
      if (Number.isFinite(ms)) return new Date(ms).toISOString();
    }

    if (typeof cameraData?.__raw === 'string') {
      try {
        const parsed = JSON.parse(cameraData.__raw);
        const fromRaw = this.pickBestTimestamp(parsed);
        if (fromRaw) return fromRaw;
      } catch {
      }
    }

    return new Date().toISOString();
  }

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
      timestamp: this.pickBestTimestamp(cameraData),
      image_url: imageUrl,
      camera_id: cameraData.SerialID || cameraData.cameraId || process.env.CAMERA_ID || 'DAHUA-001',
      location: process.env.CAMERA_LOCATION || 'Pantalla Publicitaria',
      raw_data: redactedRawData
    };
  }

  // Validar que los datos recibidos sean válidos
  validateDetectionData(data) {
    const plate = data?.license_plate;
    if (typeof plate !== 'string' || !plate) {
      return { valid: false, error: 'Sin patente' };
    }

    const normalized = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isChilean = /^[A-Z]{4}\d{2}$/.test(normalized) || /^[A-Z]{2}\d{4}$/.test(normalized);
    if (!isChilean) {
      return { valid: false, error: 'Formato de patente inválido' };
    }

    return { valid: true };
  }

  async isRecentDuplicate(supabaseClient, licensePlate, windowMs) {
    if (!supabaseClient || !licensePlate) return false;
    const ms = Number.isFinite(windowMs) ? windowMs : 15 * 60 * 1000;

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
        obj?.Picture?.Content,
        obj?.Picture?.content,
        obj?.Picture?.PicData,
        obj?.Picture?.picData,
        obj?.Picture?.CutoutPic?.Content,
        obj?.Picture?.CutoutPic?.content,
        obj?.Picture?.NormalPic?.Content,
        obj?.Picture?.NormalPic?.content,
        obj?.Picture?.VehiclePic?.Content,
        obj?.Picture?.VehiclePic?.content,
        obj?.Picture?.TrafficCar?.VehiclePic?.Content,
        obj?.Picture?.TrafficCar?.VehiclePic?.content,
        obj?.Picture?.TrafficCar?.NormalPic?.Content,
        obj?.Picture?.TrafficCar?.NormalPic?.content,
        obj?.PicData,
        obj?.picData,
        obj?.ImageData,
        obj?.imageData,
        obj?.NormalPic?.content,
        obj?.NormalPic?.Content,
        obj?.VehiclePic?.content,
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

      const nestedObjects = [obj.__rawObject, obj.__raw_object, obj.rawObject, obj.raw_object];
      for (const v of nestedObjects) {
        const b64 = tryFromObject(v);
        if (b64) return b64;
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
        if (pic.CutoutPic && typeof pic.CutoutPic === 'object' && typeof pic.CutoutPic.Content === 'string') pic.CutoutPic.Content = null;
        if (pic.CutoutPic && typeof pic.CutoutPic === 'object' && typeof pic.CutoutPic.content === 'string') pic.CutoutPic.content = null;
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
    if (cloned && typeof cloned === 'object' && cloned.__rawObject && typeof cloned.__rawObject === 'object') {
      redactInObject(cloned.__rawObject);
    }

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
