// app/lib/fiscal/notas.ts
// Fiscal (Focus NFe) — 2026-11-21. Só a Rentech emite; Lucro Presumido (CRT 3).
//
// • NFS-e: SERVICO (técnico, montagem, operação — ISS) e LOCACAO (quando o cliente
//   exige nota da locação; sem ISS). Os serviços continuam na Nota de Débito; a
//   NFS-e sai sob pedido (decisão do usuário).
// • NF-e (55): REMESSA_LOCACAO (acompanha o equipamento — valor do bem), RETORNO_LOCACAO
//   (NF-e de entrada própria, referenciando a remessa), VENDA_ATIVO e VENDA_MERCADORIA.
//
// Fluxo: grava a nota (PROCESSANDO) → POST na Focus (assíncrono) → consulta até
// AUTORIZADA/ERRO. Ambiente vem de fiscal_parametros (HOMOLOGAÇÃO até a virada).
import type { supabaseAdmin } from '../supabase';
import { focus, baixarArquivo, mensagemFocus, type AmbienteFiscal } from './focus';
import { saldosDaFicha } from '../locacao/fichaLocacao';
import { randomBytes } from 'crypto';
import { hojeISO } from '../locacao/datas';

/** Regime em vigor hoje: a data de lucro_presumido_desde (Rentech: 01/01/2027) vira sozinha, sem ninguém trocar no dia. */
export function regimeVigente(par: { regime?: string | null; lucro_presumido_desde?: string | null }): 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' {
  if (par.regime === 'LUCRO_PRESUMIDO') return 'LUCRO_PRESUMIDO';
  if (par.lucro_presumido_desde && hojeISO() >= String(par.lucro_presumido_desde).slice(0, 10)) return 'LUCRO_PRESUMIDO';
  return 'SIMPLES_NACIONAL';
}

type Db = ReturnType<typeof supabaseAdmin>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number, c = 2) => Math.round(v * 10 ** c) / 10 ** c;
const limpo = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

export const OPERACOES_NFSE = { SERVICO: 'NFS-e de serviço', LOCACAO: 'NFS-e de locação (sob pedido)' } as const;
export const FORMAS_PAGAMENTO_NFE: Record<string, string> = {
  '15': 'Boleto', '17': 'PIX', '18': 'Transferência', '16': 'Depósito', '03': 'Cartão de crédito', '01': 'Dinheiro', '90': 'Sem pagamento', '99': 'Outros',
};

// ============================================================================
// PARÂMETROS
// ============================================================================
export async function parametrosFiscais(db: Db, empresaId: number) {
  const { data } = await db.from('fiscal_parametros').select('*').eq('empresa_id', empresaId).maybeSingle();
  if (!data || !data.ativo) throw new Error('Esta empresa não emite nota fiscal pelo sistema (só a Rentech).');
  return data as any;
}
export async function operacoesNfe(db: Db) {
  const { data, error } = await db.from('fiscal_operacoes').select('*').order('ordem');
  if (error) throw error;
  return (data || []) as any[];
}
async function operacao(db: Db, codigo: string) {
  const { data } = await db.from('fiscal_operacoes').select('*').eq('codigo', codigo).maybeSingle();
  if (!data) throw new Error(`Operação fiscal ${codigo} não configurada.`);
  return data as any;
}
export async function emitente(db: Db, empresaId: number) {
  const { data } = await db.from('empresas').select('id, razao_social, cnpj, inscricao_estadual, inscricao_municipal').eq('id', empresaId).single();
  const cnpj = dig(data?.cnpj);
  if (cnpj.length !== 14) throw new Error('CNPJ da empresa inválido no cadastro.');
  return { cnpj, ie: dig(data?.inscricao_estadual), im: dig(data?.inscricao_municipal), nome: limpo(data?.razao_social) };
}

