'use server';

// app/admin/rh/actions/actions-financeiro.ts
// Montagem de lotes de pagamento a partir da folha (fechamento, adiantamento,
// pagamento e benefícios), leitura de comprovantes via OCR (AWS Textract) e
// histórico de lotes. Envio real ao banco (enviarLoteAoBancoAction) cobre só
// Itaú/PIX via API SISPAG hoje — ver app/lib/itauSispag.ts. Cadastro de
// parceiros/bancos vive em app/admin/integracao/actions.ts (tela Integrações).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { calcularBeneficiosMes } from './actions-beneficios';
import { resolverFontesPagamento } from './actions-fontes-pagamento';
import { extrairTextoPdf } from '../../../lib/textract';
import { registrarLogAuditoria } from '../../../actions';
import { enviarPixPorChave, enviarPixPorDadosBancarios, consultarPagamentoSispag, credenciaisItauConfiguradas, type PagadorSispag } from '../../../lib/itauSispag';
import { ispbPorCompe } from '../../../lib/bancosCompeIspb';

const ROTA = '/admin/financeiro/rh';

type Resultado = {
  ok: boolean;
  erro?: string;
  info?: any;
  valor?: number;       // Adicionado para o retorno do OCR da AWS
  _textoLido?: string;  // Adicionado para diagnóstico do OCR
};

// ============================================================================
// MONTAR LOTE DE PAGAMENTO — 4 fontes selecionáveis por funcionário
// ============================================================================
export type FonteLote = 'FOLHA' | 'ADIANTAMENTO' | 'PAGAMENTO' | 'BENEFICIOS' | 'DECIMO_TERCEIRO' | 'FERIAS' | 'RESCISAO';

