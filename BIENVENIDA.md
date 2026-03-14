# 👋 ¡Bienvenido al Sistema de Detección de Vehículos!

## 🎯 ¿Qué es este proyecto?

Este es un sistema completo para capturar y analizar datos de vehículos detectados por tu cámara DAHUA ITC413-PW4D-IZ3. La cámara detecta automáticamente vehículos, reconoce placas, y envía los datos a tu API que los almacena en Supabase para análisis posterior.

## 🚀 Inicio Rápido (5 minutos)

### 1️⃣ Instala las dependencias
```bash
npm install
```

### 2️⃣ Configura tus credenciales
```bash
cp .env.example .env
# Edita .env con tus credenciales de Supabase
```

### 3️⃣ Inicia el servidor
```bash
npm start
```

### 4️⃣ Prueba que funciona
```bash
npm run test:webhook
```

¡Listo! Tu API está corriendo. Ahora configura la cámara siguiendo `INICIO_RAPIDO.md`

## 📚 Documentación

### Para Empezar
- **[INICIO_RAPIDO.md](INICIO_RAPIDO.md)** ⭐ - Guía completa paso a paso
- **[RESUMEN.md](RESUMEN.md)** - Visión general del proyecto
- **[INSTALACION.md](INSTALACION.md)** - Instalación detallada

### Configuración
- **[CONFIGURACION_CAMARA.md](CONFIGURACION_CAMARA.md)** - Configurar la cámara DAHUA
- **[deploy-railway.md](deploy-railway.md)** - Desplegar en la nube

### Referencia
- **[README.md](README.md)** - Documentación técnica completa
- **[COMANDOS_UTILES.md](COMANDOS_UTILES.md)** - Comandos frecuentes
- **[FAQ.md](FAQ.md)** - Preguntas frecuentes
- **[CHECKLIST.md](CHECKLIST.md)** - Lista de verificación

### Navegación
- **[INDICE.md](INDICE.md)** - Índice completo de documentación

## 🏗️ Arquitectura Simple

```
┌─────────────┐
│   Cámara    │  Detecta vehículos y placas
│   DAHUA     │
└──────┬──────┘
       │ HTTP POST (JSON)
       ▼
┌─────────────┐
│  Tu API     │  Recibe y procesa datos
│  Node.js    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Supabase   │  Almacena datos
│ PostgreSQL  │
└─────────────┘
```

## 🎓 ¿Qué Puedes Hacer?

### Análisis de Tráfico
- Contar vehículos por hora/día
- Identificar horas pico
- Tipos de vehículos más comunes

### Seguridad
- Buscar placas específicas
- Historial de vehículos
- Alertas automáticas

### Publicidad Inteligente
- Adaptar contenido según tráfico
- Estadísticas de audiencia
- Optimización de horarios

## 💡 Ejemplos de Uso

### Consultar últimas detecciones
```bash
curl http://localhost:3000/api/detections
```

### Buscar una placa
```bash
curl http://localhost:3000/api/search/plate/ABC123
```

### Ver estadísticas
```bash
curl http://localhost:3000/api/stats
```

## 🛠️ Comandos Principales

```bash
# Iniciar servidor
npm start

# Modo desarrollo (auto-reload)
npm run dev

# Probar webhook
npm run test:webhook

# Ver ayuda
cat COMANDOS_UTILES.md
```

## 📊 Estructura del Proyecto

```
dahua-camera-api/
├── src/                    # Código fuente
│   ├── index.js           # Servidor principal
│   ├── routes/            # Endpoints de la API
│   ├── services/          # Lógica de negocio
│   └── config/            # Configuración
├── ejemplos/              # Scripts de ejemplo
├── *.md                   # Documentación
└── package.json           # Dependencias
```

## 🎯 Próximos Pasos

1. ✅ **Lee [INICIO_RAPIDO.md](INICIO_RAPIDO.md)** - Configuración completa
2. ✅ **Configura Supabase** - Crea la tabla de datos
3. ✅ **Configura la cámara** - Conecta con tu API
4. ✅ **Prueba el sistema** - Verifica que todo funciona
5. ✅ **Despliega en la nube** - Para acceso remoto (opcional)

## 💰 Costos

- **Supabase**: Gratis hasta 500MB
- **Railway**: $5 USD/mes de crédito gratis
- **Total**: $0-5 USD/mes para uso moderado

## 🆘 ¿Necesitas Ayuda?

### Problemas Comunes
- **No inicia el servidor**: Verifica que Node.js esté instalado
- **Error de Supabase**: Revisa credenciales en `.env`
- **Cámara no envía datos**: Verifica URL en configuración de cámara

### Recursos
- **FAQ**: [FAQ.md](FAQ.md)
- **Comandos**: [COMANDOS_UTILES.md](COMANDOS_UTILES.md)
- **Checklist**: [CHECKLIST.md](CHECKLIST.md)

## 🌟 Características

- ✅ Detección automática de vehículos
- ✅ Reconocimiento de placas (ANPR)
- ✅ API REST completa
- ✅ Almacenamiento en la nube
- ✅ Consultas y estadísticas
- ✅ Búsqueda por placa
- ✅ Filtros por fecha
- ✅ Exportación de datos
- ✅ Documentación completa

## 🔒 Seguridad

- Variables sensibles en `.env`
- Validación de datos
- CORS configurado
- Logs de actividad
- Recomendaciones de producción incluidas

## 📞 Soporte

Si tienes problemas:

1. Revisa [FAQ.md](FAQ.md)
2. Consulta [INICIO_RAPIDO.md](INICIO_RAPIDO.md)
3. Verifica logs: `npm start`
4. Prueba: `npm run test:webhook`

## 🎉 ¡Comienza Ahora!

```bash
# 1. Instala
npm install

# 2. Configura
cp .env.example .env
nano .env

# 3. Inicia
npm start

# 4. Prueba
npm run test:webhook
```

## 📖 Aprende Más

- **Node.js**: https://nodejs.org/
- **Express**: https://expressjs.com/
- **Supabase**: https://supabase.com/docs
- **DAHUA**: Manual de la cámara

---

## 🚦 Estado del Proyecto

✅ **Listo para usar**

- API funcional
- Integración con Supabase
- Webhook para cámara
- Endpoints de consulta
- Documentación completa
- Scripts de prueba
- Ejemplos incluidos

---

## 🎓 Lo Que Aprenderás

- Integración con cámaras IP
- APIs REST con Node.js
- Base de datos en la nube
- Webhooks y eventos
- Despliegue en producción

---

**¡Bienvenido a bordo! Comienza con [INICIO_RAPIDO.md](INICIO_RAPIDO.md) 🚀**

---

*Proyecto creado para capturar y analizar tráfico vehicular con cámara DAHUA ITC413-PW4D-IZ3*
