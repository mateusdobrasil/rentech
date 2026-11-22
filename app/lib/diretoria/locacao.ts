// app/lib/diretoria/locacao.ts
// Bloco "locação" do Diretor (IA) — 2026-11-22: orçamentos, conversão, faltas
// na agenda, devoluções atrasadas, a faturar, avarias, manutenção,
// sublocações e fiscal. Números por código; a IA só interpreta.
//
// Fase paralela (P2S ainda oficial): o que nasce nas telas novas de locação é
// ENSAIO da equipe (roteiro de testes) — contar isso viraria número errado com
// cara de certo. Por isso o bloco só liga quando a empresa congela o P2S
// (fontes.ts), e mesmo então só conta o que foi criado a partir do
// congelamento ou veio migrado do P2S. O fiscal vale sempre, mas só PRODUÇÃO
// (homologação é teste).
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { agendaOcupacao } from '../locacao/disponibilidade';
import { filaAFaturar } from '../financeiro/faturamento';
import { numeroFicha } from '../locacao/fichaNumero';
import type { FonteDiretor } from './fontes';

type DB = ReturnType<typeof supabaseAdmin>;

const num = (v: unknown) => Number(v) || 0;
const arred = (n: number) => Math.round(n * 100) / 100;
const limpo = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const somarDias = (iso: string, dias: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const diasEntre = (de: string, ate: string) => Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000);
const vq = (linhas: any[], v: (l: any) => number) => ({ valor: arred(linhas.reduce((s, l) => s + v(l), 0)), qtd: linhas.length });
const cliente = (l: any) => limpo(l.parceiro?.nome_exibicao || l.parceiro?.nome_completo) || '—';

