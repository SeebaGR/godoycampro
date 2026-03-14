require('dotenv').config();
const express = require('express');
const cors = require('cors');
const detectionRoutes = require('./routes/detectionRoutes');
const cameraService = require('./services/cameraService');
const supabase = require('./config/supabase');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
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

function parseIsapiEventBody(req) {
  const body = req.body;
  if (body == null) return { raw: null, data: {} };

  if (typeof body === 'string') {
    const trimmed = body.trim();
    const parsedJson = tryParseJson(trimmed);
    if (parsedJson) return { raw: trimmed, data: parsedJson };

    const xml = trimmed;
    const data = {
      PlateNumber: extractXmlTag(xml, ['PlateNumber', 'plateNumber', 'LicensePlate', 'Plate']),
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
        PlateNumber: extractXmlTag(xml, ['PlateNumber', 'plateNumber', 'LicensePlate', 'Plate']),
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

    return { raw: JSON.stringify(body), data: body };
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

app.post('/NotificationInfo/KeepAlive', (req, res) => {
  const { raw, data } = parseIsapiEventBody(req);
  if (raw) console.log('ISAPI KeepAlive recibido:', raw);
  else console.log('ISAPI KeepAlive recibido:', JSON.stringify(data, null, 2));
  res.status(200).send('OK');
});

app.post('/NotificationInfo/TollgateInfo', async (req, res) => {
  try {
    const { raw, data } = parseIsapiEventBody(req);

    if (raw) console.log('ISAPI TollgateInfo recibido (raw):', raw);
    else console.log('ISAPI TollgateInfo recibido:', JSON.stringify(data, null, 2));

    const detectionData = cameraService.normalizeDetectionData(data);
    const validation = cameraService.validateDetectionData(detectionData);

    if (!validation.valid) {
      console.warn('ISAPI TollgateInfo ignorado:', validation.error);
      return res.status(200).send('OK');
    }

    const { data: inserted, error } = await supabase
      .from('vehicle_detections')
      .insert([detectionData])
      .select();

    if (error) {
      console.error('❌ Error guardando ISAPI TollgateInfo en Supabase:', error);
      return res.status(200).send('OK');
    }

    console.log('ISAPI TollgateInfo guardado exitosamente:', inserted?.[0]?.id);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error procesando ISAPI TollgateInfo:', error);
    return res.status(200).send('OK');
  }
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
