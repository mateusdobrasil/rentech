'use server';

// app/admin/rh/parametros/actions-parametros.ts (ajuste o caminho conforme a localização)
// Server actions para as gravações da tela de Parâmetros, com service role.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/rh/parametros';

const calcularMesFim = (mesInicio: string, parcelas: number) => {
  if (!mesInicio || parcelas < 1) return mesInicio;
  const [ano, mes] = mesInicio.split('-').map(Number);
  const d = new Date(ano, (mes - 1) + (parcelas - 1), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ============================================================================
// FERIADOS
// ============================================================================
export async function salvarFeriadoAction(payload: {
  id?: number; data_feriado: string; descricao: string | null;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { id, data_feriado, descricao } = payload;
  if (!data_feriado) return { ok: false, erro: 'Informe a data do feriado.' };

  try {
    const dados = { data_feriado, descricao: (descricao || '').toUpperCase().trim() || null };
    const { error } = id
      ? await db.from('folha_feriados').update(dados).eq('id', id)
      : await db.from('folha_feriados').insert(dados);
    if (error) {
      if (error.code === '23505') return { ok: false, erro: `A data ${data_feriado.split('-').reverse().join('/')} já está cadastrada como feriado.` };
      throw new Error(error.message);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function excluirFeriadoAction(id: number, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_feriados').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CATÁLOGOS (folha_cargo / folha_tipocontrato / folha_departamento)
// ============================================================================
export async function adicionarCatalogoAction(payload: {
  tabela: 'folha_cargo' | 'folha_tipocontrato' | 'folha_departamento'; nome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const nome = payload.nome.toUpperCase().trim();
  if (!nome) return { ok: false, erro: 'Digite um nome antes de adicionar.' };

  try {
    const { error } = await db.from(payload.tabela).insert({ nome });
    if (error) {
      if (error.code === '23505') return { ok: false, erro: `"${nome}" já está cadastrado.` };
      throw new Error(error.message);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function removerCatalogoAction(payload: {
  tabela: 'folha_cargo' | 'folha_tipocontrato' | 'folha_departamento'; id: number; nome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { tabela, id, nome } = payload;

  try {
    // Cargo/Departamento em uso não pode ser removido (ficha ficaria órfã)
    const colunaVinculo = tabela === 'folha_cargo' ? 'cargo' : tabela === 'folha_departamento' ? 'departamento' : null;
    if (colunaVinculo) {
      const { data: emUso, error: buscaErr } = await db
        .from('folha_funcionarios').select('nome_completo').eq(colunaVinculo, nome);
      if (buscaErr) throw new Error(`Falha ao verificar vínculos: ${buscaErr.message}`);
      if (emUso && emUso.length > 0) {
        return { ok: false, erro: `Não é possível excluir "${nome}": ${emUso.length} funcionário(s) o utilizam (${emUso.map((f: any) => f.nome_completo).join(', ')}). Altere o(a) ${colunaVinculo} desses colaboradores antes.` };
      }
    }
    const { error } = await db.from(tabela).delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// REGRAS (folha_parametros) — inclui renomeio com migração de funcionários
// ============================================================================
export async function salvarRegraAction(payload: {
  regra: any;
  nomeOriginal: string | null;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const nomeNormalizado = payload.regra.nome_regra.toUpperCase().trim();
  const regra = { ...payload.regra, nome_regra: nomeNormalizado };
  delete regra.id;
  const { nomeOriginal } = payload;

  try {
    const estaRenomeando = nomeOriginal !== null && nomeOriginal !== nomeNormalizado;

    if (estaRenomeando) {
      const { data: existe } = await db.from('folha_parametros').select('nome_regra').eq('nome_regra', nomeNormalizado).maybeSingle();
      if (existe) return { ok: false, erro: `Já existe uma regra chamada "${nomeNormalizado}". Escolha outro nome.` };

      const { error: updErr } = await db.from('folha_parametros').update(regra).eq('nome_regra', nomeOriginal);
      if (updErr) throw new Error(`Falha ao renomear a regra: ${updErr.message}`);

      const { data: migrados, error: migErr } = await db.from('folha_funcionarios')
        .update({ tipo_contrato: nomeNormalizado }).eq('tipo_contrato', nomeOriginal).select('nome_completo');
      if (migErr) {
        return { ok: false, erro: `A regra foi renomeada, mas houve falha ao migrar os funcionários: ${migErr.message}. Corrija manualmente o tipo de contrato de quem usava "${nomeOriginal}".` };
      }
      return { ok: true, info: { renomeada: true, migrados: migrados?.length || 0, nomeNovo: nomeNormalizado, nomeAntigo: nomeOriginal } };
    }

    const { error } = await db.from('folha_parametros').upsert(regra, { onConflict: 'nome_regra' });
    if (error) throw new Error(`Falha ao salvar: ${error.message}`);
    return { ok: true, info: { renomeada: false } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function excluirRegraAction(nome: string, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: vinculados, error: buscaErr } = await db
      .from('folha_funcionarios').select('nome_completo').eq('tipo_contrato', nome);
    if (buscaErr) throw new Error(`Falha ao verificar vínculos: ${buscaErr.message}`);
    if (vinculados && vinculados.length > 0) {
      return { ok: false, erro: `Não é possível excluir "${nome}": ${vinculados.length} funcionário(s) usam esta regra (${vinculados.map((v: any) => v.nome_completo).join(', ')}). Altere o tipo de contrato desses colaboradores antes.` };
    }
    const { error } = await db.from('folha_parametros').delete().eq('nome_regra', nome);
    if (error) throw new Error(`Falha ao excluir: ${error.message}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Atualiza os interruptores de fontes de pagamento de um cargo (3 estados:
// true/false/null). Usado na hierarquia Contrato → Cargo → Ficha.
export async function atualizarFontesCargoAction(payload: {
  cargoId: number;
  recebeFechamento: boolean | null;
  recebeHolerite: boolean | null;
}, accessToken: string): Promise<{ ok: boolean; erro?: string }> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_cargo').update({
      recebe_fechamento: payload.recebeFechamento,
      recebe_holerite: payload.recebeHolerite
    }).eq('id', payload.cargoId);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}