// ============================================================================
// DESTINATÁRIO / TOMADOR
// ============================================================================
const cacheIbge = new Map<string, Map<string, string>>();
/** Código IBGE do município (API pública do IBGE — só a UF vai na consulta). */
export async function codigoIbge(cidade: string, uf: string): Promise<string | null> {
  const UF = semAcento(uf).slice(0, 2);
  if (!/^[A-Z]{2}$/.test(UF) || !cidade) return null;
  if (!cacheIbge.has(UF)) {
    try {
      const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${UF}/municipios`, { signal: AbortSignal.timeout(15000) });
      const lista = (await r.json()) as { id: number; nome: string }[];
      cacheIbge.set(UF, new Map(lista.map(m => [semAcento(m.nome).replace(/[^A-Z0-9 ]/g, ''), String(m.id)])));
    } catch { return null; }
  }
  return cacheIbge.get(UF)!.get(semAcento(cidade).replace(/[^A-Z0-9 ]/g, '')) || null;
}

export async function dadosParceiro(db: Db, parceiroId: number) {
  const { data: p } = await db.from('parceiros')
    .select('id, nome_completo, nome_exibicao, cpf, cnpj, inscricao_estadual, inscricao_municipal, endereco1, numero1, complemento1, bairro1, cidade1, estado1, cep1, telefone1, email1')
    .eq('id', parceiroId).maybeSingle();
  if (!p) throw new Error('Cliente não encontrado.');
  const cnpj = dig(p.cnpj), cpf = dig(p.cpf);
  const ieRaw = limpo(p.inscricao_estadual).toUpperCase();
  const ie = /ISENT/.test(ieRaw) ? 'ISENTO' : dig(ieRaw);
  const d = {
    id: p.id as number, nome: limpo(p.nome_completo || p.nome_exibicao), cnpj: cnpj.length === 14 ? cnpj : '', cpf: cpf.length === 11 ? cpf : '',
    ie, im: dig(p.inscricao_municipal), email: limpo(p.email1).split(/[;, ]/)[0] || '', telefone: dig(p.telefone1),
    logradouro: limpo(p.endereco1), numero: limpo(p.numero1) || 'S/N', complemento: limpo(p.complemento1), bairro: limpo(p.bairro1),
    cidade: limpo(p.cidade1), uf: semAcento(limpo(p.estado1)).slice(0, 2), cep: dig(p.cep1),
  };
  const faltas: string[] = [];
  if (!d.cnpj && !d.cpf) faltas.push('CNPJ/CPF');
  if (!d.nome) faltas.push('nome');
  if (!d.logradouro) faltas.push('endereço');
  if (!d.bairro) faltas.push('bairro');
  if (!d.cidade || !d.uf) faltas.push('cidade/UF');
  if (d.cep.length !== 8) faltas.push('CEP');
  return { ...d, faltas };
}

// ============================================================================
// GRAVAÇÃO + ENVIO
// ============================================================================
type Vinculos = { fichaReservaId?: number | null; fichaLocacaoId?: number | null; faturaId?: number | null; notaReferenciadaId?: number | null };
const vinculos = (a: Vinculos): Vinculos => ({ fichaReservaId: a.fichaReservaId || null, fichaLocacaoId: a.fichaLocacaoId || null, faturaId: a.faturaId || null, notaReferenciadaId: a.notaReferenciadaId || null });

async function gravarEEnviar(db: Db, base: {
  empresaId: number; tipo: 'NFE' | 'NFSE'; operacao: string; ambiente: AmbienteFiscal; parceiroId: number; valor: number; payload: any; usuario: string;
} & Vinculos) {
  const ref = `rt${base.ambiente === 'PRODUCAO' ? 'p' : 'h'}${base.tipo === 'NFE' ? 'e' : 's'}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const { data: nota, error } = await db.from('fiscal_notas').insert({
    empresa_id: base.empresaId, tipo: base.tipo, operacao: base.operacao, ambiente: base.ambiente, ref, status: 'PROCESSANDO',
    parceiro_id: base.parceiroId, ficha_reserva_id: base.fichaReservaId || null, ficha_locacao_id: base.fichaLocacaoId || null,
    fatura_id: base.faturaId || null, nota_referenciada_id: base.notaReferenciadaId || null, valor_total: arred(base.valor),
    payload: base.payload, criado_por: base.usuario,
  }).select('id').single();
  if (error) throw error;
  let r;
  try {
    r = await focus(base.ambiente, 'POST', `/v2/${base.tipo === 'NFE' ? 'nfe' : 'nfse'}?ref=${ref}`, base.payload);
  } catch (e: any) {
    // falha de rede: a nota pode ter chegado — fica PROCESSANDO e a consulta resolve
    await db.from('fiscal_notas').update({ mensagem: `Sem resposta da Focus (${e.message}). Consulte de novo em instantes.`, atualizado_em: new Date().toISOString() }).eq('id', nota.id);
    return { id: nota.id as number, status: 'PROCESSANDO', mensagem: 'Enviada; aguardando a Focus.' };
  }
  if (r.http >= 400) {
    const msg = mensagemFocus(r.corpo);
    await db.from('fiscal_notas').update({ status: 'ERRO', mensagem: msg, resposta: r.corpo, atualizado_em: new Date().toISOString() }).eq('id', nota.id);
    return { id: nota.id as number, status: 'ERRO', mensagem: msg };
  }
  await aplicarResposta(db, nota.id, base.ambiente, r.corpo);
  // tenta já buscar o resultado (NFS-e de SP e NF-e costumam sair em segundos)
  await new Promise(res => setTimeout(res, 2500));
  const c = await consultarNota(db, nota.id).catch(() => null);
  return { id: nota.id as number, status: c?.status || 'PROCESSANDO', mensagem: c?.mensagem || null };
}

const STATUS: Record<string, string> = {
  processando_autorizacao: 'PROCESSANDO', autorizado: 'AUTORIZADA', cancelado: 'CANCELADA', erro_autorizacao: 'ERRO', denegado: 'ERRO',
};
async function aplicarResposta(db: Db, id: number, _amb: AmbienteFiscal, c: any) {
  const status = STATUS[c?.status] || null;
  const upd: any = { resposta: c, atualizado_em: new Date().toISOString() };
  if (status) upd.status = status;
  if (c?.numero) upd.numero = String(c.numero);
  if (c?.serie) upd.serie = String(c.serie);
  if (c?.chave_nfe) upd.chave = String(c.chave_nfe).replace(/^NFe/, '');
  if (c?.codigo_verificacao) upd.codigo_verificacao = String(c.codigo_verificacao);
  if (c?.data_emissao) upd.data_emissao = c.data_emissao;
  if (c?.caminho_danfe || c?.url_danfse) upd.caminho_pdf = c.caminho_danfe || c.url_danfse;
  if (c?.caminho_xml_nota_fiscal) upd.caminho_xml = c.caminho_xml_nota_fiscal;
  if (c?.caminho_xml_cancelamento) upd.caminho_xml_cancelamento = c.caminho_xml_cancelamento;
  if (c?.url) upd.url_consulta = c.url;
  upd.mensagem = status === 'ERRO' ? mensagemFocus(c) : status === 'AUTORIZADA' ? (c?.mensagem_sefaz || null) : (c?.mensagem_sefaz || null);
  await db.from('fiscal_notas').update(upd).eq('id', id);
  return status;
}

export async function consultarNota(db: Db, id: number) {
  const { data: f } = await db.from('fiscal_notas').select('id, tipo, ambiente, ref, status').eq('id', id).maybeSingle();
  if (!f) throw new Error('Nota não encontrada.');
  const r = await focus(f.ambiente, 'GET', `/v2/${f.tipo === 'NFE' ? 'nfe' : 'nfse'}/${f.ref}`);
  if (r.http === 404) {
    if (f.status === 'PROCESSANDO') await db.from('fiscal_notas').update({ status: 'ERRO', mensagem: 'A Focus não recebeu esta nota (não encontrada). Emita de novo.', atualizado_em: new Date().toISOString() }).eq('id', id);
    return { status: f.status === 'PROCESSANDO' ? 'ERRO' : f.status, mensagem: 'Nota não encontrada na Focus.' };
  }
  if (r.http >= 400) return { status: f.status, mensagem: mensagemFocus(r.corpo) };
  const st = await aplicarResposta(db, id, f.ambiente, r.corpo);
  return { status: st || f.status, mensagem: st === 'ERRO' ? mensagemFocus(r.corpo) : null };
}

/** Atualiza as notas ainda em processamento (tela e cron). */
export async function atualizarProcessando(db: Db, limite = 30) {
  const { data } = await db.from('fiscal_notas').select('id').eq('status', 'PROCESSANDO').order('id').limit(limite);
  let ok = 0;
  for (const x of (data || []) as any[]) { try { await consultarNota(db, x.id); ok++; } catch { /* segue */ } }
  return ok;
}

export async function cancelarNota(db: Db, id: number, justificativa: string, usuario: string) {
  const j = limpo(justificativa);
  if (j.length < 15 || j.length > 255) throw new Error('A justificativa precisa ter entre 15 e 255 caracteres.');
  const { data: f } = await db.from('fiscal_notas').select('id, tipo, ambiente, ref, status').eq('id', id).maybeSingle();
  if (!f) throw new Error('Nota não encontrada.');
  if (f.status !== 'AUTORIZADA') throw new Error('Só nota autorizada pode ser cancelada.');
  const r = await focus(f.ambiente, 'DELETE', `/v2/${f.tipo === 'NFE' ? 'nfe' : 'nfse'}/${f.ref}`, { justificativa: j });
  if (r.http >= 400 || r.corpo?.status !== 'cancelado') throw new Error(`A ${f.tipo === 'NFE' ? 'SEFAZ' : 'Prefeitura'} não cancelou: ${mensagemFocus(r.corpo)}`);
  await db.from('fiscal_notas').update({
    status: 'CANCELADA', cancelada_em: new Date().toISOString(), cancelada_por: usuario, motivo_cancelamento: j,
    caminho_xml_cancelamento: r.corpo.caminho_xml_cancelamento || null, atualizado_em: new Date().toISOString(),
  }).eq('id', id);
}

export async function cartaCorrecao(db: Db, id: number, correcao: string, usuario: string) {
  const t = limpo(correcao);
  if (t.length < 15 || t.length > 1000) throw new Error('A correção precisa ter entre 15 e 1000 caracteres.');
  const { data: f } = await db.from('fiscal_notas').select('id, tipo, ambiente, ref, status, cartas_correcao').eq('id', id).maybeSingle();
  if (!f) throw new Error('Nota não encontrada.');
  if (f.tipo !== 'NFE' || f.status !== 'AUTORIZADA') throw new Error('Carta de correção só para NF-e autorizada.');
  const r = await focus(f.ambiente, 'POST', `/v2/nfe/${f.ref}/carta_correcao`, { correcao: t });
  if (r.http >= 400 || r.corpo?.status !== 'autorizado') throw new Error(`Carta de correção recusada: ${mensagemFocus(r.corpo)}`);
  const cartas = [...((f.cartas_correcao || []) as any[]), {
    numero: r.corpo.numero_carta_correcao, correcao: t, em: new Date().toISOString(), por: usuario,
    caminho_pdf: r.corpo.caminho_pdf_carta_correcao || null, caminho_xml: r.corpo.caminho_xml_carta_correcao || null,
  }];
  await db.from('fiscal_notas').update({ cartas_correcao: cartas, atualizado_em: new Date().toISOString() }).eq('id', id);
}

export async function arquivoNota(db: Db, id: number, qual: 'pdf' | 'xml' | 'cce') {
  const { data: f } = await db.from('fiscal_notas').select('ambiente, tipo, numero, caminho_pdf, caminho_xml, caminho_xml_cancelamento, status, cartas_correcao').eq('id', id).maybeSingle();
  if (!f) throw new Error('Nota não encontrada.');
  const cce = ((f.cartas_correcao || []) as any[]).at(-1);
  const caminho = qual === 'pdf' ? f.caminho_pdf : qual === 'cce' ? cce?.caminho_pdf : f.caminho_xml;
  if (!caminho) throw new Error(qual === 'pdf' ? 'PDF ainda não disponível.' : qual === 'cce' ? 'Sem carta de correção.' : 'XML ainda não disponível.');
  const a = await baixarArquivo(f.ambiente, caminho);
  const nome = `${f.tipo === 'NFE' ? 'nfe' : 'nfse'}-${f.numero || id}${qual === 'cce' ? '-cce' : ''}.${qual === 'xml' ? 'xml' : 'pdf'}`;
  return { ...a, nome };
}

// ============================================================================
// NFS-e
// ============================================================================
export async function emitirNfse(db: Db, a: {
  empresaId: number; operacao: 'SERVICO' | 'LOCACAO'; parceiroId: number; valor: number; discriminacao: string; issRetido?: boolean;
} & Vinculos, usuario: string) {
  const par = await parametrosFiscais(db, a.empresaId);
  const emi = await emitente(db, a.empresaId);
  const valor = arred(n(a.valor));
  if (valor <= 0) throw new Error('Informe o valor.');
  const disc = limpo(a.discriminacao);
  if (disc.length < 5) throw new Error('Informe a discriminação do serviço.');
  const loc = a.operacao === 'LOCACAO';
  const item = limpo(loc ? par.nfse_locacao_item_lista_servico : par.nfse_item_lista_servico);
  if (!item) throw new Error(`Falta o código de serviço da Prefeitura para ${loc ? 'a NFS-e de locação' : 'a NFS-e de serviço'} (Fiscal › Parâmetros).`);
  if (!emi.im) throw new Error('Falta a inscrição municipal da empresa.');
  const t = await dadosParceiro(db, a.parceiroId);
  if (!t.cnpj && !t.cpf) throw new Error('Cliente sem CNPJ/CPF.');
  const codMun = t.cidade && t.uf ? await codigoIbge(t.cidade, t.uf) : null;
  const aliquota = loc ? par.nfse_locacao_aliquota : par.nfse_aliquota;
  const servico: any = {
    valor_servicos: valor, iss_retido: !!a.issRetido, item_lista_servico: item, discriminacao: disc.slice(0, 2000), codigo_municipio: par.codigo_municipio,
  };
  if (aliquota !== null && aliquota !== undefined) servico.aliquota = n(aliquota);
  if (!loc && par.nfse_codigo_tributario_municipio) servico.codigo_tributario_municipio = par.nfse_codigo_tributario_municipio;
  if (!loc && par.nfse_codigo_cnae) servico.codigo_cnae = dig(par.nfse_codigo_cnae);
  const tomador: any = { razao_social: t.nome.slice(0, 115) };
  if (t.cnpj) tomador.cnpj = t.cnpj; else tomador.cpf = t.cpf;
  if (t.email) tomador.email = t.email;
  if (t.telefone) tomador.telefone = t.telefone;
  if (t.im && codMun === par.codigo_municipio) tomador.inscricao_municipal = t.im;
  if (t.logradouro && codMun && t.cep.length === 8) tomador.endereco = { logradouro: t.logradouro, numero: t.numero, complemento: t.complemento || undefined, bairro: t.bairro, codigo_municipio: codMun, uf: t.uf, cep: t.cep };
  // Regime: hoje a Rentech é Simples Nacional (Prefeitura exige o leiaute 1); no Lucro
  // Presumido, com IBS/CBS ligado, vai o leiaute 2 de SP (nomes descobertos no teste
  // de homologação de 2026-11-21: finalidade_emissao, consumidor_final, indicador_destinatario…).
  const simples = regimeVigente(par) === 'SIMPLES_NACIONAL';
  if (!simples && par.enviar_ibs_cbs) {
    if (!par.nfse_codigo_nbs || !par.nfse_codigo_indicador_operacao || !par.nfse_ibs_cbs_situacao_tributaria || !par.nfse_ibs_cbs_classificacao_tributaria)
      throw new Error('IBS/CBS ligado: preencha NBS, indicador de operação, CST e cClassTrib da NFS-e (Fiscal › Parâmetros).');
    Object.assign(servico, {
      valor_final_cobrado: valor, valor_ipi: 0, exigibilidade_suspensa: 0, finalidade_emissao: 0, consumidor_final: t.cnpj ? 0 : 1, indicador_destinatario: 0,
      codigo_nbs: dig(par.nfse_codigo_nbs), codigo_indicador_operacao: dig(par.nfse_codigo_indicador_operacao),
      ibs_cbs_situacao_tributaria: par.nfse_ibs_cbs_situacao_tributaria, ibs_cbs_classificacao_tributaria: par.nfse_ibs_cbs_classificacao_tributaria,
    });
  }
  const payload = {
    data_emissao: new Date().toISOString(), natureza_operacao: par.nfse_natureza_operacao || '1', optante_simples_nacional: simples,
    prestador: { cnpj: emi.cnpj, inscricao_municipal: emi.im, codigo_municipio: par.codigo_municipio }, tomador, servico,
  };
  return gravarEEnviar(db, { empresaId: a.empresaId, tipo: 'NFSE', operacao: a.operacao, ambiente: par.ambiente, parceiroId: a.parceiroId, valor, payload, usuario, ...vinculos(a) });
}

// ============================================================================
// NF-e
// ============================================================================
export interface ItemNfe { produto_id?: number | null; codigo: string; descricao: string; ncm: string; unidade: string; quantidade: number; valor_unitario: number; origem?: string | null }
export interface VolumeNfe { quantidade?: number; especie?: string; peso_bruto?: number; peso_liquido?: number }

export async function emitirNfe(db: Db, a: {
  empresaId: number; operacao: string; parceiroId: number; itens: ItemNfe[]; informacoes?: string | null; volumes?: VolumeNfe | null;
  modalidadeFrete?: number; formaPagamento?: string | null;
} & Vinculos, usuario: string) {
  const par = await parametrosFiscais(db, a.empresaId);
  const op = await operacao(db, a.operacao);
  const emi = await emitente(db, a.empresaId);
  const d = await dadosParceiro(db, a.parceiroId);
  if (d.faltas.length) throw new Error(`Cadastro do cliente incompleto para NF-e: falta ${d.faltas.join(', ')} (Comercial › Parceiros).`);
  const itens = (a.itens || []).filter(i => n(i.quantidade) > 0);
  if (!itens.length) throw new Error('Nenhum item na nota.');
  const semNcm = itens.filter(i => dig(i.ncm).length !== 8);
  if (semNcm.length) throw new Error(`Item sem NCM (8 dígitos): ${semNcm.slice(0, 3).map(i => i.descricao).join('; ')}${semNcm.length > 3 ? '…' : ''}`);
  const semValor = itens.filter(i => n(i.valor_unitario) <= 0);
  if (semValor.length) throw new Error(`Item sem valor: ${semValor.slice(0, 3).map(i => i.descricao).join('; ')}${semValor.length > 3 ? '…' : ''}`);

  const interestadual = d.uf !== 'SP';
  const contribuinte = !!d.cnpj && !!d.ie && d.ie !== 'ISENTO';
  const indIe = contribuinte ? 1 : d.ie === 'ISENTO' && d.cnpj ? 2 : 9;
  const venda = a.operacao.startsWith('VENDA');
  const simples = regimeVigente(par) === 'SIMPLES_NACIONAL';
  const cstIcms = simples ? (op.icms_csosn || '400') : op.icms_situacao_tributaria;
  const cstPis = simples ? (op.pis_cst_simples || '49') : op.pis_situacao_tributaria;
  const cstCofins = simples ? (op.cofins_cst_simples || '49') : op.cofins_situacao_tributaria;
  if (venda && interestadual && indIe === 9 && !['41', '40', '300', '400'].includes(cstIcms))
    throw new Error('Venda tributada para não contribuinte de outro estado exige DIFAL — emita com o contador.');
  const cfop = interestadual ? op.cfop_interestadual : op.cfop_interno;
  const aliqIcms = n(interestadual ? op.icms_aliquota_interestadual : op.icms_aliquota_interna);

  let notaRef: any = null;
  if (a.notaReferenciadaId) {
    const { data } = await db.from('fiscal_notas').select('id, chave, status, tipo').eq('id', a.notaReferenciadaId).maybeSingle();
    if (!data || data.tipo !== 'NFE' || data.status !== 'AUTORIZADA' || !data.chave) throw new Error('A nota referenciada precisa ser uma NF-e autorizada.');
    notaRef = data;
  }

  let total = 0;
  const items = itens.map((i, k) => {
    const q = arred(n(i.quantidade), 4), vu = arred(n(i.valor_unitario), 4), vb = arred(q * vu);
    total += vb;
    const it: any = {
      numero_item: k + 1, codigo_produto: limpo(i.codigo || i.produto_id || k + 1).slice(0, 60), descricao: limpo(i.descricao).slice(0, 120),
      cfop, codigo_ncm: dig(i.ncm), unidade_comercial: (limpo(i.unidade) || 'UN').toUpperCase().slice(0, 6), quantidade_comercial: q,
      valor_unitario_comercial: vu, valor_bruto: vb, icms_origem: String(i.origem ?? '0').slice(0, 1) || '0',
      icms_situacao_tributaria: cstIcms, pis_situacao_tributaria: cstPis, cofins_situacao_tributaria: cstCofins,
    };
    if (!simples && ['00', '20', '90'].includes(cstIcms) && aliqIcms > 0) {
      Object.assign(it, { icms_modalidade_base_calculo: 3, icms_base_calculo: vb, icms_aliquota: aliqIcms, icms_valor: arred(vb * aliqIcms / 100) });
    }
    if (!simples && ['01', '02'].includes(cstPis) && n(op.pis_aliquota) > 0) Object.assign(it, { pis_base_calculo: vb, pis_aliquota_porcentual: n(op.pis_aliquota), pis_valor: arred(vb * n(op.pis_aliquota) / 100) });
    if (!simples && ['01', '02'].includes(cstCofins) && n(op.cofins_aliquota) > 0) Object.assign(it, { cofins_base_calculo: vb, cofins_aliquota_porcentual: n(op.cofins_aliquota), cofins_valor: arred(vb * n(op.cofins_aliquota) / 100) });
    if (!simples && par.enviar_ibs_cbs && op.ibs_cbs_situacao_tributaria) Object.assign(it, { ibs_cbs_situacao_tributaria: op.ibs_cbs_situacao_tributaria, ibs_cbs_classificacao_tributaria: op.ibs_cbs_classificacao_tributaria });
    return it;
  });
  total = arred(total);
  const forma = venda ? (a.formaPagamento && FORMAS_PAGAMENTO_NFE[a.formaPagamento] ? a.formaPagamento : '15') : '90';

  const payload: any = {
    natureza_operacao: op.natureza_operacao.slice(0, 60), data_emissao: new Date().toISOString(), tipo_documento: op.tipo_documento, finalidade_emissao: op.finalidade_emissao || 1,
    local_destino: interestadual ? 2 : 1, consumidor_final: indIe === 9 ? 1 : 0, presenca_comprador: venda ? 9 : 0, cnpj_emitente: emi.cnpj,
    // a razão social da Rentech tem 64 caracteres e a NF-e aceita 60 (xNome)
    ...(emi.nome ? { nome_emitente: emi.nome.slice(0, 60).trim() } : {}), regime_tributario_emitente: simples ? 1 : 3,
    nome_destinatario: d.nome.slice(0, 60), indicador_inscricao_estadual_destinatario: indIe,
    logradouro_destinatario: d.logradouro.slice(0, 60), numero_destinatario: d.numero.slice(0, 60), bairro_destinatario: d.bairro.slice(0, 60),
    municipio_destinatario: d.cidade, uf_destinatario: d.uf, cep_destinatario: d.cep, pais_destinatario: 'Brasil',
    modalidade_frete: a.modalidadeFrete ?? 0,
    formas_pagamento: [{ forma_pagamento: forma, valor_pagamento: forma === '90' ? 0 : total }],
    items,
  };
  if (d.cnpj) payload.cnpj_destinatario = d.cnpj; else payload.cpf_destinatario = d.cpf;
  if (indIe === 1) payload.inscricao_estadual_destinatario = d.ie;
  if (d.complemento) payload.complemento_destinatario = d.complemento.slice(0, 60);
  if (d.telefone) payload.telefone_destinatario = d.telefone;
  if (d.email) payload.email_destinatario = d.email;
  if (notaRef) payload.notas_referenciadas = [{ chave_nfe: notaRef.chave }];
  const v = a.volumes;
  if (v && (n(v.quantidade) > 0 || n(v.peso_bruto) > 0)) payload.volumes = [{
    ...(n(v.quantidade) > 0 ? { quantidade: Math.round(n(v.quantidade)) } : {}), ...(limpo(v.especie) ? { especie: limpo(v.especie) } : {}),
    ...(n(v.peso_bruto) > 0 ? { peso_bruto: arred(n(v.peso_bruto), 3) } : {}), ...(n(v.peso_liquido) > 0 ? { peso_liquido: arred(n(v.peso_liquido), 3) } : {}),
  }];
  const info = [limpo(a.informacoes), limpo(op.informacoes_padrao)].filter(Boolean);
  if (info.length) payload.informacoes_adicionais_contribuinte = [...new Set(info)].join(' ').slice(0, 5000);

  return gravarEEnviar(db, { empresaId: a.empresaId, tipo: 'NFE', operacao: a.operacao, ambiente: par.ambiente, parceiroId: a.parceiroId, valor: total, payload, usuario, ...vinculos(a) });
}

// ============================================================================
// SUGESTÕES DE ITENS (remessa a partir da Ficha de Locação; retorno da remessa)
// ============================================================================
async function dadosProdutos(db: Db, ids: number[]) {
  if (!ids.length) return new Map<number, any>();
  const { data } = await db.from('produtos').select('id, nome_item, codigo_formatado, classificacao_fiscal, unidade, origem_nfe, valor_indenizacao, custo_reposicao, peso_unitario').in('id', ids);
  return new Map(((data || []) as any[]).map(p => [p.id, p]));
}
export const valorDoBem = (p: any) => n(p?.valor_indenizacao) > 0 ? n(p.valor_indenizacao) : n(p?.custo_reposicao);

/** Itens da remessa de uma FL: o que está com o cliente (ou, se nada saiu ainda, o previsto). */
export async function itensRemessaDaFicha(db: Db, fichaLocacaoId: number) {
  const { data: fl } = await db.from('locacao_fichas_locacao').select('id, numero, empresa_id, parceiro_id, ficha_reserva_id, origem').eq('id', fichaLocacaoId).maybeSingle();
  if (!fl) throw new Error('Ficha de locação não encontrada.');
  const saldos = await saldosDaFicha(db, fichaLocacaoId);
  const algumaSaida = saldos.some(s => s.saiu > 0);
  const porProduto = new Map<number, number>();
  for (const s of saldos) {
    const q = algumaSaida ? s.fora : s.prevista;
    if (q > 0 && s.produto_id) porProduto.set(s.produto_id, arred((porProduto.get(s.produto_id) || 0) + q, 3));
  }
  const prods = await dadosProdutos(db, [...porProduto.keys()]);
  const itens = [...porProduto].map(([pid, q]) => {
    const p = prods.get(pid);
    return {
      produto_id: pid, codigo: limpo(p?.codigo_formatado) || String(pid), descricao: limpo(p?.nome_item) || `Produto #${pid}`, ncm: dig(p?.classificacao_fiscal),
      unidade: limpo(p?.unidade) || 'UN', quantidade: q, valor_unitario: valorDoBem(p), origem: p?.origem_nfe != null ? String(p.origem_nfe) : '0', peso: n(p?.peso_unitario) * q,
    };
  }).sort((x, y) => x.descricao.localeCompare(y.descricao, 'pt-BR'));
  return { ficha: fl as any, base: algumaSaida ? 'COM_O_CLIENTE' : 'PREVISTO', itens };
}

/** Itens de retorno: o que a remessa levou menos o que outras notas de retorno já devolveram. */
export async function itensRetornoDaRemessa(db: Db, remessaId: number) {
  const { data: r } = await db.from('fiscal_notas').select('id, empresa_id, parceiro_id, ficha_reserva_id, ficha_locacao_id, operacao, status, payload, numero').eq('id', remessaId).maybeSingle();
  if (!r || r.operacao !== 'REMESSA_LOCACAO') throw new Error('Remessa não encontrada.');
  if (r.status !== 'AUTORIZADA') throw new Error('A remessa precisa estar autorizada.');
  const { data: rets } = await db.from('fiscal_notas').select('payload').eq('nota_referenciada_id', remessaId).eq('operacao', 'RETORNO_LOCACAO').in('status', ['AUTORIZADA', 'PROCESSANDO']);
  const ja = new Map<string, number>();
  for (const x of (rets || []) as any[]) for (const i of (x.payload?.items || []) as any[]) ja.set(i.codigo_produto, (ja.get(i.codigo_produto) || 0) + n(i.quantidade_comercial));
  const itens = ((r.payload?.items || []) as any[]).map(i => ({
    produto_id: null, codigo: i.codigo_produto, descricao: i.descricao, ncm: i.codigo_ncm, unidade: i.unidade_comercial,
    quantidade: arred(Math.max(0, n(i.quantidade_comercial) - (ja.get(i.codigo_produto) || 0)), 4), valor_unitario: n(i.valor_unitario_comercial), origem: i.icms_origem,
  })).filter(i => i.quantidade > 0);
  return { remessa: r as any, itens };
}

/** Uma prévia do produto para venda/avulso. */
export async function itemDoProduto(db: Db, produtoId: number) {
  const p = (await dadosProdutos(db, [produtoId])).get(produtoId);
  if (!p) throw new Error('Produto não encontrado.');
  return { produto_id: p.id, codigo: limpo(p.codigo_formatado) || String(p.id), descricao: limpo(p.nome_item), ncm: dig(p.classificacao_fiscal), unidade: limpo(p.unidade) || 'UN', quantidade: 1, valor_unitario: valorDoBem(p), origem: p.origem_nfe != null ? String(p.origem_nfe) : '0' };
}
