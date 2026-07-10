'use server';

// app/admin/rh/actions/actions-integracao.ts
// Integração com parceiros (bancos, benefícios). Nesta versão: estrutura,
// montagem do lote de pagamento a partir da folha, e histórico. O envio real
// ao banco é um ponto de plugagem (stub) — exige credenciais/certificado em
// variáveis de ambiente e homologação, que entram numa fase posterior.
import { supabaseAdmin } from '../../../lib/supabase';
import { calcularBeneficiosMes } from './actions-beneficios';
import { resolverFontesPagamento } from './actions-fontes-pagamento';
import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";

type Resultado = { 
  ok: boolean; 
  erro?: string; 
  info?: any;
  valor?: number;       // Adicionado para o retorno do OCR da AWS
  _textoLido?: string;  // Adicionado para diagnóstico do OCR
};

// ============================================================================
// PARCEIROS / INTEGRAÇÕES
// ============================================================================
export async function listarIntegracoesAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db.from('folha_integracoes').select('*').order('tipo');
    if (error) throw new Error(error.message);
    return { ok: true, info: { integracoes: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Salva metadados de configuração (NÃO segredos) e status de uma integração
export async function salvarIntegracaoAction(payload: {
  parceiro: string; ativo: boolean; ambiente: 'SANDBOX' | 'PRODUCAO'; config: any;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_integracoes').update({
      ativo: payload.ativo, ambiente: payload.ambiente, config: payload.config || {},
      atualizado_em: new Date().toISOString()
    }).eq('parceiro', payload.parceiro);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

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

    // CONTABILIDADE — quem tem cada tipo cadastrado no mês
    const temAdiantamento = new Set<string>();
    const temPagamento = new Set<string>();
    if (fontes.includes('ADIANTAMENTO') || fontes.includes('PAGAMENTO')) {
      const { data: docs } = await db.from('folha_documentos_contabeis')
        .select('funcionario_nome, tipo').eq('mes_referencia', mesReferencia);
      (docs || []).forEach(d => {
        if (d.tipo === 'ADIANTAMENTO') temAdiantamento.add(d.funcionario_nome);
        else if (d.tipo === 'HOLERITE_MENSAL') temPagamento.add(d.funcionario_nome);
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
          entradas.push({ fonte: 'ADIANTAMENTO', valor: valoresAdiant[nome] || 0, temDoc: true, origem: 'OCR' });
        }
      }
      
      if (fontes.includes('PAGAMENTO') && resolvido.recebeHolerite && temPagamento.has(nome)) {
        entradas.push({ fonte: 'PAGAMENTO', valor: valoresPagto[nome] || 0, temDoc: true });
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
// ============================================================================
const textractClient = new TextractClient({ 
  region: process.env.AWS_REGION || "us-east-1" 
});

export async function processarOcrAwsAction(pdfBase64: string, tipo: string): Promise<Resultado> {
  try {
    const documentBytes = Buffer.from(pdfBase64, 'base64');

    const command = new DetectDocumentTextCommand({
      Document: {
        Bytes: documentBytes,
      },
    });

    const response = await textractClient.send(command);

    if (!response.Blocks) {
      return { ok: false, erro: 'Nenhum texto detectado pela AWS.' };
    }

    const linhas = response.Blocks
      .filter(block => block.BlockType === 'LINE' && block.Text)
      .map(block => block.Text)
      .join('\n');

    const t = linhas.toUpperCase().replace(/\s+/g, ' ');
    const rx = /VALOR\s*L[IÍ]QUIDO[^\d,]{0,30}(\d{1,3}(?:\.\d{3})*,\d{2})/;
    const m = t.match(rx);

    if (m && m[1]) {
      const numero = m[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
      return { 
        ok: true, 
        valor: Number(numero),
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
// Devolve as páginas dos holerites em base64 para o backend despachar pra AWS
// ============================================================================
export async function listarPdfsContabilidadeAction(payload: {
  mesReferencia: string;
  tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL';
}): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: docs } = await db
      .from('folha_documentos_contabeis')
      .select('funcionario_nome, tipo, storage_path')
      .eq('mes_referencia', payload.mesReferencia)
      .eq('tipo', payload.tipo);
    if (!docs?.length) return { ok: true, info: { pdfs: [] } };

    const pdfs: { funcionario_nome: string; pdfBase64: string }[] = [];
    for (const d of docs) {
      const { data: blob } = await db.storage.from('documentos-folha').download(d.storage_path);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      pdfs.push({
        funcionario_nome: d.funcionario_nome,
        pdfBase64: Buffer.from(bytes).toString('base64')
      });
    }
    return { ok: true, info: { pdfs } };
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
      .select('id, parceiro, mes_referencia, tipo_lote, nome_lote, qtd_pagamentos, valor_total, status, criado_por, criado_em')
      .order('criado_em', { ascending: false });
    if (payload.mesReferencia) q = q.eq('mes_referencia', payload.mesReferencia);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, info: { lotes: data || [] } };
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