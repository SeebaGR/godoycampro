# API para Cámara DAHUA ITC413-PW4D-IZ3

Sistema para recibir datos de detección de vehículos y placas desde cámara DAHUA mediante HTTP POST y almacenarlos en Supabase.

> 📚 **[Ver Índice de Documentación](INDICE.md)** | 🚀 **[Inicio Rápido](INICIO_RAPIDO.md)** | 📋 **[Resumen del Proyecto](RESUMEN.md)**

## Arquitectura

La cámara DAHUA envía automáticamente HTTP requests con JSON a tu API cuando detecta vehículos:

```
Cámara DAHUA → HTTP POST (JSON) → Tu API → Supabase
```

## Configuración de la Cámara DAHUA

### 1. Acceso Inicial
- Conecta la cámara a tu red local
- Usa "ConfigTool" de DAHUA para encontrar la IP
- Accede vía navegador: `http://IP_CAMARA`
- Login: admin / contraseña (cambiar por defecto)

### 2. Configurar HTTP Notification (Webhook)

1. **Setup > Event > IVS (Intelligent Video Surveillance)**
   - Habilita "Traffic Statistics"
   - Habilita "License Plate Recognition (ANPR)"
   - Configura las reglas de detección

2. **Setup > Event > Traffic > HTTP Notification**
   - Habilita "HTTP Notification"
   - URL: `http://TU_SERVIDOR:3000/api/webhook/detection`
   - Method: POST
   - Content-Type: application/json
   - Habilita "Send Snapshot" (opcional)

3. **Configurar qué datos enviar:**
   - ✅ PlateNumber (Número de placa)
   - ✅ VehicleType (Tipo de vehículo)
   - ✅ VehicleColor (Color)
   - ✅ Speed (Velocidad)
   - ✅ Direction (Dirección)
   - ✅ Confidence (Confianza de detección)
   - ✅ UTC (Timestamp)

### 3. Acceso Remoto a tu API

Para que la cámara pueda enviar datos desde otra red:

#### Opción A: Servidor en la Nube (Recomendado)
- Despliega tu API en: Railway, Render, DigitalOcean, AWS, etc.
- La cámara enviará datos a: `https://tu-dominio.com/api/webhook/detection`

#### Opción B: Túnel (Para desarrollo/pruebas)
- Usa ngrok: `ngrok http 3000`
- Configura en cámara: `https://xxxxx.ngrok.io/api/webhook/detection`

#### Opción C: IP Pública + Port Forwarding
- Configura port forwarding en router (puerto 3000)
- Usa IP pública: `http://TU_IP_PUBLICA:3000/api/webhook/detection`
- ⚠️ Considera seguridad: usa HTTPS y autenticación

## Instalación del Proyecto

\`\`\`bash
# Instalar dependencias
npm install

# Copiar archivo de configuración
cp .env.example .env

# Editar .env con tus credenciales
nano .env
\`\`\`

## Configuración de Supabase

### 1. Crear tabla en Supabase

Ve a SQL Editor en tu proyecto Supabase y ejecuta:

\`\`\`sql
CREATE TABLE vehicle_detections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  license_plate VARCHAR(20),
  vehicle_type VARCHAR(50),
  vehicle_color VARCHAR(30),
  speed DECIMAL(5,2),
  direction VARCHAR(20),
  confidence DECIMAL(5,2),
  image_url TEXT,
  camera_id VARCHAR(50),
  location VARCHAR(100),
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsquedas rápidas
CREATE INDEX idx_timestamp ON vehicle_detections(timestamp DESC);
CREATE INDEX idx_license_plate ON vehicle_detections(license_plate);
CREATE INDEX idx_camera_id ON vehicle_detections(camera_id);
CREATE INDEX idx_created_at ON vehicle_detections(created_at DESC);
\`\`\`

### 2. Obtener credenciales

- URL del proyecto: Settings > API > Project URL
- Anon key: Settings > API > Project API keys > anon public

## Uso

\`\`\`bash
# Modo desarrollo
npm run dev

# Modo producción
npm start
\`\`\`

## Endpoints de la API

### Webhook (usado por la cámara)
- \`POST /api/webhook/detection\` - Recibe detecciones de la cámara

### Consultas
- \`GET /health\` - Estado del servidor
- \`GET /api/detections\` - Listar detecciones (con paginación y filtros)
- \`GET /api/detections/:id\` - Obtener detección específica
- \`GET /api/stats\` - Estadísticas de detecciones
- \`GET /api/search/plate/:plate\` - Buscar por placa

### Ejemplos de uso

\`\`\`bash
# Ver detecciones recientes
curl http://localhost:3000/api/detections

# Buscar por placa
curl http://localhost:3000/api/search/plate/ABC123

# Filtrar por fecha
curl "http://localhost:3000/api/detections?start_date=2024-01-01&end_date=2024-12-31"

# Ver estadísticas
curl http://localhost:3000/api/stats
\`\`\`

## Seguridad

- Cambia las credenciales por defecto de la cámara
- Usa HTTPS en producción
- Implementa autenticación en la API
- Configura firewall en el router
- Usa VPN para acceso remoto cuando sea posible