export async function montarLoteSalariosAction(payload: {
  mesReferencia: string;
  fontes: FonteLote[];                              // fontes selecionadas
  valoresAdiantamento?: Record<string, number>;     // OCR do ADIANTAMENTO
  valoresPagamento?: Record<string, number>;        // OCR do HOLERITE_MENSAL
  valoresDecimoTerceiro?: Record<string, number>;   // OCR do DECIMO_TERCEIRO
  valoresFerias?: Record<string, number>;           // OCR do FERIAS
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { mesReferencia, fontes } = payload;
  if (!fontes || fontes.length === 0) {
    return { ok: false, erro: 'Selecione ao menos uma fonte de pagamento.' };
  }

  try {
    // FOLHA — funcionários com folha fechada no mês
    const folhaPorNome: Record<string, number> = {};
    if (fontes.includes('FOLHA')) {
      const { data: fechados } = await db.from('folha_holerites')
        .select('funcionario_nome, dados').eq('mes_referencia', mesReferencia);
      (fechados || []).forEach(f => {
        folhaPorNome[f.funcionario_nome] = Number(f.dados?.valorLiquidoReceber || 0);
      });
    }

    // ADIANTAMENTO DA FICHA
    const adiantFichaPorNome: Record<string, number> = {};
    if (fontes.includes('ADIANTAMENTO')) {
      const { data: fichas } = await db.from('folha_funcionarios')
        .select('nome_completo, valor_adiantamento').eq('ativo', true);
      (fichas || []).forEach(f => {
        const v = Number(f.valor_adiantamento || 0);
        if (v > 0) adiantFichaPorNome[f.nome_completo] = v;
      });
    }

    // CONTABILIDADE — quem tem cada tipo cadastrado no mês. valor_ocr é o
    // resultado da leitura AWS Textract já persistido em leituras anteriores
    // (ver processarOcrAwsAction), usado como padrão para não precisar rodar
    // o OCR de novo toda vez que o lote é montado.
    const temAdiantamento = new Set<string>();
    const temPagamento = new Set<string>();
    const temDecimoTerceiro = new Set<string>();
    const temFerias = new Set<string>();
    const valorOcrAdiantPorNome: Record<string, number> = {};
    const valorOcrPagtoPorNome: Record<string, number> = {};
    const valorOcrDecimoTerceiroPorNome: Record<string, number> = {};
    const valorOcrFeriasPorNome: Record<string, number> = {};
    if (fontes.includes('ADIANTAMENTO') || fontes.includes('PAGAMENTO') || fontes.includes('DECIMO_TERCEIRO') || fontes.includes('FERIAS')) {
      const { data: docs } = await db.from('folha_documentos_contabeis')
        .select('funcionario_nome, tipo, valor_ocr').eq('mes_referencia', mesReferencia);
      (docs || []).forEach(d => {
        if (d.tipo === 'ADIANTAMENTO') {
          temAdiantamento.add(d.funcionario_nome);
          if (d.valor_ocr != null) valorOcrAdiantPorNome[d.funcionario_nome] = Number(d.valor_ocr);
        } else if (d.tipo === 'HOLERITE_MENSAL') {
          temPagamento.add(d.funcionario_nome);
          if (d.valor_ocr != null) valorOcrPagtoPorNome[d.funcionario_nome] = Number(d.valor_ocr);
        } else if (d.tipo === 'DECIMO_TERCEIRO') {
          temDecimoTerceiro.add(d.funcionario_nome);
          if (d.valor_ocr != null) valorOcrDecimoTerceiroPorNome[d.funcionario_nome] = Number(d.valor_ocr);
        } else if (d.tipo === 'FERIAS') {
          temFerias.add(d.funcionario_nome);
          if (d.valor_ocr != null) valorOcrFeriasPorNome[d.funcionario_nome] = Number(d.valor_ocr);
        }
      });
    }

    // BENEFÍCIOS — só entram no lote bancário os benefícios pagos por
    // transferência (Cartão Flash é carregado à parte, fora deste lote).
    const beneficiosPorNome: Record<string, number> = {};
    if (fontes.includes('BENEFICIOS')) {
      const normMeio = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      const { itens: itensBenef } = await calcularBeneficiosMes(db, mesReferencia);
      itensBenef.filter(it => normMeio(it.meio).includes('TRANSFER')).forEach(it => {
        beneficiosPorNome[it.funcionario_nome] = (beneficiosPorNome[it.funcionario_nome] || 0) + it.valorMes;
      });
    }

    // RESCISÃO — só as homologadas com cálculo próprio e AINDA NÃO pagas
    // (pago_em is null). Diferente das outras fontes, não é escopada pelo
    // mês de competência selecionado — uma rescisão homologada em qualquer
    // data aparece até ser paga. Se por algum motivo (ex.: readmissão)
    // houver mais de uma rescisão homologada em aberto pro mesmo nome, fica
    // só a mais recente (ordenado por homologado_em desc).
    const rescisaoPorNome: Record<string, number> = {};
    const rescisaoIdPorNome: Record<string, number> = {};
    if (fontes.includes('RESCISAO')) {
      const { data: rescisoes } = await db.from('folha_rescisoes')
        .select('id, funcionario_nome, valor_total_liquido')
        .eq('status', 'HOMOLOGADA').eq('tipo_folha', 'PROPRIO').is('pago_em', null)
        .order('homologado_em', { ascending: false });
      (rescisoes || []).forEach(r => {
        if (rescisaoPorNome[r.funcionario_nome] !== undefined) return; // já pegou a mais recente
        rescisaoPorNome[r.funcionario_nome] = Number(r.valor_total_liquido || 0);
        rescisaoIdPorNome[r.funcionario_nome] = r.id;
      });
    }

    const valoresAdiant = payload.valoresAdiantamento || {};
    const valoresPagto = payload.valoresPagamento || {};
    const valoresDecimoTerceiro = payload.valoresDecimoTerceiro || {};
    const valoresFerias = payload.valoresFerias || {};

    // União dos nomes de todas as fontes selecionadas
    const nomes = new Set<string>();
    if (fontes.includes('FOLHA')) Object.keys(folhaPorNome).forEach(n => nomes.add(n));
    if (fontes.includes('ADIANTAMENTO')) {
      temAdiantamento.forEach(n => nomes.add(n));
      Object.keys(adiantFichaPorNome).forEach(n => nomes.add(n));
    }
    if (fontes.includes('PAGAMENTO')) temPagamento.forEach(n => nomes.add(n));
    if (fontes.includes('BENEFICIOS')) Object.keys(beneficiosPorNome).forEach(n => nomes.add(n));
    if (fontes.includes('DECIMO_TERCEIRO')) temDecimoTerceiro.forEach(n => nomes.add(n));
    if (fontes.includes('FERIAS')) temFerias.forEach(n => nomes.add(n));
    if (fontes.includes('RESCISAO')) Object.keys(rescisaoPorNome).forEach(n => nomes.add(n));

    // Dados bancários + valor de adiantamento da ficha
    const { data: funcs } = await db.from('folha_funcionarios')
      .select('nome_completo, cpf, valor_adiantamento, banco_codigo, banco_agencia, banco_conta, banco_tipo, pix_tipo, pix_chave')
      .in('nome_completo', Array.from(nomes));
    const bancoPorNome: Record<string, any> = {};
    (funcs || []).forEach(f => { bancoPorNome[f.nome_completo] = f; });

    let fontesResolvidas: Record<string, { recebeFechamento: boolean; recebeHolerite: boolean }> = {};
    try {
      fontesResolvidas = await resolverFontesPagamento(db, Array.from(nomes));
    } catch (e) {
      fontesResolvidas = {};
    }

    const rotuloFonte: Record<FonteLote, string> = {
      FOLHA: 'Nossa folha', ADIANTAMENTO: 'Adiantamento',
      PAGAMENTO: 'Pagamento', BENEFICIOS: 'Benefícios',
      DECIMO_TERCEIRO: '13º Salário', FERIAS: 'Férias', RESCISAO: 'Rescisão'
    };

    const itens: any[] = [];
    Array.from(nomes).sort((a, b) => a.localeCompare(b)).forEach(nome => {
      const b = bancoPorNome[nome] || {};
      const temPix = !!(b.pix_tipo && b.pix_chave);
      const temConta = !!(b.banco_codigo && b.banco_agencia && b.banco_conta);
      const metodo = temPix ? 'PIX' : temConta ? 'TED' : 'SEM_DADOS';
      const bancoInfo = {
        cpf: b.cpf || '', metodo,
        pix_tipo: b.pix_tipo || null, pix_chave: b.pix_chave || null,
        banco_codigo: b.banco_codigo || null, banco_agencia: b.banco_agencia || null,
        banco_conta: b.banco_conta || null, banco_tipo: b.banco_tipo || null
      };

      const resolvido = fontesResolvidas[nome] || { recebeFechamento: true, recebeHolerite: true };
      const entradas: { fonte: FonteLote; valor: number; temDoc?: boolean; origem?: string; rescisaoId?: number }[] = [];

      if (fontes.includes('FOLHA') && resolvido.recebeFechamento && folhaPorNome[nome] !== undefined) {
        entradas.push({ fonte: 'FOLHA', valor: folhaPorNome[nome] });
      }

      if (fontes.includes('ADIANTAMENTO')) {
        const daFicha = adiantFichaPorNome[nome];
        if (daFicha !== undefined && daFicha > 0) {
          entradas.push({ fonte: 'ADIANTAMENTO', valor: daFicha, temDoc: false, origem: 'FICHA' });
        } else if (temAdiantamento.has(nome)) {
          const valor = valoresAdiant[nome] ?? valorOcrAdiantPorNome[nome] ?? 0;
          entradas.push({ fonte: 'ADIANTAMENTO', valor, temDoc: true, origem: 'OCR' });
        }
      }

      if (fontes.includes('PAGAMENTO') && resolvido.recebeHolerite && temPagamento.has(nome)) {
        const valor = valoresPagto[nome] ?? valorOcrPagtoPorNome[nome] ?? 0;
        entradas.push({ fonte: 'PAGAMENTO', valor, temDoc: true });
      }
      if (fontes.includes('BENEFICIOS') && beneficiosPorNome[nome] !== undefined) {
        entradas.push({ fonte: 'BENEFICIOS', valor: beneficiosPorNome[nome] });
      }
      if (fontes.includes('DECIMO_TERCEIRO') && resolvido.recebeHolerite && temDecimoTerceiro.has(nome)) {
        const valor = valoresDecimoTerceiro[nome] ?? valorOcrDecimoTerceiroPorNome[nome] ?? 0;
        entradas.push({ fonte: 'DECIMO_TERCEIRO', valor, temDoc: true });
      }
      if (fontes.includes('FERIAS') && resolvido.recebeHolerite && temFerias.has(nome)) {
        const valor = valoresFerias[nome] ?? valorOcrFeriasPorNome[nome] ?? 0;
        entradas.push({ fonte: 'FERIAS', valor, temDoc: true });
      }
      // RESCISÃO não passa pela hierarquia recebeFechamento/recebeHolerite —
      // a elegibilidade já foi fixada em tipo_folha='PROPRIO' no momento em
      // que a rescisão foi criada (ver actions-rescisao.ts).
      if (fontes.includes('RESCISAO') && rescisaoPorNome[nome] !== undefined) {
        entradas.push({ fonte: 'RESCISAO', valor: rescisaoPorNome[nome], rescisaoId: rescisaoIdPorNome[nome] });
      }

      entradas.forEach(e => {
        itens.push({
          funcionario_nome: nome,
          fonte: e.fonte,
          fonte_rotulo: rotuloFonte[e.fonte],
          temDoc: e.temDoc || false,
          origem: e.origem || null,
          rescisaoId: e.rescisaoId || null,
          valor: e.valor,
          ...bancoInfo,
          pronto: (temPix || temConta) && e.valor > 0
        });
      });
    });

    const semDados = itens.filter(i => i.metodo === 'SEM_DADOS').length;
    const semOcr = itens.filter(i => i.temDoc && i.valor <= 0).length;
    const valorTotal = itens.filter(i => i.pronto).reduce((s, i) => s + i.valor, 0);

    return {
      ok: true,
      info: {
        itens, semDados, semOcr, valorTotal, totalItens: itens.length,
        _debug: {
          fontesSelecionadas: fontes,
          qtdComAdiantFicha: Object.keys(adiantFichaPorNome).length,
          qtdComAdiantOcr: temAdiantamento.size,
          qtdNomesTotal: nomes.size,
          exemplosAdiantFicha: Object.entries(adiantFichaPorNome).slice(0, 3)
        },
        totaisPorFonte: {
          FOLHA: itens.filter(i => i.fonte === 'FOLHA').reduce((s, i) => s + i.valor, 0),
          ADIANTAMENTO: itens.filter(i => i.fonte === 'ADIANTAMENTO').reduce((s, i) => s + i.valor, 0),
          PAGAMENTO: itens.filter(i => i.fonte === 'PAGAMENTO').reduce((s, i) => s + i.valor, 0),
          BENEFICIOS: itens.filter(i => i.fonte === 'BENEFICIOS').reduce((s, i) => s + i.valor, 0),
          DECIMO_TERCEIRO: itens.filter(i => i.fonte === 'DECIMO_TERCEIRO').reduce((s, i) => s + i.valor, 0),
          FERIAS: itens.filter(i => i.fonte === 'FERIAS').reduce((s, i) => s + i.valor, 0),
          RESCISAO: itens.filter(i => i.fonte === 'RESCISAO').reduce((s, i) => s + i.valor, 0)
        }
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// OCR AWS TEXTRACT (SERVER-SIDE)
// Envia o PDF digitalizado diretamente para a AWS para leitura limpa e precisa.
// A chamada ao Textract em si vive em app/lib/textract.ts (compartilhada com
// o reconhecimento de funcionário em actions-documentos.ts).
// ============================================================================
export async function processarOcrAwsAction(
  pdfBase64: string, tipo: string, mesReferencia: string | undefined, funcionarioNome: string | undefined, accessToken: string
): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  try {
    const linhas = await extrairTextoPdf(pdfBase64);

    if (!linhas) {
      return { ok: false, erro: 'Nenhum texto detectado pela AWS.' };
    }

    const t = linhas.toUpperCase().replace(/\s+/g, ' ');
    const rx = /VALOR\s*L[IÍ]QUIDO[^\d,]{0,30}(\d{1,3}(?:\.\d{3})*,\d{2})/;
    const m = t.match(rx);

    if (m && m[1]) {
      const numero = m[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
      const valor = Number(numero);

      // Persiste o valor lido no documento de origem, para que a próxima
      // montagem do lote (ou clique em "OCR") não precise reler este PDF.
      if (mesReferencia && funcionarioNome) {
        const db = supabaseAdmin();
        await db.from('folha_documentos_contabeis')
          .update({ valor_ocr: valor, ocr_processado_em: new Date().toISOString() })
          .eq('funcionario_nome', funcionarioNome)
          .eq('mes_referencia', mesReferencia)
          .eq('tipo', tipo);
      }

      return {
        ok: true,
        valor,
        _textoLido: linhas.substring(0, 500)
      };
    }

    return {
      ok: false,
      erro: 'Texto legível, mas o rótulo "Valor Líquido" não foi encontrado.',
      _textoLido: linhas.substring(0, 500)
    };

  } catch (error: any) {
    console.error("Erro na API da AWS:", error);
    return { ok: false, erro: 'Falha na comunicação com a AWS: ' + error.message };
  }
}

// ============================================================================
// PDFs DA CONTABILIDADE
// Devolve as páginas dos holerites em base64 para o backend despachar pra AWS.
// Documentos que já têm valor_ocr salvo (leitura anterior) voltam em `cache`
// e não são baixados do Storage nem reenviados à AWS — só `forcar: true`
// (releitura manual) ignora o cache e baixa tudo de novo.
// ============================================================================
export async function listarPdfsContabilidadeAction(payload: {
  mesReferencia: string;
  tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL' | 'DECIMO_TERCEIRO' | 'FERIAS';
  forcar?: boolean;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: docs } = await db
      .from('folha_documentos_contabeis')
      .select('funcionario_nome, tipo, storage_path, valor_ocr')
      .eq('mes_referencia', payload.mesReferencia)
      .eq('tipo', payload.tipo);
    if (!docs?.length) return { ok: true, info: { pdfs: [], cache: [] } };

    const cache: { funcionario_nome: string; valor: number }[] = [];
    const pendentes = docs.filter(d => {
      if (!payload.forcar && d.valor_ocr != null) {
        cache.push({ funcionario_nome: d.funcionario_nome, valor: Number(d.valor_ocr) });
        return false;
      }
      return true;
    });

    const pdfs: { funcionario_nome: string; pdfBase64: string }[] = [];
    for (const d of pendentes) {
      const { data: blob } = await db.storage.from('documentos-folha').download(d.storage_path);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      pdfs.push({
        funcionario_nome: d.funcionario_nome,
        pdfBase64: Buffer.from(bytes).toString('base64')
      });
    }
    return { ok: true, info: { pdfs, cache } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// SALVAR LOTE (histórico). Guarda o snapshot dos pagamentos escolhidos.
// ============================================================================
export async function salvarLoteAction(payload: {
  parceiro: string; mesReferencia: string; tipoLote: string;
  nomeLote?: string;
  dataPagamento?: string | null;
  itens: any[]; criadoPor: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const prontos = payload.itens.filter(i => i.pronto);
    if (prontos.length === 0) return { ok: false, erro: 'Nenhum pagamento pronto (com dados bancários) para incluir no lote.' };

    const valorTotal = prontos.reduce((s, i) => s + Number(i.valor || 0), 0);
    const { data, error } = await db.from('folha_lotes_pagamento').insert({
      parceiro: payload.parceiro,
      mes_referencia: payload.mesReferencia,
      tipo_lote: payload.tipoLote,
      nome_lote: payload.nomeLote || null,
      data_pagamento: payload.dataPagamento || null,
      qtd_pagamentos: prontos.length,
      valor_total: valorTotal,
      status: 'GERADO',
      itens: prontos,
      criado_por: payload.criadoPor || null
    }).select('id').single();
    if (error) throw new Error(error.message);
    return { ok: true, info: { loteId: data.id, qtd: prontos.length, valorTotal } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function listarLotesAction(payload: { mesReferencia?: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    let q = db.from('folha_lotes_pagamento')
      .select('id, parceiro, mes_referencia, tipo_lote, nome_lote, data_pagamento, qtd_pagamentos, valor_total, status, ativo, criado_por, criado_em')
      .order('criado_em', { ascending: false });
    if (payload.mesReferencia) q = q.eq('mes_referencia', payload.mesReferencia);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, info: { lotes: (data || []).map(l => ({ ...l, ativo: l.ativo ?? true })) } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// BUSCAR LOTE (com os itens salvos) — usado pra reabrir um lote já gerado no
// histórico e exportar de novo (CSV/CNAB), sem precisar remontar do zero.
// ============================================================================
export async function buscarLoteAction(payload: { loteId: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db.from('folha_lotes_pagamento')
      .select('id, nome_lote, tipo_lote, mes_referencia, itens')
      .eq('id', payload.loteId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, erro: 'Lote não encontrado.' };
    return { ok: true, info: { lote: data } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// INATIVAR / REATIVAR LOTE — não apaga o registro (mantém auditoria/histórico
// do que já foi gerado), só marca como inativo pra sinalizar que esse lote
// não deve mais ser considerado (ex.: duplicado, gerado por engano).
// ============================================================================
export async function alternarAtivoLoteAction(payload: {
  loteId: number; ativo: boolean; usuarioNome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: lote, error: buscaErr } = await db.from('folha_lotes_pagamento')
      .select('nome_lote, tipo_lote, mes_referencia').eq('id', payload.loteId).maybeSingle();
    if (buscaErr) throw new Error(buscaErr.message);
    if (!lote) return { ok: false, erro: 'Lote não encontrado.' };

    const { error } = await db.from('folha_lotes_pagamento').update({ ativo: payload.ativo }).eq('id', payload.loteId);
    if (error) throw new Error(error.message);

    await registrarLogAuditoria({
      usuario_nome: payload.usuarioNome,
      acao: `${payload.ativo ? 'REATIVAÇÃO' : 'INATIVAÇÃO'} DE LOTE DE PAGAMENTO: ${lote.nome_lote || lote.tipo_lote} (${lote.mes_referencia})`,
      setor: 'FINANCEIRO / RH'
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ENVIAR LOTE AO BANCO — hoje cobre só Itaú, e só os itens em PIX: a API
// SISPAG (Cash Management) só aceita inclusão de pagamento via Pix por
// chave — TED e demais formas continuam exigindo o arquivo CNAB manual
// (exportarCnabContaCorrenteTed no front). Idempotente: itens já com
// api_status de sucesso são pulados numa nova tentativa, pra nunca pagar em
// dobro se o usuário clicar de novo após um envio parcial.
// ============================================================================
const STATUS_PIX_SUCESSO = ['Sucesso', 'Sucesso (pre-autorizado)'];

export async function enviarLoteAoBancoAction(payload: { loteId: number; dataPagamento: string; usuarioNome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: lote, error: loteErr } = await db.from('folha_lotes_pagamento')
      .select('id, parceiro, mes_referencia, tipo_lote, itens').eq('id', payload.loteId).maybeSingle();
    if (loteErr) throw new Error(loteErr.message);
    if (!lote) return { ok: false, erro: 'Lote não encontrado.' };

    if (lote.parceiro !== 'ITAU') {
      return {
        ok: false,
        erro: `Envio direto à API ainda não implementado para ${lote.parceiro}. Use a exportação do lote.`
      };
    }

    const { data: integ } = await db.from('folha_integracoes')
      .select('ativo, ambiente, config').eq('parceiro', 'ITAU').maybeSingle();
    if (!integ?.ativo) {
      return { ok: false, erro: 'A integração com o Itaú ainda não está ativa. Ative em Integrações → ⚙ Configurar antes de enviar. O lote está salvo e pode ser exportado.' };
    }
    const ambienteItau: 'SANDBOX' | 'PRODUCAO' = integ.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'SANDBOX';
    if (!credenciaisItauConfiguradas(ambienteItau)) {
      return { ok: false, erro: `Credenciais da API do Itaú não configuradas no servidor para o ambiente ${ambienteItau} (ver Integrações → ⚙ Configurar Itaú). O lote está salvo e pode ser exportado.` };
    }

    const cfg = integ.config || {};
    const camposFaltando = (['cnpj', 'agencia_debito', 'conta_debito'] as const).filter(c => !String(cfg[c] || '').trim());
    if (camposFaltando.length > 0) {
      return { ok: false, erro: `Configure primeiro (Integrações → ⚙ Configurar Itaú): ${camposFaltando.join(', ')}.` };
    }

    const limpaNum = (s: string) => String(s || '').replace(/\D/g, '');
    // pagador.conta é a conta + dígito verificador CONCATENADOS numa string
    // só (confirmado na Especificação Técnica) — não em campos separados.
    const [contaBase, dacBase] = String(cfg.conta_debito || '').split('-');
    const pagador: PagadorSispag = {
      tipo_conta: 'CC',
      agencia: limpaNum(cfg.agencia_debito),
      conta: limpaNum(contaBase) + limpaNum(dacBase || ''),
      tipo_pessoa: 'J',
      documento: limpaNum(cfg.cnpj),
      // A Especificação Técnica só lista "Fornecedores" como domínio válido
      // de ENTRADA para o POST /transferencias — ajustável via
      // config.modulo_sispag se o Itaú orientar diferente pro cadastro.
      modulo_sispag: cfg.modulo_sispag === 'Diversos' ? 'Diversos' : 'Fornecedores',
    };

    const itens: any[] = Array.isArray(lote.itens) ? lote.itens : [];
    // 'TED' aqui só indica "sem chave PIX cadastrada, mas tem conta" — desde
    // que passamos a suportar Pix por dados bancários (agência+conta+ISPB),
    // esses itens também vão via API, não só pelo CNAB manual.
    const pendentes = itens.filter(i => i.pronto && (i.metodo === 'PIX' || i.metodo === 'TED') && !STATUS_PIX_SUCESSO.includes(i.api_status));
    if (pendentes.length === 0) {
      return { ok: false, erro: 'Nenhum pagamento pendente de envio neste lote (já enviados com sucesso, ou sem PIX/conta bancária cadastrados).' };
    }

    // CORRENTE/POUPANCA (domínio do cadastro do funcionário) -> CC/PP
    // (domínio do SISPAG: CC Conta Corrente, CP Conta Pagamento, PP Conta
    // Poupança — confirmado na Especificação Técnica). Funcionário nunca
    // cadastra "Conta Pagamento", por isso não há opção pra CP aqui.
    const tipoContaSispag = (bancoTipo: string | null): 'CC' | 'PP' => bancoTipo === 'POUPANCA' ? 'PP' : 'CC';

    let sucesso = 0, rejeitado = 0, comErro = 0;
    for (const item of pendentes) {
      const referencia_empresa = `FOLHA ${lote.mes_referencia}`.slice(0, 20);
      const identificacao_comprovante = `Pagamento - ${item.funcionario_nome}`.slice(0, 100);
      const informacoes_entre_usuarios = `Pagamento de ${item.fonte_rotulo || 'folha'} - ${lote.mes_referencia}`;

      let resultado;
      if (item.pix_chave) {
        resultado = await enviarPixPorChave({
          ambiente: ambienteItau,
          valor_pagamento: Number(item.valor || 0),
          // Data pura "yyyy-MM-dd" — confirmado na Especificação Técnica
          // (tamanho 10, exemplos sem horário). dataPagamento já vem nesse
          // formato do <input type="date"> no front.
          data_pagamento: payload.dataPagamento,
          chave: item.pix_chave,
          referencia_empresa, identificacao_comprovante, informacoes_entre_usuarios,
          pagador,
        });
      } else if (item.banco_codigo && item.banco_agencia && item.banco_conta) {
        const ispb = ispbPorCompe(item.banco_codigo);
        if (!ispb) {
          item.api_status = 'Erro'; item.api_erro = `Código do banco "${item.banco_codigo}" não reconhecido para envio via Pix — use a exportação manual (CNAB) para este funcionário.`; item.api_enviado_em = new Date().toISOString();
          comErro++;
          continue;
        }
        resultado = await enviarPixPorDadosBancarios({
          ambiente: ambienteItau,
          valor_pagamento: Number(item.valor || 0),
          data_pagamento: payload.dataPagamento,
          ispb,
          tipo_identificacao_conta: tipoContaSispag(item.banco_tipo),
          agencia_recebedor: String(item.banco_agencia).replace(/\D/g, ''),
          conta_recebedor: String(item.banco_conta).replace(/\D/g, ''),
          tipo_de_identificacao_do_recebedor: 'F',
          identificacao_recebedor: String(item.cpf || '').replace(/\D/g, ''),
          referencia_empresa, identificacao_comprovante, informacoes_entre_usuarios,
          pagador,
        });
      } else {
        item.api_status = 'Erro'; item.api_erro = 'Sem chave PIX nem conta bancária cadastrada.'; item.api_enviado_em = new Date().toISOString();
        comErro++;
        continue;
      }

      item.api_enviado_em = new Date().toISOString();
      // Corpo bruto da resposta da API, sem seleção de campos — pedido
      // explicitamente pra investigar caso a API diga sucesso mas a
      // transação não apareça no app do Itaú (2026-08-10): campos que os
      // outros api_* abaixo não cobrem (dados_pix_transferencia, txid,
      // comprovante etc.) podem ter a pista que falta.
      item.api_resposta_bruta = resultado.respostaBruta ?? null;
      if (resultado.erro) {
        item.api_status = 'Erro'; item.api_erro = resultado.erro;
        comErro++;
      } else {
        item.api_status = resultado.statusPagamento || null;
        item.api_cod_pagamento = resultado.codPagamento || null;
        item.api_numero_lote = resultado.numeroLote || null;
        item.api_motivo_recusa = resultado.motivoRecusa || null;
        if (STATUS_PIX_SUCESSO.includes(resultado.statusPagamento || '')) {
          sucesso++;
          // Rescisão não é escopada por mês — sem marcar como paga aqui, a
          // mesma rescisão voltaria a aparecer no próximo lote e pagaria em
          // dobro. Demais fontes seguem só com a proteção implícita do mês.
          if (item.fonte === 'RESCISAO' && item.rescisaoId) {
            await db.from('folha_rescisoes')
              .update({ pago_em: new Date().toISOString(), pago_lote_id: payload.loteId })
              .eq('id', item.rescisaoId);
          }
        } else {
          rejeitado++;
        }
      }
    }

    const novoStatus = sucesso > 0 ? 'ENVIADO' : 'ERRO';
    const { error: updErr } = await db.from('folha_lotes_pagamento')
      .update({ itens, status: novoStatus }).eq('id', payload.loteId);
    if (updErr) throw new Error(updErr.message);

    await registrarLogAuditoria({
      usuario_nome: payload.usuarioNome,
      acao: `ENVIO DE LOTE PIX AO ITAÚ (LOTE #${payload.loteId}, ${lote.mes_referencia}): ${sucesso} enviados, ${rejeitado} rejeitados, ${comErro} com erro`,
      setor: 'FINANCEIRO / RH'
    });

    return {
      ok: sucesso > 0,
      erro: sucesso === 0 ? 'Nenhum pagamento foi enviado com sucesso — veja os detalhes por funcionário.' : undefined,
      info: { sucesso, rejeitado, comErro, total: pendentes.length }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CONSULTAR STATUS ATUAL NO ITAÚ — o api_status salvo em folha_lotes_pagamento
// fica congelado no momento do envio (ex.: "Sucesso" só significa "aceito
// pela API", não "pago de fato"). Pagamentos SISPAG passam por aprovação
// manual no Itaú Empresas antes de serem efetivados, então o status real só
// se sabe consultando de novo — GET /pagamentos_sispag/{id}, ver
// consultarPagamentoSispag em itauSispag.ts. Usado pela aba "🔌 Retorno API
// Itaú" (botão "Consultar status atual").
// ============================================================================
export async function consultarStatusAtualItauAction(payload: { idPagamentoSispag: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: integ } = await db.from('folha_integracoes')
      .select('ambiente').eq('parceiro', 'ITAU').maybeSingle();
    const ambienteItau: 'SANDBOX' | 'PRODUCAO' = integ?.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'SANDBOX';

    const { status, ok, data } = await consultarPagamentoSispag(ambienteItau, payload.idPagamentoSispag);
    if (!ok) {
      return { ok: false, erro: `Consulta rejeitada pela API do Itaú (HTTP ${status}): ${data?.mensagem || 'sem detalhe.'}` };
    }
    // Mesmo embrulho extra "data" dos outros endpoints do SISPAG — ver nota
    // em app/admin/financeiro/integracao/actions.ts.
    const pagamento = data?.data ?? data;
    return { ok: true, info: { ambiente: ambienteItau, pagamento } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
