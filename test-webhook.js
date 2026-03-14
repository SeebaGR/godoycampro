// Script para probar el webhook sin necesidad de la cámara
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';

// Datos de ejemplo que simula lo que envía la cámara DAHUA
const testData = {
  PlateNumber: 'ABC123',
  VehicleType: 'Car',
  VehicleColor: 'White',
  Speed: 45.5,
  Direction: 'North',
  Confidence: 95.5,
  UTC: new Date().toISOString(),
  SerialID: 'DAHUA-TEST-001',
  ImageUrl: null
};

async function testWebhook() {
  console.log('🧪 Probando webhook...\n');
  console.log('Datos de prueba:', JSON.stringify(testData, null, 2));
  console.log('\nEnviando a:', `${API_URL}/api/webhook/detection\n`);

  try {
    const response = await axios.post(
      `${API_URL}/api/webhook/detection`,
      testData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Respuesta exitosa:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('\n✅ Webhook funcionando correctamente!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Respuesta del servidor:', error.response.data);
    }
  }
}

// Ejecutar prueba
testWebhook();
