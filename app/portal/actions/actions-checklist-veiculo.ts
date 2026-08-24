"use server";

// app/portal/actions/actions-checklist-veiculo.ts
// Checklist de saída/retorno de veículos da frota, preenchido pelo próprio
// motorista no Portal. Mesma identidade nunca vem do cliente — sempre
// resolvida no servidor a partir do access_token (resolverFuncionarioPortal),
// e toda ação sobre um checklist existente confere que ele pertence ao
// funcionário logado antes de ler/gravar (mesmo padrão de actions-documentos.ts).
//
// A lógica de banco propriamente dita mora em ../lib/checklistVeiculo.ts —
// aqui só resolve a identidade Portal (accessToken -> funcionarioNome) e
// delega. O app mobile usa a mesma lógica por outra porta de entrada
// (app/api/portal/checklist-veiculo/*, via resolverMotorista.ts), que também
// aceita contas de equipe (STAFF/OPERACIONAL) — ver ../lib/resolverMotorista.ts.
import { supabaseAdmin } from '../../lib/supabase';
import { resolverFuncionarioPortal } from './actions-acesso';
import {
  abrirChecklistCore,
  carregarChecklistVeiculoCore,
  exigirPermissaoDirigir,
  finalizarChecklistCore,
  registrarAvariaChecklistCore,
  type Etapa,
  type ItemMarcado,
} from '../lib/checklistVeiculo';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ERRO_SESSAO = 'Sessão inválida ou expirada. Faça login novamente.';
const ERRO_SEM_PERMISSAO = 'Você não tem permissão para dirigir veículos da frota.';

export async function podeDirigirAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  const podeDirigir = await exigirPermissaoDirigir(db, func.funcionarioNome);
  return { ok: true, info: { podeDirigir } };
}

export async function carregarChecklistVeiculoAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  if (!(await exigirPermissaoDirigir(db, func.funcionarioNome))) return { ok: false, erro: ERRO_SEM_PERMISSAO };

  try {
    const info = await carregarChecklistVeiculoCore(db, func.funcionarioNome);
    return { ok: true, info };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function abrirChecklistAction(accessToken: string, payload: {
  veiculoId: string;
  kmInicial: number;
  combustivelSaida: string;
  destino: string;
  itens: ItemMarcado[];
}): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  if (!(await exigirPermissaoDirigir(db, func.funcionarioNome))) return { ok: false, erro: ERRO_SEM_PERMISSAO };

  try {
    const { data: funcRow } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', func.funcionarioNome).maybeSingle();
    const info = await abrirChecklistCore(db, {
      motoristaNome: func.funcionarioNome,
      empresaId: funcRow?.empresa_id ?? null,
      origem: 'PORTAL',
      ...payload,
    });
    return { ok: true, info };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function finalizarChecklistAction(accessToken: string, payload: {
  checklistId: string;
  kmFinal: number;
  combustivelRetorno: string;
  itens: ItemMarcado[];
}): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    await finalizarChecklistCore(db, { motoristaNome: func.funcionarioNome, ...payload });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// REGISTRAR AVARIA (texto + foto opcional)
// Chamada depois de abrirChecklistAction/finalizarChecklistAction, já com o
// checklistId em mãos — confere posse antes de gravar. Quando há foto, o
// cliente lê o arquivo como base64 e esta mesma ação sobe pro Storage, no
// mesmo padrão de uploadFotoFuncionarioAction
// (app/admin/rh/actions/actions-documentos-func.ts).
// ============================================================================
export async function registrarAvariaChecklistAction(accessToken: string, payload: {
  checklistId: string;
  etapa: Etapa;
  descricao: string;
  arquivoBase64?: string;
  nomeArquivo?: string;
  tipoMime?: string;
}): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const info = await registrarAvariaChecklistCore(db, { motoristaNome: func.funcionarioNome, ...payload });
    return { ok: true, info };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
