// mobile/lib/veiculosCache.ts
// Cache local da lista de veículos, pra Novo checklist (tela 4) poder ser
// criado offline (README: "lista de veículos do cache"). Não é escopado por
// identidade — a frota é a mesma pra qualquer motorista.
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface VeiculoCache {
  id: string;
  apelido: string;
  tipo: string;
  placa: string;
  km_atual: number | null;
  status: string;
  crlv_vencimento: string | null;
  seguro_vigencia_fim: string | null;
}

export interface ItemModelo {
  id: string;
  ordem: number;
  descricao: string;
}

const CHAVE = '@rentech/frota/veiculos';
const CHAVE_ITENS = '@rentech/frota/itens-modelo';

export async function salvarVeiculosCache(veiculos: VeiculoCache[]): Promise<void> {
  await AsyncStorage.setItem(CHAVE, JSON.stringify(veiculos));
}

export async function lerVeiculosCache(): Promise<VeiculoCache[]> {
  const raw = await AsyncStorage.getItem(CHAVE);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Cacheia as duas etapas de uma vez (a resposta de GET /checklist-veiculo já
// devolve ambas — ver itensModeloSaida/itensModeloRetorno em
// carregarChecklistVeiculoCore, web/) — dá pra criar um checklist inteiro
// offline, ida e volta, sem depender de estar online no meio da viagem só
// pra buscar o modelo de itens da segunda etapa.
export async function salvarItensModeloCache(itensModeloSaida: ItemModelo[], itensModeloRetorno: ItemModelo[]): Promise<void> {
  await AsyncStorage.setItem(CHAVE_ITENS, JSON.stringify({ SAIDA: itensModeloSaida, RETORNO: itensModeloRetorno }));
}

export async function lerItensModeloCache(etapa: 'SAIDA' | 'RETORNO'): Promise<ItemModelo[]> {
  const raw = await AsyncStorage.getItem(CHAVE_ITENS);
  if (!raw) return [];
  try {
    return JSON.parse(raw)[etapa] || [];
  } catch {
    return [];
  }
}
