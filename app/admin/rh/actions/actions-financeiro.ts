'use server';

// app/admin/rh/actions/actions-financeiro.ts
// Montagem de lotes de pagamento a partir da folha (fechamento, adiantamento,
// pagamento e benefícios), leitura de comprovantes via OCR (AWS Textract) e
// histórico de lotes. Envio real ao banco (enviarLoteAoBancoAction) cobre só
// Itaú/PIX via API SISPAG hoje — ver app/lib/itauSispag.ts. Cadastro de
// parceiros/bancos vive em app/admin/integracao/actions.ts (tela Integrações).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
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
// NORMALIZAÇÃO E VALIDAÇÃO DE DADOS DE PAGAMENTO — compartilhadas entre
// montarLoteSalariosAction (decide se o item nasce "pronto" e mostra o aviso
// no grid) e enviarLoteAoBancoAction (trava de segurança antes de CADA
// chamada à API, mesmo que o item já estivesse marcado pronto — cobre o caso
// de alguém editar manualmente a chave/CPF na grade entre montar e enviar,
// ex.: a edição inline de Contas a Pagar). Movidas pro escopo do módulo
// (eram locais a enviarLoteAoBancoAction) justamente pra dar pra reusar nos
// dois lugares sem duplicar a lógica.
//
// Normaliza a chave Pix pro formato que o DICT/BACEN espera, ANTES de
// enviar — três fontes diferentes alimentam item.pix_tipo com vocabulários
// próprios pro mesmo conceito (funcionário: TELEFONE/CPF; OP: CELULAR/
// "CPF/CNPJ"; Contas a Pagar: TELEFONE/"CPF-CNPJ"), por isso a checagem é
// por substring (TEL/CEL, CPF/CNPJ), não igualdade exata.
// Dois problemas reais confirmados em produção (lote #41, 2026-09-17):
// - Telefone/celular sem "+55" na frente → "916 Chave não encontrada"
//   (chave existe no DICT, mas sem o formato E.164 o Itaú não acha).
// - CPF/CNPJ com máscara (ex.: "455.769.598-17", digitado à mão numa OP)
//   → "Chave PIX inválida" (DICT só aceita dígitos puros).
// E-mail/chave aleatória não têm esse problema — vão como cadastrados.
function chavePixParaEnvio(item: { pix_chave?: string | null; pix_tipo?: string | null }): string {
  const chave = String(item.pix_chave || '').trim();
  const tipo = String(item.pix_tipo || '').toUpperCase();
  if (chave.startsWith('+')) return chave;
  if (tipo.includes('TEL') || tipo.includes('CEL')) {
    const digitos = chave.replace(/\D/g, '');
    // Já vem com código do país (55 + DDD + número = 12/13 dígitos)?
    return digitos.length >= 12 ? `+${digitos}` : `+55${digitos}`;
  }
  if (tipo.includes('CPF') || tipo.includes('CNPJ')) {
    return chave.replace(/\D/g, '');
  }
  return chave;
}

// Valida o FORMATO dos dados que vão pro pagamento (não confirma se a chave
// existe de verdade no DICT — só se o valor tem cara do que o tipo declarado
// promete), pra pegar erro óbvio ANTES de gastar uma tentativa de API com
// algo que já dá pra saber que vai falhar (ex.: alguém deixou um texto de
// anotação — "DADOS JÁ CADASTRADOS" — no campo da chave, em vez do valor de
// verdade; confirmado em produção no lote #41, 6 OPs assim). Retorna null se
// parecer válido, ou uma mensagem de erro pronta pra mostrar ao usuário.
function validarDadosPagamentoItem(item: {
  funcionario_nome?: string; metodo?: string;
  pix_tipo?: string | null; pix_chave?: string | null; cpf?: string | null;
  banco_codigo?: string | null; banco_agencia?: string | null; banco_conta?: string | null;
}): string | null {
  if (!item.funcionario_nome || !item.funcionario_nome.trim()) {
    return 'Nome do favorecido está vazio.';
  }
  if (item.metodo === 'PIX') {
    const chave = chavePixParaEnvio(item);
    if (!chave) return 'Chave PIX está vazia.';
    const tipo = String(item.pix_tipo || '').toUpperCase();
    if (tipo.includes('CPF') || tipo.includes('CNPJ')) {
      const digitos = chave.replace(/\D/g, '');
      if (digitos.length !== 11 && digitos.length !== 14) {
        return `Chave PIX tipo CPF/CNPJ com formato inválido ("${item.pix_chave}") — tem ${digitos.length} dígito(s), esperado 11 (CPF) ou 14 (CNPJ).`;
      }
    } else if (tipo.includes('TEL') || tipo.includes('CEL')) {
      const digitos = chave.replace(/\D/g, '');
      if (digitos.length < 12 || digitos.length > 13) {
        return `Chave PIX tipo celular com formato inválido ("${item.pix_chave}") — não parece um telefone com DDI+DDD.`;
      }
    } else if (tipo.includes('EMAIL')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chave)) {
        return `Chave PIX tipo e-mail com formato inválido: "${item.pix_chave}".`;
      }
    } else if (tipo.includes('ALEAT')) {
      if (!/^[0-9a-fA-F-]{20,36}$/.test(chave)) {
        return `Chave PIX tipo aleatória com formato inesperado: "${item.pix_chave}" — confira se não foi digitado outro texto no lugar da chave.`;
      }
    }
  } else if (item.metodo === 'TED') {
    if (!item.banco_codigo || !item.banco_agencia || !item.banco_conta) {
      return 'Dados bancários incompletos (banco/agência/conta).';
    }
    const cpfDigitos = String(item.cpf || '').replace(/\D/g, '');
    if (cpfDigitos.length !== 11 && cpfDigitos.length !== 14) {
      return `Documento do favorecido com formato inválido para pagamento por dados bancários ("${item.cpf}") — tem ${cpfDigitos.length} dígito(s), esperado 11 (CPF) ou 14 (CNPJ).`;
    }
  }
  return null;
}

// ============================================================================
// MONTAR LOTE DE PAGAMENTO — 4 fontes selecionáveis por funcionário
// ============================================================================
export type FonteLote = 'FOLHA' | 'ADIANTAMENTO' | 'PAGAMENTO' | 'BENEFICIOS' | 'DECIMO_TERCEIRO' | 'FERIAS' | 'RESCISAO' | 'OP' | 'CONTAS_PAGAR';

