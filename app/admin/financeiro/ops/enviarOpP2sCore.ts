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

export interface ItemOPParaEnvioP2s {
  descricao?: string; description?: string;
  qtd?: number; quantity?: number;
  valor_unitario?: number;
}

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
  observacao: string | null;
  itens?: ItemOPParaEnvioP2s[] | null;
}

export interface ResultadoEnvioP2s {
  p2sOid: string;
  fornecedorVinculado: boolean;
  origemVinculo: 'parceiro' | 'colaborador' | 'parceiro_criado' | null;
}

// Formata os itens da OP (descrição, quantidade, valor unitário) pra somar às
// Observações da Conta a Pagar no PrimeStart — usuário pediu que o detalhe do
// que está sendo pago (não só o total) apareça lá, já que o ERP não tem os
// itens da OP como linhas próprias.
function formatarItensObservacao(itens: OPParaEnvioP2s['itens']): string {
  if (!Array.isArray(itens) || itens.length === 0) return '';
  const fmt = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return itens
    .map(it => {
      const descricao = it?.descricao || it?.description || '';
      const qtd = Number(it?.qtd ?? it?.quantity ?? 0);
      const unitario = Number(it?.valor_unitario ?? 0);
      return `${descricao} (Qtd ${qtd} x ${fmt(unitario)})`;
    })
    .join('; ');
}

// Observações da Conta a Pagar — mesmo texto usado na criação e na
// sincronização de edição, pra não duplicar a montagem em dois lugares.
function montarObservacoes(op: OPParaEnvioP2s, nomeResponsavel: string): string {
  const itensTexto = formatarItensObservacao(op.itens);
  return `Lançada via sistema Rentech por ${nomeResponsavel} | Natureza: ${op.natureza_pagamento || '—'} | OS: ${op.os_numero || 'S/N'} | Cliente: ${op.os_cliente || '—'} | Evento: ${op.os_evento || '—'}${op.observacao ? ` | Obs: ${op.observacao}` : ''}${itensTexto ? ` | Itens: ${itensTexto}` : ''}`;
}

// Busca a Entidade pelo CNPJ/CPF já digitado no formulário da OP nas tabelas
// locais `parceiros` e `colaboradores`, já sincronizadas do PrimeStart (ver
// app/admin/comercial/parceiros/actions.ts) — mais rápido que ir na API a
// cada envio, e cobre as duas fontes (o favorecido pode ser um colaborador
// nosso, ex: freelancer, que não é Parceiro). Colaborador só tem CPF (é
// sempre pessoa física), por isso só entra na busca quando o documento tem
// 11 dígitos.
//
// Compara por DÍGITOS (cpf_digitos/cnpj_digitos, colunas geradas — ver
// .sql/parceiros_documento_digitos.sql), não pela string mascarada crua:
// nem todo cadastro sincronizado do PrimeStart usa a mesma pontuação (às
// vezes vem sem máscara, com espaço a mais etc.), então comparar a string
// inteira ("123.456.789-00") batia igualdade EXATA e falhava mesmo com o
// parceiro certo já cadastrado — causava duplicação (bug reportado
// 2026-09-14: parceiro já existia e o sistema criava outro).
async function buscarEntidadeLocal(documentoFormatado: string): Promise<{ oid: string; origem: 'parceiro' | 'colaborador' } | null> {
  const digitos = documentoFormatado.replace(/\D/g, '');
  if (!digitos) return null;
  const campo = digitos.length > 11 ? 'cnpj_digitos' : 'cpf_digitos';

  const db = supabaseAdmin();

  const { data: parceiro } = await db.from('parceiros').select('p2s_oid').eq(campo, digitos).limit(1).maybeSingle();
  if (parceiro?.p2s_oid) return { oid: parceiro.p2s_oid as string, origem: 'parceiro' };

  if (campo === 'cpf_digitos') {
    const { data: colaborador } = await db.from('colaboradores').select('p2s_oid').eq('cpf_digitos', digitos).limit(1).maybeSingle();
    if (colaborador?.p2s_oid) return { oid: colaborador.p2s_oid as string, origem: 'colaborador' };
  }

  return null;
}

