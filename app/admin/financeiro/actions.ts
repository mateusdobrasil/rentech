'use server';

// app/admin/financeiro/actions.ts
// Agregações para o dashboard de Relatórios do hub Financeiro
// (/admin/financeiro/relatorios) — consolida as três frentes que hoje vivem
// sob este hub: Ordens de Pagamento (op_ordens_pagamento), Lotes de
// Pagamento (folha_lotes_pagamento) e Crédito Consignado (folha_consignados).
// Todo o cálculo acontece aqui (server-side) para a página só desenhar.
import { supabaseAdmin } from '../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../lib/serverAuth';

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
    const { data: opsRaw, error: opsErr } = await db
      .from('op_ordens_pagamento')
      .select('id, empresa_id, os_numero, empresa_recebedora, natureza_pagamento, total_geral, status, data_criacao, data_vencimento, responsavel_nome')
      .order('data_criacao', { ascending: false });
    if (opsErr) throw new Error(opsErr.message);
    const ops = (opsRaw || []).filter(o => dentroDoEscopo(o.empresa_id));

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
    const { data: lotesRaw, error: lotesErr } = await db
      .from('folha_lotes_pagamento')
      .select('mes_referencia, status, valor_total, qtd_pagamentos, criado_em, tipo_lote, nome_lote, empresa_id, itens')
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
      nome: l.nome_lote || l.tipo_lote, mes: l.mes_referencia, valor: Number(l.valor_total) || 0,
      qtd: l.qtd_pagamentos, status: l.status, criadoEm: l.criado_em
    }));

    // ============================================================
    // CRÉDITO CONSIGNADO — situação atual (a tabela não guarda histórico
    // mensal: cada contrato é uma linha viva, atualizada a cada importação).
    // ============================================================
    const [{ data: consignadosRaw, error: consErr }, { data: funcionariosRaw, error: funcErr }] = await Promise.all([
      db.from('folha_consignados').select('cpf, instituicao_nome, valor_parcela, importado_em').eq('ativo', true),
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
