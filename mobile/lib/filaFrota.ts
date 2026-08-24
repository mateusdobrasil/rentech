// mobile/lib/filaFrota.ts
// Fila offline do checklist de veículo. Um rascunho local existe SEMPRE
// enquanto a tela [id].tsx está sendo preenchida (sobrevive o app fechar no
// meio do preenchimento) — vira só "fila de verdade" quando salvar encontra
// o dispositivo offline (ou a tentativa online falha). Uma vez sincronizado,
// o registro de SAÍDA não é apagado — vira status SINCRONIZADO e guarda
// idRemoto/numeroRemoto, pra qualquer RETORNO local que ainda aponte pra ele
// (refLocalId) conseguir resolver o checklist_id real quando for a vez dele
// sincronizar. listarPendentes() filtra os já sincronizados.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GpsCaptura } from './gps';
import { lerFotoBase64 } from './fotoAvaria';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;
const CHAVE_FILA = '@rentech/frota/fila';
const CHAVE_CONTADOR = '@rentech/frota/proximo-numero-local';

export type Etapa = 'SAIDA' | 'RETORNO';
export type StatusLocal = 'RASCUNHO' | 'FILA' | 'ENVIANDO' | 'ERRO' | 'SINCRONIZADO';

export interface ItemMarcado {
  descricao: string;
  ordem: number;
  marcado: boolean;
}

export interface AvariaLocal {
  descricao: string;
  fotoUri: string | null;
}

interface ChecklistLocalBase {
  localId: string;
  status: StatusLocal;
  criadoEm: string;
  motoristaNome: string;
  itens: ItemMarcado[];
  gps: GpsCaptura | null;
  avarias: AvariaLocal[];
  erroUltimaTentativa?: string;
}

export interface ChecklistLocalSaida extends ChecklistLocalBase {
  tipo: 'SAIDA';
  numeroLocal: string; // "CKL-VEI-LOC-<n>"
  veiculoId: string;
  veiculoLabel: string;
  kmInicial: number;
  combustivelSaida: string;
  destino: string;
  observacoesSaida: string;
  idRemoto?: string;
  numeroRemoto?: number;
}

export interface ChecklistLocalRetorno extends ChecklistLocalBase {
  tipo: 'RETORNO';
  refLocalId: string | null;
  refChecklistId: string | null; // já era um checklist sincronizado quando o retorno começou a ser preenchido
  veiculoLabel: string; // snapshot da saída (local ou do servidor) — sem isso o card de confirmação não tinha o que mostrar
  kmFinal: number;
  combustivelRetorno: string;
  observacoesRetorno: string;
}

export type ChecklistLocal = ChecklistLocalSaida | ChecklistLocalRetorno;

function novoId(): string {
  return `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function lerTodos(): Promise<ChecklistLocal[]> {
  const raw = await AsyncStorage.getItem(CHAVE_FILA);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function salvarTodos(registros: ChecklistLocal[]): Promise<void> {
  await AsyncStorage.setItem(CHAVE_FILA, JSON.stringify(registros));
}

async function proximoNumeroLocal(): Promise<string> {
  const atual = Number((await AsyncStorage.getItem(CHAVE_CONTADOR)) || '0') + 1;
  await AsyncStorage.setItem(CHAVE_CONTADOR, String(atual));
  return `CKL-VEI-LOC-${atual}`;
}

export async function obter(localId: string): Promise<ChecklistLocal | null> {
  return (await lerTodos()).find(r => r.localId === localId) || null;
}

// SAIDA/RETORNO ainda não sincronizados (e útil pra continuar preenchendo um
// rascunho que ainda nem foi enfileirado) — tela Frota mostra tudo isso como
// "em andamento".
export async function listarPendentes(): Promise<ChecklistLocal[]> {
  return (await lerTodos()).filter(r => r.status !== 'SINCRONIZADO');
}

export async function salvarRascunho(registro: ChecklistLocal): Promise<void> {
  const todos = await lerTodos();
  const idx = todos.findIndex(r => r.localId === registro.localId);
  if (idx >= 0) todos[idx] = registro;
  else todos.push(registro);
  await salvarTodos(todos);
}

export async function criarRascunhoSaida(params: {
  motoristaNome: string;
  veiculoId: string;
  veiculoLabel: string;
  kmInicial: number;
  combustivelSaida: string;
  destino: string;
}): Promise<ChecklistLocalSaida> {
  const registro: ChecklistLocalSaida = {
    tipo: 'SAIDA',
    localId: novoId(),
    numeroLocal: await proximoNumeroLocal(),
    status: 'RASCUNHO',
    criadoEm: new Date().toISOString(),
    motoristaNome: params.motoristaNome,
    veiculoId: params.veiculoId,
    veiculoLabel: params.veiculoLabel,
    kmInicial: params.kmInicial,
    combustivelSaida: params.combustivelSaida,
    destino: params.destino,
    observacoesSaida: '',
    itens: [],
    gps: null,
    avarias: [],
  };
  await salvarRascunho(registro);
  return registro;
}

export async function criarRascunhoRetorno(params: {
  motoristaNome: string;
  refLocalId: string | null;
  refChecklistId: string | null;
  veiculoLabel: string;
  kmFinal: number;
}): Promise<ChecklistLocalRetorno> {
  const registro: ChecklistLocalRetorno = {
    tipo: 'RETORNO',
    localId: novoId(),
    status: 'RASCUNHO',
    criadoEm: new Date().toISOString(),
    motoristaNome: params.motoristaNome,
    refLocalId: params.refLocalId,
    refChecklistId: params.refChecklistId,
    veiculoLabel: params.veiculoLabel,
    kmFinal: params.kmFinal,
    combustivelRetorno: 'CHEIO',
    observacoesRetorno: '',
    itens: [],
    gps: null,
    avarias: [],
  };
  await salvarRascunho(registro);
  return registro;
}

async function atualizarRegistro(localId: string, patch: Partial<ChecklistLocal>): Promise<void> {
  const todos = await lerTodos();
  const idx = todos.findIndex(r => r.localId === localId);
  if (idx < 0) return;
  todos[idx] = { ...todos[idx], ...patch } as ChecklistLocal;
  await salvarTodos(todos);
}

export async function enfileirar(localId: string): Promise<void> {
  await atualizarRegistro(localId, { status: 'FILA' });
}

async function enviarAvarias(checklistId: string, etapa: Etapa, avarias: AvariaLocal[], accessToken: string): Promise<void> {
  for (const avaria of avarias) {
    try {
      const arquivoBase64 = avaria.fotoUri ? await lerFotoBase64(avaria.fotoUri) : undefined;
      await fetch(`${SITE_URL}/api/portal/checklist-veiculo/avaria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          checklistId,
          etapa,
          descricao: avaria.descricao,
          arquivoBase64,
          nomeArquivo: avaria.fotoUri ? 'avaria.jpg' : undefined,
          tipoMime: avaria.fotoUri ? 'image/jpeg' : undefined,
        }),
      });
      // Falha de avaria não derruba a sincronização do checklist inteiro —
      // mesmo comportamento do fluxo web (falhasAvaria vira aviso parcial, não erro total).
    } catch {
      // segue tentando as próximas avarias
    }
  }
}