// Segunda tentativa, ao vivo na API, antes de decidir cadastrar um parceiro
// novo — reduz o risco de duplicar um cadastro que já existe no PrimeStart
// mas ainda não chegou na sincronização local (ex: cadastrado há poucos
// minutos por outra pessoa). Tenta o documento mascarado (formato mais comum
// no PrimeStart) e, se não achar, também só os dígitos — mesmo motivo do
// buscarEntidadeLocal: não dá pra confiar que todo cadastro usa a mesma
// pontuação, e a API só faz igualdade exata (sem normalizar).
async function buscarParceiroAoVivo(ambiente: AmbienteP2s, documentoFormatado: string, campo: 'CNPJ' | 'CPF'): Promise<string | null> {
  const resultado = await consultarObjetos(ambiente, 'TCustomParceiro', [criterio(campo, 'eq', 'str', documentoFormatado)], { proxy: true });
  const oidMascarado = resultado.objectlist[0]?.oid ?? null;
  if (oidMascarado) return oidMascarado;

  const digitos = documentoFormatado.replace(/\D/g, '');
  if (digitos === documentoFormatado) return null;
  const resultadoDigitos = await consultarObjetos(ambiente, 'TCustomParceiro', [criterio(campo, 'eq', 'str', digitos)], { proxy: true });
  return resultadoDigitos.objectlist[0]?.oid ?? null;
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
    Observacoes: montarObservacoes(op, nomeResponsavel),
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

// Sincroniza uma edição de OP com a Conta a Pagar já criada no PrimeStart
// (chamada por atualizarOP em app/admin/op/actions.ts, depois de gravar a
// edição no Supabase) — usuário pediu que editar a OP também reflita no ERP,
// não só na criação. Não mexe na Entidade/fornecedor (CNPJ/CPF não é
// editável na tela "Minhas OPs") nem cadastra Parceiro novo — só atualiza os
// campos que a tela de fato deixa editar: descrição/valor/vencimento/
// observações (itens inclusos, ver montarObservacoes). Se a OP nunca foi
// enviada pro PrimeStart (p2s_conta_pagar_oid nulo — ainda não achou
// fornecedor, ou o envio automático da criação falhou), não há nada a
// sincronizar aqui; o botão manual em /admin/financeiro/ops continua sendo o
// caminho pra mandar pela primeira vez.
export async function atualizarContaPagarParaOP(op: OPParaEnvioP2s & { p2s_conta_pagar_oid: string | null }, nomeResponsavel: string): Promise<void> {
  if (!op.p2s_conta_pagar_oid) return;

  const ambiente: AmbienteP2s = 'PRODUCAO';
  const campos: Record<string, unknown> = {
    Descricao: `OP: ${op.numero_op} - ${op.empresa_recebedora}`,
    Valor: Number(op.total_geral) || 0,
    DataVencimentoNominal: dataParaP2s(new Date(`${op.data_vencimento}T00:00:00Z`)),
    Observacoes: montarObservacoes(op, nomeResponsavel),
  };

  await atualizarObjeto(ambiente, 'TCustomContaPagar', op.p2s_conta_pagar_oid, campos);

  registrarLogAuditoria({
    usuario_nome: nomeResponsavel,
    acao: `EDITOU OP — SINCRONIZOU ALTERAÇÃO COM A CONTA A PAGAR ${op.p2s_conta_pagar_oid} NO PRIMESTART`,
    setor: 'OP',
    equipamento_id: op.id,
    equipamento_nome: `OP #${op.numero_op} — OS ${op.os_numero || 'S/N'}`,
  });

  revalidatePath('/admin');
}