const ORCAMENTO = ['ORCAMENTO', 'ENVIADO'];
const GANHAS = ['APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];
const MANUT_ABERTA = ['ABERTA', 'EM_EXECUCAO', 'AGUARDANDO_PECA'];

/** Filtro "dado real" de fichas do sistema depois do congelamento. */
const fichaReal = (f: FonteDiretor) => `origem.eq.P2S,migrada_p2s_em.not.is.null,created_at.gte."${f.congeladaEm}"`;

// ============================================================================
// FISCAL (produção) — vale antes e depois da virada
// ============================================================================
export async function nfeForaDeSpSemMdfe(db: DB, E: number, desde: string) {
  const { data, error } = await db.from('fiscal_notas')
    .select('id, numero, operacao, valor_total, criado_em, uf:payload->>uf_destinatario, parceiro:parceiros(nome_exibicao, nome_completo), mdfes:fiscal_mdfe_notas(mdfe:fiscal_mdfe(status))')
    .eq('empresa_id', E).eq('tipo', 'NFE').eq('ambiente', 'PRODUCAO').eq('status', 'AUTORIZADA')
    .in('operacao', ['REMESSA_LOCACAO', 'RETORNO_LOCACAO', 'VENDA_ATIVO', 'VENDA_MERCADORIA']).gte('criado_em', `${desde}T00:00:00-03:00`);
  if (error) throw error;
  return ((data || []) as any[]).filter(n => {
    const uf = String(n.uf || '').toUpperCase();
    const ativo = (n.mdfes || []).some((l: any) => ['PROCESSANDO', 'AUTORIZADO', 'ENCERRADO'].includes(l.mdfe?.status));
    return uf && uf !== 'SP' && !ativo;
  }).map(n => ({ id: n.id as number, numero: n.numero, operacao: n.operacao, uf: String(n.uf).toUpperCase(), cliente: cliente(n), valor: arred(num(n.valor_total)), emitida_em: n.criado_em as string }));
}

async function blocoFiscal(db: DB, E: number, hoje: string) {
  const [erros, processando, semMdfe] = await Promise.all([
    db.from('fiscal_notas').select('numero, tipo, operacao, mensagem, criado_em').eq('empresa_id', E).eq('ambiente', 'PRODUCAO').eq('status', 'ERRO').gte('criado_em', `${somarDias(hoje, -7)}T00:00:00-03:00`),
    db.from('fiscal_notas').select('id, tipo, criado_em').eq('empresa_id', E).eq('ambiente', 'PRODUCAO').eq('status', 'PROCESSANDO').lt('criado_em', new Date(Date.now() - 3_600_000).toISOString()),
    nfeForaDeSpSemMdfe(db, E, somarDias(hoje, -30)).catch(() => []),
  ]);
  return {
    notas_com_erro_7d: ((erros.data || []) as any[]).map(n => ({ tipo: n.tipo, operacao: n.operacao, mensagem: limpo(n.mensagem).slice(0, 200), em: String(n.criado_em).slice(0, 10) })),
    notas_processando_ha_mais_de_1h: (processando.data || []).length,
    nfe_fora_de_sp_sem_mdfe_30d: semMdfe.slice(0, 15),
  };
}

// ============================================================================
// BLOCO DO RELATÓRIO
// ============================================================================
export async function blocoLocacao(db: DB, fonte: FonteDiretor, hoje: string, falhou: (area: string, e: any) => void) {
  const E = fonte.empresaId;
  const fiscal = await blocoFiscal(db, E, hoje).catch(e => { falhou('fiscal', e); return null; });
  if (fonte.fichas !== 'SISTEMA' || !fonte.congeladaEm) {
    return {
      ativo: false,
      motivo: 'Fase paralela: a locação oficial ainda está no P2S (ver bloco comercial). O que existe nas telas novas de locação é ensaio da equipe e não entra nos números.',
      fiscal,
    };
  }
  const desde = fonte.congeladaEm;
  const em7 = somarDias(hoje, 7), em14 = somarDias(hoje, 13);

  const [orcs, emitidas30, fls, avarias, manut, subs, fila, agenda] = await Promise.all([
    db.from('locacao_fichas_reserva').select('id, origem, p2s_numero, status, valor_total, data_inicio, conteudo_alterado_em, updated_at, created_at, vendedor_nome, parceiro:parceiros(nome_exibicao, nome_completo)')
      .eq('empresa_id', E).in('status', ORCAMENTO).or(fichaReal(fonte)),
    buscarTodasPaginas<any>((d, a) => db.from('locacao_fichas_reserva').select('id, status, valor_total').eq('empresa_id', E).gte('data_emissao', somarDias(hoje, -30)).lt('data_emissao', hoje).or(fichaReal(fonte)).order('id').range(d, a)),
    db.from('locacao_fichas_locacao').select('numero, status, data_saida, criado_em, migrada_p2s_em, os:locacao_fichas_reserva(id, data_fim, parceiro:parceiros(nome_exibicao, nome_completo))').eq('empresa_id', E).eq('origem', 'SISTEMA').eq('status', 'A'),
    db.from('locacao_avarias').select('status_cobranca, valor_cobranca, gravidade, registrada_em').eq('empresa_id', E).in('status_cobranca', ['A_DEFINIR', 'COBRAR']).gte('registrada_em', desde),
    db.from('locacao_manutencoes').select('status, previsao, problema, aberta_em').eq('empresa_id', E).in('status', MANUT_ABERTA).gte('aberta_em', desde),
    db.from('locacao_sublocacoes').select('status, data_devolucao, criado_em').eq('empresa_id', E).in('status', ['SOLICITADO', 'CONFIRMADO']).gte('criado_em', desde),
    filaAFaturar(db, [E], false).catch(e => { falhou('faturamento', e); return [] as any[]; }),
    agendaOcupacao(db, E, hoje, em14).catch(e => { falhou('agenda', e); return null; }),
  ]);
  falhou('orçamentos', orcs.error); falhou('fichas de locação', fls.error); falhou('avarias', avarias.error); falhou('manutenção', manut.error); falhou('sublocações', subs.error);

  // Orçamento com evento já passado e nunca fechado (comum no histórico do P2S) não está mais "em aberto".
  const orcamentos = ((orcs.data || []) as any[]).filter(o => !o.data_inicio || o.data_inicio >= hoje);
  const parados = orcamentos.filter(o => o.status === 'ENVIADO' && String(o.conteudo_alterado_em || o.updated_at || o.created_at).slice(0, 10) <= somarDias(hoje, -7));
  const comecando = orcamentos.filter(o => o.data_inicio && o.data_inicio >= hoje && o.data_inicio <= em7);
  const ficha = (o: any) => ({ numero: numeroFicha(o), cliente: cliente(o), valor: arred(num(o.valor_total)), inicio: o.data_inicio, vendedor: o.vendedor_nome || null });

  const em = (emitidas30.data || []) as any[];
  const ganhas = em.filter(f => GANHAS.includes(f.status)), perdidas = em.filter(f => f.status === 'PERDIDO');
  const decididas = ganhas.length + perdidas.length;

  // FL aberta cuja OS já terminou: material na rua depois do fim do evento.
  const atrasadas = ((fls.data || []) as any[])
    .filter(f => (f.migrada_p2s_em || String(f.criado_em) >= desde) && f.os?.data_fim && f.os.data_fim < hoje)
    .map(f => ({ ficha_locacao: f.numero, cliente: cliente(f.os), fim_do_evento: f.os.data_fim, dias_atraso: diasEntre(f.os.data_fim, hoje) }))
    .sort((a, b) => b.dias_atraso - a.dias_atraso);

  // A faturar: só OS reais (criadas depois do congelamento ou migradas).
  let aFaturar: any[] = [];
  if (fila.length) {
    const { data: reais } = await db.from('locacao_fichas_reserva').select('id').in('id', fila.map((o: any) => o.id)).or(fichaReal(fonte));
    const ok = new Set(((reais || []) as any[]).map(r => r.id));
    aFaturar = fila.filter((o: any) => ok.has(o.id));
  }

  const faltas = (agenda?.produtos || []).map(p => {
    const dia = p.ocupacao.findIndex(o => o > p.capacidade);
    if (dia < 0) return null;
    const pico = Math.max(...p.ocupacao);
    return { equipamento: p.nome, codigo: p.codigo, estoque: p.capacidade, pico_reservado: pico, falta: pico - p.capacidade, primeiro_dia: agenda!.dias[dia] };
  }).filter(Boolean) as { equipamento: string; codigo: string | null; estoque: number; pico_reservado: number; falta: number; primeiro_dia: string }[];

  const manutencoes = (manut.data || []) as any[];
  const sublocs = (subs.data || []) as any[];
  return {
    ativo: true,
    orcamentos_em_aberto: { ...vq(orcamentos, o => num(o.valor_total)), parados_ha_7_dias_ou_mais: { qtd: parados.length, lista: parados.slice(0, 10).map(ficha) }, comecam_em_ate_7_dias_sem_aprovacao: { qtd: comecando.length, lista: comecando.slice(0, 10).map(ficha) } },
    conversao_ultimos_30d: { emitidas: em.length, aprovadas: vq(ganhas, f => num(f.valor_total)), perdidas: vq(perdidas, f => num(f.valor_total)), pct_aprovadas_das_decididas: decididas ? Math.round((ganhas.length / decididas) * 1000) / 10 : null },
    faltas_na_agenda_14d: { qtd: faltas.length, lista: faltas.sort((a, b) => a.primeiro_dia.localeCompare(b.primeiro_dia)).slice(0, 15) },
    devolucoes_atrasadas: { qtd: atrasadas.length, lista: atrasadas.slice(0, 15) },
    a_faturar: { ...vq(aFaturar, o => num(o.saldo)), maiores: [...aFaturar].sort((a, b) => num(b.saldo) - num(a.saldo)).slice(0, 10).map(o => ({ os: o.numero, cliente: o.cliente, saldo: arred(num(o.saldo)), fim: o.fim })) },
    avarias_a_cobrar: { ...vq((avarias.data || []) as any[], a => num(a.valor_cobranca)), a_definir: ((avarias.data || []) as any[]).filter(a => a.status_cobranca === 'A_DEFINIR').length },
    manutencao: { abertas: manutencoes.length, atrasadas: manutencoes.filter(m => m.previsao && m.previsao < hoje).length },
    sublocacoes: { aguardando_parceiro: sublocs.filter(s => s.status === 'SOLICITADO').length, devolucao_ao_parceiro_atrasada: sublocs.filter(s => s.status === 'CONFIRMADO' && s.data_devolucao && s.data_devolucao < hoje).length },
    fiscal,
  };
}

/** Faltas de equipamento na agenda (só depois do congelamento) — usado pelos alertas. */
export async function faltasNaAgenda(db: DB, fonte: FonteDiretor, hoje: string, dias = 7) {
  if (fonte.fichas !== 'SISTEMA' || !fonte.congeladaEm) return [];
  const agenda = await agendaOcupacao(db, fonte.empresaId, hoje, somarDias(hoje, dias - 1));
  return agenda.produtos.flatMap(p => {
    const i = p.ocupacao.findIndex(o => o > p.capacidade);
    return i < 0 ? [] : [{ produto_id: p.produto_id, nome: p.nome, estoque: p.capacidade, pico: Math.max(...p.ocupacao), primeiro_dia: agenda.dias[i] }];
  });
}
