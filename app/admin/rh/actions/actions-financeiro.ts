'use server';

// app/admin/rh/actions/actions-financeiro.ts
// Montagem de lotes de pagamento a partir da folha (fechamento, adiantamento,
// pagamento e benefícios), leitura de comprovantes via OCR (AWS Textract) e
// histórico de lotes. O envio real ao banco é um ponto de plugagem (stub) —
// exige credenciais/certificado em variáveis de ambiente e homologação, que
// entram numa fase posterior. Cadastro de parceiros/bancos vive em
// app/admin/integracao/actions.ts (tela Integrações).
import { supabaseAdmin } from '../../../lib/supabase';
import { calcularBeneficiosMes } from './actions-beneficios';
import { resolverFontesPagamento } from './actions-fontes-pagamento';
import { extrairTextoPdf } from '../../../lib/textract';
import { registrarLogAuditoria } from '../../../actions';

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
export type FonteLote = 'FOLHA' | 'ADIANTAMENTO' | 'PAGAMENTO' | 'BENEFICIOS';

export async function montarLoteSalariosAction(payload: {
  mesReferencia: string;
  fontes: FonteLote[];                          // fontes selecionadas
  valoresAdiantamento?: Record<string, number>; // OCR do ADIANTAMENTO
  valoresPagamento?: Record<string, number>;    // OCR do HOLERITE_MENSAL
}): Promise<Resultado> {
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
    const valorOcrAdiantPorNome: Record<string, number> = {};
    const valorOcrPagtoPorNome: Record<string, number> = {};
    if (fontes.includes('ADIANTAMENTO') || fontes.includes('PAGAMENTO')) {
      const { data: docs } = await db.from('folha_documentos_contabeis')
        .select('funcionario_nome, tipo, valor_ocr').eq('mes_referencia', mesReferencia);
      (docs || []).forEach(d => {
        if (d.tipo === 'ADIANTAMENTO') {
          temAdiantamento.add(d.funcionario_nome);
          if (d.valor_ocr != null) valorOcrAdiantPorNome[d.funcionario_nome] = Number(d.valor_ocr);
        } else if (d.tipo === 'HOLERITE_MENSAL') {
          temPagamento.add(d.funcionario_nome);
          if (d.valor_ocr != null) valorOcrPagtoPorNome[d.funcionario_nome] = Number(d.valor_ocr);
        }
      });
    }

    // BENEFÍCIOS
    const beneficiosPorNome: Record<string, number> = {};
    if (fontes.includes('BENEFICIOS')) {
      const { itens: itensBenef } = await calcularBeneficiosMes(db, mesReferencia);
      itensBenef.forEach(it => {
        beneficiosPorNome[it.funcionario_nome] = (beneficiosPorNome[it.funcionario_nome] || 0) + it.valorMes;
      });
    }

    const valoresAdiant = payload.valoresAdiantamento || {};
    const valoresPagto = payload.valoresPagamento || {};

    // União dos nomes de todas as fontes selecionadas
    const nomes = new Set<string>();
    if (fontes.includes('FOLHA')) Object.keys(folhaPorNome).forEach(n => nomes.add(n));
    if (fontes.includes('ADIANTAMENTO')) {
      temAdiantamento.forEach(n => nomes.add(n));
      Object.keys(adiantFichaPorNome).forEach(n => nomes.add(n));
    }
    if (fontes.includes('PAGAMENTO')) temPagamento.forEach(n => nomes.add(n));
    if (fontes.includes('BENEFICIOS')) Object.keys(beneficiosPorNome).forEach(n => nomes.add(n));

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
      PAGAMENTO: 'Pagamento', BENEFICIOS: 'Benefícios'
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
      const entradas: { fonte: FonteLote; valor: number; temDoc?: boolean; origem?: string }[] = [];

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

      entradas.forEach(e => {
        itens.push({
          funcionario_nome: nome,
          fonte: e.fonte,
          fonte_rotulo: rotuloFonte[e.fonte],
          temDoc: e.temDoc || false,
          origem: e.origem || null,
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
          BENEFICIOS: itens.filter(i => i.fonte === 'BENEFICIOS').reduce((s, i) => s + i.valor, 0)
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
  pdfBase64: string, tipo: string, mesReferencia?: string, funcionarioNome?: string
): Promise<Resultado> {
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
  tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL';
  forcar?: boolean;
}): Promise<Resultado> {
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
  itens: any[]; criadoPor: string;
}): Promise<Resultado> {
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

export async function listarLotesAction(payload: { mesReferencia?: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    let q = db.from('folha_lotes_pagamento')
      .select('id, parceiro, mes_referencia, tipo_lote, nome_lote, qtd_pagamentos, valor_total, status, ativo, criado_por, criado_em')
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
export async function buscarLoteAction(payload: { loteId: number }): Promise<Resultado> {
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
}): Promise<Resultado> {
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
// ENVIAR LOTE AO BANCO — PONTO DE PLUGAGEM (stub).
// ============================================================================
export async function enviarLoteAoBancoAction(payload: { loteId: number }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: lote } = await db.from('folha_lotes_pagamento')
      .select('parceiro, status').eq('id', payload.loteId).maybeSingle();
    if (!lote) return { ok: false, erro: 'Lote não encontrado.' };

    const { data: integ } = await db.from('folha_integracoes')
      .select('ativo, ambiente').eq('parceiro', lote.parceiro).maybeSingle();

    if (!integ?.ativo) {
      return {
        ok: false,
        erro: `A integração com ${lote.parceiro} ainda não está ativa. Configure as credenciais (certificado e OAuth) no servidor e ative a integração antes de enviar. O lote está salvo e pode ser exportado.`
      };
    }

    return {
      ok: false,
      erro: 'Envio direto à API do banco ainda não implementado nesta versão. Use a exportação do lote (CNAB/planilha) para processar no internet banking, ou aguarde a ativação da API homologada.'
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