async function sincronizarSaida(registro: ChecklistLocalSaida, accessToken: string): Promise<void> {
  await atualizarRegistro(registro.localId, { status: 'ENVIANDO' });
  try {
    const res = await fetch(`${SITE_URL}/api/portal/checklist-veiculo/abrir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        veiculoId: registro.veiculoId,
        kmInicial: registro.kmInicial,
        combustivelSaida: registro.combustivelSaida,
        destino: registro.destino,
        itens: registro.itens,
        gps: registro.gps ?? undefined,
        observacoesSaida: registro.observacoesSaida,
      }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.erro || 'Falha ao sincronizar a saída.');

    await enviarAvarias(json.info.id, 'SAIDA', registro.avarias, accessToken);
    await atualizarRegistro(registro.localId, { status: 'SINCRONIZADO', idRemoto: json.info.id, numeroRemoto: json.info.numero });
  } catch (e) {
    await atualizarRegistro(registro.localId, { status: 'ERRO', erroUltimaTentativa: e instanceof Error ? e.message : 'Erro desconhecido.' });
  }
}

async function sincronizarRetorno(registro: ChecklistLocalRetorno, checklistId: string, accessToken: string): Promise<void> {
  await atualizarRegistro(registro.localId, { status: 'ENVIANDO' });
  try {
    const res = await fetch(`${SITE_URL}/api/portal/checklist-veiculo/finalizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        checklistId,
        kmFinal: registro.kmFinal,
        combustivelRetorno: registro.combustivelRetorno,
        itens: registro.itens,
        gps: registro.gps ?? undefined,
        observacoesRetorno: registro.observacoesRetorno,
      }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.erro || 'Falha ao sincronizar o retorno.');

    await enviarAvarias(checklistId, 'RETORNO', registro.avarias, accessToken);
    await atualizarRegistro(registro.localId, { status: 'SINCRONIZADO' });
  } catch (e) {
    await atualizarRegistro(registro.localId, { status: 'ERRO', erroUltimaTentativa: e instanceof Error ? e.message : 'Erro desconhecido.' });
  }
}

// Processa a fila inteira: SAÍDA primeiro (pra qualquer RETORNO que dependa
// de um localId recém-sincronizado já conseguir resolver o checklist_id real
// na mesma passada), depois RETORNO. Registro com erro fica em status ERRO e
// não trava os outros — a próxima chamada tenta de novo.
export async function processarFila(accessToken: string): Promise<void> {
  if (!SITE_URL || !accessToken) return;

  const saidas = (await lerTodos()).filter((r): r is ChecklistLocalSaida => r.tipo === 'SAIDA' && r.status === 'FILA');
  for (const s of saidas) {
    await sincronizarSaida(s, accessToken);
  }

  const todosAtualizados = await lerTodos();
  const retornos = todosAtualizados.filter((r): r is ChecklistLocalRetorno => r.tipo === 'RETORNO' && r.status === 'FILA');
  for (const r of retornos) {
    let checklistId = r.refChecklistId;
    if (!checklistId && r.refLocalId) {
      const saidaRef = todosAtualizados.find((x): x is ChecklistLocalSaida => x.tipo === 'SAIDA' && x.localId === r.refLocalId);
      checklistId = saidaRef?.idRemoto ?? null;
    }
    if (!checklistId) continue; // saída-mãe ainda não sincronizou — tenta de novo na próxima passada
    await sincronizarRetorno(r, checklistId, accessToken);
  }
}
