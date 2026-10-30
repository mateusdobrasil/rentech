'use server';

// app/admin/rh/actions-assinatura.ts
// Orquestra o envio de holerites para assinatura na Autentique.
// - exige folha FECHADA (usa o snapshot congelado como fonte da verdade)
// - gera o PDF no servidor (lib/gerarHoleritePdf)
// - grava o controle em folha_holerite_assinaturas (service role)
// - chama o cliente da Autentique (lib/autentique)
import { supabaseAdmin } from '../../../lib/supabase';
import { indexarFeriados, feriadosDaEmpresa } from '../../../lib/feriados';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { autentiqueCriarDocumento, autentiqueConsultarDocumento, autentiqueCancelarDocumento } from '../../../lib/autentique';
import { gerarHoleritePdf } from '../../../lib/gerarHoleritePdf';
import { gerarEspelhoPontoPdf, RegistroPontoDia } from '../../../lib/gerarEspelhoPontoPdf';
import { gerarReciboPdf } from '../../../lib/gerarReciboPdf';
import { gerarResumoRecebimentosPdf, LinhaResumo, OpResumo } from '../../../lib/gerarResumoRecebimentosPdf';
import { mergePdfs } from '../../../lib/mergePdf';
import { normalizarItensOP } from '../../op/utils';
import { contextoEnvioItau, consultarPagamentoSispag, semAcento, STATUS_ITAU_EFETUADO } from '../../../lib/itauSispag';
import { gravarStatusItauItemLote } from '../../../lib/loteStatusItau';
import { categoriaMeio, inicioDaCompetencia } from '../../../lib/beneficiosGeracoes';
import { calcularBeneficiosMes } from './actions-beneficios';
import { baixarAssinado } from './assinaturaDownloadCore';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET_DOCS = 'documentos-folha';

// Rotas que usam este arquivo: /admin/rh/assinaturas (fluxo principal),
// /admin/rh/holerite (envio avulso a partir da tela de holerite) e
// /admin/rh/relatorios (reenvio/consulta pontual).
const ROTAS_PERMITIDAS = ['/admin/rh/assinaturas', '/admin/rh/holerite', '/admin/rh/relatorios'];

async function validarAcessoQualquerRota(accessToken: string) {
  for (const rota of ROTAS_PERMITIDAS) {
    const acesso = await validarAcesso(accessToken, rota);
    if (acesso.ok) return acesso;
  }
  return { ok: false as const, message: 'Você não tem permissão para executar esta ação.' };
}

const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

// Nome da empresa pra estampar nos PDFs (holerite/espelho/recibo) \u2014 antes
// fixo em 'RENTECH', agora resolvido pelo empresa_id real do funcion\u00e1rio
// (necess\u00e1rio pra AlfaLight n\u00e3o sair com documentos dizendo "RENTECH").
// Funcion\u00e1rio sem empresa definida cai no fallback hist\u00f3rico.
async function nomeEmpresaDoFuncionario(db: ReturnType<typeof supabaseAdmin>, empresaId: number | null | undefined): Promise<string> {
  if (!empresaId) return 'RENTECH';
  const { data } = await db.from('empresas').select('nome').eq('id', empresaId).maybeSingle();
  return data?.nome || 'RENTECH';
}

