// mobile/lib/fotoAvaria.ts
// Captura + comprime + persiste uma foto de avaria. O fluxo web equivalente
// (app/portal/ChecklistVeiculo.tsx) sobe o arquivo cru, sem compressão — aqui
// comprimimos porque o celular tira fotos bem maiores e a rede de campo é
// fraca (mesmo motivo da fila offline existir).
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Directory, Paths } from 'expo-file-system';

const LARGURA_MAXIMA = 1600;
const QUALIDADE = 0.65;

// Devolve a URI persistente da foto já comprimida (documentDirectory, não
// cacheDirectory — o SO pode limpar cache a qualquer momento, e a foto
// precisa sobreviver até a fila conseguir sincronizar). null se o usuário
// cancelou ou negou a permissão de câmera.
export async function capturarFotoAvaria(localId: string): Promise<string | null> {
  const permissao = await ImagePicker.requestCameraPermissionsAsync();
  if (!permissao.granted) return null;

  const resultado = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (resultado.canceled || !resultado.assets?.[0]) return null;

  const renderizada = await ImageManipulator.manipulate(resultado.assets[0].uri).resize({ width: LARGURA_MAXIMA }).renderAsync();
  const comprimida = await renderizada.saveAsync({ compress: QUALIDADE, format: SaveFormat.JPEG });

  const dir = new Directory(Paths.document, 'avarias', localId);
  dir.create({ intermediates: true, idempotent: true });
  const destino = new File(dir, `${Date.now()}.jpg`);
  new File(comprimida.uri).copy(destino);

  return destino.uri;
}

export async function lerFotoBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}

export function apagarFotoLocal(uri: string): void {
  try {
    const arquivo = new File(uri);
    if (arquivo.exists) arquivo.delete();
  } catch {
    // não bloqueante — só reclama espaço, se falhar não é grave
  }
}
