import { useState, useRef } from 'react';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButton,
  IonIcon,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonSpinner,
  IonText,
  IonImg,
  IonButtons,
  IonMenuButton,
  IonBadge,
} from '@ionic/react';
import { camera, refresh, scan } from 'ionicons/icons';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import './Home.css';

interface ScanResult {
  plate: string;
  confidence: number;
  timestamp: Date;
  vehicleData?: VehicleData | null;
}

interface VehicleData {
  licensePlate?: string;
  year?: number;
  color?: string;
  fuel?: string;
  vinNumber?: string;
  engineNumber?: string;
  engine?: string;
  transmission?: string;
  doors?: number;
  model?: {
    name?: string;
    typeVehicle?: {
      name?: string;
    };
  };
  brand?: {
    name?: string;
  };
  monthRT?: string;
  rtDate?: string | null;
  rtResult?: string | null;
  rtResultGas?: string | null;
  plantaRevisora?: {
    codPrt?: string;
    region?: string;
    comuna?: string;
    concesionPlantaRevisora?: string;
    direccion?: string;
  };
  appraisal?: {
    precioUsado?: {
      precio?: number;
      banda_max?: number;
      banda_min?: number;
    };
    precioRetoma?: number;
  };
  [key: string]: any;
}

const Home: React.FC = () => {
  const [photo, setPhoto] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingPlate, setEditingPlate] = useState(false);
  const [manualPlate, setManualPlate] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const takePhoto = async () => {
    try {
      setError(null);
      setScanResult(null);
      
      const photo = await Camera.getPhoto({
        quality: 100, // Aumentar calidad al máximo
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        correctOrientation: true,
        width: 1920, // Establecer un ancho máximo para mejor calidad
        height: 1080,
      });

      const dataUrl = photo.dataUrl || null;
      setPhoto(dataUrl);
      
      // Analizar automáticamente después de tomar la foto
      if (dataUrl) {
        // Pequeño delay para asegurar que la imagen esté lista
        await new Promise(resolve => setTimeout(resolve, 500));
        await analyzePlateWithGemini(dataUrl);
      }
    } catch (err: unknown) {
      console.error('Error al tomar foto:', err);
      // Si falla la cámara nativa, usar el input file como fallback
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }
  };

  const selectFromGallery = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          setPhoto(result);
          setScanResult(null);
          setError(null);
          
          // Analizar automáticamente después de cargar la imagen
          await new Promise(resolve => setTimeout(resolve, 500));
          await analyzePlateWithGemini(result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzePlateWithGemini = async (imageDataUrl: string) => {
    setIsScanning(true);
    setError(null);

    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Mira esta imagen de una patente vehicular chilena. Lee EXACTAMENTE los caracteres que ves en la placa. Las patentes chilenas tienen formato: 4 letras + 2 números (ej: LYHR62, BBCD34). Lee cada carácter con mucho cuidado, distinguiendo entre letras similares (O vs 0, I vs 1, L vs 1, S vs 5, G vs 6, Z vs 2, Y vs V). Responde SOLO con los caracteres de la patente en mayúsculas, sin espacios, sin puntos, sin guiones. Ejemplo de respuesta correcta: LYHR62',
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: imageDataUrl,
                    },
                  },
                ],
              },
            ],
            temperature: 0.1,
            max_completion_tokens: 20,
            top_p: 1,
            stream: false,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error de Groq API:', errorData);
        throw new Error(`Error ${response.status}: ${errorData.error?.message || 'Error desconocido'}`);
      }

      const data = await response.json();
      let plateText = data.choices?.[0]?.message?.content?.trim() || 'No detectada';
      
      console.log('Texto original de IA:', plateText);
      
      // Limpiar y validar el formato de la patente
      plateText = cleanPlateText(plateText);
      
      console.log('Texto limpio:', plateText);

      // Crear resultado inicial
      const result: ScanResult = {
        plate: plateText,
        confidence: 95,
        timestamp: new Date(),
      };

      setScanResult(result);

      // Si se detectó una patente válida, consultar datos del vehículo
      if (plateText !== 'No detectada') {
        await fetchVehicleData(plateText, result);
      }
    } catch (err) {
      console.error('Error al analizar con Groq:', err);
      setError('Error al analizar la imagen. Por favor, intenta nuevamente.');
    } finally {
      setIsScanning(false);
    }
  };

  const cleanPlateText = (text: string): string => {
    // Eliminar espacios, puntos, guiones y caracteres especiales
    let cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // Si está vacío, retornar "No detectada"
    if (!cleaned || cleaned.length < 5) {
      return 'No detectada';
    }
    
    // Validar formato chileno: 4 letras + 2 números (LYHR62)
    // o formato antiguo: 2 letras + 4 números (AB1234)
    const modernFormat = /^[A-Z]{4}\d{2}$/;
    const oldFormat = /^[A-Z]{2}\d{4}$/;
    
    if (modernFormat.test(cleaned) || oldFormat.test(cleaned)) {
      return cleaned;
    }
    
    // Si tiene más caracteres de lo esperado, intentar extraer el patrón correcto
    if (cleaned.length > 6) {
      // Buscar patrón de 4 letras seguidas de 2 números
      const match = cleaned.match(/[A-Z]{4}\d{2}/);
      if (match) {
        return match[0];
      }
      
      // Buscar patrón de 2 letras seguidas de 4 números
      const oldMatch = cleaned.match(/[A-Z]{2}\d{4}/);
      if (oldMatch) {
        return oldMatch[0];
      }
      
      // Si tiene exactamente 6 caracteres al inicio, tomarlos
      if (cleaned.length >= 6) {
        const first6 = cleaned.substring(0, 6);
        if (modernFormat.test(first6) || oldFormat.test(first6)) {
          return first6;
        }
      }
    }
    
    // Si no coincide con ningún formato, retornar lo que se limpió
    return cleaned.length >= 6 ? cleaned.substring(0, 6) : cleaned;
  };

  const fetchVehicleData = async (plate: string, currentResult: ScanResult) => {
    try {
      console.log('Consultando datos para patente:', plate);
      
      // Consultar información básica del vehículo
      const response = await fetch(
        `https://chile.getapi.cl/v1/vehicles/plate/${plate}`,
        {
          method: 'GET',
          headers: {
            'X-Api-Key': 'd085fb04-057f-44f6-a34d-9f6c7b8d80d2',
          },
        }
      );

      console.log('Respuesta de GetAPI:', response.status);

      if (response.ok) {
        const apiResponse = await response.json();
        console.log('Datos del vehículo recibidos:', apiResponse);
        
        // La API devuelve los datos dentro de un objeto "data"
        const vehicleData = apiResponse.data || apiResponse;
        
        // La marca está dentro de model.brand, no en el nivel superior
        if (vehicleData.model?.brand && !vehicleData.brand) {
          vehicleData.brand = vehicleData.model.brand;
        }
        
        console.log('Marca extraída:', vehicleData.brand?.name);
        console.log('Tipo:', vehicleData.model?.typeVehicle?.name);
        console.log('RT Date:', vehicleData.rtDate);
        console.log('RT Month:', vehicleData.monthRT);
        console.log('RT Result:', vehicleData.rtResult);
        console.log('RT Result Gas:', vehicleData.rtResultGas);
        
        // Consultar tasación del vehículo
        await fetchAppraisal(plate, vehicleData, currentResult);
      } else {
        const errorText = await response.text();
        console.error('Error al consultar datos del vehículo:', response.status, errorText);
        setScanResult(currentResult);
      }
    } catch (err) {
      console.error('Error al obtener datos del vehículo:', err);
      setScanResult(currentResult);
    }
  };

  const fetchAppraisal = async (plate: string, vehicleData: VehicleData, currentResult: ScanResult) => {
    try {
      console.log('Consultando tasación para patente:', plate);
      
      const response = await fetch(
        `https://chile.getapi.cl/v1/vehicles/appraisal/${plate}`,
        {
          method: 'GET',
          headers: {
            'X-Api-Key': 'd085fb04-057f-44f6-a34d-9f6c7b8d80d2',
          },
        }
      );

      if (response.ok) {
        const appraisalResponse = await response.json();
        console.log('Tasación recibida:', appraisalResponse);
        
        const appraisalData = appraisalResponse.data;
        
        // Combinar datos del vehículo con tasación
        setScanResult({
          ...currentResult,
          vehicleData: {
            ...vehicleData,
            appraisal: {
              precioUsado: appraisalData?.precioUsado,
              precioRetoma: appraisalData?.precioRetoma,
            },
          },
        });
      } else {
        console.error('Error al consultar tasación:', response.status);
        // Si falla la tasación, mostrar solo los datos del vehículo
        setScanResult({
          ...currentResult,
          vehicleData: vehicleData,
        });
      }
    } catch (err) {
      console.error('Error al obtener tasación:', err);
      // Si falla la tasación, mostrar solo los datos del vehículo
      setScanResult({
        ...currentResult,
        vehicleData: vehicleData,
      });
    }
  };

  const extractPlateNumber = (text: string): string => {
    // Patrones comunes de patentes latinoamericanas
    const patterns = [
      // Argentina: AB123CD (nuevo formato)
      /^[A-Z]{2}\d{3}[A-Z]{2}$/i,
      // Argentina: ABC123 (formato anterior)
      /^[A-Z]{3}\d{3}$/i,
      // Chile: ABCD12 o AB1234
      /^[A-Z]{2,4}\d{2,4}$/i,
      // Brasil: ABC1234 o ABC1D23
      /^[A-Z]{3}\d{1}[A-Z]{1}\d{2}$/i,
      /^[A-Z]{3}\d{4}$/i,
      // México: ABC123A
      /^[A-Z]{3}\d{3}[A-Z]{1}$/i,
      // Colombia: ABC123
      /^[A-Z]{3}\d{3}$/i,
      // Perú: ABC123
      /^[A-Z]{3}\d{3}$/i,
      // Formato genérico: letras y números combinados
      /^[A-Z]{2,3}\d{2,3}[A-Z]{0,2}$/i,
    ];

    // Limpiar texto y buscar patrones
    const cleanText = text
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 5 && word.length <= 8);

    for (const word of cleanText) {
      for (const pattern of patterns) {
        if (pattern.test(word)) {
          return word.toUpperCase();
        }
      }
    }

    // Si no encuentra patrón exacto, buscar la combinación más probable
    const possiblePlates = text
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .match(/[A-Z]{2,3}\d{2,4}[A-Z]{0,2}/g);

    if (possiblePlates && possiblePlates.length > 0) {
      // Retornar la más larga que tenga al menos una letra y un número
      const validPlates = possiblePlates.filter(
        plate => /[A-Z]/.test(plate) && /\d/.test(plate)
      );
      if (validPlates.length > 0) {
        return validPlates.sort((a, b) => b.length - a.length)[0];
      }
    }

    return 'No detectada';
  };

  const scanPlate = async () => {
    if (!photo) return;
    await analyzePlateWithGemini(photo);
  };

  const resetScan = () => {
    setPhoto(null);
    setScanResult(null);
    setError(null);
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="primary">
          <IonButtons slot="start">
            <IonMenuButton />
          </IonButtons>
          <IonTitle>
            <IonIcon icon={scan} style={{ marginRight: '8px' }} />
            Patentado
          </IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="ion-padding">
        <div className="container">
          {!photo ? (
            <div className="upload-section">
              <IonCard className="upload-card">
                <IonCardContent className="upload-content">
                  <IonIcon icon={camera} className="camera-icon" />
                  <IonText>
                    <h2>Escanear Patente</h2>
                    <p>Toma una foto clara de la patente del vehículo</p>
                  </IonText>
                  <IonButton expand="block" onClick={takePhoto} size="large">
                    <IonIcon slot="start" icon={camera} />
                    Tomar Foto
                  </IonButton>
                  <IonButton
                    expand="block"
                    fill="outline"
                    onClick={selectFromGallery}
                  >
                    Seleccionar de Galería
                  </IonButton>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                </IonCardContent>
              </IonCard>
            </div>
          ) : (
            <div className="result-section">
              <IonCard className="photo-card">
                <IonImg src={photo} className="captured-photo" />
              </IonCard>

              {isScanning && (
                <IonCard className="scanning-card">
                  <IonCardContent className="scanning-content">
                    <IonSpinner name="crescent" />
                    <IonText>
                      <p>Analizando imagen...</p>
                    </IonText>
                  </IonCardContent>
                </IonCard>
              )}

              {scanResult && (
                <IonCard className="result-card">
                  <IonCardContent>
                    <div className="plate-display">
                      <IonBadge color="success" className="plate-badge">
                        {scanResult.plate}
                      </IonBadge>
                    </div>
                    <div className="result-details">
                      <IonText color="medium">
                        <p>Confianza: {scanResult.confidence}%</p>
                        <p>
                          Fecha:{' '}
                          {scanResult.timestamp.toLocaleDateString('es-CL')}{' '}
                          {scanResult.timestamp.toLocaleTimeString('es-CL')}
                        </p>
                      </IonText>
                    </div>

                    {scanResult.vehicleData && (
                      <div className="vehicle-info">
                        <IonText>
                          <h3>Información del Vehículo</h3>
                          
                          {scanResult.vehicleData.brand && scanResult.vehicleData.brand.name && (
                            <p><strong>Marca:</strong> {scanResult.vehicleData.brand.name}</p>
                          )}
                          
                          {scanResult.vehicleData.model && scanResult.vehicleData.model.name && (
                            <p><strong>Modelo:</strong> {scanResult.vehicleData.model.name}</p>
                          )}
                          
                          {scanResult.vehicleData.year && (
                            <p><strong>Año:</strong> {scanResult.vehicleData.year}</p>
                          )}
                          
                          {scanResult.vehicleData.model?.typeVehicle?.name && (
                            <p><strong>Tipo:</strong> {scanResult.vehicleData.model.typeVehicle.name}</p>
                          )}
                          
                          {scanResult.vehicleData.fuel && (
                            <p><strong>Combustible:</strong> {scanResult.vehicleData.fuel}</p>
                          )}
                          
                          {scanResult.vehicleData.color && (
                            <p><strong>Color:</strong> {scanResult.vehicleData.color}</p>
                          )}
                          
                          {scanResult.vehicleData.vinNumber && (
                            <p><strong>VIN:</strong> {scanResult.vehicleData.vinNumber}</p>
                          )}
                          
                          {scanResult.vehicleData.engineNumber && (
                            <p><strong>N° Motor:</strong> {scanResult.vehicleData.engineNumber}</p>
                          )}
                          
                          {scanResult.vehicleData.transmission && (
                            <p><strong>Transmisión:</strong> {scanResult.vehicleData.transmission}</p>
                          )}
                          
                          {scanResult.vehicleData.doors && (
                            <p><strong>Puertas:</strong> {scanResult.vehicleData.doors}</p>
                          )}
                          
                          <h3 style={{ marginTop: '20px', fontSize: '16px', fontWeight: '700', color: 'var(--ion-color-primary)' }}>Revisión Técnica</h3>
                          
                          {scanResult.vehicleData.rtDate || scanResult.vehicleData.rtResult || scanResult.vehicleData.rtResultGas ? (
                            <>
                              {scanResult.vehicleData.monthRT && (
                                <p><strong>Mes:</strong> {scanResult.vehicleData.monthRT}</p>
                              )}
                              
                              {scanResult.vehicleData.rtDate && scanResult.vehicleData.rtDate !== '0000-00-00 00:00:00' && (
                                <p><strong>Fecha Vencimiento:</strong> {new Date(scanResult.vehicleData.rtDate).toLocaleDateString('es-CL')}</p>
                              )}
                              
                              {scanResult.vehicleData.rtResult && (
                                <p>
                                  <strong>Resultado:</strong>{' '}
                                  <span style={{ 
                                    color: scanResult.vehicleData.rtResult === 'A' ? 'green' : 
                                           scanResult.vehicleData.rtResult === 'R' ? 'red' : 'orange',
                                    fontWeight: '600'
                                  }}>
                                    {scanResult.vehicleData.rtResult === 'A' ? 'Aprobado' : 
                                     scanResult.vehicleData.rtResult === 'R' ? 'Rechazado' : 
                                     scanResult.vehicleData.rtResult}
                                  </span>
                                </p>
                              )}
                              
                              {scanResult.vehicleData.rtResultGas && (
                                <p>
                                  <strong>Resultado Gases:</strong>{' '}
                                  <span style={{ 
                                    color: scanResult.vehicleData.rtResultGas === 'A' ? 'green' : 
                                           scanResult.vehicleData.rtResultGas === 'R' ? 'red' : 'orange',
                                    fontWeight: '600'
                                  }}>
                                    {scanResult.vehicleData.rtResultGas === 'A' ? 'Aprobado' : 
                                     scanResult.vehicleData.rtResultGas === 'R' ? 'Rechazado' : 
                                     scanResult.vehicleData.rtResultGas}
                                  </span>
                                </p>
                              )}
                              
                              {scanResult.vehicleData.plantaRevisora && (
                                <>
                                  {scanResult.vehicleData.plantaRevisora.concesionPlantaRevisora && (
                                    <p><strong>Planta Revisora:</strong> {scanResult.vehicleData.plantaRevisora.concesionPlantaRevisora}</p>
                                  )}
                                  {scanResult.vehicleData.plantaRevisora.comuna && scanResult.vehicleData.plantaRevisora.region && (
                                    <p style={{ fontSize: '13px', color: 'var(--ion-color-medium)' }}>
                                      {scanResult.vehicleData.plantaRevisora.comuna}, {scanResult.vehicleData.plantaRevisora.region}
                                    </p>
                                  )}
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              {scanResult.vehicleData.year && (new Date().getFullYear() - scanResult.vehicleData.year <= 3) ? (
                                <p style={{ color: 'var(--ion-color-success)', fontWeight: '600' }}>
                                  Homologado (Vehículo nuevo sin revisión técnica requerida)
                                </p>
                              ) : scanResult.vehicleData.monthRT ? (
                                <>
                                  <p><strong>Mes:</strong> {scanResult.vehicleData.monthRT}</p>
                                  {scanResult.vehicleData.plantaRevisora?.concesionPlantaRevisora && (
                                    <>
                                      <p><strong>Planta Revisora:</strong> {scanResult.vehicleData.plantaRevisora.concesionPlantaRevisora}</p>
                                      {scanResult.vehicleData.plantaRevisora.comuna && scanResult.vehicleData.plantaRevisora.region && (
                                        <p style={{ fontSize: '13px', color: 'var(--ion-color-medium)' }}>
                                          {scanResult.vehicleData.plantaRevisora.comuna}, {scanResult.vehicleData.plantaRevisora.region}
                                        </p>
                                      )}
                                    </>
                                  )}
                                </>
                              ) : (
                                <p style={{ color: 'var(--ion-color-medium)', fontStyle: 'italic' }}>
                                  Sin información de revisión técnica disponible
                                </p>
                              )}
                            </>
                          )}
                          
                          {scanResult.vehicleData.appraisal && (
                            <>
                              <h3 style={{ marginTop: '20px', fontSize: '16px', fontWeight: '700', color: 'var(--ion-color-primary)' }}>Tasación</h3>
                              
                              {scanResult.vehicleData.appraisal.precioUsado?.precio && (
                                <>
                                  <p><strong>Precio Usado:</strong> ${scanResult.vehicleData.appraisal.precioUsado.precio.toLocaleString('es-CL')}</p>
                                  <p style={{ fontSize: '13px', color: 'var(--ion-color-medium)' }}>
                                    Rango: ${scanResult.vehicleData.appraisal.precioUsado.banda_min?.toLocaleString('es-CL')} - ${scanResult.vehicleData.appraisal.precioUsado.banda_max?.toLocaleString('es-CL')}
                                  </p>
                                </>
                              )}
                              
                              {scanResult.vehicleData.appraisal.precioRetoma && (
                                <p><strong>Precio Retoma:</strong> ${scanResult.vehicleData.appraisal.precioRetoma.toLocaleString('es-CL')}</p>
                              )}
                            </>
                          )}
                        </IonText>
                      </div>
                    )}
                  </IonCardContent>
                </IonCard>
              )}

              {error && (
                <IonCard className="error-card">
                  <IonCardContent>
                    <IonText color="danger">
                      <p>{error}</p>
                    </IonText>
                  </IonCardContent>
                </IonCard>
              )}

              <div className="action-buttons">
                {!scanResult && !isScanning && (
                  <IonButton
                    expand="block"
                    onClick={scanPlate}
                    size="large"
                    color="success"
                  >
                    <IonIcon slot="start" icon={scan} />
                    Analizar Patente
                  </IonButton>
                )}
                <IonButton
                  expand="block"
                  fill="outline"
                  onClick={resetScan}
                  disabled={isScanning}
                >
                  <IonIcon slot="start" icon={refresh} />
                  Nueva Captura
                </IonButton>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Home;