// Lista funcionários ativos (para o seletor do envio avulso)
export async function listarFuncionariosAtivosAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let q = db
      .from('folha_funcionarios')
      .select('nome_completo, cpf, celular, email')
      .eq('ativo', true)
      .order('nome_completo');
    if (empresasPermitidas) q = q.in('empresa_id', empresasPermitidas);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, info: { funcionarios: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Busca um anexo da contabilidade no Storage; retorna null se não existir.
async function baixarAnexoContabil(
  db: ReturnType<typeof supabaseAdmin>,
  mesReferencia: string,
  tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL',
  funcionarioNome: string
): Promise<Uint8Array | null> {
  // Confirma no banco que há registro (evita chamada de Storage à toa)
  const { data: reg } = await db
    .from('folha_documentos_contabeis')
    .select('storage_path')
    .eq('funcionario_nome', funcionarioNome)
    .eq('mes_referencia', mesReferencia)
    .eq('tipo', tipo)
    .maybeSingle();
  if (!reg?.storage_path) return null;

  const { data, error } = await db.storage.from(BUCKET_DOCS).download(reg.storage_path);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

// Monta o espelho de ponto do mês (batidas + abonos) e gera o PDF. Retorna
// null se não houver nenhum registro de ponto/abono naquele mês — nesse caso
// simplesmente não anexa (não bloqueia o envio).
async function gerarEspelhoPontoBytes(
  db: ReturnType<typeof supabaseAdmin>,
  funcionarioNome: string,
  cpf: string | null,
  mesReferencia: string,
  dataAdmissao?: string | null,
  dataDesligamento?: string | null,
  empresaNome: string = 'RENTECH',
  // Feriado municipal vale só para a empresa daquela cidade — sem isto, o
  // espelho de quem é de Osasco zeraria a carga num feriado de São Paulo.
  empresaId: number | null = null
): Promise<Uint8Array | null> {
  const [ano, mes] = mesReferencia.split('-');
  const dataInicio = `${ano}-${mes}-01`;
  const dataFim = `${ano}-${mes}-${new Date(Number(ano), Number(mes), 0).getDate()}`;

  const [{ data: pontoData }, { data: abonoData }, { data: fData }] = await Promise.all([
    db.from('folha_ponto_diaria')
      .select('data_registro, minutos_trabalhados, entrada_1, saida_1, entrada_2, saida_2')
      .eq('funcionario_nome', funcionarioNome)
      .gte('data_registro', dataInicio).lte('data_registro', dataFim),
    db.from('folha_ponto_abono')
      .select('data_abono, minutos_abonados, motivo')
      .eq('funcionario_nome', funcionarioNome)
      .gte('data_abono', dataInicio).lte('data_abono', dataFim),
    db.from('folha_feriados').select('*')
  ]);

  if ((!pontoData || pontoData.length === 0) && (!abonoData || abonoData.length === 0)) return null;

  const porDia: Record<string, RegistroPontoDia> = {};
  (pontoData || []).forEach((r: any) => {
    porDia[r.data_registro] = {
      data: r.data_registro, entrada_1: r.entrada_1, saida_1: r.saida_1,
      entrada_2: r.entrada_2, saida_2: r.saida_2,
      minutosTrabalhados: r.minutos_trabalhados || 0, minutosAbonados: 0, motivoAbono: null
    };
  });
  (abonoData || []).forEach((a: any) => {
    if (!porDia[a.data_abono]) {
      porDia[a.data_abono] = {
        data: a.data_abono, entrada_1: null, saida_1: null, entrada_2: null, saida_2: null,
        minutosTrabalhados: 0, minutosAbonados: 0, motivoAbono: null
      };
    }
    porDia[a.data_abono].minutosAbonados = a.minutos_abonados || 0;
    porDia[a.data_abono].motivoAbono = a.motivo || null;
  });

  return gerarEspelhoPontoPdf({
    nome: funcionarioNome,
    cpf,
    mesReferencia,
    registros: Object.values(porDia),
    feriados: [...feriadosDaEmpresa(indexarFeriados(fData), empresaId)],
    dataAdmissao,
    dataDesligamento,
    empresaNome
  });
}

// Deduz a forma de pagamento a partir da ficha (mesma lógica em toda a
// função: PIX cadastrado > dados bancários cadastrados > "a combinar").
function deduzirFormaPagamento(func: { pix_chave?: string | null; banco_conta?: string | null } | null): string {
  if (func?.pix_chave) return 'PIX';
  if (func?.banco_conta) return 'Transferência bancária';
  return 'A combinar';
}

// Valor do holerite de pagamento da contabilidade (tipo HOLERITE_MENSAL, não
// ADIANTAMENTO), já extraído por OCR e cacheado em folha_documentos_contabeis
// (ver actions-financeiro.ts). null se o documento não existe ou o OCR ainda
// não rodou para ele.
async function buscarValorOcrPagamento(
  db: ReturnType<typeof supabaseAdmin>,
  funcionarioNome: string,
  mesReferencia: string
): Promise<number | null> {
  const { data } = await db
    .from('folha_documentos_contabeis')
    .select('valor_ocr')
    .eq('funcionario_nome', funcionarioNome)
    .eq('mes_referencia', mesReferencia)
    .eq('tipo', 'HOLERITE_MENSAL')
    .maybeSingle();
  return data?.valor_ocr != null ? Number(data.valor_ocr) : null;
}

// Quando o contrato tem "paga_salario_base" desligado (o parâmetro "Exibir
// Salário Base no Holerite?" em /admin/rh/parametros), o salário base NÃO
// entra no cálculo da nossa folha (montarDadosHolerite zera salarioBaseExibido)
// — ele é pago à parte, pelo holerite da contabilidade. O sinal de verdade de
// que o contrato de fato recebe esse holerite externo é a flag dedicada
// `recebe_holerite_contabilidade` da regra (mesma usada em SepararHolerites.tsx
// para decidir quem entra no fluxo de importação de holerites da contabilidade)
// — NÃO o campo salario_folha do funcionário, que é só um valor de referência
// para cálculo de hora extra/faltas e pode legitimamente estar zerado (ex.:
// funcionário cadastrado sem esse campo preenchido), o que antes fazia o
// gatilho falhar silenciosamente e o recibo sair sem o valor pago pela
// contabilidade.
function precisaHoleriteContabilidade(dados: any): boolean {
  return dados?.regra?.paga_salario_base === false && dados?.regra?.recebe_holerite_contabilidade !== false;
}

// Nesse caso o funcionário recebe os DOIS pagamentos, então o recibo (que é a
// quitação de tudo) precisa somar valorLiquidoReceber (só os extras/benefícios
// calculados por nós) com o valor real do holerite de pagamento, lido do OCR
// (valorOcrPagamento).
function calcularValorRecibo(dados: any, valorOcrPagamento: number | null): number {
  const base = dados?.valorLiquidoReceber || 0;
  const complementoHoleriteContabil = precisaHoleriteContabilidade(dados) ? (valorOcrPagamento || 0) : 0;
  return base + complementoHoleriteContabil;
}

// Discrimina de onde vem o valor total do recibo (soma sempre = calcularValorRecibo
// acima) — puramente para transparência no PDF, não afeta o cálculo em si.
function montarDetalhamentoRecibo(
  soDocumental: boolean | undefined,
  valorLiquidoReceber: number,
  gatilhoDoisPagamentos: boolean,
  valorOcrPagamento: number | null,
  valorManual: number | undefined
): { descricao: string; valor: number }[] {
  if (soDocumental) {
    return [{
      descricao: valorManual !== undefined ? 'Valor informado manualmente' : 'Holerite pago pela contabilidade',
      valor: valorManual ?? valorOcrPagamento ?? 0
    }];
  }
  const itens = [{ descricao: 'Salário líquido — Holerite Rentech', valor: valorLiquidoReceber || 0 }];
  if (gatilhoDoisPagamentos) {
    itens.push({ descricao: 'Holerite pago pela contabilidade', valor: valorOcrPagamento || 0 });
  }
  return itens;
}

// Benefícios do funcionário na MESMA competência do holerite — mesmo mês que o
// lote do Financeiro RH (fonte BENEFICIOS) e o pedido Flash usam (alinhado a
// pedido do usuário em 2026-10-28).
//
// Valores vêm do que foi GERADO no mês, não do cadastro atual (que pode ter
// mudado depois — caso Emilio, 2026-10-30): folha_beneficios_geracoes, por
// grupo de meio (Flash / transferência / demais). Em cada grupo vale a
// geração mais recente que cobre o funcionário, preferindo a que é o próprio
// pagamento (pedido Flash pro Flash, lote pra transferência) ao CSV do Grid;
// pedido Flash cancelado e lote desativado não contam. Grupo sem nenhuma
// geração (meses antes do histórico existir) → cadastro reconstituído como
// estava na virada do mês (benefício é pago adiantado: o que muda no fim do
// mês já é do mês seguinte).
async function buscarBeneficiosCompetencia(
  db: ReturnType<typeof supabaseAdmin>,
  funcionarioNome: string,
  mesReferencia: string
): Promise<{
  itens: { tipo: string; meio: string; valor: number }[]; mesReferenciaBeneficio: string; origemValores: string[];
  // Grupo de meio (≠ Flash) registrado como já pago no "Já foi pago — só registrar"
  pagosRegistrados: Record<string, { pagoEm: string; geracaoId: number }>;
}> {
  const mesReferenciaBeneficio = mesReferencia;
  const dataBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  let geracoes: any[] = [];
  try {
    const { data, error } = await db.from('folha_beneficios_geracoes')
      .select('id, origem, referencia_id, escopo_meio, funcionarios, itens, gerado_em, pago_em')
      .eq('mes_referencia', mesReferenciaBeneficio)
      .order('gerado_em', { ascending: false });
    if (!error) geracoes = (data || []).filter(g => Array.isArray(g.funcionarios) && g.funcionarios.includes(funcionarioNome));
    if (geracoes.length > 0) {
      const idsFlash = geracoes.filter(g => (g.origem === 'FLASH' || g.origem === 'BENEFICIO') && g.referencia_id).map(g => g.referencia_id);
      const idsLote = geracoes.filter(g => g.origem === 'LOTE' && g.referencia_id).map(g => g.referencia_id);
      const [{ data: pedidos }, { data: lotes }] = await Promise.all([
        idsFlash.length ? db.from('folha_beneficios_flash_pedidos').select('id, status').in('id', idsFlash) : Promise.resolve({ data: [] as any[] }),
        idsLote.length ? db.from('financeiro_lotes_pagamento').select('id, ativo').in('id', idsLote) : Promise.resolve({ data: [] as any[] }),
      ]);
      const pedidoCancelado = new Set((pedidos || []).filter(p => p.status === 'CANCELADO').map(p => p.id));
      const loteInativo = new Set((lotes || []).filter(l => l.ativo === false).map(l => l.id));
      geracoes = geracoes
        .filter(g =>
          !(g.origem === 'FLASH' && pedidoCancelado.has(g.referencia_id)) &&
          !(g.origem === 'LOTE' && loteInativo.has(g.referencia_id)))
        // BENEFICIO com pedido Flash cancelado: perde só a parte Flash
        .map(g => ({ ...g, flashCancelado: g.origem === 'BENEFICIO' && pedidoCancelado.has(g.referencia_id) }));
    }
  } catch { geracoes = []; }

  // BENEFICIO = botão "Gerar Benefício" (todos os meios; Flash com pedido em
  // referencia_id). FLASH/GRID_CSV = gerações de antes do botão.
  const cobre = (g: any, cat: string) =>
    g.origem === 'FLASH' ? cat === 'FLASH'
      : g.origem === 'LOTE' ? cat === 'TRANSFER'
        : g.origem === 'BENEFICIO' ? !(cat === 'FLASH' && g.flashCancelado)
          : !g.escopo_meio || categoriaMeio(g.escopo_meio) === cat;
  // Quanto mais perto do pagamento, melhor: lote > Gerar Benefício > CSV antigo
  const prioridade = (g: any, cat: string) =>
    g.origem === 'LOTE' || (g.origem === 'FLASH' && cat === 'FLASH') ? 0 : g.origem === 'BENEFICIO' ? 1 : 2;
  const escolher = (cat: string) => {
    const candidatas = geracoes.filter(g => cobre(g, cat));
    if (candidatas.length === 0) return null;
    const melhor = Math.min(...candidatas.map(g => prioridade(g, cat)));
    return candidatas.find(g => prioridade(g, cat) === melhor); // já em ordem do mais recente
  };
  const rotulo = (g: any, cat: string) =>
    g.origem === 'LOTE' ? `lote de pagamento #${g.referencia_id} de ${dataBR(g.gerado_em)}`
      : (g.origem === 'FLASH' || g.origem === 'BENEFICIO') && cat === 'FLASH' && g.referencia_id ? `pedido Flash #${g.referencia_id} de ${dataBR(g.gerado_em)}`
        : `benefícios gerados em ${dataBR(g.gerado_em)}`;

  const corte = inicioDaCompetencia(mesReferenciaBeneficio);
  const { itens: reconstituidos } = await calcularBeneficiosMes(db, mesReferenciaBeneficio, null, { dataCorte: corte });
  const doCadastro = reconstituidos.filter(it => it.funcionario_nome === funcionarioNome);

  const categorias = new Set<string>(doCadastro.map(it => categoriaMeio(it.meio)));
  geracoes.forEach(g => (g.itens || []).forEach((it: any) => { if (it.funcionario_nome === funcionarioNome) categorias.add(categoriaMeio(it.meio)); }));

  const itens: { tipo: string; meio: string; valor: number }[] = [];
  const origens: string[] = [];
  const pagosRegistrados: Record<string, { pagoEm: string; geracaoId: number }> = {};
  for (const cat of categorias) {
    const g = escolher(cat);
    if (g) {
      if (cat !== 'FLASH' && g.origem === 'BENEFICIO' && g.pago_em) pagosRegistrados[cat] = { pagoEm: g.pago_em, geracaoId: g.id };
      (g.itens || [])
        .filter((it: any) => it.funcionario_nome === funcionarioNome && categoriaMeio(it.meio) === cat)
        .forEach((it: any) => itens.push({ tipo: it.tipo, meio: it.meio, valor: Number(it.valorMes) || 0 }));
      origens.push(rotulo(g, cat));
    } else {
      const doGrupo = doCadastro.filter(it => categoriaMeio(it.meio) === cat);
      doGrupo.forEach(it => itens.push({ tipo: it.tipo, meio: it.meio, valor: it.valorMes }));
      if (doGrupo.length) origens.push(`cadastro como estava em ${dataBR(corte)} (sem folha gerada no mês)`);
    }
  }
  return { itens, mesReferenciaBeneficio, origemValores: [...new Set(origens)], pagosRegistrados };
}

// Recibo de pagamento — vai como o ÚLTIMO arquivo do pacote de assinatura de
// TODOS os colaboradores (com ou sem folha calculada). Quem tem folha usa o
// valorLiquidoReceber do snapshot fechado (mais o salário folha, se pago à
// parte pela contabilidade — ver calcularValorRecibo); quem é só documental
// usa o valor lido do holerite OCR pagamento da contabilidade (valorOcrPagamento),
// já que não há cálculo.
async function gerarReciboBytes(
  db: ReturnType<typeof supabaseAdmin>,
  funcionarioNome: string,
  cpf: string | null,
  mesReferencia: string,
  valor: number,
  formaPagamento: string,
  detalhamento: { descricao: string; valor: number }[],
  empresaNome: string = 'RENTECH',
  empresaId: number | null = null,
  // Já calculado pelo chamador (o Resumo de Recebimentos usa a mesma lista) —
  // evita rodar calcularBeneficiosMes duas vezes por envio.
  beneficiosPre?: Awaited<ReturnType<typeof buscarBeneficiosCompetencia>>
): Promise<Uint8Array> {
  const [{ data: fData }, { itens: beneficios, mesReferenciaBeneficio }] = await Promise.all([
    db.from('folha_feriados').select('*'),
    beneficiosPre ?? buscarBeneficiosCompetencia(db, funcionarioNome, mesReferencia)
  ]);
  return gerarReciboPdf({
    nome: funcionarioNome,
    cpf,
    mesReferencia,
    valor,
    formaPagamento,
    feriados: [...feriadosDaEmpresa(indexarFeriados(fData), empresaId)],
    empresaNome,
    detalhamento,
    beneficios,
    mesReferenciaBeneficio
  });
}

// Resumo de Recebimentos — página informativa logo antes do recibo, com tudo
// que o colaborador recebeu na competência: as mesmas linhas do recibo
// (detalhamento) precedidas do adiantamento, + 13º/Férias da contabilidade
// lidos no mês, + benefícios (mesma lista do recibo, com a situação de
// pagamento — ver rastrearPagamentoBeneficios) + OPs em nome dele com
// vencimento dentro do mês de competência (exceto reprovadas). OP é ligada
// ao funcionário pelo CPF (favorecido ou signatário), comparando só dígitos.
async function gerarResumoRecebimentosBytes(
  db: ReturnType<typeof supabaseAdmin>,
  p: {
    funcionarioNome: string;
    cpf: string | null;
    mesReferencia: string;
    dados: any;
    detalhamentoRecibo: { descricao: string; valor: number }[];
    beneficios: Awaited<ReturnType<typeof buscarBeneficiosCompetencia>>;
    empresaNome: string;
  }
): Promise<Uint8Array> {
  const { funcionarioNome, mesReferencia, dados } = p;
  const [ano, mes] = mesReferencia.split('-');
  const dataInicio = `${ano}-${mes}-01`;
  const dataFim = `${ano}-${mes}-${new Date(Number(ano), Number(mes), 0).getDate()}`;
  const cpfDigitos = (p.cpf || '').replace(/\D/g, '');

  const [{ data: docs }, { data: ops }] = await Promise.all([
    db.from('folha_documentos_contabeis')
      .select('tipo, valor_ocr')
      .eq('funcionario_nome', funcionarioNome)
      .eq('mes_referencia', mesReferencia)
      .in('tipo', ['ADIANTAMENTO', 'DECIMO_TERCEIRO', 'FERIAS']),
    cpfDigitos.length === 11
      ? db.from('op_ordens_pagamento')
        .select('numero_op, natureza_pagamento, os_numero, os_evento, os_cliente, cnpj_cpf_recebedora, cpf_signatario, total_geral, data_vencimento, status, itens')
        .neq('status', 'REPROVADA')
        .gte('data_vencimento', dataInicio).lte('data_vencimento', dataFim)
        .order('data_vencimento')
      : Promise.resolve({ data: [] as any[] })
  ]);
  const ocrPorTipo: Record<string, number> = {};
  (docs || []).forEach(d => { if (d.valor_ocr != null) ocrPorTipo[d.tipo] = Number(d.valor_ocr); });

  const salario: LinhaResumo[] = [];

  // Adiantamento: mesma prioridade do lote do Financeiro RH — valor da ficha
  // (já descontado no nosso holerite) e, sem ele, o holerite de adiantamento
  // da contabilidade.
  const adiantFicha = Number(dados?.valorAdiantamento || 0);
  if (adiantFicha > 0) salario.push({ descricao: 'Adiantamento quinzenal (dia 20)', valor: adiantFicha });
  else if ((ocrPorTipo.ADIANTAMENTO || 0) > 0) salario.push({ descricao: 'Adiantamento — holerite da contabilidade', valor: ocrPorTipo.ADIANTAMENTO });

  // Linhas do recibo; a do nosso holerite ganha a composição (salário + extras)
  p.detalhamentoRecibo.forEach((item, i) => {
    const linha: LinhaResumo = { descricao: item.descricao, valor: item.valor };
    if (i === 0 && dados && item.descricao.startsWith('Salário líquido')) {
      const det: { descricao: string; valor?: number }[] = [];
      const add = (descricao: string, valor: number) => { if (valor > 0) det.push({ descricao, valor }); };
      add('Salário base contratual', dados.salarioBaseExibido || 0);
      add('Complemento de acordo classe', dados.complementoContratoExibido || 0);
      add(`Hora extra ${dados.regra?.percentual_extra_semana ?? ''}% (seg a sáb)`, dados.totalExtra60 || 0);
      add(`Hora extra ${dados.regra?.percentual_extra_dom_fer ?? ''}% (dom/feriado)`, dados.totalExtra100 || 0);
      add('Diárias de fim de semana / apoio', dados.totalDiariasFdsFechada || 0);
      add('Diárias bônus', dados.totalDiariasExcedentes || 0);
      (dados.bonusAtivos || []).forEach((b: any) => add(b.descricao, Number(b.valor || 0)));
      add('Vale refeição (VR)', dados.totalVr || 0);
      add('Vale transporte (VT)', dados.totalVt || 0);
      if ((dados.totalDebitos || 0) > 0) det.push({ descricao: '(-) Adiantamento, descontos e faltas', valor: dados.totalDebitos });
      linha.detalhes = det;
    }
    salario.push(linha);
  });

  if ((ocrPorTipo.DECIMO_TERCEIRO || 0) > 0) salario.push({ descricao: '13º salário — holerite da contabilidade', valor: ocrPorTipo.DECIMO_TERCEIRO });
  if ((ocrPorTipo.FERIAS || 0) > 0) salario.push({ descricao: 'Férias — holerite da contabilidade', valor: ocrPorTipo.FERIAS });

  const opsDoFuncionario: OpResumo[] = (ops || [])
    .filter((o: any) =>
      String(o.cnpj_cpf_recebedora || '').replace(/\D/g, '') === cpfDigitos ||
      String(o.cpf_signatario || '').replace(/\D/g, '') === cpfDigitos)
    .map((o: any) => ({
      numero: o.numero_op,
      natureza: o.natureza_pagamento || '',
      referencia: [o.os_evento, o.os_numero ? `OS ${o.os_numero}` : null].filter(Boolean).join(' · ') || o.os_cliente || null,
      vencimento: o.data_vencimento,
      status: o.status,
      valor: Number(o.total_geral || 0),
      itens: normalizarItensOP(o.itens).map(it => ({ descricao: it.descricao, qtd: it.qtd, valorUnitario: it.valor_unitario, total: it.total }))
    }));

  const beneficios = await rastrearPagamentoBeneficios(db, funcionarioNome, cpfDigitos, p.beneficios.mesReferenciaBeneficio, p.beneficios.itens, p.beneficios.pagosRegistrados);

  return gerarResumoRecebimentosPdf({
    nome: funcionarioNome,
    cpf: p.cpf,
    mesReferencia,
    empresaNome: p.empresaNome,
    salario,
    beneficios,
    mesReferenciaBeneficio: p.beneficios.mesReferenciaBeneficio,
    origemValoresBeneficios: p.beneficios.origemValores,
    ops: opsDoFuncionario
  });
}

// Situação de pagamento de cada benefício, por meio:
// - CARTÃO FLASH: pedido gravado no "Baixar CSV" + confirmação manual do RH
//   (folha_beneficios_flash_pedidos) — a Flash não devolve rastreio nenhum.
// - TRANSFERÊNCIA: item BENEFICIOS do lote do Financeiro RH no mês. Só conta
//   como pago com "Efetuado" no Itaú; se o item foi aceito pela API mas ainda
//   não tem essa confirmação gravada, consulta o SISPAG agora e grava no item
//   (gravarStatusItauItemLote) — assim ninguém precisa clicar "Consultar
//   status" item por item antes de mandar o holerite.
// - Demais meios: sem rastreio no sistema.
// - Qualquer meio fora do Flash registrado como "Já foi pago — só registrar"
//   no Grid (pagosRegistrados): pago na data informada pelo RH, sem consultar lote.
// Nunca derruba o envio: qualquer falha vira "não foi possível verificar".
async function rastrearPagamentoBeneficios(
  db: ReturnType<typeof supabaseAdmin>,
  funcionarioNome: string,
  cpfDigitos: string,
  mesBeneficio: string,
  itens: { tipo: string; meio: string; valor: number }[],
  pagosRegistrados: Record<string, { pagoEm: string; geracaoId: number }> = {}
): Promise<{ tipo: string; meio: string; valor: number; situacao: string; pago: boolean }[]> {
  if (itens.length === 0) return [];
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
  const temFlash = itens.some(it => norm(it.meio).includes('FLASH'));
  const temTransfer = itens.some(it => norm(it.meio).includes('TRANSFER')) && !pagosRegistrados.TRANSFER;

  let situacaoFlash = { situacao: 'Sem rastreio de pagamento no sistema', pago: false };
  if (temFlash) {
    try {
      const { data: pedidos, error } = await db.from('folha_beneficios_flash_pedidos')
        .select('id, status, gerado_em, pago_em, itens').eq('mes_referencia', mesBeneficio).neq('status', 'CANCELADO');
      if (error) throw new Error(error.message);
      const doFuncionario = (pedidos || []).filter(pd => (Array.isArray(pd.itens) ? pd.itens : []).some((l: any) =>
        (cpfDigitos && String(l.cpf || '').replace(/\D/g, '') === cpfDigitos) || l.nome === funcionarioNome));
      const pago = doFuncionario.find(pd => pd.status === 'PAGO');
      const gerado = doFuncionario.find(pd => pd.status === 'GERADO');
      situacaoFlash = pago
        ? { situacao: `Pago em ${dataBR(pago.pago_em)} — pedido Flash #${pago.id}`, pago: true }
        : gerado
          ? { situacao: `Pedido Flash #${gerado.id} gerado em ${dataBR(gerado.gerado_em)}, pagamento não confirmado pelo RH`, pago: false }
          : { situacao: 'Nenhum pedido Flash gerado com este funcionário no mês', pago: false };
    } catch {
      situacaoFlash = { situacao: 'Não foi possível verificar o pedido Flash', pago: false };
    }
  }

  let situacaoTransfer = { situacao: 'Sem rastreio de pagamento no sistema', pago: false };
  if (temTransfer) {
    try {
      const { data: lotes, error } = await db.from('financeiro_lotes_pagamento')
        .select('id, data_pagamento, itens').eq('mes_referencia', mesBeneficio).or('ativo.is.null,ativo.eq.true');
      if (error) throw new Error(error.message);
      const candidatos = (lotes || []).flatMap(l => (Array.isArray(l.itens) ? l.itens : [])
        .filter((it: any) => it?.fonte === 'BENEFICIOS' && it.funcionario_nome === funcionarioNome)
        .map((it: any) => ({ lote: l, item: it })));

      const efetuado = (c: { item: any }) => semAcento(c.item.itau_status_atual || '') === STATUS_ITAU_EFETUADO;
      let confirmado = candidatos.find(efetuado);
      const aguardando = candidatos.filter(c => !efetuado(c) && c.item.api_cod_pagamento && c.item.api_status !== 'Erro');
      if (!confirmado && aguardando.length > 0) {
        const ctx = await contextoEnvioItau();
        if (ctx.ok) {
          for (const c of aguardando) {
            const { ok, data } = await consultarPagamentoSispag(ctx.ambiente, c.item.api_cod_pagamento);
            if (!ok) continue;
            const statusBruto = String((data?.data ?? data)?.dados_pagamento?.status || '');
            await gravarStatusItauItemLote(db, c.lote.id, c.item.api_cod_pagamento, statusBruto);
            c.item.itau_status_atual = statusBruto;
            if (efetuado(c)) { confirmado = c; break; }
          }
        }
      }

      if (confirmado) {
        const quando = confirmado.lote.data_pagamento || confirmado.item.dataPagamento || confirmado.item.itau_efetuado_em || confirmado.item.api_enviado_em;
        situacaoTransfer = { situacao: `Pago${quando ? ` em ${dataBR(String(quando))}` : ''} — confirmado pelo Itaú (lote #${confirmado.lote.id})`, pago: true };
      } else if (aguardando.length > 0) {
        const ultimo = aguardando[aguardando.length - 1];
        const st = ultimo.item.itau_status_atual;
        situacaoTransfer = { situacao: `Enviado ao banco (lote #${ultimo.lote.id})${st ? ` — status no Itaú: ${st}` : ', sem confirmação do Itaú'}`, pago: false };
      } else if (candidatos.length > 0) {
        const c = candidatos[candidatos.length - 1];
        situacaoTransfer = { situacao: c.item.api_status === 'Erro' ? `Erro no envio ao banco (lote #${c.lote.id})` : `No lote #${c.lote.id}, ainda não enviado ao banco`, pago: false };
      } else {
        situacaoTransfer = { situacao: 'Não incluído em nenhum lote de pagamento do mês', pago: false };
      }
    } catch {
      situacaoTransfer = { situacao: 'Não foi possível verificar o lote de pagamento', pago: false };
    }
  }

  return itens.map(it => {
    const meio = norm(it.meio);
    const registrado = pagosRegistrados[categoriaMeio(it.meio)];
    if (registrado && !meio.includes('FLASH')) {
      return { ...it, situacao: `Pago em ${dataBR(registrado.pagoEm)} — registrado pelo RH (benefícios #${registrado.geracaoId})`, pago: true };
    }
    const s = meio.includes('FLASH') ? situacaoFlash
      : meio.includes('TRANSFER') ? situacaoTransfer
        : { situacao: 'Sem rastreio de pagamento no sistema', pago: false };
    return { ...it, ...s };
  });
}

function normalizarCelularBR(celular?: string | null): string | null {
  if (!celular) return null;
  const digits = celular.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const comPais = digits.startsWith('55') ? digits : `55${digits}`;
  return `+${comPais}`;
}

// ============================================================================
// ENVIO DE DOCUMENTO AVULSO (advertência, aviso, etc.)
// Não depende de folha nem de mês — sobe um PDF qualquer para um funcionário.
// ============================================================================
export async function enviarDocumentoAvulsoAction(payload: {
  funcionarioNome: string;
  tituloDocumento: string;      // ex: "Advertência - atraso"
  pdfBase64: string;
  mesReferencia: string;        // mês selecionado na página de assinaturas
  enviadoPor: string;
  sandbox: boolean;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { funcionarioNome, tituloDocumento, pdfBase64, mesReferencia, enviadoPor, sandbox } = payload;

  if (!tituloDocumento?.trim()) return { ok: false, erro: 'Informe um título para o documento.' };
  if (!pdfBase64) return { ok: false, erro: 'Nenhum arquivo enviado.' };

  try {
    const { data: func } = await db
      .from('folha_funcionarios')
      .select('cpf, celular, email, empresa_id')
      .eq('nome_completo', funcionarioNome)
      .maybeSingle();

    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, func?.empresa_id)) {
      return { ok: false, erro: 'Você não tem permissão para enviar documentos para este funcionário.' };
    }

    const cpfLimpo = (func?.cpf || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return { ok: false, erro: `CPF de ${funcionarioNome} ausente ou inválido. Preencha o CPF na ficha antes de enviar.` };
    }
    const celularE164 = normalizarCelularBR(func?.celular);
    if (!celularE164 && !func?.email) {
      return { ok: false, erro: `Informe celular ou e-mail de ${funcionarioNome} na ficha para enviar o link de assinatura.` };
    }

    const pdfBytes = new Uint8Array(Buffer.from(pdfBase64, 'base64'));
    const doc = await autentiqueCriarDocumento({
      nomeDocumento: `${tituloDocumento} — ${funcionarioNome}`,
      signatarioNome: funcionarioNome,
      signatarioCpf: cpfLimpo,
      signatarioCelular: celularE164 || undefined,
      signatarioEmail: func?.email || undefined,
      pdfBuffer: pdfBytes,
      pdfNomeArquivo: `${slug(tituloDocumento)}-${slug(funcionarioNome)}.pdf`,
      sandbox
    });

    // Registra como avulso vinculado ao mês selecionado: o marcador inclui o
    // mês (para o avulso aparecer naquele mês) + timestamp (para não colidir
    // com o holerite nem com outros avulsos, dada a unique func+mes).
    const marcadorAvulso = `AVULSO-${mesReferencia}-${Date.now()}`;
    const { error } = await db.from('folha_holerite_assinaturas').upsert({
      funcionario_nome: funcionarioNome,
      empresa_id: func?.empresa_id ?? null,
      mes_referencia: marcadorAvulso,
      cpf: cpfLimpo,
      autentique_doc_id: doc.docId,
      public_id: doc.publicId,
      link_assinatura: doc.linkAssinatura,
      status: 'ENVIADO',
      sandbox,
      titulo_avulso: tituloDocumento,
      enviado_por: enviadoPor || null,
      enviado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    }, { onConflict: 'funcionario_nome,mes_referencia' });
    if (error) throw new Error(`Documento criado na Autentique (${doc.docId}), mas falha ao gravar o controle: ${error.message}`);

    registrarLogAuditoria({
      usuario_nome: enviadoPor || 'Sistema',
      acao: `ENVIOU DOCUMENTO AVULSO PARA ASSINATURA (AUTENTIQUE): ${tituloDocumento}`,
      setor: 'RECURSOS HUMANOS',
      equipamento_nome: funcionarioNome,
    });

    return { ok: true, info: { docId: doc.docId, link: doc.linkAssinatura, sandbox } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ENVIAR HOLERITE PARA ASSINATURA (somente folha FECHADA)
// ============================================================================
export async function enviarHoleriteAssinaturaAction(payload: {
  funcionarioNome: string;
  mesReferencia: string;
  enviadoPor: string;
  sandbox: boolean;
  soDocumental?: boolean;
  valorManual?: number; // ajuste opcional: sobrepõe o valor lido do OCR quando soDocumental
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { funcionarioNome, mesReferencia, enviadoPor, sandbox, soDocumental, valorManual } = payload;

  try {
    // 1) Folha fechada: obrigatória para contratos com cálculo. Para contratos
    // "só documentais", não há folha — envia apenas os anexos da contabilidade.
    const { data: fechamento } = await db
      .from('folha_holerites')
      .select('dados, fechado_em')
      .eq('funcionario_nome', funcionarioNome)
      .eq('mes_referencia', mesReferencia)
      .maybeSingle();
    if (!soDocumental && !fechamento?.dados) {
      return { ok: false, erro: 'A folha deste mês não está fechada para este funcionário. Feche a folha antes de enviar para assinatura.' };
    }

    // 2) Busca dados pessoais (CPF, celular, e-mail) da ficha
    const { data: func } = await db
      .from('folha_funcionarios')
      .select('cpf, celular, email, data_admissao, data_desligamento, pix_chave, banco_conta, empresa_id')
      .eq('nome_completo', funcionarioNome)
      .maybeSingle();

    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, func?.empresa_id)) {
      return { ok: false, erro: 'Você não tem permissão para enviar documentos para este funcionário.' };
    }
    const nomeEmpresa = await nomeEmpresaDoFuncionario(db, func?.empresa_id);

    // Contrato paga o salário base à parte (pelo holerite da contabilidade):
    // o recibo precisa do valor real desse pagamento, lido do OCR. Contratos
    // só documentais usam esse mesmo OCR como o próprio valor do recibo —
    // não há folha calculada pra somar.
    const gatilhoDoisPagamentos = !soDocumental && precisaHoleriteContabilidade(fechamento?.dados);
    const valorOcrPagamento = (gatilhoDoisPagamentos || soDocumental)
      ? await buscarValorOcrPagamento(db, funcionarioNome, mesReferencia)
      : null;
    // "=== null" sozinho não bastava: uma linha de folha_documentos_contabeis
    // com valor_ocr = 0 (OCR leu errado, ou a linha foi criada sem valor)
    // passava direto por aqui e seguia pro recibo zerado — caso real do
    // Inácio (AlfaLight) em 2026-10, enviado pra assinatura com R$0,00.
    if (gatilhoDoisPagamentos && (valorOcrPagamento === null || valorOcrPagamento <= 0)) {
      return { ok: false, erro: `Este funcionário recebe o salário base pelo holerite da contabilidade, mas o valor lido (OCR) para ${funcionarioNome} neste mês está ausente ou zerado. Confira/rode o OCR na tela de Financeiro antes de enviar.` };
    }
    if (soDocumental && valorManual === undefined && (valorOcrPagamento === null || valorOcrPagamento <= 0)) {
      return { ok: false, erro: `O holerite da contabilidade de ${funcionarioNome} ainda não foi lido (OCR) neste mês. Rode o OCR na tela de Financeiro antes de enviar.` };
    }

    // O recibo (último arquivo do pacote) vale para todo mundo: quem tem
    // folha usa o valor líquido já calculado (mais o holerite da
    // contabilidade, se o salário base for pago à parte); quem é só
    // documental usa o valor lido do holerite OCR da contabilidade
    // (valorManual só entra se vier explícito, como ajuste pontual).
    const valorRecibo = !soDocumental
      ? calcularValorRecibo(fechamento?.dados, valorOcrPagamento)
      : (valorManual ?? valorOcrPagamento ?? 0);
    const detalhamentoRecibo = montarDetalhamentoRecibo(
      soDocumental, fechamento?.dados?.valorLiquidoReceber || 0, gatilhoDoisPagamentos, valorOcrPagamento, valorManual
    );

    // Trava final: nenhum holerite sai para assinatura com recibo zerado ou
    // negativo, seja qual for o caminho que levou a esse valor. Um caso
    // legítimo (ex.: afastamento o mês inteiro, sem nenhum crédito) precisa
    // de decisão manual de quem está enviando — não existe envio automático
    // silencioso para R$0,00.
    if (valorRecibo <= 0) {
      return { ok: false, erro: `O recibo de ${funcionarioNome} ficou em ${valorRecibo < 0 ? 'valor negativo' : 'R$ 0,00'} neste mês. Confira o cálculo da folha e o OCR do holerite da contabilidade antes de enviar para assinatura.` };
    }

    const cpfLimpo = (func?.cpf || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return { ok: false, erro: `CPF de ${funcionarioNome} ausente ou inválido. Preencha o CPF na ficha antes de enviar.` };
    }
    const celularE164 = normalizarCelularBR(func?.celular);
    if (!celularE164 && !func?.email) {
      return { ok: false, erro: `Informe celular ou e-mail de ${funcionarioNome} na ficha para enviar o link de assinatura.` };
    }

    // 3) Impede reenvio se já assinado — EXCETO quando a folha foi reaberta e
    // fechada de novo depois desse envio/assinatura: nesse caso o documento
    // assinado é de uma versão antiga do holerite (reabrirFolhaAction só
    // apaga o snapshot em folha_holerites, nunca toca nesta tabela), então
    // precisa deixar passar um novo envio com os valores corrigidos.
    const { data: existente } = await db
      .from('folha_holerite_assinaturas')
      .select('status, enviado_em')
      .eq('funcionario_nome', funcionarioNome)
      .eq('mes_referencia', mesReferencia)
      .maybeSingle();
    if (existente?.status === 'ASSINADO') {
      const assinaturaDesatualizada = !!(fechamento?.fechado_em && existente.enviado_em && fechamento.fechado_em > existente.enviado_em);
      if (!assinaturaDesatualizada) {
        return { ok: false, erro: 'Este holerite já foi assinado. Não é possível reenviar.' };
      }
    }

    // 4) Nosso resumo — só para contratos com cálculo (folha fechada).
    const resumoBytes = (!soDocumental && fechamento?.dados) ? await gerarHoleritePdf({
      nome: funcionarioNome,
      cpf: func?.cpf || null,
      mesReferencia,
      dados: fechamento.dados,
      fechadoEm: fechamento?.fechado_em,
      empresaNome: nomeEmpresa
    }) : null;

    // 4b) Espelho de ponto do mês (batidas + abonos), se houver registro.
    const espelhoBytes = await gerarEspelhoPontoBytes(
      db, funcionarioNome, cpfLimpo || func?.cpf || null, mesReferencia,
      func?.data_admissao, func?.data_desligamento, nomeEmpresa, func?.empresa_id ?? null
    );

    // 4c) Anexa os documentos da contabilidade que existirem no Storage.
    const adiantamento = await baixarAnexoContabil(db, mesReferencia, 'ADIANTAMENTO', funcionarioNome);
    const holeriteMensal = await baixarAnexoContabil(db, mesReferencia, 'HOLERITE_MENSAL', funcionarioNome);

    // Documental exige o holerite real da contabilidade — o recibo sozinho
    // (valor digitado) não substitui esse anexo.
    if (soDocumental && !adiantamento && !holeriteMensal) {
      return { ok: false, erro: `Nenhum holerite da contabilidade encontrado para ${funcionarioNome} neste mês. Importe e separe os PDFs antes de enviar.` };
    }

    // 4d) Resumo de Recebimentos (salário + benefícios + OPs) e recibo de
    // pagamento — o recibo é sempre o ÚLTIMO arquivo do pacote.
    const beneficiosMes = await buscarBeneficiosCompetencia(db, funcionarioNome, mesReferencia);
    const resumoRecebimentosBytes = await gerarResumoRecebimentosBytes(db, {
      funcionarioNome, cpf: func?.cpf || null, mesReferencia, dados: soDocumental ? null : fechamento?.dados,
      detalhamentoRecibo, beneficios: beneficiosMes, empresaNome: nomeEmpresa
    });
    const formaPagamento = deduzirFormaPagamento(func);
    const reciboBytes = await gerarReciboBytes(
      db, funcionarioNome, func?.cpf || null, mesReferencia, valorRecibo || 0, formaPagamento, detalhamentoRecibo, nomeEmpresa, func?.empresa_id ?? null, beneficiosMes
    );

    // Ordem: nosso resumo (se houver) → espelho de ponto → adiantamento → holerite mensal → resumo de recebimentos → recibo.
    const partes = [resumoBytes, espelhoBytes, adiantamento, holeriteMensal, resumoRecebimentosBytes, reciboBytes].filter((p): p is Uint8Array => !!p);
    const pdfBytes = partes.length > 1 ? await mergePdfs(partes) : partes[0];
    const anexados = [
      espelhoBytes ? 'espelho de ponto' : null,
      adiantamento ? 'adiantamento' : null,
      holeriteMensal ? 'holerite' : null,
      'resumo de recebimentos',
      'recibo'
    ].filter(Boolean);

    // 5) Cria o documento na Autentique (com validação por CPF + WhatsApp)
    const doc = await autentiqueCriarDocumento({
      nomeDocumento: `Holerite ${mesReferencia.split('-').reverse().join('/')} — ${funcionarioNome}`,
      signatarioNome: funcionarioNome,
      signatarioCpf: cpfLimpo,
      signatarioCelular: celularE164 || undefined,
      signatarioEmail: func?.email || undefined,
      pdfBuffer: pdfBytes,
      pdfNomeArquivo: `${funcionarioNome.replace(/\s+/g, '-').toLowerCase()}-${mesReferencia}.pdf`,
      sandbox
    });

    // 6) Grava/atualiza o controle
    const { error } = await db.from('folha_holerite_assinaturas').upsert({
      funcionario_nome: funcionarioNome,
      empresa_id: func?.empresa_id ?? null,
      mes_referencia: mesReferencia,
      cpf: cpfLimpo,
      autentique_doc_id: doc.docId,
      public_id: doc.publicId,
      link_assinatura: doc.linkAssinatura,
      status: 'ENVIADO',
      sandbox,
      enviado_por: enviadoPor || null,
      enviado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    }, { onConflict: 'funcionario_nome,mes_referencia' });
    if (error) throw new Error(`Documento criado na Autentique (${doc.docId}), mas falha ao gravar o controle: ${error.message}`);

    registrarLogAuditoria({
      usuario_nome: enviadoPor || 'Sistema',
      acao: `ENVIOU HOLERITE PARA ASSINATURA (AUTENTIQUE): ${mesReferencia}`,
      setor: 'RECURSOS HUMANOS',
      equipamento_nome: funcionarioNome,
    });

    return { ok: true, info: { docId: doc.docId, link: doc.linkAssinatura, sandbox, anexados } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ENVIO EM LOTE: todos os holerites FECHADOS do mês ainda não assinados
// ============================================================================
export async function enviarHoleritesLoteAction(payload: {
  mesReferencia: string;
  enviadoPor: string;
  sandbox: boolean;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { mesReferencia, enviadoPor, sandbox } = payload;

  try {
    // 1) Funcionários com folha FECHADA no mês (contratos com cálculo)
    const { data: fechados } = await db
      .from('folha_holerites')
      .select('funcionario_nome, fechado_em')
      .eq('mes_referencia', mesReferencia);
    const fechadoEmPorNome = new Map((fechados || []).map(f => [f.funcionario_nome, f.fechado_em]));

    // 2) Funcionários de contrato SÓ DOCUMENTAL (sem folha), que têm anexos da
    //    contabilidade neste mês — também vão para assinatura.
    const { data: regras } = await db
      .from('folha_parametros')
      .select('nome_regra, so_documental');
    const contratosDocumentais = new Set(
      (regras || []).filter(r => r.so_documental === true).map(r => r.nome_regra)
    );

    let documentais: string[] = [];
    if (contratosDocumentais.size > 0) {
      const { data: funcsDoc } = await db
        .from('folha_funcionarios')
        .select('nome_completo, tipo_contrato')
        .eq('ativo', true);
      const candidatos = (funcsDoc || [])
        .filter(f => contratosDocumentais.has(f.tipo_contrato))
        .map(f => f.nome_completo);

      // Só inclui documentais que realmente têm algum documento da contabilidade
      if (candidatos.length > 0) {
        const { data: comDocs } = await db
          .from('folha_documentos_contabeis')
          .select('funcionario_nome')
          .eq('mes_referencia', mesReferencia)
          .in('funcionario_nome', candidatos);
        documentais = Array.from(new Set((comDocs || []).map(d => d.funcionario_nome)));
      }
    }

    // Marca quem é documental para o envio saber pular o resumo
    const nomeDocumentais = new Set(documentais);
    const todosNomes = Array.from(new Set([
      ...(fechados || []).map(f => f.funcionario_nome),
      ...documentais
    ]));

    if (todosNomes.length === 0) {
      return { ok: false, erro: 'Nenhuma folha fechada nem documento documental neste mês. Feche a folha ou separe os holerites da contabilidade antes de enviar.' };
    }

    // Já assinados/enviados: não reenviar — EXCETO um ASSINADO cuja folha foi
    // reaberta e fechada de novo depois dessa assinatura (mesma exceção de
    // enviarHoleriteAssinaturaAction): o documento assinado é de uma versão
    // antiga do holerite, então entra de novo nos alvos do lote.
    const { data: jaEnviados } = await db
      .from('folha_holerite_assinaturas')
      .select('funcionario_nome, status, enviado_em')
      .eq('mes_referencia', mesReferencia);
    const bloqueados = new Set((jaEnviados || [])
      .filter(a => {
        if (a.status === 'ENVIADO' || a.status === 'VISUALIZADO') return true;
        if (a.status !== 'ASSINADO') return false;
        const fechadoEm = fechadoEmPorNome.get(a.funcionario_nome);
        const desatualizada = fechadoEm && a.enviado_em && fechadoEm > a.enviado_em;
        return !desatualizada;
      })
      .map(a => a.funcionario_nome));

    const alvos = todosNomes.filter(n => !bloqueados.has(n));
    if (alvos.length === 0) {
      return { ok: false, erro: 'Todos os documentos deste mês já foram enviados ou assinados.' };
    }

    const resultados: { nome: string; ok: boolean; erro?: string }[] = [];
    for (const nome of alvos) {
      const r = await enviarHoleriteAssinaturaAction({
        funcionarioNome: nome, mesReferencia, enviadoPor, sandbox,
        soDocumental: nomeDocumentais.has(nome)
      }, accessToken);
      resultados.push({ nome, ok: r.ok, erro: r.erro });
    }

    const enviados = resultados.filter(r => r.ok).length;
    const falhas = resultados.filter(r => !r.ok);

    return {
      ok: enviados > 0,
      info: { enviados, total: alvos.length, documentais: documentais.length, falhas: falhas.map(f => `${f.nome}: ${f.erro}`) }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// LISTAR ASSINATURAS DE UM MÊS (para a página de acompanhamento)
// ============================================================================
export async function listarAssinaturasAction(payload: { mesReferencia: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    // Traz as assinaturas do mês + os avulsos DAQUELE mês (AVULSO-{mes}-...)
    let q = db
      .from('folha_holerite_assinaturas')
      .select('*')
      .or(`mes_referencia.eq.${payload.mesReferencia},mes_referencia.like.AVULSO-${payload.mesReferencia}-%`)
      .order('funcionario_nome');
    if (empresasPermitidas) q = q.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, info: { assinaturas: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PRÉVIA DO DOCUMENTO DE ASSINATURA (para testes/conferência)
// Gera EXATAMENTE o mesmo PDF que seria enviado à Autentique (resumo + anexos
// da contabilidade, com merge), mas devolve em base64 para abrir no navegador.
// Não cria nada na Autentique nem gasta documentos do plano.
// ============================================================================
export async function previaDocumentoAssinaturaAction(payload: {
  funcionarioNome: string;
  mesReferencia: string;
  soDocumental?: boolean;
  dadosAoVivo?: any; // se a folha não está fechada, a tela pode mandar o cálculo ao vivo
  valorManual?: number; // ajuste opcional: sobrepõe o valor lido do OCR quando soDocumental
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { funcionarioNome, mesReferencia, soDocumental, dadosAoVivo, valorManual } = payload;

  try {
    // Snapshot congelado (se fechado) ou dados ao vivo (prévia de folha aberta)
    const { data: fechamento } = await db
      .from('folha_holerites')
      .select('dados, fechado_em')
      .eq('funcionario_nome', funcionarioNome)
      .eq('mes_referencia', mesReferencia)
      .maybeSingle();

    const dados = fechamento?.dados || dadosAoVivo;
    if (!soDocumental && !dados) {
      return { ok: false, erro: 'Sem dados para gerar a prévia: feche a folha ou envie o cálculo ao vivo.' };
    }

    const { data: func } = await db
      .from('folha_funcionarios')
      .select('cpf, data_admissao, data_desligamento, pix_chave, banco_conta, empresa_id')
      .eq('nome_completo', funcionarioNome)
      .maybeSingle();

    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, func?.empresa_id)) {
      return { ok: false, erro: 'Você não tem permissão para gerar prévia para este funcionário.' };
    }
    const nomeEmpresa = await nomeEmpresaDoFuncionario(db, func?.empresa_id);

    const gatilhoDoisPagamentos = !soDocumental && precisaHoleriteContabilidade(dados);
    const valorOcrPagamento = (gatilhoDoisPagamentos || soDocumental)
      ? await buscarValorOcrPagamento(db, funcionarioNome, mesReferencia)
      : null;
    if (gatilhoDoisPagamentos && valorOcrPagamento === null) {
      return { ok: false, erro: `Este funcionário recebe o salário base pelo holerite da contabilidade, mas o valor ainda não foi lido (OCR) para ${funcionarioNome} neste mês. Rode o OCR na tela de Financeiro antes de gerar a prévia.` };
    }
    if (soDocumental && valorManual === undefined && (valorOcrPagamento === null || valorOcrPagamento <= 0)) {
      return { ok: false, erro: `O holerite da contabilidade de ${funcionarioNome} ainda não foi lido (OCR) neste mês. Rode o OCR na tela de Financeiro antes de gerar a prévia.` };
    }

    const valorRecibo = !soDocumental
      ? calcularValorRecibo(dados, valorOcrPagamento)
      : (valorManual ?? valorOcrPagamento ?? 0);
    const detalhamentoRecibo = montarDetalhamentoRecibo(
      soDocumental, dados?.valorLiquidoReceber || 0, gatilhoDoisPagamentos, valorOcrPagamento, valorManual
    );

    const resumoBytes = (!soDocumental && dados) ? await gerarHoleritePdf({
      nome: funcionarioNome,
      cpf: func?.cpf || null,
      mesReferencia,
      dados,
      fechadoEm: fechamento?.fechado_em,
      empresaNome: nomeEmpresa
    }) : null;

    const espelhoBytes = await gerarEspelhoPontoBytes(
      db, funcionarioNome, func?.cpf || null, mesReferencia,
      func?.data_admissao, func?.data_desligamento, nomeEmpresa, func?.empresa_id ?? null
    );

    const adiantamento = await baixarAnexoContabil(db, mesReferencia, 'ADIANTAMENTO', funcionarioNome);
    const holeriteMensal = await baixarAnexoContabil(db, mesReferencia, 'HOLERITE_MENSAL', funcionarioNome);

    const beneficiosMes = await buscarBeneficiosCompetencia(db, funcionarioNome, mesReferencia);
    const resumoRecebimentosBytes = await gerarResumoRecebimentosBytes(db, {
      funcionarioNome, cpf: func?.cpf || null, mesReferencia, dados: soDocumental ? null : dados,
      detalhamentoRecibo, beneficios: beneficiosMes, empresaNome: nomeEmpresa
    });
    const formaPagamento = deduzirFormaPagamento(func);
    const reciboBytes = await gerarReciboBytes(
      db, funcionarioNome, func?.cpf || null, mesReferencia, valorRecibo || 0, formaPagamento, detalhamentoRecibo, nomeEmpresa, func?.empresa_id ?? null, beneficiosMes
    );

    const partes = [resumoBytes, espelhoBytes, adiantamento, holeriteMensal, resumoRecebimentosBytes, reciboBytes].filter((p): p is Uint8Array => !!p);
    const pdfBytes = partes.length > 1 ? await mergePdfs(partes) : partes[0];

    const anexados = [
      resumoBytes ? 'resumo' : null,
      espelhoBytes ? 'espelho de ponto' : null,
      adiantamento ? 'adiantamento' : null,
      holeriteMensal ? 'holerite' : null,
      'resumo de recebimentos',
      'recibo'
    ].filter(Boolean);

    return {
      ok: true,
      info: {
        pdfBase64: Buffer.from(pdfBytes).toString('base64'),
        anexados,
        fonte: fechamento?.dados ? 'FOLHA FECHADA (snapshot)' : 'CÁLCULO AO VIVO (folha aberta)'
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ATUALIZAR TODAS AS ASSINATURAS NÃO FINALIZADAS (de um mês + avulsos)
// Consulta a Autentique para cada uma que ainda não está ASSINADA/REJEITADA.
// ============================================================================
export async function atualizarTodasAssinaturasAction(payload: {
  mesReferencia: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let qPendentes = db
      .from('folha_holerite_assinaturas')
      .select('funcionario_nome, mes_referencia, status')
      .or(`mes_referencia.eq.${payload.mesReferencia},mes_referencia.like.AVULSO-${payload.mesReferencia}-%`)
      .not('status', 'in', '("ASSINADO","REJEITADO","CANCELADO")');
    if (empresasPermitidas) qPendentes = qPendentes.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    const { data: pendentes } = await qPendentes;

    if (!pendentes?.length) {
      return { ok: true, info: { atualizados: 0, total: 0, mudancas: [] } };
    }

    const mudancas: string[] = [];
    let atualizados = 0;

    for (const p of pendentes) {
      const antes = p.status;
      const r = await consultarAssinaturaAction({ funcionarioNome: p.funcionario_nome, mesReferencia: p.mes_referencia }, accessToken);
      if (r.ok) {
        atualizados++;
        if (r.info?.status && r.info.status !== antes) {
          mudancas.push(`${p.funcionario_nome}: ${antes} → ${r.info.status}`);
        }
      }
    }

    return { ok: true, info: { atualizados, total: pendentes.length, mudancas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// BAIXAR DOCUMENTO ASSINADO
// Os links files.signed/pades da Autentique exigem o token (Authorization),
// então clicar direto no navegador retorna "não existe". Aqui baixamos com o
// token no servidor, arquivamos no nosso Storage (cópia permanente) e
// devolvemos uma signed URL para o usuário abrir.
// ============================================================================
// A lógica em si vive em assinaturaDownloadCore.ts (baixarAssinado, sem "use
// server") porque também é chamada pelo Portal do funcionário
// (urlMeuHoleriteAction), que já resolve/confere a posse do holerite pela
// sessão do próprio funcionário — não tem (nem deveria ter) um accessToken
// de admin pra passar aqui.
export async function baixarAssinadoAction(payload: {
  funcionarioNome: string; mesReferencia: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { data: func } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', payload.funcionarioNome).maybeSingle();
  const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  if (!empresaPermitida(empresasPermitidas, func?.empresa_id)) {
    return { ok: false, erro: 'Você não tem permissão para acessar este documento.' };
  }

  return baixarAssinado({ ...payload, solicitadoPor: acesso.perfil.nome });
}

// ============================================================================
// CONSULTAR STATUS (fallback do webhook — uso pontual)
// ============================================================================
export async function consultarAssinaturaAction(payload: {
  funcionarioNome: string; mesReferencia: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: ctrl } = await db
      .from('folha_holerite_assinaturas')
      .select('autentique_doc_id, empresa_id, status')
      .eq('funcionario_nome', payload.funcionarioNome)
      .eq('mes_referencia', payload.mesReferencia)
      .maybeSingle();
    if (!ctrl?.autentique_doc_id) return { ok: false, erro: 'Nenhum envio encontrado para este holerite.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, ctrl.empresa_id)) return { ok: false, erro: 'Nenhum envio encontrado para este holerite.' };
    // Envio cancelado não se "reabre" sozinho: sem este guard, consultar a
    // Autentique sobrescreveria o status de volta pra ENVIADO/VISUALIZADO.
    if (ctrl.status === 'CANCELADO') return { ok: false, erro: 'Este envio foi cancelado.' };

    const doc = await autentiqueConsultarDocumento(ctrl.autentique_doc_id);
    // A primeira signature é o AUTOR (a Rentech, action: null), que nunca assina.
    // O signatário de verdade é o que tem action.name === 'SIGN'.
    const assinatura = (doc?.signatures || []).find((s: any) => s?.action?.name === 'SIGN')
      || (doc?.signatures || [])[0];

    const assinou = !!assinatura?.signed?.created_at;
    const visualizou = !!assinatura?.viewed?.created_at;
    const rejeitou = !!assinatura?.rejected?.created_at;

    const novoStatus = rejeitou ? 'REJEITADO' : assinou ? 'ASSINADO' : visualizou ? 'VISUALIZADO' : 'ENVIADO';

    // Só grava log quando o status realmente muda — atualizarTodasAssinaturasAction
    // chama isto em loop pra cada pendência do mês, e logar toda consulta sem
    // mudança nenhuma poluiria o log de auditoria sem informação nova.
    if (novoStatus !== ctrl.status) {
      registrarLogAuditoria({
        usuario_nome: acesso.perfil.nome,
        acao: `ATUALIZOU STATUS DE ASSINATURA (AUTENTIQUE): ${ctrl.status || '—'} → ${novoStatus}`,
        setor: 'RECURSOS HUMANOS',
        equipamento_nome: `${payload.funcionarioNome} — ${payload.mesReferencia}`,
      });
    }

    await db.from('folha_holerite_assinaturas').update({
      status: novoStatus,
      arquivo_assinado: doc?.files?.signed || doc?.files?.pades || null,
      visualizado_em: assinatura?.viewed?.created_at || null,
      assinado_em: assinatura?.signed?.created_at || null,
      atualizado_em: new Date().toISOString()
    }).eq('autentique_doc_id', ctrl.autentique_doc_id);

    return { ok: true, info: { status: novoStatus } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CANCELAR ENVIO — nunca apaga a linha de folha_holerite_assinaturas (histórico
// de quem mandou o quê fica preservado), só marca status='CANCELADO'. Serve
// para retratar um envio errado (ex.: holerite que saiu com valor zerado) sem
// perder o rastro, e libera o funcionário pra receber um novo envio corrigido
// no mesmo mês (o upsert de enviarHoleriteAssinaturaAction sobrescreve a linha
// normalmente, menos quando já está ASSINADO).
// ============================================================================
export async function cancelarAssinaturaAction(payload: {
  funcionarioNome: string;
  mesReferencia: string;
  canceladoPor: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { funcionarioNome, mesReferencia, canceladoPor } = payload;

  try {
    const { data: atual } = await db
      .from('folha_holerite_assinaturas')
      .select('status, autentique_doc_id, empresa_id')
      .eq('funcionario_nome', funcionarioNome)
      .eq('mes_referencia', mesReferencia)
      .maybeSingle();
    if (!atual) return { ok: false, erro: 'Nenhum envio encontrado para este holerite.' };

    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, atual.empresa_id)) {
      return { ok: false, erro: 'Nenhum envio encontrado para este holerite.' };
    }
    if (atual.status === 'ASSINADO') {
      return { ok: false, erro: 'Este holerite já foi assinado. Não é possível cancelar um documento já assinado.' };
    }
    if (atual.status === 'CANCELADO') {
      return { ok: false, erro: 'Este envio já está cancelado.' };
    }

    // Bloqueia a assinatura do lado da Autentique. Falha aqui não impede o
    // cancelamento interno — se o funcionário já abriu o link antes de
    // cancelarmos, não há o que fazer do nosso lado de qualquer forma.
    if (atual.autentique_doc_id) {
      try {
        await autentiqueCancelarDocumento(atual.autentique_doc_id);
      } catch (e: any) {
        console.error('Falha ao bloquear documento na Autentique ao cancelar:', e.message);
      }
    }

    const { error } = await db
      .from('folha_holerite_assinaturas')
      .update({
        status: 'CANCELADO',
        cancelado_por: canceladoPor || null,
        cancelado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString()
      })
      .eq('funcionario_nome', funcionarioNome)
      .eq('mes_referencia', mesReferencia);
    if (error) throw new Error(error.message);

    registrarLogAuditoria({
      usuario_nome: canceladoPor || 'Sistema',
      acao: `CANCELOU ENVIO DE HOLERITE PARA ASSINATURA: ${mesReferencia}`,
      setor: 'RECURSOS HUMANOS',
      equipamento_nome: funcionarioNome,
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}