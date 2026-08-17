// Lógica de criar a Conta a Pagar (e, se preciso, o Parceiro) no PrimeStart
// para uma OP, SEM "use server" — reaproveitada tanto pela action já
// protegida enviarOpParaPrimeStartAction (botão manual em
// /admin/financeiro/ops, accessToken validado) quanto por criarOP (disparo
// automático na criação da OP, decisão do usuário em 2026-08-17 — antes só
// existia o botão manual, pra dar controle antes de gravar no ERP real).
// Ficar fora de um arquivo "use server" é o que impede que isso vire um
// endpoint de Server Action alcançável direto por RPC sem accessToken (mesmo
// motivo/padrão de app/admin/op/assinaturaOpCore.ts).
import { revalidatePath } from 'next/cache';
import { registrarLogAuditoria } from '../../../actions';
import { supabaseAdmin } from '../../../lib/supabase';
import { criarObjeto, atualizarObjeto, consultarObjetos, criterio, dataParaP2s, type AmbienteP2s } from '../../../lib/p2s';

export interface OPParaEnvioP2s {
  id: string;
  numero_op: number;
  os_numero: string | null;
  os_cliente: string | null;
  os_evento: string | null;
  natureza_pagamento: string | null;
  empresa_recebedora: string;
  cnpj_cpf_recebedora: string | null;
  total_geral: number;
  data_vencimento: string;
}

export interface ResultadoEnvioP2s {
  p2sOid: string;
  fornecedorVinculado: boolean;
  origemVinculo: 'parceiro' | 'colaborador' | 'parceiro_criado' | null;
}

// Busca a Entidade pelo CNPJ/CPF já digitado no formulário da OP nas tabelas
// locais `parceiros` e `colaboradores`, já sincronizadas do PrimeStart (ver
// app/admin/comercial/parceiros/actions.ts) — mais rápido que ir na API a
// cada envio, e cobre as duas fontes (o favorecido pode ser um colaborador
// nosso, ex: freelancer, que não é Parceiro). Colaborador só tem CPF (é
// sempre pessoa física), por isso só entra na busca quando o documento tem
// 11 dígitos.
async function buscarEntidadeLocal(documentoFormatado: string): Promise<{ oid: string; origem: 'parceiro' | 'colaborador' } | null> {
  const digitos = documentoFormatado.replace(/\D/g, '');
  if (!digitos) return null;
  const campo = digitos.length > 11 ? 'cnpj' : 'cpf';

  const db = supabaseAdmin();

  const { data: parceiro } = await db.from('parceiros').select('p2s_oid').eq(campo, documentoFormatado).limit(1).maybeSingle();
  if (parceiro?.p2s_oid) return { oid: parceiro.p2s_oid as string, origem: 'parceiro' };

  if (campo === 'cpf') {
    const { data: colaborador } = await db.from('colaboradores').select('p2s_oid').eq('cpf', documentoFormatado).limit(1).maybeSingle();
    if (colaborador?.p2s_oid) return { oid: colaborador.p2s_oid as string, origem: 'colaborador' };
  }

  return null;
}

// Segunda tentativa, ao vivo na API, antes de decidir cadastrar um parceiro
// novo — reduz o risco de duplicar um cadastro que já existe no PrimeStart
// mas ainda não chegou na sincronização local (ex: cadastrado há poucos
// minutos por outra pessoa).
async function buscarParceiroAoVivo(ambiente: AmbienteP2s, documentoFormatado: string, campo: 'CNPJ' | 'CPF'): Promise<string | null> {
  const resultado = await consultarObjetos(ambiente, 'TCustomParceiro', [criterio(campo, 'eq', 'str', documentoFormatado)], { proxy: true });
  return resultado.objectlist[0]?.oid ?? null;
}

// Cadastra um Parceiro/Fornecedor novo no PrimeStart quando nenhum cadastro
// (local nem ao vivo) foi encontrado pra esse CNPJ/CPF — usa só os dados já
// coletados no formulário da OP, então é um cadastro mínimo. Marca em
// Observacoes pra o Comercial saber que precisa complementar (endereço,
// dados bancários etc.) quando tiver oportunidade. Testado em sandbox em
// 2026-08-17 (oid P,47937): Nome + Natureza (F/J) + CPF ou CNPJ +
// FlagFornecedor já bastam pra um cadastro válido e buscável.
async function criarParceiroFornecedor(ambiente: AmbienteP2s, nome: string, documentoFormatado: string): Promise<string> {
  const digitos = documentoFormatado.replace(/\D/g, '');
  const natureza = digitos.length > 11 ? 'J' : 'F';
  const criado = await criarObjeto(ambiente, 'TCustomParceiro');

  const campos: Record<string, unknown> = {
    NomeCompleto: nome,
    NomeExibicao: nome,
    Natureza: natureza,
    FlagFornecedor: true,
    FlagCliente: false,
    Observacoes: 'Cadastro automatico via sistema Rentech (Ordem de Pagamento) - revisar dados completos.',
  };
  campos[natureza === 'J' ? 'CNPJ' : 'CPF'] = documentoFormatado;

  await atualizarObjeto(ambiente, 'TCustomParceiro', criado.oid, campos);

  // Espelha na base local pra próximas OPs do mesmo favorecido acharem sem
  // precisar esperar a próxima sincronização de Parceiros.
  const db = supabaseAdmin();
  await db.from('parceiros').upsert({
    p2s_oid: criado.oid,
    codigo_parceiro: (criado as any).CodigoParceiro ?? null,
    nome_completo: nome,
    nome_exibicao: nome,
    natureza,
    cpf: natureza === 'F' ? documentoFormatado : null,
    cnpj: natureza === 'J' ? documentoFormatado : null,
    flag_fornecedor: true,
    flag_cliente: false,
    status_parceiro: 'A',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'p2s_oid' });

  return criado.oid;
}

