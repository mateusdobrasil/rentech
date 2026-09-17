'use server';

// app/admin/comercial/parceiros/actions.ts
// Wrapper fino: só checa permissão e delega pra parceirosCore.ts, que tem a
// lógica de sync de verdade (e é reaproveitada também por
// app/api/cron/sync-p2s/route.ts, que roda sem sessão de usuário — ver
// comentário no topo de parceirosCore.ts).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { obterUltimaSincronizacao } from '../../../lib/syncLog';
import {
  sincronizarParceirosCore, type SincronizarParceirosOpcoes,
  sincronizarColaboradoresCore, type SincronizarColaboradoresOpcoes,
} from './parceirosCore';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/comercial/parceiros';

export async function sincronizarParceirosP2sAction(opcoes: SincronizarParceirosOpcoes, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  return sincronizarParceirosCore(opcoes);
}

export async function buscarUltimaSincronizacaoParceirosAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const info = await obterUltimaSincronizacao('parceiros', 'PRODUCAO');
  return { ok: true, info };
}

// ============================================================================
// COLABORADORES (aba separada, mesma página) — TCustomColaborador
// ============================================================================
// Dado sensível (CPF, RG, PIS, título de eleitor, dados bancários, raça/cor,
// deficiência, filiação) — por decisão explícita do usuário, entra o
// cadastro completo, mas com DUAS proteções que a aba Parceiros não tem:
// 1) Permissão própria e mais restrita (ROTA_COLABORADORES, ver
//    sql/colaboradores_permissao.sql), checada em toda ação abaixo.
// 2) A tabela `colaboradores` tem RLS ligada e SEM policy (ver
//    sql/colaboradores.sql) — o client-side supabase (usado em produtos e
//    parceiros pra ler direto do navegador) não enxerga nada nela. Por isso,
//    ao contrário de produtos/parceiros, aqui a PÁGINA busca os dados via
//    Server Action (supabaseAdmin, que ignora RLS) em vez de query direta.
const ROTA_COLABORADORES = '/admin/comercial/parceiros/colaboradores';

export async function sincronizarColaboradoresP2sAction(opcoes: SincronizarColaboradoresOpcoes, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA_COLABORADORES);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  return sincronizarColaboradoresCore(opcoes);
}

export async function buscarUltimaSincronizacaoColaboradoresAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA_COLABORADORES);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const info = await obterUltimaSincronizacao('colaboradores', 'PRODUCAO');
  return { ok: true, info };
}

export interface FiltroColaboradores {
  texto?: string;
  pagina: number;
  tamanhoPagina: number;
}

// Leitura via Server Action (não client-side direto) — a tabela não tem
// policy de SELECT de propósito (ver sql/colaboradores.sql), só
// supabaseAdmin() enxerga as linhas.
export async function buscarColaboradoresAction(filtro: FiltroColaboradores, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA_COLABORADORES);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  let query = db
    .from('colaboradores')
    .select('id, codigo_colaborador, nome_exibicao, nome_completo, cpf, status_colaborador, data_admissao, telefone1, email1', { count: 'exact' })
    .order('codigo_colaborador', { ascending: true })
    .range(filtro.pagina * filtro.tamanhoPagina, filtro.pagina * filtro.tamanhoPagina + filtro.tamanhoPagina - 1);

  if (filtro.texto?.trim()) {
    const termo = `%${filtro.texto.trim()}%`;
    query = query.or(`nome_exibicao.ilike.${termo},nome_completo.ilike.${termo},cpf.ilike.${termo}`);
  }

  const { data, error, count } = await query;
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: { registros: data || [], total: count || 0 } };
}

export async function buscarColaboradorDetalheAction(id: number, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA_COLABORADORES);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { data, error } = await db.from('colaboradores').select('*').eq('id', id).single();
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: data };
}

