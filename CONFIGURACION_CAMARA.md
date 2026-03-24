# Guía Detallada de Configuración - Cámara DAHUA ITC413-PW4D-IZ3

## Paso 1: Acceso Inicial

1. Conecta la cámara a tu red mediante cable Ethernet
2. Descarga "ConfigTool" desde el sitio de DAHUA
3. Ejecuta ConfigTool para encontrar la IP de la cámara
4. Accede desde el navegador: `http://IP_DE_LA_CAMARA`
5. Usuario por defecto: `admin` / Contraseña: (la que configuraste)

## Paso 2: Configuración de Red

### Asignar IP Estática (Recomendado)

1. Ve a: **Setup > Network > TCP/IP**
2. Cambia de DHCP a Static
3. Configura:
   - IP Address: 192.168.1.100 (ejemplo)
   - Subnet Mask: 255.255.255.0
   - Gateway: 192.168.1.1 (tu router)
   - DNS: 8.8.8.8
4. Guarda y reinicia la cámara

## Paso 3: Configurar Detección de Vehículos

### 3.1 Habilitar IVS (Intelligent Video Surveillance)

1. **Setup > Event > IVS**
2. Habilita "IVS Enable"
3. Selecciona "Traffic Statistics"
4. Dibuja la línea de detección en la imagen
5. Configura dirección de conteo

### 3.2 Configurar ANPR (Reconocimiento de Placas)

1. **Setup > Event > Traffic**
2. Habilita "License Plate Recognition"
3. Configura:
   - País/Región: (tu país)
   - Tipo de placa: (según tu región)
   - Confianza mínima: 70-80%
4. Ajusta área de detección

### 3.3 Configurar Snapshot

1. **Setup > Storage > Snapshot**
2. Habilita "Snapshot"
3. Configura:
   - Calidad: Alta
   - Frecuencia: Por evento
   - Cantidad: 1-3 imágenes por evento

## Paso 4: Configurar HTTP Notification (CRÍTICO)

### 4.1 Configuración Básica

1. **Setup > Event > HTTP Notification**
2. Habilita "HTTP Notification"
3. Configura:
   ```
   URL: http://TU_SERVIDOR:3000/api/webhook/detection
   Method: POST
   Content-Type: application/json
   ```

### 4.2 Formato de Datos JSON

Configura los campos que la cámara enviará:

```json
{
  "PlateNumber": "${PlateNumber}",
  "VehicleType": "${VehicleType}",
  "VehicleColor": "${VehicleColor}",
  "Speed": ${Speed},
  "Direction": "${Direction}",
  "Confidence": ${Confidence},
  "UTC": "${UTC}",
  "SerialID": "${SerialID}",
  "ImageUrl": "${ImageUrl}"
}
```

### 4.3 Variables Disponibles

La cámara DAHUA soporta estas variables:

- `${PlateNumber}` - Número de placa detectado
- `${VehicleType}` - Tipo: Car, Truck, Bus, Motorcycle, etc.
- `${VehicleColor}` - Color: White, Black, Red, Blue, etc.
- `${Speed}` - Velocidad en km/h
- `${Direction}` - Dirección: North, South, East, West
- `${Confidence}` - Confianza de detección (0-100)
- `${UTC}` - Timestamp UTC
- `${SerialID}` - ID serial de la cámara
- `${ImageUrl}` - URL de la imagen capturada

## Paso 5: Configurar Acceso Remoto

### Opción A: Usando Servicio en la Nube

1. Despliega tu API en un servicio cloud (Railway, Render, etc.)
2. Obtén la URL pública: `https://tu-api.railway.app`
3. En la cámara, configura:
   ```
   URL: https://tu-api.railway.app/api/webhook/detection
   ```

### Opción B: Usando ngrok (Desarrollo)

1. Instala ngrok: `npm install -g ngrok`
2. Ejecuta: `ngrok http 3000`
3. Copia la URL: `https://xxxx.ngrok.io`
4. Configura en cámara:
   ```
   URL: https://xxxx.ngrok.io/api/webhook/detection
   ```

### Opción C: IP Pública + Port Forwarding

1. En tu router, configura Port Forwarding:
   - Puerto externo: 3000
   - Puerto interno: 3000
   - IP destino: IP de tu servidor
2. Obtén tu IP pública: `curl ifconfig.me`
3. Configura en cámara:
   ```
   URL: http://TU_IP_PUBLICA:3000/api/webhook/detection
   ```

## Paso 6: Pruebas

### 6.1 Probar Detección

1. Ve a: **Setup > Event > IVS > Test**
2. Simula un vehículo pasando
3. Verifica que se genere el evento

### 6.2 Probar HTTP Notification

1. Inicia tu API: `npm start`
2. Genera un evento de prueba en la cámara
3. Verifica en los logs de tu API:
   ```
   📥 Detección recibida de la cámara: {...}
   ✅ Detección guardada exitosamente
   ```

### 6.3 Verificar en Supabase

1. Accede a tu proyecto Supabase
2. Ve a: Table Editor > vehicle_detections
3. Verifica que aparezcan los registros

## Solución de Problemas

### La cámara no envía datos

1. Verifica conectividad:
   ```bash
   ping IP_DE_LA_CAMARA
   ```

2. Verifica que la URL sea accesible desde la red de la cámara:
   ```bash
   curl -X POST http://TU_SERVIDOR:3000/api/webhook/detection
   ```

3. Revisa logs de la cámara:
   - Setup > Maintenance > Log
   - Busca errores de HTTP

### Datos incompletos

1. Verifica configuración de campos JSON
2. Asegúrate que todas las variables estén correctas
3. Revisa logs de tu API para ver qué llega

### Baja precisión en detección

1. Ajusta iluminación de la cámara
2. Configura mejor el área de detección
3. Aumenta resolución de captura
4. Ajusta ángulo de la cámara (30-45° recomendado)

## Mantenimiento

### Limpieza Regular

- Limpia el lente cada semana
- Verifica conexiones de red
- Revisa logs de errores

### Actualizaciones

- Mantén firmware actualizado
- Backup de configuración antes de actualizar
- Prueba después de cada actualización

## Seguridad

1. **Cambia contraseña por defecto**
2. **Deshabilita servicios no usados**
3. **Usa HTTPS en producción**
4. **Configura firewall**
5. **Limita acceso por IP si es posible**
6. **Monitorea intentos de acceso**
