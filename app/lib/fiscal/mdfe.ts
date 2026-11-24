// app/lib/fiscal/mdfe.ts
// MDF-e (modelo 58) pela Focus NFe — 2026-11-21. A Rentech emite como
// "transportador de carga própria" (emitente 2): junta as NF-e de uma viagem
// (remessas/vendas na IDA; retornos na VOLTA) com o veículo da frota e os
// motoristas. Obrigatório em viagem interestadual com veículo próprio; dentro
// de SP é só sugerido (o contador confirma a regra estadual).
//
// Formato descoberto em homologação (21/11/2026): o tipo de emitente vai em
// `emitente`; as NF-e vão DENTRO de cada município de descarregamento
// (`municipios_descarregamento[].notas_fiscais[].chave_nfe`); o veículo e os
// condutores em `modal_rodoviario`. A Focus devolve a autorização na hora (201).
// Seguro da carga é opcional para carga própria.
import type { supabaseAdmin } from '../supabase';
import { focus, baixarArquivo, mensagemFocus, type AmbienteFiscal } from './focus';
import { parametrosFiscais, emitente, codigoIbge } from './notas';
import { hojeISO } from '../locacao/datas';
import { randomBytes } from 'crypto';

type Db = ReturnType<typeof supabaseAdmin>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number, c = 2) => Math.round(v * 10 ** c) / 10 ** c;
const limpo = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const UF = (v: unknown) => limpo(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().slice(0, 2);

export const TIPOS_RODADO: Record<string, string> = { '01': 'Truck', '02': 'Toco', '03': 'Cavalo mecânico', '04': 'Van', '05': 'Utilitário', '06': 'Outros' };
export const TIPOS_CARROCERIA: Record<string, string> = { '00': 'Não aplicável', '01': 'Aberta', '02': 'Fechada / baú', '03': 'Granelera', '04': 'Porta container', '05': 'Sider' };
export const TIPOS_CARGA: Record<string, string> = { '05': 'Carga geral', '04': 'Conteinerizada', '01': 'Granel sólido', '11': 'Perigosa (carga geral)' };
/** Operações que viajam na IDA (saem da Rentech) e na VOLTA (voltam para a Rentech). */
const OPERACOES_IDA = ['REMESSA_LOCACAO', 'VENDA_ATIVO', 'VENDA_MERCADORIA'];
const OPERACOES_VOLTA = ['RETORNO_LOCACAO'];
export type SentidoMdfe = 'IDA' | 'VOLTA';

export function cpfValido(c: string) {
  const d = dig(c);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (k: number) => { let s = 0; for (let i = 0; i < k; i++) s += Number(d[i]) * (k + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

// ============================================================================
// PERCURSO: UFs atravessadas entre a de início e a de fim (caminho mais curto pelas divisas)
// ============================================================================
const VIZINHOS: Record<string, string[]> = {
  AC: ['AM', 'RO'], AL: ['PE', 'SE', 'BA'], AP: ['PA'], AM: ['AC', 'RO', 'MT', 'PA', 'RR'], BA: ['SE', 'AL', 'PE', 'PI', 'TO', 'GO', 'MG', 'ES'],
  CE: ['RN', 'PB', 'PE', 'PI'], DF: ['GO', 'MG'], ES: ['BA', 'MG', 'RJ'], GO: ['TO', 'BA', 'MG', 'MS', 'MT', 'DF'], MA: ['PA', 'TO', 'PI'],
  MT: ['RO', 'AM', 'PA', 'TO', 'GO', 'MS'], MS: ['MT', 'GO', 'MG', 'SP', 'PR'], MG: ['BA', 'GO', 'DF', 'MS', 'SP', 'RJ', 'ES'],
  PA: ['AP', 'AM', 'RR', 'MT', 'TO', 'MA'], PB: ['RN', 'CE', 'PE'], PR: ['SP', 'MS', 'SC'], PE: ['PB', 'CE', 'PI', 'BA', 'AL'],
  PI: ['MA', 'TO', 'BA', 'PE', 'CE'], RJ: ['MG', 'ES', 'SP'], RN: ['CE', 'PB'], RS: ['SC'], RO: ['AC', 'AM', 'MT'], RR: ['AM', 'PA'],
  SC: ['PR', 'RS'], SP: ['MG', 'RJ', 'PR', 'MS'], SE: ['AL', 'BA'], TO: ['MA', 'PI', 'BA', 'GO', 'MT', 'PA'],
};
export const UFS = Object.keys(VIZINHOS).sort();
export function percursoSugerido(inicio: string, fim: string): string[] {
  const a = UF(inicio), b = UF(fim);
  if (a === b || !VIZINHOS[a] || !VIZINHOS[b]) return [];
  const anterior = new Map<string, string>([[a, '']]);
  const fila = [a];
  while (fila.length) {
    const u = fila.shift()!;
    if (u === b) break;
    for (const v of VIZINHOS[u]) if (!anterior.has(v)) { anterior.set(v, u); fila.push(v); }
  }
  const caminho: string[] = [];
  for (let u = anterior.get(b); u && u !== a; u = anterior.get(u)) caminho.unshift(u);
  return caminho;
}

const cacheMunicipio = new Map<string, string>([['3550308', 'São Paulo']]);
async function nomeMunicipio(codigo: string): Promise<string> {
  if (cacheMunicipio.has(codigo)) return cacheMunicipio.get(codigo)!;
  try {
    const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${codigo}`, { signal: AbortSignal.timeout(15000) });
    const j = (await r.json()) as any;
    if (j?.nome) { cacheMunicipio.set(codigo, j.nome); return j.nome; }
  } catch { /* segue */ }
  throw new Error(`Não achei o nome do município ${codigo} (IBGE).`);
}

// ============================================================================
// NOTAS QUE PODEM IR NUM MDF-e
// ============================================================================
const STATUS_ATIVOS = ['PROCESSANDO', 'AUTORIZADO', 'ENCERRADO'];

/** NF-e autorizadas dos últimos 30 dias, no ambiente atual, que ainda não estão num MDF-e válido. */
export async function notasParaMdfe(db: Db, empresaId: number, ambiente: AmbienteFiscal) {
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await db.from('fiscal_notas')
    .select('id, operacao, numero, serie, chave, valor_total, criado_em, payload, parceiro:parceiros(nome_exibicao, nome_completo), fl:locacao_fichas_locacao(numero)')
    .eq('empresa_id', empresaId).eq('tipo', 'NFE').eq('status', 'AUTORIZADA').eq('ambiente', ambiente).in('operacao', [...OPERACOES_IDA, ...OPERACOES_VOLTA])
    .gte('criado_em', desde).not('chave', 'is', null).order('id', { ascending: false }).limit(500);
  if (error) throw error;
  const ids = ((data || []) as any[]).map(x => x.id);
  const usadas = new Set<number>();
  if (ids.length) {
    const { data: lig } = await db.from('fiscal_mdfe_notas').select('nota_id, mdfe:fiscal_mdfe(status)').in('nota_id', ids);
    for (const l of (lig || []) as any[]) if (STATUS_ATIVOS.includes(l.mdfe?.status)) usadas.add(l.nota_id);
  }
  return ((data || []) as any[]).filter(x => !usadas.has(x.id)).map(x => ({
    id: x.id as number, operacao: x.operacao as string, sentido: (OPERACOES_VOLTA.includes(x.operacao) ? 'VOLTA' : 'IDA') as SentidoMdfe,
    numero: x.numero, serie: x.serie, chave: x.chave as string, valor: n(x.valor_total), criado_em: x.criado_em,
    cliente: limpo(x.parceiro?.nome_exibicao || x.parceiro?.nome_completo) || '—', fl: x.fl?.numero || null,
    cidade: limpo(x.payload?.municipio_destinatario), uf: UF(x.payload?.uf_destinatario), cep: dig(x.payload?.cep_destinatario),
    peso: n(x.payload?.volumes?.[0]?.peso_bruto),
  }));
}

// ============================================================================
// EMISSÃO
// ============================================================================
export interface CondutorMdfe { nome: string; cpf: string; funcionario_id?: number | null }
export interface VeiculoMdfe { tara_kg?: number | null; capacidade_kg?: number | null; capacidade_m3?: number | null; tipo_rodado?: string | null; tipo_carroceria?: string | null; uf_licenciamento?: string | null }

export async function emitirMdfe(db: Db, a: {
  empresaId: number; sentido: SentidoMdfe; notaIds: number[]; veiculoId: string; veiculo?: VeiculoMdfe | null; condutores: CondutorMdfe[];
  percurso?: string[] | null; pesoKg?: number | null; dataViagem?: string | null; informacoes?: string | null;
}, usuario: string) {
  const par = await parametrosFiscais(db, a.empresaId);
  const emi = await emitente(db, a.empresaId);
  const ambiente = par.ambiente as AmbienteFiscal;

  // notas
  const candidatas = await notasParaMdfe(db, a.empresaId, ambiente);
  const ids = [...new Set((a.notaIds || []).map(Number))];
  if (!ids.length) throw new Error('Escolha as NF-e da viagem.');
  const notas = ids.map(id => candidatas.find(c => c.id === id));
  if (notas.some(x => !x)) throw new Error('Alguma NF-e escolhida não está mais disponível (cancelada, de outro ambiente ou já num MDF-e).');
  const lista = notas as NonNullable<(typeof notas)[number]>[];
  if (lista.some(x => x.sentido !== a.sentido)) throw new Error(a.sentido === 'IDA' ? 'Na ida só vão remessas e vendas.' : 'Na volta só vão notas de retorno.');
  const semCidade = lista.filter(x => !x.cidade || !x.uf);
  if (semCidade.length) throw new Error(`NF-e sem cidade/UF do cliente: ${semCidade.map(x => x.numero).join(', ')}.`);

  // origem/destino: a Rentech de um lado, os clientes do outro
  const codBase = String(par.codigo_municipio || '3550308');
  const base = { codigo: codBase, nome: await nomeMunicipio(codBase), uf: 'SP' };
  const lado = new Map<string, { codigo: string; nome: string; uf: string; notas: typeof lista }>();
  for (const x of lista) {
    const cod = await codigoIbge(x.cidade, x.uf);
    if (!cod) throw new Error(`Não achei o código IBGE de ${x.cidade}/${x.uf} (NF-e ${x.numero}).`);
    const g = lado.get(cod) || { codigo: cod, nome: x.cidade, uf: x.uf, notas: [] as typeof lista };
    g.notas.push(x); lado.set(cod, g);
  }
  const clientes = [...lado.values()];
  const ufsClientes = [...new Set(clientes.map(c => c.uf))];
  if (a.sentido === 'IDA' && ufsClientes.length > 1) throw new Error(`As notas vão para UFs diferentes (${ufsClientes.join(', ')}): emita um MDF-e por UF de destino.`);
  if (a.sentido === 'VOLTA' && ufsClientes.length > 1) throw new Error(`Os retornos saem de UFs diferentes (${ufsClientes.join(', ')}): emita um MDF-e por UF de carregamento.`);
  const ufInicio = a.sentido === 'IDA' ? base.uf : ufsClientes[0];
  const ufFim = a.sentido === 'IDA' ? ufsClientes[0] : base.uf;
  const percurso = (a.percurso ?? percursoSugerido(ufInicio, ufFim)).map(UF).filter(u => u && u !== ufInicio && u !== ufFim);
  const invalidas = percurso.filter(u => !VIZINHOS[u]);
  if (invalidas.length) throw new Error(`UF de percurso inválida: ${invalidas.join(', ')}.`);

  // veículo (o que vier do formulário completa o cadastro da frota)
  const { data: v } = await db.from('frota_veiculos').select('*').eq('id', a.veiculoId).maybeSingle();
  if (!v) throw new Error('Veículo não encontrado na frota.');
  const ajuste: Record<string, unknown> = {};
  for (const k of ['tara_kg', 'capacidade_kg', 'capacidade_m3', 'tipo_rodado', 'tipo_carroceria', 'uf_licenciamento'] as const) {
    const novo = a.veiculo?.[k];
    if (novo !== undefined && novo !== null && String(novo) !== '' && String(novo) !== String(v[k] ?? '')) ajuste[k] = /kg|m3/.test(k) ? Math.round(n(novo)) : k === 'uf_licenciamento' ? UF(novo) : String(novo);
  }
  const ve = { ...v, ...ajuste } as any;
  const placa = limpo(ve.placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const faltaVe = [!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa) && 'placa', !(n(ve.tara_kg) > 0) && 'tara (kg)', !TIPOS_RODADO[ve.tipo_rodado] && 'tipo de rodado', !TIPOS_CARROCERIA[ve.tipo_carroceria] && 'tipo de carroceria', !VIZINHOS[UF(ve.uf_licenciamento)] && 'UF de licenciamento'].filter(Boolean);
  if (faltaVe.length) throw new Error(`Veículo ${placa || ''}: falta ${faltaVe.join(', ')}.`);
  const { data: abertos } = await db.from('fiscal_mdfe').select('id, numero').eq('placa', placa).eq('ambiente', ambiente).in('status', ['PROCESSANDO', 'AUTORIZADO']);
  if ((abertos || []).length) throw new Error(`A placa ${placa} já tem MDF-e aberto (nº ${(abertos as any[]).map(x => x.numero || '#' + x.id).join(', ')}). Encerre antes — a SEFAZ recusa outro.`);

  // condutores
  const condutores = (a.condutores || []).map(c => ({ nome: limpo(c.nome).toUpperCase().slice(0, 60), cpf: dig(c.cpf), funcionario_id: c.funcionario_id || null }));
  if (!condutores.length) throw new Error('Informe o motorista.');
  if (condutores.length > 10) throw new Error('No máximo 10 condutores.');
  const ruins = condutores.filter(c => c.nome.length < 2 || !cpfValido(c.cpf));
  if (ruins.length) throw new Error(`Motorista sem nome ou com CPF inválido: ${ruins.map(c => c.nome || c.cpf).join(', ')} (confira na Ficha do Funcionário).`);

  // carga
  const valor = arred(lista.reduce((s, x) => s + x.valor, 0));
  const peso = arred(n(a.pesoKg) > 0 ? n(a.pesoKg) : lista.reduce((s, x) => s + x.peso, 0), 4);
  if (!(peso > 0)) throw new Error('Informe o peso bruto da carga (kg) — as NF-e não trazem peso.');
  const uma = lista.length === 1;
  const cepBase = dig(par.mdfe_cep_carregamento);
  if (uma && cepBase.length !== 8) throw new Error('MDF-e com uma NF-e só exige o CEP da Rentech: preencha em Fiscal › Parâmetros › MDF-e.');
  if (uma && lista[0].cep.length !== 8) throw new Error(`A NF-e ${lista[0].numero} não tem CEP do cliente.`);

  const munBase = { codigo: Number(base.codigo), nome: base.nome };
  const munClientes = clientes.map(c => ({ codigo: Number(c.codigo), nome: c.nome.slice(0, 60) }));
  const comNotas = (m: { codigo: number; nome: string }, ns: typeof lista) => ({ ...m, notas_fiscais: ns.map(x => ({ chave_nfe: x.chave })) });
  const payload: any = {
    data_emissao: new Date().toISOString(), cnpj_emitente: emi.cnpj, emitente: 2, ...(emi.nome ? { nome_emitente: emi.nome.slice(0, 60).trim() } : {}),
    uf_inicio: ufInicio, uf_fim: ufFim,
    municipios_carregamento: a.sentido === 'IDA' ? [munBase] : munClientes,
    municipios_descarregamento: a.sentido === 'IDA' ? clientes.map(c => comNotas({ codigo: Number(c.codigo), nome: c.nome.slice(0, 60) }, c.notas)) : [comNotas(munBase, lista)],
    quantidade_total_nfe: lista.length, valor_total_carga: valor, codigo_unidade_medida_peso_bruto: '01', peso_bruto: peso.toFixed(4),
    tipo_carga: par.mdfe_tipo_carga || '05', descricao_produto: (limpo(par.mdfe_produto_predominante) || 'EQUIPAMENTOS EM LOCACAO').slice(0, 120),
    modal_rodoviario: {
      placa_veiculo: placa, tara_veiculo: Math.round(n(ve.tara_kg)), tipo_rodado_veiculo: ve.tipo_rodado, tipo_carroceria_veiculo: ve.tipo_carroceria,
      uf_licenciamento_veiculo: UF(ve.uf_licenciamento), condutores: condutores.map(c => ({ nome: c.nome, cpf: c.cpf })),
      ...(dig(ve.renavam).length >= 9 ? { renavam_veiculo: dig(ve.renavam) } : {}),
      ...(n(ve.capacidade_kg) > 0 ? { capacidade_kg_veiculo: Math.round(n(ve.capacidade_kg)) } : {}),
      ...(n(ve.capacidade_m3) > 0 ? { capacidade_m3_veiculo: Math.round(n(ve.capacidade_m3)) } : {}),
    },
  };
  if (percurso.length) payload.percursos = percurso.map(u => ({ uf_percurso: u }));
  if (a.dataViagem) payload.data_hora_previsto_inicio_viagem = new Date(a.dataViagem).toISOString();
  if (dig(par.mdfe_ncm).length === 8) payload.codigo_ncm_produto = dig(par.mdfe_ncm);
  if (uma) {
    payload.cep_carregamento = a.sentido === 'IDA' ? cepBase : lista[0].cep;
    payload.cep_descarregamento = a.sentido === 'IDA' ? lista[0].cep : cepBase;
  }
  if (limpo(par.mdfe_apolice) && dig(par.mdfe_seguradora_cnpj).length === 14) {
    payload.seguros_carga = [{
      responsavel_seguro: 1, cnpj_responsavel: emi.cnpj, nome_seguradora: limpo(par.mdfe_seguradora_nome).slice(0, 30) || undefined, cnpj_seguradora: dig(par.mdfe_seguradora_cnpj),
      numero_apolice: limpo(par.mdfe_apolice).slice(0, 20), ...(limpo(par.mdfe_averbacao) ? { numero_averbacao: limpo(par.mdfe_averbacao).slice(0, 40) } : {}),
    }];
  }
  if (limpo(a.informacoes)) payload.informacao_complementar = limpo(a.informacoes).slice(0, 5000);

  if (Object.keys(ajuste).length) await db.from('frota_veiculos').update(ajuste).eq('id', v.id);

  const ref = `rt${ambiente === 'PRODUCAO' ? 'p' : 'h'}m-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const { data: m, error } = await db.from('fiscal_mdfe').insert({
    empresa_id: a.empresaId, ambiente, ref, status: 'PROCESSANDO', veiculo_id: v.id, placa, condutores, uf_inicio: ufInicio, uf_fim: ufFim, percurso,
    municipio_carregamento: payload.municipios_carregamento.map((x: any) => x.nome).join(', '),
    municipios_descarregamento: (a.sentido === 'IDA' ? clientes.map(c => ({ codigo: c.codigo, nome: c.nome, uf: c.uf, notas: c.notas.length })) : [{ codigo: base.codigo, nome: base.nome, uf: base.uf, notas: lista.length }]),
    data_viagem: a.dataViagem ? new Date(a.dataViagem).toISOString() : null, valor_carga: valor, peso_kg: peso, interestadual: ufInicio !== ufFim,
    payload, criado_por: usuario,
  }).select('id').single();
  if (error) throw error;
  const { error: eN } = await db.from('fiscal_mdfe_notas').insert(lista.map(x => ({ mdfe_id: m.id, nota_id: x.id })));
  if (eN) throw eN;

  let r;
  try { r = await focus(ambiente, 'POST', `/v2/mdfe?ref=${ref}`, payload, a.empresaId); } catch (e: any) {
    await db.from('fiscal_mdfe').update({ mensagem: `Sem resposta da Focus (${e.message}). Consulte de novo em instantes.`, atualizado_em: new Date().toISOString() }).eq('id', m.id);
    return { id: m.id as number, status: 'PROCESSANDO', mensagem: 'Enviado; aguardando a Focus.' };
  }
  if (r.http >= 400) {
    const msg = mensagemFocus(r.corpo);
    await db.from('fiscal_mdfe').update({ status: 'ERRO', mensagem: msg, resposta: r.corpo, atualizado_em: new Date().toISOString() }).eq('id', m.id);
    return { id: m.id as number, status: 'ERRO', mensagem: msg };
  }
  let st = await aplicar(db, m.id, r.corpo);
  if (st === 'PROCESSANDO') { await new Promise(res => setTimeout(res, 2500)); st = (await consultarMdfe(db, m.id).catch(() => null))?.status || st; }
  const { data: fim } = await db.from('fiscal_mdfe').select('status, mensagem, numero').eq('id', m.id).single();
  return { id: m.id as number, status: fim?.status || st, mensagem: fim?.mensagem || null, numero: fim?.numero || null };
}

const STATUS: Record<string, string> = {
  processando_autorizacao: 'PROCESSANDO', autorizado: 'AUTORIZADO', erro_autorizacao: 'ERRO', encerrado: 'ENCERRADO', cancelado: 'CANCELADO',
};
async function aplicar(db: Db, id: number, c: any) {
  const status = STATUS[c?.status] || null;
  const upd: any = { resposta: c, atualizado_em: new Date().toISOString() };
  if (status) upd.status = status;
  if (c?.numero) upd.numero = String(c.numero);
  if (c?.serie) upd.serie = String(c.serie);
  if (c?.chave) upd.chave = String(c.chave).replace(/^MDFe/, '');
  if (c?.caminho_damdfe) upd.caminho_pdf = c.caminho_damdfe;
  if (c?.caminho_xml) upd.caminho_xml = c.caminho_xml;
  if (c?.caminho_xml_encerramento) upd.caminho_xml_encerramento = c.caminho_xml_encerramento;
  if (c?.caminho_xml_cancelamento) upd.caminho_xml_cancelamento = c.caminho_xml_cancelamento;
  if (status === 'ERRO') upd.mensagem = mensagemFocus(c);
  else if (status === 'AUTORIZADO' || status === 'PROCESSANDO') upd.mensagem = c?.mensagem_sefaz || null;
  await db.from('fiscal_mdfe').update(upd).eq('id', id);
  return status;
}

async function carregar(db: Db, id: number) {
  const { data } = await db.from('fiscal_mdfe').select('*').eq('id', id).maybeSingle();
  if (!data) throw new Error('MDF-e não encontrado.');
  return data as any;
}

export async function consultarMdfe(db: Db, id: number) {
  const m = await carregar(db, id);
  const r = await focus(m.ambiente, 'GET', `/v2/mdfe/${m.ref}`, undefined, m.empresa_id);
  if (r.http === 404) {
    if (m.status === 'PROCESSANDO') await db.from('fiscal_mdfe').update({ status: 'ERRO', mensagem: 'A Focus não recebeu este MDF-e. Emita de novo.', atualizado_em: new Date().toISOString() }).eq('id', id);
    return { status: m.status === 'PROCESSANDO' ? 'ERRO' : m.status, mensagem: 'MDF-e não encontrado na Focus.' };
  }
  if (r.http >= 400) return { status: m.status, mensagem: mensagemFocus(r.corpo) };
  const st = await aplicar(db, id, r.corpo);
  return { status: st || m.status, mensagem: st === 'ERRO' ? mensagemFocus(r.corpo) : null };
}

/** Atualiza os MDF-e ainda em processamento (tela e cron /api/cron/fiscal). Devolve quantos consultou. */
export async function atualizarMdfeProcessando(db: Db, limite = 20) {
  const { data } = await db.from('fiscal_mdfe').select('id').eq('status', 'PROCESSANDO').order('id').limit(limite);
  let ok = 0;
  for (const x of (data || []) as any[]) if (await consultarMdfe(db, x.id).catch(() => null)) ok++;
  return ok;
}

const evento = (m: any, e: Record<string, unknown>) => [...((m.eventos || []) as any[]), { em: new Date().toISOString(), ...e }];

/** Encerra o MDF-e (entrega feita). Data, UF e município de onde terminou a viagem. */
export async function encerrarMdfe(db: Db, id: number, e: { data?: string | null; uf?: string | null; municipio?: string | null }, usuario: string) {
  const m = await carregar(db, id);
  if (m.status !== 'AUTORIZADO') throw new Error('Só MDF-e autorizado (e ainda aberto) pode ser encerrado.');
  const ultimo = ((m.municipios_descarregamento || []) as any[]).at(-1) || {};
  const corpo = { data: e.data || hojeISO(), sigla_uf: UF(e.uf || ultimo.uf || m.uf_fim), nome_municipio: limpo(e.municipio || ultimo.nome) };
  if (!corpo.nome_municipio) throw new Error('Informe o município do encerramento.');
  const r = await focus(m.ambiente, 'POST', `/v2/mdfe/${m.ref}/encerrar`, corpo, m.empresa_id);
  const jaEncerrado = r.corpo?.codigo === 'mdfe_ja_encerrado';
  if (!jaEncerrado && (r.http >= 400 || !['encerrado', 'incluido'].includes(r.corpo?.status))) throw new Error(`A SEFAZ não encerrou: ${mensagemFocus(r.corpo)}`);
  await db.from('fiscal_mdfe').update({
    status: 'ENCERRADO', encerrado_em: new Date().toISOString(), encerrado_por: usuario, encerramento_uf: corpo.sigla_uf, encerramento_municipio: corpo.nome_municipio,
    eventos: evento(m, { tipo: 'ENCERRAMENTO', por: usuario, data: corpo.data, uf: corpo.sigla_uf, municipio: corpo.nome_municipio, caminho_xml: r.corpo?.caminho_xml || null }),
    atualizado_em: new Date().toISOString(),
  }).eq('id', id);
  await consultarMdfe(db, id).catch(() => null);
}

export async function cancelarMdfe(db: Db, id: number, justificativa: string, usuario: string) {
  const j = limpo(justificativa);
  if (j.length < 15 || j.length > 255) throw new Error('A justificativa precisa ter entre 15 e 255 caracteres.');
  const m = await carregar(db, id);
  if (m.status !== 'AUTORIZADO') throw new Error('Só MDF-e autorizado (e não encerrado) pode ser cancelado.');
  const r = await focus(m.ambiente, 'DELETE', `/v2/mdfe/${m.ref}`, { justificativa: j }, m.empresa_id);
  if (r.http >= 400 || r.corpo?.status !== 'cancelado') throw new Error(`A SEFAZ não cancelou: ${mensagemFocus(r.corpo)}`);
  await db.from('fiscal_mdfe').update({
    status: 'CANCELADO', cancelado_em: new Date().toISOString(), cancelado_por: usuario, motivo_cancelamento: j,
    caminho_xml_cancelamento: r.corpo.caminho_xml_cancelamento || r.corpo.caminho_xml || null, atualizado_em: new Date().toISOString(),
  }).eq('id', id);
}

/** Troca/acréscimo de motorista no meio da viagem. */
export async function incluirCondutorMdfe(db: Db, id: number, c: CondutorMdfe, usuario: string) {
  const m = await carregar(db, id);
  if (m.status !== 'AUTORIZADO') throw new Error('Só dá para incluir motorista em MDF-e autorizado e aberto.');
  const nome = limpo(c.nome).toUpperCase().slice(0, 60), cpf = dig(c.cpf);
  if (nome.length < 2 || !cpfValido(cpf)) throw new Error('Motorista sem nome ou com CPF inválido.');
  const r = await focus(m.ambiente, 'POST', `/v2/mdfe/${m.ref}/inclusao_condutor`, { nome, cpf }, m.empresa_id);
  if (r.http >= 400 || r.corpo?.status !== 'incluido') throw new Error(`A SEFAZ não incluiu o motorista: ${mensagemFocus(r.corpo)}`);
  await db.from('fiscal_mdfe').update({
    condutores: [...((m.condutores || []) as any[]), { nome, cpf, funcionario_id: c.funcionario_id || null, incluido_depois: true }],
    eventos: evento(m, { tipo: 'INCLUSAO_CONDUTOR', por: usuario, nome, caminho_xml: r.corpo?.caminho_xml || null }), atualizado_em: new Date().toISOString(),
  }).eq('id', id);
}

export async function arquivoMdfe(db: Db, id: number, qual: 'pdf' | 'xml') {
  const m = await carregar(db, id);
  const caminho = qual === 'pdf' ? m.caminho_pdf : m.caminho_xml;
  if (!caminho) throw new Error(qual === 'pdf' ? 'DAMDFE ainda não disponível.' : 'XML ainda não disponível.');
  const a = await baixarArquivo(m.ambiente, caminho, m.empresa_id);
  return { ...a, nome: `mdfe-${m.numero || id}.${qual === 'xml' ? 'xml' : 'pdf'}` };
}

/** MDF-e autorizados e ainda abertos há mais de `horas` (padrão 24h). */
export async function mdfesAbertos(db: Db, empresaId: number, opcoes: { horas?: number; ambiente?: AmbienteFiscal } = {}) {
  let q = db.from('fiscal_mdfe').select('id, numero, placa, uf_fim, criado_em, ambiente, municipios_descarregamento')
    .eq('empresa_id', empresaId).eq('status', 'AUTORIZADO').lt('criado_em', new Date(Date.now() - (opcoes.horas ?? 24) * 3_600_000).toISOString());
  if (opcoes.ambiente) q = q.eq('ambiente', opcoes.ambiente);
  const { data } = await q.order('id');
  return (data || []) as any[];
}