// ============================================================================
// BUSCA LEVE PRA IMPORT EM /admin/op/nova E /admin/op/responsavel — botão
// "Banco de Colaboradores", independente da Natureza do Pagamento (pedido do
// usuário 2026-09-17). Só os campos que uma OP usa pra preencher o
// favorecido (nome/CPF/telefone/endereço/PIX/conta) — de propósito SEM os
// campos sensíveis de RH que a aba Colaboradores expõe (RG, PIS, título de
// eleitor, raça/cor, deficiência, filiação etc.). Por isso é gateada pela
// permissão de /admin/op/nova, não a mais restrita de ROTA_COLABORADORES —
// quem pode criar OP não precisa ter acesso ao cadastro completo de
// colaboradores só pra puxar nome/CPF de quem vai receber o pagamento.
//
// UNIÃO DE DUAS FONTES (2026-09-17, corrigindo um bug real): "colaborador"
// tem dois cadastros DIFERENTES neste sistema — TCustomColaborador (P2S,
// tabela `colaboradores`, sem PIX/conta estruturados — só o texto livre
// dados_bancarios_obs) e `folha_funcionarios` (cadastro próprio de
// pagamento, com PIX/conta estruturados). Um colaborador ativo pode estar só
// numa das duas (ex.: ISMAEL DAMIÃO FERREIRA está ativo em folha_funcionarios
// mas nunca foi sincronizado como TCustomColaborador no PrimeStart — sumia
// completamente do "Banco de Colaboradores" antes desta correção, mesmo
// aparecendo como ativo no quadro de funcionários). Agora busca as duas e
// junta por CPF: quem está nas duas usa o PIX/conta de folha_funcionarios
// (estruturado) por cima do que vier do PrimeStart; quem só está numa delas
// entra do mesmo jeito, sem ficar de fora.
export interface ColaboradorParaOp {
  chave: string; // "p2s:<id>" ou "folha:<id>" — só identifica a linha na lista, não é salvo em lugar nenhum
  nome: string;
  cpf: string | null;
  telefone: string | null;
  endereco: string | null;
  pix_tipo: string | null;
  pix_chave: string | null;
  banco_codigo: string | null;
  banco_agencia: string | null;
  banco_conta: string | null;
  banco_tipo: string | null;
  dados_bancarios_obs: string | null;
  origem: 'PRIMESTART' | 'FOLHA' | 'PRIMESTART+FOLHA';
}

export async function buscarColaboradoresParaOpAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, '/admin/op/nova');
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const [{ data: p2s, error: erroP2s }, { data: folha, error: erroFolha }] = await Promise.all([
    db.from('colaboradores')
      .select('id, nome_exibicao, nome_completo, cpf, telefone1, endereco1, numero1, complemento1, bairro1, cidade1, estado1, dados_bancarios_obs')
      .eq('status_colaborador', 'A'),
    db.from('folha_funcionarios')
      .select('id, nome_completo, cpf, celular, endereco, pix_tipo, pix_chave, banco_codigo, banco_agencia, banco_conta, banco_tipo')
      .eq('ativo', true),
  ]);
  if (erroP2s) return { ok: false, erro: erroP2s.message };
  if (erroFolha) return { ok: false, erro: erroFolha.message };

  const porCpfFolha = new Map<string, typeof folha[number]>();
  (folha || []).forEach(f => { if (f.cpf) porCpfFolha.set(f.cpf.replace(/\D/g, ''), f); });
  const cpfsUsados = new Set<string>();

  const registros: ColaboradorParaOp[] = (p2s || []).map(c => {
    const cpfDigitos = (c.cpf || '').replace(/\D/g, '');
    const matchFolha = cpfDigitos ? porCpfFolha.get(cpfDigitos) : undefined;
    if (matchFolha && cpfDigitos) cpfsUsados.add(cpfDigitos);
    const enderecoP2s = [
      [c.endereco1, c.numero1].filter(Boolean).join(', '),
      c.complemento1, c.bairro1,
      [c.cidade1, c.estado1].filter(Boolean).join('/'),
    ].filter(Boolean).join(' - ') || null;
    return {
      chave: `p2s:${c.id}`,
      nome: c.nome_exibicao || c.nome_completo || '(sem nome)',
      cpf: c.cpf,
      telefone: matchFolha?.celular || c.telefone1,
      endereco: matchFolha?.endereco || enderecoP2s,
      pix_tipo: matchFolha?.pix_tipo || null,
      pix_chave: matchFolha?.pix_chave || null,
      banco_codigo: matchFolha?.banco_codigo || null,
      banco_agencia: matchFolha?.banco_agencia || null,
      banco_conta: matchFolha?.banco_conta || null,
      banco_tipo: matchFolha?.banco_tipo || null,
      dados_bancarios_obs: c.dados_bancarios_obs,
      origem: matchFolha ? 'PRIMESTART+FOLHA' : 'PRIMESTART',
    };
  });

  // Funcionários ativos que não bateram com nenhum colaborador do PrimeStart
  // (ou não têm CPF pra cruzar) entram como registros próprios — é
  // exatamente o caso do Ismael.
  (folha || []).forEach(f => {
    const cpfDigitos = (f.cpf || '').replace(/\D/g, '');
    if (cpfDigitos && cpfsUsados.has(cpfDigitos)) return;
    registros.push({
      chave: `folha:${f.id}`,
      nome: f.nome_completo,
      cpf: f.cpf,
      telefone: f.celular,
      endereco: f.endereco,
      pix_tipo: f.pix_tipo,
      pix_chave: f.pix_chave,
      banco_codigo: f.banco_codigo,
      banco_agencia: f.banco_agencia,
      banco_conta: f.banco_conta,
      banco_tipo: f.banco_tipo,
      dados_bancarios_obs: null,
      origem: 'FOLHA',
    });
  });

  registros.sort((a, b) => a.nome.localeCompare(b.nome));
  return { ok: true, info: { registros } };
}
