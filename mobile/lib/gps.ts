// mobile/lib/gps.ts
// Captura de GPS pro checklist de veículo (saída e retorno) — README tela 5:
// "capturado uma vez ao abrir". Sem coluna equivalente no fluxo web (é feature
// só do app mobile nesta fase); os campos batem com GpsCaptura em
// app/portal/lib/checklistVeiculo.ts (web/), mantenha os dois em sincronia.
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';

export interface GpsCaptura {
  lat: number;
  lng: number;
  local: string | null;
  capturadoEm: string;
}

// null quando a permissão é negada — quem chama decide o que mostrar (README
// não especifica um fallback, decisão tomada: deixa seguir o formulário sem
// GPS em vez de travar a tela).
export async function capturarGps(): Promise<GpsCaptura | null> {
  const permissao = await Location.requestForegroundPermissionsAsync();
  if (!permissao.granted) return null;

  const posicao = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = posicao.coords;

  let local: string | null = null;
  const estadoRede = await NetInfo.fetch();
  if (estadoRede.isConnected) {
    try {
      const [endereco] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (endereco) local = [endereco.street, endereco.city].filter(Boolean).join(' · ') || null;
    } catch {
      // reverse geocode pode falhar mesmo online (limite da API do SO, etc.) — segue só com lat/lng
    }
  }

  return { lat: latitude, lng: longitude, local, capturadoEm: new Date().toISOString() };
}
