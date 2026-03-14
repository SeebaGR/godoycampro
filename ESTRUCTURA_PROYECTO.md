# 📁 Estructura del Proyecto

```
dahua-camera-api/
│
├── src/                          # Código fuente
│   ├── config/
│   │   └── supabase.js          # Configuración de Supabase
│   ├── routes/
│   │   └── detectionRoutes.js   # Rutas de la API
│   ├── services/
│   │   └── cameraService.js     # Lógica de procesamiento
│   └── index.js                 # Punto de entrada
│
├── ejemplos/                     # Ejemplos y scripts de prueba
│   ├── consulta-detecciones.sh  # Script para consultar API
│   ├── payload-camara.json      # Ejemplo de datos de cámara
│   └── respuesta-api.json       # Ejemplo de respuesta
│
├── .env                         # Variables de entorno (NO subir a Git)
├── .env.example                 # Plantilla de variables
├── .gitignore                   # Archivos ignorados por Git
├── package.json                 # Dependencias del proyecto
├── test-webhook.js              # Script para probar webhook
│
├── README.md                    # Documentación principal
├── INICIO_RAPIDO.md            # Guía de inicio rápido
├── CONFIGURACION_CAMARA.md     # Guía detallada de cámara
├── deploy-railway.md           # Guía de despliegue
└── ESTRUCTURA_PROYECTO.md      # Este archivo
```

## 📄 Descripción de Archivos

### Archivos de Configuración

- **`.env`**: Variables de entorno (credenciales de Supabase, puerto, etc.)
- **`.env.example`**: Plantilla para crear tu `.env`
- **`.gitignore`**: Evita subir archivos sensibles a Git
- **`package.json`**: Dependencias y scripts del proyecto

### Código Fuente (`src/`)

- **`index.js`**: Servidor Express, punto de entrada de la aplicación
- **`config/supabase.js`**: Cliente de Supabase configurado
- **`routes/detectionRoutes.js`**: Endpoints de la API
- **`services/cameraService.js`**: Lógica para procesar datos de la cámara

### Documentación

- **`README.md`**: Documentación completa del proyecto
- **`INICIO_RAPIDO.md`**: Guía paso a paso para comenzar
- **`CONFIGURACION_CAMARA.md`**: Configuración detallada de la cámara DAHUA
- **`deploy-railway.md`**: Cómo desplegar en Railway

### Scripts y Ejemplos

- **`test-webhook.js`**: Prueba el webhook sin necesidad de la cámara
- **`ejemplos/`**: Scripts y ejemplos de uso

## 🔄 Flujo de Datos

```
1. Cámara detecta vehículo
   ↓
2. Envía POST a /api/webhook/detection
   ↓
3. detectionRoutes.js recibe request
   ↓
4. cameraService.js normaliza datos
   ↓
5. Se guarda en Supabase
   ↓
6. Responde a la cámara con éxito/error
```

## 🚀 Comandos Principales

```bash
# Instalar dependencias
npm install

# Iniciar servidor (producción)
npm start

# Iniciar con auto-reload (desarrollo)
npm run dev

# Probar webhook
npm run test:webhook
```

## 📊 Endpoints de la API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/webhook/detection` | Recibe detecciones de la cámara |
| GET | `/api/detections` | Lista todas las detecciones |
| GET | `/api/detections/:id` | Obtiene una detección específica |
| GET | `/api/search/plate/:plate` | Busca por placa |
| GET | `/api/stats` | Estadísticas generales |
| GET | `/health` | Estado del servidor |

## 🗄️ Esquema de Base de Datos

```sql
vehicle_detections
├── id (UUID, PK)
├── timestamp (TIMESTAMPTZ)
├── license_plate (VARCHAR)
├── vehicle_type (VARCHAR)
├── vehicle_color (VARCHAR)
├── speed (DECIMAL)
├── direction (VARCHAR)
├── confidence (DECIMAL)
├── image_url (TEXT)
├── camera_id (VARCHAR)
├── location (VARCHAR)
├── raw_data (JSONB)
└── created_at (TIMESTAMPTZ)
```

## 🔐 Seguridad

- Las credenciales están en `.env` (no se sube a Git)
- Usa HTTPS en producción
- Considera agregar autenticación al webhook
- Valida datos antes de guardar en BD

## 📦 Dependencias Principales

- **express**: Framework web
- **@supabase/supabase-js**: Cliente de Supabase
- **axios**: HTTP client (para pruebas)
- **dotenv**: Variables de entorno
- **cors**: CORS middleware

## 🎯 Próximas Mejoras

- [ ] Autenticación en webhook
- [ ] Dashboard web
- [ ] Alertas en tiempo real
- [ ] Exportación de reportes
- [ ] Análisis de patrones de tráfico