export async function montarLoteSalariosAction(payload: {
  mesReferencia: string;
  fontes: FonteLote[];                              // fontes selecionadas
  empresaId?: number | null;                        // empresa escolhida na tela ANTES de montar
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
  // financeiro_contas_pagar não tem coluna de empresa (contas do PrimeStart
  // não são separadas por Rentech/AlfaLight hoje) — por decisão do usuário
  // (2026-09-17), toda conta trazida nessa fonte é debitada da empresa
  // escolhida na tela, então essa fonte não pode ser usada sem empresa
  // definida (as demais fontes toleram, pra não quebrar fluxo antigo).
  if (fontes.includes('CONTAS_PAGAR') && !payload.empresaId) {
    return { ok: false, erro: 'Selecione a empresa antes de montar um lote com Contas a Pagar (P2S) — essas contas não têm empresa própria, então usam a conta de débito da empresa escolhida.' };
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

    // ORDEM DE PAGAMENTO — OPs pendentes de baixa (status='PENDENTE'), pra
    // entrarem no mesmo lote bancário das folhas. Diferente das demais
    // fontes, cada OP é um favorecido isolado (não um funcionário) e não
    // combina com as outras pelo nome — por isso é tratada fora do mecanismo
    // de "nomes" abaixo e vira item de lote diretamente mais adiante. Também
    // não é escopada pelo mês de competência selecionado, mesmo critério já
    // usado pra RESCISAO. pago_em is null: exclui quem já foi enviado com
    // sucesso pela API num lote anterior (ver enviarLoteAoBancoAction) —
    // mesmo sem status='PAGO' ainda (isso exige confirmação humana), não
    // pode reaparecer aqui e ser enviado de novo, senão paga em dobro.
    let opsPendentes: { id: string; numero_op: number; empresa_id: number | null; empresa_recebedora: string; cnpj_cpf_recebedora: string; tipo_pagamento: string; chave_pix: string; dados_pagamento: string; total_geral: number; data_vencimento: string | null; banco_codigo: string | null; banco_agencia: string | null; banco_conta: string | null; banco_tipo: string | null }[] = [];
    if (fontes.includes('OP')) {
      const { data: ops } = await db.from('op_ordens_pagamento')
        .select('id, numero_op, empresa_id, empresa_recebedora, cnpj_cpf_recebedora, tipo_pagamento, chave_pix, dados_pagamento, total_geral, data_vencimento, banco_codigo, banco_agencia, banco_conta, banco_tipo')
        .eq('status', 'PENDENTE').is('pago_em', null);
      opsPendentes = ops || [];
    }

    // CONTAS A PAGAR (P2S) — mesmo tratamento de item isolado da OP (não
    // combina por nome, não é escopada pelo mês de competência, pago_em is
    // null evita reenvio/pagamento em dobro). "Em aberto" aqui é só
    // quitado=false — o pedido do usuário era literalmente esse (excluir
    // quitadas), sem outro critério de situação. O corte por vencimento (só
    // trazer contas até a "Data de pagamento" escolhida) acontece no CLIENTE,
    // igual já é feito pra OP — ver dentroDoFiltroData em
    // app/admin/financeiro/rh/page.tsx.
    let contasPagarPendentes: { id: number; descricao: string | null; fornecedor: string | null; centro: string | null; valor: number | null; valor_pago: number | null; data_vencimento: string | null; documento_fornecedor: string | null; pix_tipo: string | null; pix_chave: string | null; banco_codigo: string | null; banco_agencia: string | null; banco_conta: string | null; banco_tipo: string | null }[] = [];
    if (fontes.includes('CONTAS_PAGAR')) {
      const { data: contas } = await db.from('financeiro_contas_pagar')
        .select('id, descricao, fornecedor, centro, valor, valor_pago, data_vencimento, documento_fornecedor, pix_tipo, pix_chave, banco_codigo, banco_agencia, banco_conta, banco_tipo')
        .eq('quitado', false).is('pago_em', null);
      contasPagarPendentes = contas || [];
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
      .select('nome_completo, cpf, empresa_id, valor_adiantamento, banco_codigo, banco_agencia, banco_conta, banco_tipo, pix_tipo, pix_chave')
      .in('nome_completo', Array.from(nomes));
    const bancoPorNome: Record<string, any> = {};
    const empresaPorNomeFunc: Record<string, number | null> = {};
    (funcs || []).forEach(f => { bancoPorNome[f.nome_completo] = f; empresaPorNomeFunc[f.nome_completo] = f.empresa_id; });

    // Filtro de empresa: um lote só pode incluir funcionários das empresas
    // que o usuário logado enxerga (senão um usuário só-Rentech poderia
    // montar/pagar um lote com funcionários da AlfaLight).
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (empresasPermitidas) {
      Array.from(nomes).forEach(nome => {
        if (!empresaPermitida(empresasPermitidas, empresaPorNomeFunc[nome])) nomes.delete(nome);
      });
      opsPendentes = opsPendentes.filter(op => empresaPermitida(empresasPermitidas, op.empresa_id));
    }

    // Empresa escolhida na tela ANTES de montar o lote — não é um filtro de
    // exibição, restringe de fato quem entra. Revalidada aqui contra o que o
    // usuário realmente pode ver, nunca confiando cegamente no valor do payload.
    if (payload.empresaId) {
      if (!empresaPermitida(empresasPermitidas, payload.empresaId)) {
        return { ok: false, erro: 'Você não tem permissão para montar um lote para esta empresa.' };
      }
      Array.from(nomes).forEach(nome => {
        if (empresaPorNomeFunc[nome] != null && empresaPorNomeFunc[nome] !== payload.empresaId) nomes.delete(nome);
      });
      opsPendentes = opsPendentes.filter(op => op.empresa_id == null || op.empresa_id === payload.empresaId);
    }

    let fontesResolvidas: Record<string, { recebeFechamento: boolean; recebeHolerite: boolean }> = {};
    try {
      fontesResolvidas = await resolverFontesPagamento(db, Array.from(nomes));
    } catch (e) {
      fontesResolvidas = {};
    }

    const rotuloFonte: Record<FonteLote, string> = {
      FOLHA: 'Nossa folha', ADIANTAMENTO: 'Adiantamento',
      PAGAMENTO: 'Pagamento', BENEFICIOS: 'Benefícios',
      DECIMO_TERCEIRO: '13º Salário', FERIAS: 'Férias', RESCISAO: 'Rescisão',
      OP: 'Ordem de Pagamento', CONTAS_PAGAR: 'Contas a Pagar (P2S)'
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
      // Formato suspeito na ficha do funcionário (chave PIX mal digitada,
      // CPF com dígito errado etc.) já nasce sinalizado no grid, sem esperar
      // o usuário tentar enviar pra só então descobrir — ver
      // validarDadosPagamentoItem no topo do arquivo.
      const alertaDados = metodo === 'SEM_DADOS' ? null : validarDadosPagamentoItem({ funcionario_nome: nome, ...bancoInfo });

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
          empresa_id: empresaPorNomeFunc[nome] ?? null,
          fonte: e.fonte,
          fonte_rotulo: rotuloFonte[e.fonte],
          temDoc: e.temDoc || false,
          origem: e.origem || null,
          rescisaoId: e.rescisaoId || null,
          opId: null,
          contaPagarId: null,
          nota: null,
          alerta: alertaDados,
          dataPagamento: null,
          valor: e.valor,
          ...bancoInfo,
          pronto: (temPix || temConta) && e.valor > 0 && !alertaDados
        });
      });
    });

    // ORDEM DE PAGAMENTO — cada OP vira um item isolado (não passa pelo
    // mecanismo de "nomes" acima, que serve pra combinar FOLHA/ADIANTAMENTO/
    // etc. do MESMO funcionário). tipo_pagamento/chave_pix/dados_pagamento
    // seguem o modelo de op_ordens_pagamento (ver app/admin/op/nova/page.tsx):
    // chave_pix guarda o TIPO da chave (CELULAR/EMAIL/CPF-CNPJ/ALEATÓRIO) e
    // dados_pagamento guarda o VALOR de fato (chave Pix, boleto ou
    // agência/conta em texto livre) — nomes invertidos em relação ao
    // ItemLote de funcionário, onde pix_chave é o valor.
    opsPendentes.forEach(op => {
      const ehPix = String(op.tipo_pagamento || '').toUpperCase() === 'PIX' && !!String(op.dados_pagamento || '').trim();
      // TRANSFERÊNCIA com banco/agência/conta preenchidos (ver /admin/op/nova)
      // entra no lote pela mesma via de funcionário com TED (banco_codigo +
      // banco_agencia + banco_conta) — enviarLoteAoBancoAction e a exportação
      // CNAB já sabem lidar com isso, sem precisar saber que veio de uma OP.
      const ehTed = !ehPix && !!(op.banco_codigo && op.banco_agencia && op.banco_conta);
      const metodo = ehPix ? 'PIX' : ehTed ? 'TED' : 'SEM_DADOS';
      const valor = Number(op.total_geral || 0);
      const nomeOp = op.empresa_recebedora ? `${op.empresa_recebedora} — OP #${op.numero_op}` : `OP #${op.numero_op}`;
      const alertaDadosOp = metodo === 'SEM_DADOS' ? null : validarDadosPagamentoItem({
        funcionario_nome: nomeOp, metodo,
        pix_tipo: ehPix ? (op.chave_pix || null) : null, pix_chave: ehPix ? (op.dados_pagamento || null) : null,
        cpf: String(op.cnpj_cpf_recebedora || '').replace(/\D/g, ''),
        banco_codigo: ehTed ? op.banco_codigo : null, banco_agencia: ehTed ? op.banco_agencia : null, banco_conta: ehTed ? op.banco_conta : null,
      });
      itens.push({
        funcionario_nome: nomeOp,
        empresa_id: op.empresa_id ?? null,
        fonte: 'OP',
        fonte_rotulo: rotuloFonte.OP,
        temDoc: false,
        origem: null,
        rescisaoId: null,
        opId: op.id,
        contaPagarId: null,
        valor,
        cpf: String(op.cnpj_cpf_recebedora || '').replace(/\D/g, ''),
        metodo,
        pix_tipo: ehPix ? (op.chave_pix || null) : null,
        pix_chave: ehPix ? (op.dados_pagamento || null) : null,
        // Data de pagamento da OP é a própria data de vencimento dela, nunca
        // a digitada na tela de montagem do lote — ver enviarLoteAoBancoAction
        // e a exportação CNAB no front, que preferem este campo quando presente.
        dataPagamento: op.data_vencimento || null,
        banco_codigo: ehTed ? op.banco_codigo : null,
        banco_agencia: ehTed ? op.banco_agencia : null,
        banco_conta: ehTed ? op.banco_conta : null,
        banco_tipo: ehTed ? op.banco_tipo : null,
        // Só usado pra exibição quando não dá pra pagar automaticamente
        // (BOLETO, DINHEIRO, ou TRANSFERÊNCIA sem conta cadastrada) — mostra
        // ao usuário o que foi digitado na OP em vez do aviso genérico de
        // "sem dados bancários".
        nota: (!ehPix && !ehTed) ? [op.tipo_pagamento, op.dados_pagamento].filter(Boolean).join(': ') : null,
        alerta: alertaDadosOp,
        pronto: (ehPix || ehTed) && valor > 0 && !alertaDadosOp
      });
    });

    // CONTAS A PAGAR (P2S) — cada conta também é um item isolado, igual OP.
    // documento_fornecedor/pix_*/banco_* vêm de financeiro_contas_pagar (só
    // preenchidos manualmente na própria tela do lote — ver
    // salvarDadosPagamentoContaPagarAction — porque o PrimeStart não traz
    // esse dado, ver comentário no .sql da migração). Valor é o SALDO em
    // aberto (valor - valor_pago), não o valor original, pra contas pagas
    // parcialmente.
    contasPagarPendentes.forEach(c => {
      const temPix = !!c.pix_chave;
      const temConta = !!(c.banco_codigo && c.banco_agencia && c.banco_conta);
      const metodo = temPix ? 'PIX' : temConta ? 'TED' : 'SEM_DADOS';
      const saldo = Number(c.valor || 0) - Number(c.valor_pago || 0);
      // "(#id)" no fim garante nome único por linha (chaveEdit no front é
      // funcionario_nome+fonte) — sem isso, duas contas do mesmo fornecedor
      // com a mesma descrição (ex.: "VALE REFEIÇÃO" de dois meses em aberto
      // ao mesmo tempo) colidiriam e o toggle/edição de uma mexeria nas duas.
      const nomeContaPagar = c.fornecedor ? `${c.fornecedor} — ${c.descricao || 'Conta a pagar'} (#${c.id})` : `${c.descricao || 'Conta a pagar'} (#${c.id})`;
      const alertaDadosCp = metodo === 'SEM_DADOS' ? null : validarDadosPagamentoItem({
        funcionario_nome: nomeContaPagar, metodo,
        pix_tipo: temPix ? c.pix_tipo : null, pix_chave: temPix ? c.pix_chave : null,
        cpf: String(c.documento_fornecedor || '').replace(/\D/g, ''),
        banco_codigo: temConta ? c.banco_codigo : null, banco_agencia: temConta ? c.banco_agencia : null, banco_conta: temConta ? c.banco_conta : null,
      });
      itens.push({
        funcionario_nome: nomeContaPagar,
        empresa_id: payload.empresaId ?? null,
        fonte: 'CONTAS_PAGAR',
        fonte_rotulo: rotuloFonte.CONTAS_PAGAR,
        temDoc: false,
        origem: null,
        rescisaoId: null,
        opId: null,
        contaPagarId: c.id,
        valor: saldo,
        cpf: String(c.documento_fornecedor || '').replace(/\D/g, ''),
        metodo,
        pix_tipo: temPix ? c.pix_tipo : null,
        pix_chave: temPix ? c.pix_chave : null,
        // Vencimento da própria conta — mesmo papel de item.dataPagamento na
        // OP: usado no lugar da "Data de pagamento" digitada na tela, tanto
        // no filtro client-side (dentroDoFiltroData) quanto no envio/CNAB.
        dataPagamento: c.data_vencimento || null,
        banco_codigo: temConta ? c.banco_codigo : null,
        banco_agencia: temConta ? c.banco_agencia : null,
        banco_conta: temConta ? c.banco_conta : null,
        banco_tipo: temConta ? c.banco_tipo : null,
        nota: c.centro || null,
        alerta: alertaDadosCp,
        pronto: (temPix || temConta) && saldo > 0 && !alertaDadosCp
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
          RESCISAO: itens.filter(i => i.fonte === 'RESCISAO').reduce((s, i) => s + i.valor, 0),
          OP: itens.filter(i => i.fonte === 'OP').reduce((s, i) => s + i.valor, 0),
          CONTAS_PAGAR: itens.filter(i => i.fonte === 'CONTAS_PAGAR').reduce((s, i) => s + i.valor, 0)
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
        const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
        const { data: func } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', funcionarioNome).maybeSingle();
        if (!empresaPermitida(empresasPermitidas, func?.empresa_id)) {
          return { ok: false, erro: 'Você não tem permissão para processar OCR deste funcionário.' };
        }
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

// Digitação manual do valor (fallback de quando o OCR automático falha —
// ver ocrFalhas na tela) precisa gravar em folha_documentos_contabeis.valor_ocr,
// a MESMA coluna que processarOcrAwsAction grava. Sem isso, o valor digitado
// só existia no estado local desta tela (bom o bastante pra montar o lote de
// pagamento aqui), mas /admin/rh/holerite (Prévia PDF / envio pra assinatura)
// lê valor_ocr direto do banco e continuava vendo null — o RH digitava o
// valor, via ele entrar no lote certinho, e mesmo assim a prévia do holerite
// dizia "ainda não foi lido (OCR)", porque de fato nunca tinha sido gravado.
// Só atualiza se já existir uma linha do documento (nome+mês+tipo) — se não
// existir (ex.: fonte sem PDF de contabilidade nenhum), não faz nada.
export async function salvarValorOcrManualAction(payload: {
  funcionarioNome: string;
  mesReferencia: string;
  tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL' | 'DECIMO_TERCEIRO' | 'FERIAS';
  valor: number;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: func } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', payload.funcionarioNome).maybeSingle();
    if (!empresaPermitida(empresasPermitidas, func?.empresa_id)) {
      return { ok: false, erro: 'Você não tem permissão para editar o valor deste funcionário.' };
    }

    const { error } = await db.from('folha_documentos_contabeis')
      .update({ valor_ocr: payload.valor, ocr_processado_em: new Date().toISOString() })
      .eq('funcionario_nome', payload.funcionarioNome)
      .eq('mes_referencia', payload.mesReferencia)
      .eq('tipo', payload.tipo);
    if (error) throw new Error(error.message);

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
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
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let q = db
      .from('folha_documentos_contabeis')
      .select('funcionario_nome, tipo, storage_path, valor_ocr')
      .eq('mes_referencia', payload.mesReferencia)
      .eq('tipo', payload.tipo);
    if (empresasPermitidas) q = q.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    const { data: docs } = await q;
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
// Resolve a empresa "de verdade" (do banco, não do que o item possa trazer no
// payload) de cada item de um lote, pra revalidar a permissão de empresa antes
// de gravar/enviar. Itens de funcionário (FOLHA/ADIANTAMENTO/etc.) resolvem
// via folha_funcionarios pelo nome; itens de OP resolvem via
// op_ordens_pagamento pelo opId — nomes de favorecido de OP não existem
// nessa tabela, então cairiam sempre em "sem restrição" se reaproveitassem a
// mesma busca por nome.
// ============================================================================
async function construirResolvedorEmpresa(db: any, itens: any[]): Promise<(item: any) => number | null> {
  const nomesFunc = Array.from(new Set(itens.filter(i => i.fonte !== 'OP' && i.fonte !== 'CONTAS_PAGAR').map(i => i.funcionario_nome)));
  const opIds = Array.from(new Set(itens.filter(i => i.fonte === 'OP').map(i => i.opId).filter((v: any): v is string => v != null)));

  const [{ data: funcsLote }, { data: opsLote }] = await Promise.all([
    nomesFunc.length > 0
      ? db.from('folha_funcionarios').select('nome_completo, empresa_id').in('nome_completo', nomesFunc)
      : Promise.resolve({ data: [] }),
    opIds.length > 0
      ? db.from('op_ordens_pagamento').select('id, empresa_id').in('id', opIds)
      : Promise.resolve({ data: [] }),
  ]);

  const empresaPorNome: Record<string, number | null> = {};
  (funcsLote || []).forEach((f: any) => { empresaPorNome[f.nome_completo] = f.empresa_id; });
  const empresaPorOpId: Record<string, number | null> = {};
  (opsLote || []).forEach((o: any) => { empresaPorOpId[o.id] = o.empresa_id; });

  return (item: any): number | null => {
    if (item.fonte === 'OP') return item.opId != null ? (empresaPorOpId[item.opId] ?? null) : null;
    // CONTAS_PAGAR não tem coluna de empresa própria pra re-resolver contra o
    // banco (ver comentário em montarLoteSalariosAction) — diferente das
    // demais fontes, que sempre re-checam contra uma fonte independente do
    // payload do cliente, aqui não existe essa fonte independente, então
    // confiamos no item.empresa_id já validado uma vez na montagem
    // (payload.empresaId contra empresaPermitida).
    if (item.fonte === 'CONTAS_PAGAR') return item.empresa_id ?? null;
    return empresaPorNome[item.funcionario_nome] ?? null;
  };
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

    // Revalida no servidor a empresa de cada item — nunca confia no
    // empresa_id que possa ter vindo embutido no payload do cliente.
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (empresasPermitidas) {
      const resolverEmpresa = await construirResolvedorEmpresa(db, prontos);
      const foraDoEscopo = prontos.filter(i => !empresaPermitida(empresasPermitidas, resolverEmpresa(i)));
      if (foraDoEscopo.length > 0) {
        return { ok: false, erro: `Você não tem permissão para incluir no lote: ${foraDoEscopo.map(i => i.funcionario_nome).join(', ')}.` };
      }
    }

    const valorTotal = prontos.reduce((s, i) => s + Number(i.valor || 0), 0);

    // empresa_id do lote é derivado aqui, dos itens já validados acima — nunca
    // de um valor vindo do cliente. Só grava quando os itens são de UMA única
    // empresa (o normal, já que a tela exige escolher a empresa antes de
    // montar); se misturar empresas (ex.: admin com acesso a mais de uma) ou
    // não tiver empresa_id em nenhum item, fica NULL — mesmo critério de
    // "sem empresa definida" já usado no resto do sistema.
    const empresasDoLote = new Set(prontos.map(i => i.empresa_id).filter((v): v is number => v != null));
    const empresaIdLote = empresasDoLote.size === 1 ? [...empresasDoLote][0] : null;

    const { data, error } = await db.from('financeiro_lotes_pagamento').insert({
      parceiro: payload.parceiro,
      mes_referencia: payload.mesReferencia,
      tipo_lote: payload.tipoLote,
      nome_lote: payload.nomeLote || null,
      data_pagamento: payload.dataPagamento || null,
      empresa_id: empresaIdLote,
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
    // Inclui "itens" só pra filtrar por empresa quando o lote não tem
    // empresa_id próprio (histórico anterior à coluna, ou lote misto) — nunca
    // vai pro cliente (removido no map final); a tela só usa as colunas de resumo.
    let q = db.from('financeiro_lotes_pagamento')
      .select('id, parceiro, mes_referencia, tipo_lote, nome_lote, data_pagamento, empresa_id, qtd_pagamentos, valor_total, status, ativo, criado_por, criado_em, itens')
      .order('criado_em', { ascending: false });
    if (payload.mesReferencia) q = q.eq('mes_referencia', payload.mesReferencia);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // Caminho rápido: lote com empresa_id próprio (todo lote novo, desde que
    // a montagem passou a exigir escolher a empresa antes) usa direto essa
    // coluna. Lotes antigos sem ela (empresa_id NULL) caem no fallback:
    // legitimamente podem misturar empresas (ver buscarLoteAction), então só
    // ficam de fora se NENHUM item pertencer a uma empresa permitida —
    // itens sem empresa_id (histórico) contam como visíveis.
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const visiveis = empresasPermitidas === null
      ? (data || [])
      : (data || []).filter(l => {
          if (l.empresa_id != null) return empresaPermitida(empresasPermitidas, l.empresa_id);
          const itens = Array.isArray(l.itens) ? l.itens : [];
          if (itens.length === 0) return true;
          return itens.some((i: any) => empresaPermitida(empresasPermitidas, i?.empresa_id));
        });

    return { ok: true, info: { lotes: visiveis.map(l => ({ ...l, itens: undefined, ativo: l.ativo ?? true })) } };
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
    const { data, error } = await db.from('financeiro_lotes_pagamento')
      .select('id, nome_lote, tipo_lote, mes_referencia, itens')
      .eq('id', payload.loteId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, erro: 'Lote não encontrado.' };

    // Redige os itens de funcionários fora do escopo do usuário logado — um
    // lote pode legitimamente misturar empresas (quem o gerou pode ter
    // acesso a mais de uma), mas quem só enxerga Rentech não pode ver linhas
    // (nome + dados bancários) de funcionários da AlfaLight e vice-versa.
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let itensVisiveis = Array.isArray(data.itens) ? data.itens : [];
    if (empresasPermitidas) {
      const nomesLote = Array.from(new Set(itensVisiveis.map((i: any) => i.funcionario_nome)));
      const { data: funcsLote } = await db.from('folha_funcionarios').select('nome_completo, empresa_id').in('nome_completo', nomesLote);
      const empresaPorNome: Record<string, number | null> = {};
      (funcsLote || []).forEach(f => { empresaPorNome[f.nome_completo] = f.empresa_id; });
      itensVisiveis = itensVisiveis.filter((i: any) =>
        empresaPermitida(empresasPermitidas, i.empresa_id !== undefined ? i.empresa_id : empresaPorNome[i.funcionario_nome])
      );
    }

    return { ok: true, info: { lote: { ...data, itens: itensVisiveis } } };
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
    const { data: lote, error: buscaErr } = await db.from('financeiro_lotes_pagamento')
      .select('nome_lote, tipo_lote, mes_referencia, itens').eq('id', payload.loteId).maybeSingle();
    if (buscaErr) throw new Error(buscaErr.message);
    if (!lote) return { ok: false, erro: 'Lote não encontrado.' };

    // Diferente de abrir/listar (que só redigem as linhas fora do escopo),
    // inativar/reativar afeta o lote inteiro — exige acesso a TODAS as
    // empresas presentes nele, mesmo critério usado ao criar (salvarLoteAction).
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (empresasPermitidas !== null) {
      const itens = Array.isArray(lote.itens) ? lote.itens : [];
      const foraDoEscopo = itens.some((i: any) => !empresaPermitida(empresasPermitidas, i?.empresa_id));
      if (foraDoEscopo) {
        return { ok: false, erro: 'Você não tem permissão para alterar este lote — ele inclui funcionário(s) de outra empresa.' };
      }
    }

    const { error } = await db.from('financeiro_lotes_pagamento').update({ ativo: payload.ativo }).eq('id', payload.loteId);
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
    const { data: lote, error: loteErr } = await db.from('financeiro_lotes_pagamento')
      .select('id, parceiro, mes_referencia, tipo_lote, itens, status').eq('id', payload.loteId).maybeSingle();
    if (loteErr) throw new Error(loteErr.message);
    if (!lote) return { ok: false, erro: 'Lote não encontrado.' };
    if (lote.status === 'ENVIANDO') {
      return { ok: false, erro: 'Este lote já está sendo enviado neste momento. Aguarde terminar e atualize a tela.' };
    }

    if (lote.parceiro !== 'ITAU') {
      return {
        ok: false,
        erro: `Envio direto à API ainda não implementado para ${lote.parceiro}. Use a exportação do lote.`
      };
    }

    const { data: integ } = await db.from('parametros_integracoes')
      .select('ativo, ambiente, config, empresa_id').eq('parceiro', 'ITAU').maybeSingle();
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
    // A Especificação Técnica só lista "Fornecedores"/"Diversos" como domínio
    // válido de ENTRADA para o POST /transferencias — ajustável via
    // config.modulo_sispag se o Itaú orientar diferente pro cadastro. Testes
    // empíricos (2026-08-27) mostraram que o Itaú reclassifica pra "CONTAS"
    // no eco da resposta independente do que mandamos aqui — mas mantemos
    // esse valor consistente entre pagador e recebedor pra não confundir um
    // teste com o outro.
    const moduloSispag: 'Fornecedores' | 'Diversos' = cfg.modulo_sispag === 'Diversos' ? 'Diversos' : 'Fornecedores';
    // CONFIRMADO EM PRODUÇÃO (2026-09-17): pagador.conta precisava do
    // prefixo "00" na frente de conta+dígito (ex.: "00093124") pra o
    // pagamento nascer vinculado a um operador e conseguir ser aprovado —
    // chamado de "código de beneficiário" pelo time técnico do Itaú, não
    // documentado em lugar nenhum do schema oficial. A causa raiz de toda a
    // investigação "pagamento não aparece pra aprovar" (desde 2026-08-10)
    // era exatamente isso.
    // POR DECISÃO DO USUÁRIO (2026-09-17): esse prefixo NÃO é mais aplicado
    // aqui no código — ele mesmo mantém `config.conta_debito` (tela
    // Integrações → ⚙ Configurar Itaú) já com o "00" incluso quando precisar
    // (ex.: "0009312-4"), pra ter controle direto sem precisar mexer em
    // código. Não reintroduzir a concatenação automática aqui, senão o
    // prefixo duplica.
    const pagador: PagadorSispag = {
      tipo_conta: 'CC',
      agencia: limpaNum(cfg.agencia_debito),
      conta: limpaNum(contaBase) + limpaNum(dacBase || ''),
      tipo_pessoa: 'J',
      documento: limpaNum(cfg.cnpj),
      modulo_sispag: moduloSispag,
    };

    const itens: any[] = Array.isArray(lote.itens) ? lote.itens : [];

    // Nunca envia dinheiro para um funcionário fora das empresas que o
    // usuário logado enxerga — mesma revalidação de buscarLoteAction, mas
    // aqui bloqueando o próprio envio, não só a leitura.
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const resolverEmpresaItem = await construirResolvedorEmpresa(db, itens);
    const empresaDoItem = (i: any) => (i.empresa_id !== undefined && i.empresa_id !== null ? i.empresa_id : resolverEmpresaItem(i));
    let itensElegiveis = itens;
    if (empresasPermitidas) {
      itensElegiveis = itens.filter((i: any) => empresaPermitida(empresasPermitidas, empresaDoItem(i)));
    }

    // A conta de débito (pagador) é a da integração ITAÚ, que pertence a UMA
    // empresa. Com multi-empresa, um lote misto poderia pagar funcionário de
    // outra empresa saindo do caixa desta — dinheiro certo, CNPJ errado.
    // Bloqueia só quando dá pra afirmar: item e integração com empresa_id
    // preenchidos e diferentes (item legado sem empresa_id continua passando,
    // pra não travar lote antigo).
    const itensDeOutraEmpresa = integ.empresa_id == null ? [] : itensElegiveis.filter((i: any) => {
      const empresaItem = empresaDoItem(i);
      return empresaItem != null && empresaItem !== integ.empresa_id;
    });
    if (itensDeOutraEmpresa.length > 0) {
      const nomes = [...new Set(itensDeOutraEmpresa.map((i: any) => i.funcionario_nome))].slice(0, 5).join(', ');
      return {
        ok: false,
        erro: `Este lote tem ${itensDeOutraEmpresa.length} pagamento(s) de funcionários de OUTRA empresa (${nomes}${itensDeOutraEmpresa.length > 5 ? '…' : ''}), mas a conta de débito configurada no Itaú pertence a uma empresa diferente. Monte um lote por empresa para não pagar pelo CNPJ errado.`
      };
    }

    // 'TED' aqui só indica "sem chave PIX cadastrada, mas tem conta" — desde
    // que passamos a suportar Pix por dados bancários (agência+conta+ISPB),
    // esses itens também vão via API, não só pelo CNAB manual.
    const pendentes = itensElegiveis.filter(i => i.pronto && (i.metodo === 'PIX' || i.metodo === 'TED') && !STATUS_PIX_SUCESSO.includes(i.api_status));
    if (pendentes.length === 0) {
      return { ok: false, erro: 'Nenhum pagamento pendente de envio neste lote (já enviados com sucesso, sem PIX/conta bancária cadastrados, ou fora das empresas que você tem permissão para pagar).' };
    }

    // TRAVA CONTRA ENVIO SIMULTÂNEO. O loop abaixo leva ~1s por item (um lote
    // de 19 levou 18s) e só grava os itens no fim — sem trava, dois cliques
    // concorrentes (duas abas, duas pessoas do financeiro) leriam o mesmo
    // estado inicial, os DOIS mandariam os pagamentos ao banco e o segundo
    // write sobrescreveria o primeiro: pagamento em dobro, de dinheiro real.
    // A idempotência por api_status só protege entre execuções sequenciais.
    // O update condicional abaixo é atômico no Postgres: só uma execução
    // consegue marcar ENVIANDO, a outra recebe 0 linhas e para aqui.
    const { data: travou, error: travaErr } = await db.from('financeiro_lotes_pagamento')
      .update({ status: 'ENVIANDO' })
      .eq('id', payload.loteId).neq('status', 'ENVIANDO')
      .select('id');
    if (travaErr) throw new Error(travaErr.message);
    if (!travou || travou.length === 0) {
      return { ok: false, erro: 'Este lote já está sendo enviado neste momento (por você em outra aba, ou por outra pessoa). Aguarde o envio terminar e atualize a tela antes de tentar de novo.' };
    }

    // CORRENTE/POUPANCA (domínio do cadastro do funcionário) -> CC/PP
    // (domínio do SISPAG: CC Conta Corrente, CP Conta Pagamento, PP Conta
    // Poupança — confirmado na Especificação Técnica). Funcionário nunca
    // cadastra "Conta Pagamento", por isso não há opção pra CP aqui.
    const tipoContaSispag = (bancoTipo: string | null): 'CC' | 'PP' => bancoTipo === 'POUPANCA' ? 'PP' : 'CC';

    // Texto livre que vai pro SISPAG (comprovante/mensagem ao recebedor) sem
    // acento nem caractere especial. O backend do SISPAG é mainframe — o
    // próprio Itaú devolve os nomes já sem acento ("RENTECH LOCACAO DE
    // EQUIPAME...") — e a exportação CNAB daqui já fazia essa limpeza
    // (formataTexto em /admin/financeiro/rh); só o caminho da API mandava o
    // texto cru. Hoje 2 funcionários têm acento no nome (ISMAEL DAMIÃO,
    // GILMASIO ELISBÃO), então isso já valia pra folha real.
    const textoSispag = (s: string, limite: number): string =>
      String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9 .,\-/#]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limite);

    // agencia_recebedor tem maxLength 4 no schema. Hoje nenhum funcionário
    // tem agência maior que isso, mas um cadastro novo com dígito verificador
    // junto (ex.: "1234-5") viraria 5 dígitos e estouraria o campo — corta nos
    // 4 primeiros, que é a agência de fato.
    const agenciaSispag = (v: string) => String(v || '').replace(/\D/g, '').slice(0, 4);

    // SISPAG exige conta com exatamente 8 dígitos (conta+dígito, preenchida
    // com zero à esquerda quando faltar) — confirmado em produção 2026-09-17
    // pro pagador (por isso o "00" na frente de "093124") e reconfirmado
    // 2026-09-17 pelo usuário que a mesma regra vale pro recebedor pago por
    // agência+conta (dados bancários, não chave Pix).
    const contaSispag = (v: string) => String(v || '').replace(/\D/g, '').padStart(8, '0');

    // TESTADO E DESCARTADO (2026-09-04): mandamos data_pagamento como
    // datetime completo ("yyyy-MM-ddT00:00:00.000Z"), sugestão do time
    // técnico do Itaú — a API devolveu HTTP 500 "Erro de Processamento
    // Interno". Confirma o schema oficial (format:"date", só "yyyy-MM-dd"),
    // que é o que dataPagamentoItem já vem formatado do front.
    let sucesso = 0, rejeitado = 0, comErro = 0;
    try {
    for (const item of pendentes) {
      // Trava de segurança ANTES de gastar uma tentativa de API: revalida o
      // formato dos dados mesmo que o item já estivesse "pronto" na
      // montagem — cobre edição manual depois de montar (ex.: chave PIX
      // digitada errado na edição inline de Contas a Pagar). Ver comentário
      // de validarDadosPagamentoItem no topo do arquivo.
      const erroValidacao = validarDadosPagamentoItem(item);
      if (erroValidacao) {
        item.api_status = 'Erro'; item.api_erro = erroValidacao; item.api_enviado_em = new Date().toISOString();
        comErro++;
        continue;
      }

      // referencia_empresa: maxLength 20 no schema oficial.
      const referencia_empresa = textoSispag(`FOLHA ${lote.mes_referencia}`, 20);
      const identificacao_comprovante = textoSispag(`Pagamento - ${item.funcionario_nome}`, 100);
      const informacoes_entre_usuarios = textoSispag(`Pagamento de ${item.fonte_rotulo || 'folha'} - ${lote.mes_referencia}`, 100);
      // Itens de OP usam a própria data de vencimento (item.dataPagamento),
      // nunca a data digitada na tela de montagem do lote — ver
      // montarLoteSalariosAction, onde esse campo é preenchido só pra OP.
      const dataPagamentoItem = item.dataPagamento || payload.dataPagamento;

      let resultado;
      if (item.pix_chave) {
        resultado = await enviarPixPorChave({
          ambiente: ambienteItau,
          valor_pagamento: Number(item.valor || 0),
          // Data pura "yyyy-MM-dd" — confirmado na Especificação Técnica
          // (format:"date") e por teste real (datetime completo deu 500).
          data_pagamento: dataPagamentoItem,
          chave: chavePixParaEnvio(item),
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
          data_pagamento: dataPagamentoItem,
          ispb,
          tipo_identificacao_conta: tipoContaSispag(item.banco_tipo),
          agencia_recebedor: agenciaSispag(item.banco_agencia),
          // SISPAG espera conta com exatamente 8 dígitos (mesma regra
          // confirmada em produção pra pagador.conta — ver comentário acima
          // sobre o "código de beneficiário"), preenchidos com zero à
          // esquerda quando a conta do funcionário tiver menos dígitos.
          conta_recebedor: contaSispag(item.banco_conta),
          // Era fixo 'F' (pessoa física) — passava despercebido porque só
          // funcionário e OP usavam este caminho, quase sempre PF. Contas a
          // Pagar (P2S) muda isso: fornecedor pago por agência/conta é
          // tipicamente PJ (concessionária, prestador de serviço etc.) — CNPJ
          // (14 dígitos) com tipo 'F' teria boa chance de ser rejeitado pelo
          // Itaú. Deriva do tamanho do documento em vez de assumir.
          tipo_de_identificacao_do_recebedor: String(item.cpf || '').replace(/\D/g, '').length > 11 ? 'J' : 'F',
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
          // OP também não é escopada por mês, mas "Sucesso" aqui é só a API
          // aceitando o PEDIDO — pagamentos SISPAG ainda passam por aprovação
          // manual no Itaú Empresas antes de serem efetivados de verdade (ver
          // consultarStatusAtualItauAction). Por isso NÃO grava
          // status='PAGO' automaticamente — isso continua sendo confirmação
          // humana (botão "Baixar OP" em /admin/financeiro/ops, ou
          // conciliação com o PrimeStart). pago_em só evita que a mesma OP
          // reapareça num próximo lote e seja paga em dobro.
          if (item.fonte === 'OP' && item.opId) {
            await db.from('op_ordens_pagamento')
              .update({ pago_em: new Date().toISOString(), pago_lote_id: payload.loteId })
              .eq('id', item.opId);
          }
          // Mesmo raciocínio da OP: FlagQuitado no PrimeStart só muda quando
          // alguém baixa a conta manualmente lá (ou no próximo sync, se isso
          // já tiver acontecido) — pago_em aqui é só a nossa própria trava
          // contra reenvio, independente disso.
          if (item.fonte === 'CONTAS_PAGAR' && item.contaPagarId) {
            await db.from('financeiro_contas_pagar')
              .update({ pago_em: new Date().toISOString(), pago_lote_id: payload.loteId })
              .eq('id', item.contaPagarId);
          }
        } else {
          rejeitado++;
        }
      }
    }
    } catch (erroLoop: any) {
      // Se estourar no meio do loop, alguns itens já podem ter sido enviados
      // de verdade ao banco — grava o que já foi processado (senão o lote
      // ficaria dizendo "não enviado" com dinheiro já em trânsito) e libera a
      // trava, que senão deixaria o lote preso em ENVIANDO pra sempre.
      await db.from('financeiro_lotes_pagamento')
        .update({ itens, status: sucesso > 0 ? 'ENVIADO' : 'ERRO' }).eq('id', payload.loteId);
      throw erroLoop;
    }

    const novoStatus = sucesso > 0 ? 'ENVIADO' : 'ERRO';
    const { error: updErr } = await db.from('financeiro_lotes_pagamento')
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
// CONSULTAR STATUS ATUAL NO ITAÚ — o api_status salvo em financeiro_lotes_pagamento
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

  try {
    const ctx = await contextoEnvioItau();
    if (!ctx.ok) return { ok: false, erro: ctx.erro };

    const { status, ok, data } = await consultarPagamentoSispag(ctx.ambiente, payload.idPagamentoSispag);
    if (!ok) {
      return { ok: false, erro: `Consulta rejeitada pela API do Itaú (HTTP ${status}): ${data?.mensagem || 'sem detalhe.'}` };
    }
    // Mesmo embrulho extra "data" dos outros endpoints do SISPAG — ver nota
    // em app/admin/financeiro/integracao/actions.ts.
    const pagamento = data?.data ?? data;

    registrarLogAuditoria({
      usuario_nome: acesso.perfil.nome,
      acao: `CONSULTOU STATUS ATUAL NO ITAÚ (SISPAG ${payload.idPagamentoSispag})`,
      setor: 'FINANCEIRO / RH',
    });

    return { ok: true, info: { ambiente: ctx.ambiente, pagamento } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Ambiente + validações da integração ITAÚ, compartilhado pelas ações que
// falam com a API (consulta de status e reabertura de item). O envio do lote
// faz as mesmas checagens inline porque precisa também do `config` pro
// pagador.
async function contextoEnvioItau(): Promise<{ ok: true; ambiente: 'SANDBOX' | 'PRODUCAO' } | { ok: false; erro: string }> {
  const db = supabaseAdmin();
  const { data: integ } = await db.from('parametros_integracoes')
    .select('ativo, ambiente').eq('parceiro', 'ITAU').maybeSingle();
  if (!integ) return { ok: false, erro: 'Integração com o Itaú não encontrada (ver Integrações).' };
  if (!integ.ativo) return { ok: false, erro: 'A integração com o Itaú não está ativa (ver Integrações → ⚙ Configurar).' };
  const ambiente: 'SANDBOX' | 'PRODUCAO' = integ.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'SANDBOX';
  if (!credenciaisItauConfiguradas(ambiente)) {
    return { ok: false, erro: `Credenciais da API do Itaú não configuradas no servidor para o ambiente ${ambiente}.` };
  }
  return { ok: true, ambiente };
}

// ============================================================================
// REABRIR ITEM PARA REENVIO — conserta a armadilha do "Sucesso" que não é
// pagamento: `api_status: 'Sucesso'` só diz que a API aceitou a inclusão, mas
// o pagamento ainda pode ser recusado/expirar depois no Itaú (já aconteceu:
// lotes inteiros viraram "Não Efetuado / Pagamento expirado"). Quando isso
// acontecia, o item ficava preso pra sempre:
//   - enviarLoteAoBancoAction pula itens com api_status de sucesso;
//   - montarLoteSalariosAction exclui OP/rescisão com pago_em preenchido.
// Ou seja: ninguém recebia e o sistema mostrava "pago". Esta ação desfaz esse
// estado, mas SÓ depois de confirmar na API do Itaú que o pagamento realmente
// falhou — nunca com base no que está salvo no nosso banco, pra não haver
// risco de reabrir (e repagar) algo que na verdade foi efetivado.
// ============================================================================
const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Só estes status contam como "falhou de vez" e liberam o reenvio. Qualquer
// outro (inclusive "Pendente de autorização" e "Efetuado") bloqueia.
const STATUS_ITAU_FALHA = ['nao efetuado', 'rejeitado', 'cancelado', 'estornado'];

export async function reabrirItemParaReenvioAction(
  payload: { loteId: number; idPagamentoSispag: string; usuarioNome: string },
  accessToken: string
): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const ctx = await contextoEnvioItau();
    if (!ctx.ok) return { ok: false, erro: ctx.erro };

    const { data: lote, error: loteErr } = await db.from('financeiro_lotes_pagamento')
      .select('id, mes_referencia, itens, status').eq('id', payload.loteId).maybeSingle();
    if (loteErr) throw new Error(loteErr.message);
    if (!lote) return { ok: false, erro: 'Lote não encontrado.' };

    const itens: any[] = Array.isArray(lote.itens) ? lote.itens : [];
    const item = itens.find(i => i.api_cod_pagamento === payload.idPagamentoSispag);
    if (!item) return { ok: false, erro: 'Pagamento não encontrado neste lote.' };

    // Confere o estado REAL no banco antes de liberar qualquer reenvio.
    const { ok, status, data } = await consultarPagamentoSispag(ctx.ambiente, payload.idPagamentoSispag);
    if (!ok) {
      return { ok: false, erro: `Não foi possível confirmar o status atual no Itaú (HTTP ${status}) — reabertura cancelada por segurança.` };
    }
    const dadosPagamento = (data?.data ?? data)?.dados_pagamento;
    const statusItau = String(dadosPagamento?.status || '');
    if (!STATUS_ITAU_FALHA.includes(semAcento(statusItau))) {
      return {
        ok: false,
        erro: `O Itaú informa que este pagamento está como "${statusItau || 'desconhecido'}" — só é possível reabrir pagamentos que falharam de vez (Não Efetuado, Rejeitado, Cancelado ou Estornado). Se ele ainda está pendente de autorização, aprove ou cancele no Itaú Empresas primeiro.`
      };
    }

    // Guarda a tentativa anterior antes de limpar, pra não perder o rastro do
    // que foi enviado (inclusive o motivo real da falha).
    item.api_tentativas_anteriores = [
      ...(Array.isArray(item.api_tentativas_anteriores) ? item.api_tentativas_anteriores : []),
      {
        api_status: item.api_status ?? null,
        api_cod_pagamento: item.api_cod_pagamento ?? null,
        api_numero_lote: item.api_numero_lote ?? null,
        api_enviado_em: item.api_enviado_em ?? null,
        api_erro: item.api_erro ?? null,
        status_final_itau: statusItau,
        motivo_final_itau: dadosPagamento?.motivo_rejeicao ?? null,
        reaberto_em: new Date().toISOString(),
        reaberto_por: payload.usuarioNome,
      },
    ];
    item.api_status = null;
    item.api_cod_pagamento = null;
    item.api_numero_lote = null;
    item.api_motivo_recusa = null;
    item.api_erro = null;
    item.api_enviado_em = null;
    item.api_resposta_bruta = null;

    // Devolve OP/rescisão/conta a pagar pro estado "a pagar" — sem isso elas
    // continuariam marcadas como pagas e nunca voltariam a aparecer num lote novo.
    if (item.fonte === 'RESCISAO' && item.rescisaoId) {
      await db.from('folha_rescisoes').update({ pago_em: null, pago_lote_id: null }).eq('id', item.rescisaoId);
    }
    if (item.fonte === 'OP' && item.opId) {
      await db.from('op_ordens_pagamento').update({ pago_em: null, pago_lote_id: null }).eq('id', item.opId);
    }
    if (item.fonte === 'CONTAS_PAGAR' && item.contaPagarId) {
      await db.from('financeiro_contas_pagar').update({ pago_em: null, pago_lote_id: null }).eq('id', item.contaPagarId);
    }

    const aindaTemSucesso = itens.some(i => STATUS_PIX_SUCESSO.includes(i.api_status));
    const { error: updErr } = await db.from('financeiro_lotes_pagamento')
      .update({ itens, status: aindaTemSucesso ? lote.status : 'GERADO' })
      .eq('id', payload.loteId);
    if (updErr) throw new Error(updErr.message);

    await registrarLogAuditoria({
      usuario_nome: payload.usuarioNome,
      acao: `REABERTURA DE PAGAMENTO PARA REENVIO (LOTE #${payload.loteId}, ${item.funcionario_nome}, ${payload.idPagamentoSispag}): status no Itaú era "${statusItau}"`,
      setor: 'FINANCEIRO / RH'
    });

    return { ok: true, info: { statusItau, funcionario: item.funcionario_nome } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// DETALHES DE UMA OP (popup "ver" na linha do lote, fonte 'OP') — gatilhada
// pela mesma permissão de /admin/financeiro/rh, não pela de
// /admin/op/responsavel ou /admin/financeiro/ops (buscarOP, em
// app/admin/op/actions.ts): quem já vê a linha da OP no lote (montada por
// montarLoteSalariosAction, sob esta mesma rota) precisa poder abrir o
// detalhe sem esbarrar numa permissão de outro módulo que talvez não tenha.
// ============================================================================
export async function buscarDetalhesOPAction(payload: { opId: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: op, error } = await db.from('op_ordens_pagamento')
      .select('*').eq('id', payload.opId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!op) return { ok: false, erro: 'OP não encontrada.' };

    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, op.empresa_id)) {
      return { ok: false, erro: 'Você não tem permissão para ver esta OP.' };
    }

    return { ok: true, info: { op } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