// "Centro" da conta a pagar é uma referência (TCustomCentro), não texto
// livre — sem ele, o campo ia vazio (some_campo:"null"). Confirmado em
// produção em 2026-08-17: só existem 3 TCustomCentro cadastrados (um por
// CNPJ do Grupo Rentech); P,275 é o "Rentech" (CNPJ 22.618.891/0001-87). O
// módulo de OP ainda não distingue qual empresa do grupo está pagando, então
// por ora toda conta a pagar criada por aqui usa o Centro da Rentech.
const CENTRO_RENTECH_OID = 'P,275';

async function resolverEntidade(op: OPParaEnvioP2s, ambiente: AmbienteP2s): Promise<{ oid: string; origem: 'parceiro' | 'colaborador' | 'parceiro_criado' } | null> {
  const documento = (op.cnpj_cpf_recebedora || '').trim();
  if (!documento) return null;

  const local = await buscarEntidadeLocal(documento);
  if (local) return local;

  const digitos = documento.replace(/\D/g, '');
  const campo = digitos.length > 11 ? 'CNPJ' : 'CPF';
  const aoVivo = await buscarParceiroAoVivo(ambiente, documento, campo);
  if (aoVivo) return { oid: aoVivo, origem: 'parceiro' };

  const oidCriado = await criarParceiroFornecedor(ambiente, op.empresa_recebedora, documento);
  return { oid: oidCriado, origem: 'parceiro_criado' };
}

// Cria a Conta a Pagar no PrimeStart (produção) pra uma OP — a conta nasce em
// aberto (sem FlagQuitado: em teste no sandbox, forçar essa flag direto por
// PUT se mostrou não confiável, provavelmente controlada pelo workflow de
// pagamento do próprio PrimeStart). A quitação continua acontecendo dentro
// do PrimeStart e volta pra cá pela sincronização + conciliação por
// "OP: <número>" na descrição, fechando o ciclo.
export async function criarContaPagarParaOP(op: OPParaEnvioP2s, nomeResponsavel: string): Promise<ResultadoEnvioP2s> {
  const ambiente: AmbienteP2s = 'PRODUCAO';

  const entidade = await resolverEntidade(op, ambiente);

  const criado = await criarObjeto(ambiente, 'TCustomContaPagar');

  const campos: Record<string, unknown> = {
    Descricao: `OP: ${op.numero_op} - ${op.empresa_recebedora}`,
    Valor: Number(op.total_geral) || 0,
    DataVencimentoNominal: dataParaP2s(new Date(`${op.data_vencimento}T00:00:00Z`)),
    Observacoes: `Lançada via sistema Rentech por ${nomeResponsavel} | Natureza: ${op.natureza_pagamento || '—'} | OS: ${op.os_numero || 'S/N'} | Cliente: ${op.os_cliente || '—'} | Evento: ${op.os_evento || '—'}`,
    Centro: CENTRO_RENTECH_OID,
  };
  if (entidade) campos.Entidade = entidade.oid;

  await atualizarObjeto(ambiente, 'TCustomContaPagar', criado.oid, campos);

  const db = supabaseAdmin();
  const agora = new Date().toISOString();
  const { error: erroUpdate } = await db
    .from('op_ordens_pagamento')
    .update({ p2s_conta_pagar_oid: criado.oid, p2s_conta_pagar_enviado_em: agora, p2s_conta_pagar_enviado_por: nomeResponsavel })
    .eq('id', op.id);
  if (erroUpdate) throw new Error(erroUpdate.message);

  registrarLogAuditoria({
    usuario_nome: nomeResponsavel,
    acao: `ENVIOU OP PARA O PRIMESTART — CRIOU CONTA A PAGAR ${criado.oid}${entidade ? ` (VINCULADA A ${entidade.origem.toUpperCase()})` : ' (SEM FORNECEDOR VINCULADO — CPF/CNPJ AUSENTE NA OP)'}`,
    setor: 'OP',
    equipamento_id: op.id,
    equipamento_nome: `OP #${op.numero_op} — OS ${op.os_numero || 'S/N'}`,
  });

  revalidatePath('/admin');

  return { p2sOid: criado.oid, fornecedorVinculado: !!entidade, origemVinculo: entidade?.origem ?? null };
}
