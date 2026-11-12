'use server';

// app/admin/financeiro/actions.ts
// Agregações para o dashboard de Relatórios do hub Financeiro
// (/admin/financeiro/relatorios) — consolida as três frentes que hoje vivem
// sob este hub: Ordens de Pagamento (op_ordens_pagamento), Lotes de
// Pagamento (financeiro_lotes_pagamento) e Crédito Consignado (financeiro_consignados).
// Todo o cálculo acontece aqui (server-side) para a página só desenhar.
import { supabaseAdmin } from '../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../lib/serverAuth';
import { contextoEnvioItau, consultarPagamentoSispag, semAcento, STATUS_ITAU_EFETUADO } from '../../lib/itauSispag';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/financeiro/relatorios';

// Textos livres (natureza_pagamento, responsável, instituição) chegam com
// grafias inconsistentes no banco (ex.: "FREELANCE" e "freelance" como
// valores distintos) — normaliza pra não fragmentar o mesmo grupo em fatias
// diferentes do relatório.
const normalizarCategoria = (s: string | null | undefined): string => {
  const limpo = (s || '').normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '').trim().toUpperCase();
  return limpo || 'NÃO INFORMADO';
};

// Lista de competências 'AAAA-MM', da mais antiga pra mais recente, terminando em mesFinal.
function ultimosMeses(mesFinal: string, qtd: number): string[] {
  const [ano, mes] = mesFinal.split('-').map(Number);
  const lista: string[] = [];
  for (let i = qtd - 1; i >= 0; i--) {
    const d = new Date(ano, mes - 1 - i, 1);
    lista.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return lista;
}

type ValorQtd = { valor: number; qtd: number };

function topN(entradas: [string, ValorQtd][], n: number): { label: string; valor: number; qtd: number }[] {
  const ordenado = [...entradas].sort((a, b) => b[1].valor - a[1].valor);
  const cabeca = ordenado.slice(0, n).map(([label, v]) => ({ label, ...v }));
  const resto = ordenado.slice(n);
  if (resto.length > 0) {
    const somaResto = resto.reduce((acc, [, v]) => ({ valor: acc.valor + v.valor, qtd: acc.qtd + v.qtd }), { valor: 0, qtd: 0 });
    cabeca.push({ label: 'OUTROS', ...somaResto });
  }
  return cabeca;
}

export async function buscarRelatorioFinanceiroAction(payload: { mesReferencia: string; empresaId?: number | null }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { mesReferencia } = payload;

  // Empresa(s) que o usuário pode ver — só quem é literalmente
  // "Administrador" (ehAdministradorGlobal, dentro de obterEmpresasPermitidas)
  // enxerga tudo sem restrição; os demais ficam escopados a
  // perfis_usuarios_empresas, igual ao resto do sistema. payload.empresaId é
  // o filtro opcional da tela (revalidado abaixo — nunca confiar cego nele).
  const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  if (payload.empresaId && !empresaPermitida(empresasPermitidas, payload.empresaId)) {
    return { ok: false, erro: 'Você não tem permissão para ver o relatório desta empresa.' };
  }
  // Linha (empresa_id) passa se: dentro do que o usuário pode ver E (sem
  // filtro de tela OU sem empresa própria OU bate com o filtro escolhido).
  const dentroDoEscopo = (empresaIdLinha: number | null | undefined) =>
    empresaPermitida(empresasPermitidas, empresaIdLinha) &&
    (!payload.empresaId || empresaIdLinha == null || empresaIdLinha === payload.empresaId);

  try {
    const meses6 = ultimosMeses(mesReferencia, 6);
    const mesMaisAntigo = meses6[0];

    // ============================================================
    // ORDENS DE PAGAMENTO
    // ============================================================
    // OP REPROVADA (cancelada) fica fora de tudo — antes entrava como
    // "pendente" nos cartões, natureza, ranking, tendência e na grade de
    // vencidas (bug reportado em 2026-11-05). Busca paginada: a Data API
    // devolve no máximo 1.000 linhas por chamada.
    const opsRaw = await buscarTodas<any>((de, ate) => db
      .from('op_ordens_pagamento')
      .select('id, numero_op, empresa_id, os_numero, empresa_recebedora, natureza_pagamento, total_geral, status, data_criacao, data_vencimento, responsavel_nome')
      .neq('status', 'REPROVADA')
      .order('data_criacao', { ascending: false })
      .range(de, ate));
    const ops = opsRaw.filter(o => dentroDoEscopo(o.empresa_id));

    const ehPago = (status: string) => (status || '').toUpperCase().includes('PAGO');
    const hojeIso = new Date().toISOString().slice(0, 10);

    const opsDoMes = ops.filter(o => (o.data_criacao || '').slice(0, 7) === mesReferencia);

    let pendenteQtd = 0, pendenteValor = 0, pagoQtd = 0, pagoValor = 0;
    const naturezaMapa: Record<string, { valor: number; qtd: number }> = {};
    const responsavelMapa: Record<string, { valor: number; qtd: number }> = {};
    opsDoMes.forEach(o => {
      const valor = Number(o.total_geral) || 0;
      if (ehPago(o.status)) { pagoQtd++; pagoValor += valor; }
      else { pendenteQtd++; pendenteValor += valor; }

      const nat = normalizarCategoria(o.natureza_pagamento);
      if (!naturezaMapa[nat]) naturezaMapa[nat] = { valor: 0, qtd: 0 };
      naturezaMapa[nat].valor += valor;
      naturezaMapa[nat].qtd += 1;

      const resp = normalizarCategoria(o.responsavel_nome);
      if (!responsavelMapa[resp]) responsavelMapa[resp] = { valor: 0, qtd: 0 };
      responsavelMapa[resp].valor += valor;
      responsavelMapa[resp].qtd += 1;
    });

    const natureza = topN(Object.entries(naturezaMapa), 5);
    const topResponsaveis = topN(Object.entries(responsavelMapa), 6)
      .filter(r => r.label !== 'OUTROS'); // ranking de pessoas — "outros" não informa nada aqui

    // Vencidas: pendentes com vencimento no passado — sempre "ao vivo", não
    // filtra pelo mês selecionado (é um alerta operacional, não histórico).
    const vencidas = ops
      .filter(o => !ehPago(o.status) && o.data_vencimento && o.data_vencimento < hojeIso)
      .map(o => ({
        id: o.id,
        os_numero: o.os_numero || 'S/N',
        favorecido: o.empresa_recebedora || '—',
        valor: Number(o.total_geral) || 0,
        vencimento: o.data_vencimento,
        dias: Math.floor((new Date(hojeIso).getTime() - new Date(o.data_vencimento).getTime()) / 86400000),
        responsavel: o.responsavel_nome || '—'
      }))
      .sort((a, b) => b.dias - a.dias);
    const vencidasValor = vencidas.reduce((s, v) => s + v.valor, 0);

    // Tendência: total pago vs pendente por mês de criação, últimos 6 meses.
    const opsTrendJanela = ops.filter(o => (o.data_criacao || '').slice(0, 7) >= mesMaisAntigo && (o.data_criacao || '').slice(0, 7) <= mesReferencia);
    const opsTrendMapa: Record<string, { pago: number; pendente: number }> = {};
    meses6.forEach(m => { opsTrendMapa[m] = { pago: 0, pendente: 0 }; });
    opsTrendJanela.forEach(o => {
      const m = (o.data_criacao || '').slice(0, 7);
      if (!opsTrendMapa[m]) return;
      const valor = Number(o.total_geral) || 0;
      if (ehPago(o.status)) opsTrendMapa[m].pago += valor; else opsTrendMapa[m].pendente += valor;
    });
    const opsTrend = meses6.map(m => ({ mes: m, ...opsTrendMapa[m] }));

    // ============================================================
    // LOTES DE PAGAMENTO
    // ============================================================
    // Lote desativado (ativo=false — gerado errado e descartado) não entra
    const { data: lotesRaw, error: lotesErr } = await db
      .from('financeiro_lotes_pagamento')
      .select('id, mes_referencia, status, valor_total, qtd_pagamentos, criado_em, tipo_lote, nome_lote, empresa_id, itens')
      .or('ativo.is.null,ativo.eq.true')
      .order('criado_em', { ascending: false });
    if (lotesErr) throw new Error(lotesErr.message);

    // Caminho rápido: lote com empresa_id própria (todo lote novo, já que a
    // montagem exige escolher a empresa antes) passa inteiro ou fica de fora
    // inteiro, sem inspecionar itens. Sem ela (histórico anterior à coluna, ou
    // lote misto gerado por quem tem acesso a mais de uma empresa), recalcula
    // valor/qtd só com os itens dentro do escopo — não inclui/exclui o lote
    // inteiro. Lotes sem "itens" registrados (formato bem antigo) mantêm os
    // totais originais, sem quebra por empresa.
    const lotes = (lotesRaw || [])
      .map(l => {
        if (l.empresa_id != null) {
          return dentroDoEscopo(l.empresa_id)
            ? { ...l, valor_total: Number(l.valor_total) || 0, qtd_pagamentos: l.qtd_pagamentos || 0 }
            : { ...l, valor_total: 0, qtd_pagamentos: 0 };
        }
        const itens = Array.isArray(l.itens) ? l.itens : [];
        if (itens.length === 0) return { ...l, valor_total: Number(l.valor_total) || 0, qtd_pagamentos: l.qtd_pagamentos || 0 };
        const itensEscopo = itens.filter((i: any) => dentroDoEscopo(i?.empresa_id));
        return {
          ...l,
          valor_total: itensEscopo.reduce((s: number, i: any) => s + (Number(i.valor) || 0), 0),
          qtd_pagamentos: itensEscopo.length
        };
      })
      .filter(l => l.qtd_pagamentos > 0 || !Array.isArray(l.itens) || l.itens.length === 0);

    const lotesDoMes = lotes.filter(l => l.mes_referencia === mesReferencia);
    const lotesStatusMapa: Record<string, { valor: number; qtd: number }> = {};
    lotesDoMes.forEach(l => {
      const st = l.status || 'RASCUNHO';
      if (!lotesStatusMapa[st]) lotesStatusMapa[st] = { valor: 0, qtd: 0 };
      lotesStatusMapa[st].valor += Number(l.valor_total) || 0;
      lotesStatusMapa[st].qtd += 1;
    });
    const lotesValorMes = lotesDoMes.reduce((s, l) => s + (Number(l.valor_total) || 0), 0);

    const lotesTrendMapa: Record<string, number> = {};
    meses6.forEach(m => { lotesTrendMapa[m] = 0; });
    lotes.forEach(l => {
      if (lotesTrendMapa[l.mes_referencia] !== undefined) lotesTrendMapa[l.mes_referencia] += Number(l.valor_total) || 0;
    });
    const lotesTrend = meses6.map(m => ({ mes: m, valor: lotesTrendMapa[m] }));

    const lotesRecentes = lotes.slice(0, 5).map(l => ({
      id: l.id,
      nome: l.nome_lote || l.tipo_lote, mes: l.mes_referencia, valor: Number(l.valor_total) || 0,
      qtd: l.qtd_pagamentos, status: l.status, criadoEm: l.criado_em
    }));

    // ============================================================
    // CRÉDITO CONSIGNADO — situação atual (a tabela não guarda histórico
    // mensal: cada contrato é uma linha viva, atualizada a cada importação).
    // ============================================================
    const [{ data: consignadosRaw, error: consErr }, { data: funcionariosRaw, error: funcErr }] = await Promise.all([
      db.from('financeiro_consignados').select('cpf, instituicao_nome, valor_parcela, importado_em').eq('ativo', true),
      db.from('folha_funcionarios').select('cpf, empresa_id, ativo')
    ]);
    if (consErr) throw new Error(consErr.message);
    if (funcErr) throw new Error(funcErr.message);

    // Consignado não tem empresa_id próprio — casa por CPF com a ficha do
    // funcionário (mesmo padrão usado em actions-financeiro.ts).
    const empresaPorCpf: Record<string, number | null> = {};
    (funcionariosRaw || []).forEach(f => { empresaPorCpf[f.cpf] = f.empresa_id; });
    const funcionariosEscopo = (funcionariosRaw || []).filter(f => dentroDoEscopo(f.empresa_id));
    const funcionariosAtivos = funcionariosEscopo.filter(f => f.ativo).length;

    const consignados = (consignadosRaw || []).filter(c => dentroDoEscopo(empresaPorCpf[c.cpf]));

    const instituicaoMapa: Record<string, { valor: number; qtd: number }> = {};
    let ultimaAtualizacaoConsignado: string | null = null;
    consignados.forEach(c => {
      const inst = normalizarCategoria(c.instituicao_nome);
      if (!instituicaoMapa[inst]) instituicaoMapa[inst] = { valor: 0, qtd: 0 };
      instituicaoMapa[inst].valor += Number(c.valor_parcela) || 0;
      instituicaoMapa[inst].qtd += 1;
      if (!ultimaAtualizacaoConsignado || c.importado_em > ultimaAtualizacaoConsignado) ultimaAtualizacaoConsignado = c.importado_em;
    });
    const topInstituicoes = topN(Object.entries(instituicaoMapa), 5);
    const funcionariosComConsignado = new Set(consignados.map(c => c.cpf)).size;

    return {
      ok: true,
      info: {
        mesReferencia,
        ops: {
          qtd: opsDoMes.length,
          valor: pendenteValor + pagoValor,
          pendenteQtd, pendenteValor, pagoQtd, pagoValor,
          natureza,
          topResponsaveis,
          vencidas: { qtd: vencidas.length, valor: vencidasValor, lista: vencidas.slice(0, 15) },
          trend: opsTrend
        },
        lotes: {
          qtd: lotesDoMes.length,
          valor: lotesValorMes,
          statusBreakdown: Object.entries(lotesStatusMapa).map(([status, v]) => ({ status, ...v })),
          trend: lotesTrend,
          recentes: lotesRecentes
        },
        consignado: {
          qtdAtivos: consignados.length,
          valorMensalTotal: consignados.reduce((s, c) => s + (Number(c.valor_parcela) || 0), 0),
          funcionariosComConsignado,
          funcionariosAtivos: funcionariosAtivos || 0,
          topInstituicoes,
          atualizadoEm: ultimaAtualizacaoConsignado
        }
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PAINEL DO HUB (/admin/financeiro) — os principais números, no mesmo formato
// do hub de RH. Os cartões de total que ficavam no topo de
// /admin/financeiro/ops vieram pra cá (2026-11-05). Cada bloco só é calculado
// pra quem tem acesso ao módulo de destino do cartão.
// ============================================================================
const hojeIsoBrasilia = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const somarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

// Busca paginada (a Data API devolve no máximo 1.000 linhas por chamada).
async function buscarTodas<T>(montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const lote = 1000;
  const todas: T[] = [];
  for (let de = 0; de < 20000; de += lote) {
    const { data, error } = await montar(de, de + lote - 1);
    if (error) throw new Error(error.message);
    todas.push(...(data || []));
    if (!data || data.length < lote) break;
  }
  return todas;
}

export async function painelFinanceiroAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, '/admin/financeiro');
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const [acessoOps, acessoContas] = await Promise.all([
      validarAcesso(accessToken, '/admin/financeiro/ops'),
      validarAcesso(accessToken, '/admin/financeiro/contas-pagar'),
    ]);
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const hoje = hojeIsoBrasilia();
    const em7Dias = somarDias(hoje, 7);
    const vazio = () => ({ valor: 0, qtd: 0 });
    const somar = (acc: ValorQtd, v: unknown) => { acc.valor += Number(v) || 0; acc.qtd += 1; };

    let ops: { pendentes: ValorQtd; vencidas: ValorQtd; vencendo7d: ValorQtd; aguardandoBanco: ValorQtd } | null = null;
    if (acessoOps.ok) {
      // Mesmo critério da tela de OPs: pendente = nem pago nem reprovado.
      // OP sem empresa (legado) continua visível, igual ao resto do sistema.
      const linhas = await buscarTodas<any>((de, ate) => {
        let q = db.from('op_ordens_pagamento')
          .select('total_geral, data_vencimento, pago_em, empresa_id')
          .not('status', 'ilike', '%PAGO%').neq('status', 'REPROVADA')
          .range(de, ate);
        if (empresasPermitidas) q = q.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
        return q;
      });
      ops = { pendentes: vazio(), vencidas: vazio(), vencendo7d: vazio(), aguardandoBanco: vazio() };
      for (const o of linhas) {
        somar(ops.pendentes, o.total_geral);
        const venc = o.data_vencimento ? String(o.data_vencimento).slice(0, 10) : null;
        if (venc && venc < hoje) somar(ops.vencidas, o.total_geral);
        else if (venc && venc <= em7Dias) somar(ops.vencendo7d, o.total_geral);
        // pago_em numa OP pendente = Pix enviado pelo lote, sem confirmação do banco ainda
        if (o.pago_em) somar(ops.aguardandoBanco, o.total_geral);
      }
    }

    let contasPagar: { vencidas: ValorQtd; vencendo7d: ValorQtd } | null = null;
    if (acessoContas.ok) {
      // Cópia sincronizada do PrimeStart — mesma leitura da tela de Contas a Pagar
      const linhas = await buscarTodas<any>((de, ate) => db.from('financeiro_contas_pagar')
        .select('valor, data_vencimento').eq('quitado', false).lte('data_vencimento', em7Dias).range(de, ate));
      contasPagar = { vencidas: vazio(), vencendo7d: vazio() };
      for (const c of linhas) {
        const venc = String(c.data_vencimento).slice(0, 10);
        somar(venc < hoje ? contasPagar.vencidas : contasPagar.vencendo7d, c.valor);
      }
    }

    return { ok: true, info: { hoje, ops, contasPagar } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// RELATÓRIO POR LOTE (/admin/financeiro/relatorios, aba "Relatório de Lote") —
// escolhe um lote gerado e vê todos os pagamentos dele, com a situação do
// envio ao banco. Mesma regra de empresa do relatório geral: lote com
// empresa_id própria passa inteiro ou fica fora; lote antigo/misto mostra só
// os itens da(s) empresa(s) do usuário.
// ============================================================================
function escopoEmpresa(empresasPermitidas: number[] | null, empresaFiltro: number | null | undefined) {
  return (empresaIdLinha: number | null | undefined) =>
    empresaPermitida(empresasPermitidas, empresaIdLinha) &&
    (!empresaFiltro || empresaIdLinha == null || empresaIdLinha === empresaFiltro);
}

export async function listarLotesRelatorioAction(payload: { empresaId?: number | null }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (payload.empresaId && !empresaPermitida(empresasPermitidas, payload.empresaId)) {
      return { ok: false, erro: 'Você não tem permissão para ver os lotes desta empresa.' };
    }
    const dentro = escopoEmpresa(empresasPermitidas, payload.empresaId);

    const { data, error } = await db.from('financeiro_lotes_pagamento')
      .select('id, nome_lote, tipo_lote, mes_referencia, data_pagamento, valor_total, qtd_pagamentos, status, ativo, criado_em, empresa_id, itens')
      .order('criado_em', { ascending: false });
    if (error) throw new Error(error.message);

    const lotes = (data || []).flatMap(l => {
      let valor = Number(l.valor_total) || 0, qtd = l.qtd_pagamentos || 0;
      if (l.empresa_id != null) {
        if (!dentro(l.empresa_id)) return [];
      } else {
        const itens = (Array.isArray(l.itens) ? l.itens : []).filter((i: any) => dentro(i?.empresa_id));
        if (Array.isArray(l.itens) && l.itens.length > 0 && itens.length === 0) return [];
        if (Array.isArray(l.itens) && l.itens.length > 0) { valor = itens.reduce((s: number, i: any) => s + (Number(i.valor) || 0), 0); qtd = itens.length; }
      }
      return [{
        id: l.id, nome: l.nome_lote || l.tipo_lote, mes: l.mes_referencia, dataPagamento: l.data_pagamento,
        valor, qtd, status: l.status, ativo: l.ativo !== false, criadoEm: l.criado_em
      }];
    });
    return { ok: true, info: { lotes } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Destino mascarado (só os 4 últimos) — o relatório é pra conferência, não
// precisa expor chave PIX/conta inteira.
const mascarar = (v: string | null | undefined) => {
  const s = String(v || '').trim();
  return s.length > 4 ? `•••${s.slice(-4)}` : s;
};

export async function detalheLoteRelatorioAction(payload: { loteId: number; empresaId?: number | null }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (payload.empresaId && !empresaPermitida(empresasPermitidas, payload.empresaId)) {
      return { ok: false, erro: 'Você não tem permissão para ver os lotes desta empresa.' };
    }
    const dentro = escopoEmpresa(empresasPermitidas, payload.empresaId);

    const { data: l, error } = await db.from('financeiro_lotes_pagamento').select('*').eq('id', payload.loteId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!l || (l.empresa_id != null && !dentro(l.empresa_id))) return { ok: false, erro: 'Lote não encontrado.' };

    const itensBrutos: any[] = (Array.isArray(l.itens) ? l.itens : [])
      .filter((i: any) => l.empresa_id != null || dentro(i?.empresa_id));

    // Número da OP pros itens que vieram de Ordem de Pagamento
    const opIds = [...new Set(itensBrutos.map(i => i.opId).filter(Boolean))];
    const numeroOp: Record<string, string> = {};
    if (opIds.length) {
      const { data: ops } = await db.from('op_ordens_pagamento').select('id, numero_op').in('id', opIds);
      (ops || []).forEach(o => { numeroOp[o.id] = o.numero_op; });
    }
    const { data: empresa } = l.empresa_id != null
      ? await db.from('empresas').select('nome').eq('id', l.empresa_id).maybeSingle()
      : { data: null };

    const itens = itensBrutos.map((i, idx) => {
      const ehPix = (i.metodo || '').toUpperCase() === 'PIX';
      const boletos: { linha?: string }[] = Array.isArray(i.boletos) ? i.boletos : [];
      const destino = ehPix
        ? `PIX ${String(i.pix_tipo || '').toLowerCase()} ${mascarar(i.pix_chave)}`.trim()
        : (i.metodo || '').toUpperCase() === 'BOLETO'
        ? (boletos.length > 1 ? `${boletos.length} boletos (arquivo SISPAG)` : `boleto ${String(boletos[0]?.linha || '').slice(0, 5)}… (arquivo SISPAG)`)
        : [i.banco_codigo && `banco ${i.banco_codigo}`, i.banco_agencia && `ag ${i.banco_agencia}`, i.banco_conta && `cc ${mascarar(i.banco_conta)}`].filter(Boolean).join(' · ') || '—';
      return {
        seq: idx + 1,
        favorecido: i.funcionario_nome || i.api_resposta_bruta?.recebedor?.nome || '—',
        fonte: i.fonte_rotulo || i.fonte || '—',
        referencia: i.opId && numeroOp[i.opId] ? `OP ${numeroOp[i.opId]}` : null,
        metodo: i.metodo || '—',
        destino,
        valor: Number(i.valor) || 0,
        envio: i.api_status || null,             // 'Sucesso' = aceito pela API do Itaú; 'Erro' = recusado
        envioErro: i.api_erro || (Array.isArray(i.api_motivo_recusa) && i.api_motivo_recusa.length ? i.api_motivo_recusa.map((m: any) => m?.descricao || m).join('; ') : null),
        enviadoEm: i.api_enviado_em || null,
        banco: i.itau_status_atual || null,      // status real no Itaú (ex.: Efetuado), se já consultado
        efetuadoEm: i.itau_efetuado_em || null,  // quando o sistema viu "Efetuado" (data da consulta, não do banco)
        consultadoEm: i.itau_consultado_em || null,
        codPagamento: i.api_cod_pagamento || null, // pra "Atualizar situação no Itaú"
        observacao: i.alerta || i.nota || null,
      };
    });

    return {
      ok: true,
      info: {
        lote: {
          id: l.id, nome: l.nome_lote || l.tipo_lote, tipo: l.tipo_lote, parceiro: l.parceiro, mes: l.mes_referencia,
          dataPagamento: l.data_pagamento, status: l.status, ativo: l.ativo !== false,
          criadoPor: l.criado_por, criadoEm: l.criado_em, empresa: empresa?.nome || (l.empresa_id == null ? 'Várias / sem empresa' : null),
          valor: itens.reduce((s, i) => s + i.valor, 0), qtd: itens.length,
        },
        itens
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Atualiza a situação real no Itaú dos pagamentos de um lote (aba Relatório de
// Lote). O api_status do envio só diz que a API aceitou; "Efetuado" só aparece
// consultando o SISPAG de novo — sem isso o relatório mostrava "Enviado" pra
// lote já pago (caso lote #82, 2026-11-06: 1 de 45 consultado). Recebe no
// máximo 10 códigos por chamada (a tela chama em sequência, com progresso) e
// grava tudo no item do lote de uma vez. Só consulta e grava o status — não dá
// baixa em OP/Conta a Pagar (isso continua na tela de Lotes de Pagamento).
export async function atualizarStatusItauLoteAction(payload: { loteId: number; codigos: string[]; empresaId?: number | null }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const codigos = [...new Set((payload.codigos || []).filter(Boolean))].slice(0, 10);
  if (codigos.length === 0) return { ok: true, info: { consultados: 0 } };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const dentro = escopoEmpresa(empresasPermitidas, payload.empresaId);
    const { data: lote } = await db.from('financeiro_lotes_pagamento').select('id, empresa_id, itens').eq('id', payload.loteId).maybeSingle();
    if (!lote || (lote.empresa_id != null && !dentro(lote.empresa_id))) return { ok: false, erro: 'Lote não encontrado.' };

    const ctx = await contextoEnvioItau();
    if (!ctx.ok) return { ok: false, erro: ctx.erro };

    const itensLote: any[] = Array.isArray(lote.itens) ? lote.itens : [];
    const resultados: Record<string, string> = {};
    const falhas: string[] = [];
    for (const cod of codigos) {
      const item = itensLote.find(i => i.api_cod_pagamento === cod);
      if (!item || (lote.empresa_id == null && !dentro(item.empresa_id))) continue;
      const { ok, data } = await consultarPagamentoSispag(ctx.ambiente, cod);
      if (!ok) { falhas.push(item.funcionario_nome || cod); continue; }
      resultados[cod] = String((data?.data ?? data)?.dados_pagamento?.status || '');
    }

    // Grava de uma vez, relendo o lote (pode ter mudado durante as consultas)
    if (Object.keys(resultados).length > 0) {
      const { data: atual } = await db.from('financeiro_lotes_pagamento').select('itens').eq('id', payload.loteId).single();
      const itens: any[] = Array.isArray(atual?.itens) ? atual.itens : [];
      const agora = new Date().toISOString();
      itens.forEach(i => {
        const status = resultados[i.api_cod_pagamento];
        if (status === undefined) return;
        i.itau_status_atual = status || null;
        i.itau_consultado_em = agora;
        if (semAcento(status) === STATUS_ITAU_EFETUADO && !i.itau_efetuado_em) i.itau_efetuado_em = agora;
      });
      const { error } = await db.from('financeiro_lotes_pagamento').update({ itens }).eq('id', payload.loteId);
      if (error) throw new Error(error.message);
    }
    return { ok: true, info: { consultados: Object.keys(resultados).length, falhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
