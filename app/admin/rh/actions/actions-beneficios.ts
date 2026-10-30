'use server';

// app/admin/rh/actions-beneficios.ts
// Gestão de benefícios fixos (vale-alimentação, saúde, etc.) com histórico.
// O VR/VT NÃO é gravado aqui — é lido do holerite (contrato + ficha) e apenas
// exibido junto no painel, para não duplicar a fonte da verdade.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { indexarFeriados, feriadosDaEmpresa } from '../../../lib/feriados';
import { registrarLogAuditoria } from '../../../actions';
import { gravarGeracaoBeneficios, categoriaMeio, pedidosFlashCancelados, inicioDaCompetencia, type BaseBeneficios } from '../../../lib/beneficiosGeracoes';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTAS_PERMITIDAS = ['/admin/rh/beneficios', '/admin/rh/relatorios'];

async function validarAcessoQualquerRota(accessToken: string) {
  for (const rota of ROTAS_PERMITIDAS) {
    const acesso = await validarAcesso(accessToken, rota);
    if (acesso.ok) return acesso;
  }
  return { ok: false as const, message: 'Você não tem permissão para executar esta ação.' };
}

// ============================================================================
// DIAS ÚTEIS DO MÊS (seg-sex menos feriados cadastrados) — mesma régua do holerite
// ============================================================================
// ============================================================================
// DIAS ÚTEIS DO MÊS (seg-sex menos feriados) — mesma régua do holerite.
// Aceita janela opcional [inicio, fim] para contar só o período trabalhado
// (admissão/desligamento no meio do mês → benefício proporcional).
// ============================================================================
function diasUteisNoPeriodo(ano: number, mes: number, feriados: Set<string>, inicioIso?: string | null, fimIso?: string | null): number {
  const ultimoDia = new Date(ano, mes, 0).getDate();
  let uteis = 0;
  for (let d = 1; d <= ultimoDia; d++) {
    const diaSemana = new Date(ano, mes - 1, d).getDay(); // 0=dom, 6=sáb
    const iso = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (diaSemana === 0 || diaSemana === 6 || feriados.has(iso)) continue;
    if (inicioIso && iso < inicioIso) continue;   // antes da admissão
    if (fimIso && iso > fimIso) continue;          // depois do desligamento
    uteis++;
  }
  return uteis;
}

// ============================================================================
// BENEFÍCIOS CALCULADOS DE UM MÊS (para o relatório financeiro)
// Valor único = valor direto; por diária = valor × dias úteis do mês.
// ============================================================================
export async function beneficiosDoMesAction(payload: { mesReferencia: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { diasUteisMes, itens } = await calcularBeneficiosMes(db, payload.mesReferencia, empresasPermitidas);

    // Agrupa por funcionário
    const porFunc: Record<string, any> = {};
    itens.forEach(it => {
      (porFunc[it.funcionario_nome] ||= { funcionario_nome: it.funcionario_nome, itens: [], total: 0 });
      porFunc[it.funcionario_nome].itens.push({ tipo: it.tipo, meio: it.meio, modalidade: it.modalidade, valorBase: it.valorBase, valorMes: it.valorMes, detalhe: it.detalhe });
      porFunc[it.funcionario_nome].total += it.valorMes;
    });

    return { ok: true, info: { diasUteis: diasUteisMes, funcionarios: Object.values(porFunc) } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// NÚCLEO: calcula os benefícios de um mês, com proporcionalidade por
// admissão/desligamento. Reutilizado pelo relatório e pelo grid.
// ============================================================================
// opcoes.dataCorte (ISO): em vez do cadastro atual, usa o cadastro como estava
// naquele instante (reconstituído desfazendo folha_beneficios_historico) — ver
// beneficiosNaData.
export async function calcularBeneficiosMes(db: ReturnType<typeof supabaseAdmin>, mesAno: string, empresaIds: number[] | null = null, opcoes: { dataCorte?: string } = {}) {
  const [ano, mes] = mesAno.split('-').map(Number);
  const primeiroDoMes = `${ano}-${String(mes).padStart(2, '0')}-01`;

  const { data: fers } = await db.from('folha_feriados').select('*');
  const indiceFeriados = indexarFeriados(fers);

  // Dias úteis do mês cheio (referência para quem trabalhou o mês todo).
  // Usa só os feriados gerais: este número é único no retorno, e o municipal
  // varia por empresa (Rentech em São Paulo/SP, Alfa Light em Osasco/SP). O
  // cálculo de cada funcionário, abaixo, usa os feriados da empresa dele.
  const diasUteisMes = diasUteisNoPeriodo(ano, mes, indiceFeriados.gerais);

  // Data de admissão e status de cada funcionário. empresaIds (null = sem
  // restrição) exclui da fonte quem está fora do escopo do usuário logado —
  // como diasUteisTrabalhados() só reconhece nomes presentes aqui, o filtro
  // se propaga naturalmente pros itens calculados.
  let qFuncs = db.from('folha_funcionarios')
    .select('nome_completo, data_admissao, ativo, empresa_id');
  if (empresaIds) qFuncs = qFuncs.in('empresa_id', empresaIds);
  const { data: funcs } = await qFuncs;
  const dadosFunc: Record<string, { adm: string | null; ativo: boolean; empresaId: number | null }> = {};
  (funcs || []).forEach(f => { dadosFunc[f.nome_completo] = { adm: f.data_admissao, ativo: f.ativo !== false, empresaId: f.empresa_id ?? null }; });

  // Dias úteis trabalhados no mês por funcionário (respeitando admissão).
  // Desligado (ativo=false) NÃO entra aqui — nem proporcional ao próprio mês
  // do desligamento — por decisão explícita do usuário (2026-09-17): só
  // ativo recebe pelo Grid/Flash de benefícios. Corrigido nessa data porque
  // JOSE APARECIDO SILVA DE LIMA (desligado 14/09) ainda aparecia no
  // Grid/Flash de setembro, proporcional aos dias trabalhados antes de sair.
  const diasUteisTrabalhados = (nome: string): number => {
    const d = dadosFunc[nome];
    if (!d) return 0; // funcionário não encontrado no cadastro atual
    if (!d.ativo) return 0; // desligado — fora do Grid/Flash, sem exceção
    if (d.adm && d.adm.slice(0, 7) > mesAno) return 0; // admitido depois do mês
    const inicio = (d.adm && d.adm > primeiroDoMes) ? d.adm : null;
    return diasUteisNoPeriodo(ano, mes, feriadosDaEmpresa(indiceFeriados, d.empresaId), inicio, null);
  };

  const { data: tipos } = await db.from('folha_beneficio_tipos').select('id, nome');
  const { data: meios } = await db.from('folha_beneficio_meios').select('id, nome');
  const beneficios = opcoes.dataCorte
    ? await beneficiosNaData(db, opcoes.dataCorte, meios || [])
    : (await db.from('folha_beneficios')
      .select('id, funcionario_nome, valor_mensal, modalidade, qtd_dias, tipo_id, meio_id')
      .eq('ativo', true)).data;
  const nomeTipo = (id: number) => tipos?.find(t => t.id === id)?.nome || '—';
  const nomeMeio = (id: number) => meios?.find(m => m.id === id)?.nome || '—';

  const itens = (beneficios || [])
    .map(b => {
      const diasTrab = diasUteisTrabalhados(b.funcionario_nome);
      const parcial = diasTrab < diasUteisMes; // trabalhou só parte do mês
      let valorMes: number;
      let detalhe: string;

      if (b.modalidade === 'POR_DIARIA') {
        // Proporcional: dias úteis dentro do período trabalhado
        valorMes = Number(b.valor_mensal) * diasTrab;
        detalhe = `${BRLnum(Number(b.valor_mensal))}/dia × ${diasTrab} úteis${parcial ? ' (proporc.)' : ''}`;
      } else if (b.modalidade === 'DIAS_FIXOS') {
        // Teto: min(dias digitados, dias úteis trabalhados)
        const digitados = Number(b.qtd_dias) || 0;
        const diasPagos = Math.min(digitados, diasTrab);
        valorMes = Number(b.valor_mensal) * diasPagos;
        detalhe = `${BRLnum(Number(b.valor_mensal))}/dia × ${diasPagos} dias${diasPagos < digitados ? ` (teto ${digitados}, proporc.)` : ''}`;
      } else {
        // Valor único: não é proporcional, mas só é devido se trabalhou no mês
        valorMes = diasTrab > 0 ? Number(b.valor_mensal) : 0;
        detalhe = diasTrab > 0 ? 'valor único' : 'sem direito (inativo no mês)';
      }

      return {
        funcionario_nome: b.funcionario_nome,
        tipo: nomeTipo(b.tipo_id), meio: nomeMeio(b.meio_id),
        modalidade: b.modalidade, valorBase: Number(b.valor_mensal), valorMes, detalhe,
        diasTrab, parcial
      };
    })
    // Sem nenhum dia trabalhado no mês (inativo/desligado fora do período): não entra no grid
    .filter(it => it.diasTrab > 0);

  return { ano, mes, diasUteisMes, itens };
}

// Cadastro de benefícios como estava em `dataCorte`: parte do estado atual de
// cada registro (ativos e removidos) e desfaz, do mais recente pro mais
// antigo, o que o histórico registrou depois do corte (valor, meio, ativação
// e — desde .sql/folha_beneficios_historico_modalidade.sql — modalidade/dias;
// antes disso a troca de modalidade não era registrada e fica como hoje).
async function beneficiosNaData(db: ReturnType<typeof supabaseAdmin>, dataCorte: string, meios: { id: number; nome: string }[]) {
  const corte = new Date(dataCorte).getTime();
  const { data: todos } = await db.from('folha_beneficios')
    .select('id, funcionario_nome, valor_mensal, modalidade, qtd_dias, tipo_id, meio_id, ativo, criado_em');
  // '*' porque as colunas de modalidade só existem depois do SQL acima
  const { data: hist } = await db.from('folha_beneficios_historico')
    .select('*')
    .gt('alterado_em', dataCorte)
    .order('alterado_em', { ascending: false });
  const idMeio = (nome: string | null) => meios.find(m => m.nome === nome)?.id;

  const depoisPorBeneficio: Record<number, any[]> = {};
  (hist || []).forEach(h => { (depoisPorBeneficio[h.beneficio_id] ||= []).push(h); });

  return (todos || []).flatMap(b => {
    if (b.criado_em && new Date(b.criado_em).getTime() > corte) return [];
    let ativo = b.ativo !== false;
    let valor = b.valor_mensal;
    let meioId = b.meio_id;
    let modalidade = b.modalidade;
    let qtdDias = b.qtd_dias;
    for (const h of depoisPorBeneficio[b.id] || []) {
      if (h.acao === 'CRIADO') return [];
      if (h.acao === 'DESATIVADO') ativo = true;
      else if (h.acao === 'REATIVADO') ativo = false;
      else if (h.acao === 'VALOR_ALTERADO' && h.valor_anterior != null) valor = h.valor_anterior;
      else if (h.acao === 'MEIO_ALTERADO') meioId = idMeio(h.meio_anterior) ?? meioId;
      else if (h.acao === 'MODALIDADE_ALTERADA') {
        if (h.modalidade_anterior) modalidade = h.modalidade_anterior;
        qtdDias = h.qtd_dias_anterior ?? null;
      }
    }
    return ativo ? [{ ...b, valor_mensal: valor, meio_id: meioId, modalidade, qtd_dias: qtdDias }] : [];
  });
}

const BRLnum = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ============================================================================
// ARQUIVO FLASH: linhas do pedido de benefícios para o cartão Flash.
// Só funcionários com benefício de meio "CARTÃO FLASH". Mapeia por nome do tipo:
//   TRANSPORTE/MOBILIDADE → Mobilidade | ALIMENTA/REFEI → Refeição e Alimentação
//   demais → Premiação no cartão. Valores do mês (diária × dias úteis).
// Uma linha por funcionário; montado no servidor pelo "Gerar Benefício", sem
// confiar em valores vindos do cliente. itensPre = já calculado pelo chamador.
// ============================================================================
async function montarLinhasFlash(
  db: ReturnType<typeof supabaseAdmin>, mesReferencia: string, empresasPermitidas: number[] | null,
  itensPre?: Awaited<ReturnType<typeof calcularBeneficiosMes>>['itens']
) {
  const CNPJ_RENTECH_FALLBACK = '22.618.891/0001-87';
  {
    // Reutiliza o núcleo de cálculo do mês (já aplica proporcionalidade)
    const itens = itensPre ?? (await calcularBeneficiosMes(db, mesReferencia, empresasPermitidas)).itens;

    // CPF + CNPJ (real da empresa do funcionário, não fixo em Rentech — a
    // planilha Flash é por CNPJ empregador) de cada funcionário.
    const { data: funcs } = await db.from('folha_funcionarios').select('nome_completo, cpf, empresa_id');
    const { data: empresasCad } = await db.from('empresas').select('id, cnpj');
    // empresas.cnpj é gravado só com dígitos (ver /admin/parametros/empresas) —
    // formata igual ao padrão usado no restante do sistema (00.000.000/0000-00).
    const formatarCnpj = (v: string): string => {
      const d = String(v || '').replace(/\D/g, '');
      return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v;
    };
    const cnpjPorEmpresaId: Record<number, string> = {};
    (empresasCad || []).forEach(e => { if (e.cnpj) cnpjPorEmpresaId[e.id] = formatarCnpj(e.cnpj); });
    const cpfPorNome: Record<string, string> = {};
    const cnpjPorNome: Record<string, string> = {};
    const empresaPorNome: Record<string, number | null> = {};
    (funcs || []).forEach(f => {
      cpfPorNome[f.nome_completo] = f.cpf || '';
      empresaPorNome[f.nome_completo] = f.empresa_id ?? null;
      cnpjPorNome[f.nome_completo] = (f.empresa_id && cnpjPorEmpresaId[f.empresa_id]) || CNPJ_RENTECH_FALLBACK;
    });

    const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

    // Só benefícios com meio CARTÃO FLASH
    const flashItens = itens.filter(it => norm(it.meio).includes('FLASH'));

    // Agrupa por funcionário, distribuindo nos campos da Flash
    const porFunc: Record<string, { mobilidade: number; refAlim: number; premiacao: number }> = {};
    flashItens.forEach(it => {
      const tipo = norm(it.tipo);
      (porFunc[it.funcionario_nome] ||= { mobilidade: 0, refAlim: 0, premiacao: 0 });
      if (tipo.includes('TRANSPORTE') || tipo.includes('MOBILIDADE')) {
        porFunc[it.funcionario_nome].mobilidade += it.valorMes;
      } else if (tipo.includes('ALIMENTA') || tipo.includes('REFEI')) {
        porFunc[it.funcionario_nome].refAlim += it.valorMes;
      } else {
        porFunc[it.funcionario_nome].premiacao += it.valorMes;
      }
    });

    // Monta as linhas na ordem das colunas da planilha
    const linhas = Object.entries(porFunc)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([nome, v]) => ({
        cnpj: cnpjPorNome[nome] || CNPJ_RENTECH_FALLBACK,
        nome,
        cpf: cpfPorNome[nome] || '',
        empresaId: empresaPorNome[nome] ?? null,
        mobilidade: v.mobilidade,
        refeicao: 0,
        alimentacao: 0,
        premiacaoCartao: v.premiacao,
        refeicaoEAlimentacao: v.refAlim,
        premiacaoVirtual: 0
      }));

    return linhas;
  }
}

// ============================================================================
// GERAR BENEFÍCIO (botão do Grid) — grava no banco a folha de benefícios do
// mês de quem ficou marcado (folha_beneficios_geracoes, origem BENEFICIO):
//   - Cartão Flash → pedido Flash (GERADO) + linhas do arquivo, devolvidas pro
//     cliente baixar SÓ depois de gravado. A Flash não devolve rastreio: depois
//     de pagar lá, o RH confirma em "Pedidos Flash" (PAGO + data).
//   - O resto → fica esperando o lote do Financeiro RH, fonte Benefícios
//     (beneficiosGeradosParaLote em app/lib/beneficiosGeracoes.ts).
// Valores sempre recalculados aqui, nunca vindos do cliente. Lido também pelo
// Resumo de Recebimentos do holerite (actions-assinatura.ts).
// Tabelas: .sql/folha_beneficios_flash_pedidos.sql, .sql/folha_beneficios_geracoes*.sql
// ============================================================================
// INICIO_MES = cadastro como estava na virada da competência (benefício é pago
// adiantado — o que mudou depois já é do mês seguinte); ATUAL = cadastro de hoje.
const opcoesDaBase = (mesReferencia: string, base?: BaseBeneficios) =>
  base === 'INICIO_MES' ? { dataCorte: inicioDaCompetencia(mesReferencia) } : {};

const totalLinhaFlash = (l: any) =>
  (l.mobilidade || 0) + (l.refeicao || 0) + (l.alimentacao || 0) + (l.premiacaoCartao || 0) + (l.refeicaoEAlimentacao || 0) + (l.premiacaoVirtual || 0);
const arred = (v: number) => Math.round(v * 100) / 100;

export async function gerarBeneficioAction(payload: {
  mesReferencia: string;
  nomes: string[]; // funcionario_nome de quem ficou marcado no Grid
  base?: BaseBeneficios; // a mesma do Grid exibido
  // "Já foi pago — só registrar": competência paga por fora. Grava o histórico
  // já pago (pedido Flash nasce PAGO, nada vai pro lote) e não baixa arquivo.
  jaPagoEm?: string | null; // 'AAAA-MM-DD'
  usuarioNome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const usuario = payload.usuarioNome || acesso.perfil.nome;
  const jaPagoEm = payload.jaPagoEm || null;
  if (jaPagoEm && !/^\d{4}-\d{2}-\d{2}$/.test(jaPagoEm)) return { ok: false, erro: 'Informe a data em que foi pago.' };
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { itens } = await calcularBeneficiosMes(db, payload.mesReferencia, empresasPermitidas, opcoesDaBase(payload.mesReferencia, payload.base));
    const marcados = new Set(payload.nomes);
    const selecionados = itens.filter(it => marcados.has(it.funcionario_nome) && it.valorMes > 0);
    if (selecionados.length === 0) return { ok: false, erro: 'Nenhum benefício dos funcionários selecionados.' };

    const nomesFlash = new Set(selecionados.filter(it => categoriaMeio(it.meio) === 'FLASH').map(it => it.funcionario_nome));
    const linhasFlash = (await montarLinhasFlash(db, payload.mesReferencia, empresasPermitidas, selecionados))
      .filter(l => nomesFlash.has(l.nome))
      .map(l => ({ ...l, total: totalLinhaFlash(l) }));
    const valorFlash = arred(linhasFlash.reduce((s, l) => s + l.total, 0));
    const lote = selecionados.filter(it => categoriaMeio(it.meio) !== 'FLASH');
    const valorLote = arred(lote.reduce((s, it) => s + it.valorMes, 0));

    let pedidoId: number | null = null;
    if (linhasFlash.length > 0) {
      const { data, error } = await db.from('folha_beneficios_flash_pedidos').insert({
        mes_referencia: payload.mesReferencia,
        itens: linhasFlash,
        qtd_funcionarios: linhasFlash.length,
        valor_total: valorFlash,
        gerado_por: usuario,
        ...(jaPagoEm ? { status: 'PAGO', pago_em: jaPagoEm, confirmado_por: usuario, confirmado_em: new Date().toISOString() } : {})
      }).select('id').single();
      if (error) throw new Error(`Pedido Flash não gravado: ${error.message}`);
      pedidoId = data.id;
    }

    const geracao = await gravarGeracaoBeneficios(db, {
      mesReferencia: payload.mesReferencia, origem: 'BENEFICIO', referenciaId: pedidoId,
      funcionarios: [...new Set(selecionados.map(it => it.funcionario_nome))],
      itens: selecionados,
      geradoPor: usuario,
      pagoEm: jaPagoEm
    });
    if (!geracao.ok) {
      // Sem a geração, o pedido Flash ficaria órfão (e o lote não veria nada): desfaz
      if (pedidoId) await db.from('folha_beneficios_flash_pedidos').delete().eq('id', pedidoId);
      return { ok: false, erro: `Benefício não gravado: ${geracao.erro}` };
    }

    const qtdLote = new Set(lote.map(it => it.funcionario_nome)).size;
    registrarLogAuditoria({
      usuario_nome: usuario,
      acao: `${jaPagoEm ? `REGISTROU BENEFÍCIOS JÁ PAGOS EM ${jaPagoEm.split('-').reverse().join('/')}` : 'GEROU BENEFÍCIOS'} #${geracao.id} (${payload.mesReferencia}, ${payload.base === 'INICIO_MES' ? 'cadastro de 01/' + payload.mesReferencia.slice(5) : 'cadastro atual'}): ` +
        `${pedidoId ? `Flash #${pedidoId} ${linhasFlash.length} func. ${BRLnum(valorFlash)}` : 'sem Flash'}; ` +
        `lote ${qtdLote} func. ${BRLnum(valorLote)}`,
      setor: 'RECURSOS HUMANOS',
    });
    return {
      ok: true,
      info: { geracaoId: geracao.id, pedidoId, linhasFlash, valorFlash, qtdFlash: linhasFlash.length, valorLote, qtdLote, jaPagoEm }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function listarPedidosFlashAction(payload: { mesReferencia: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data, error } = await db.from('folha_beneficios_flash_pedidos')
      .select('*').eq('mes_referencia', payload.mesReferencia).order('gerado_em', { ascending: false });
    if (error) throw new Error(error.message);
    // Só mostra pedido que tenha alguém da(s) empresa(s) do usuário
    const pedidos = (data || []).filter(p =>
      !empresasPermitidas || (Array.isArray(p.itens) ? p.itens : []).some((l: any) => empresaPermitida(empresasPermitidas, l.empresaId)));
    return { ok: true, info: { pedidos } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Pedido inteiro só pode ser confirmado/cancelado por quem enxerga todos os
// funcionários dele — senão um usuário só-Rentech mexeria em linhas da AlfaLight.
async function buscarPedidoFlashEditavel(db: ReturnType<typeof supabaseAdmin>, pedidoId: number, empresasPermitidas: number[] | null) {
  const { data: pedido } = await db.from('folha_beneficios_flash_pedidos').select('*').eq('id', pedidoId).maybeSingle();
  if (!pedido) return { erro: 'Pedido não encontrado.' };
  const itens: any[] = Array.isArray(pedido.itens) ? pedido.itens : [];
  if (empresasPermitidas && !itens.every(l => empresaPermitida(empresasPermitidas, l.empresaId))) {
    return { erro: 'Este pedido tem funcionários de uma empresa que você não acessa.' };
  }
  return { pedido };
}

export async function confirmarPagamentoFlashAction(payload: {
  pedidoId: number;
  dataPagamento: string; // 'AAAA-MM-DD'
  usuarioNome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.dataPagamento || '')) return { ok: false, erro: 'Informe a data do pagamento.' };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const r = await buscarPedidoFlashEditavel(db, payload.pedidoId, empresasPermitidas);
    if (r.erro) return { ok: false, erro: r.erro };
    if (r.pedido.status !== 'GERADO') return { ok: false, erro: `Pedido já está ${r.pedido.status === 'PAGO' ? 'pago' : 'cancelado'}.` };

    const { error } = await db.from('folha_beneficios_flash_pedidos').update({
      status: 'PAGO', pago_em: payload.dataPagamento,
      confirmado_por: payload.usuarioNome || acesso.perfil.nome, confirmado_em: new Date().toISOString()
    }).eq('id', payload.pedidoId).eq('status', 'GERADO');
    if (error) throw new Error(error.message);

    registrarLogAuditoria({
      usuario_nome: payload.usuarioNome || acesso.perfil.nome,
      acao: `CONFIRMOU PAGAMENTO DO PEDIDO FLASH #${payload.pedidoId} (${r.pedido.mes_referencia}) EM ${payload.dataPagamento.split('-').reverse().join('/')}`,
      setor: 'RECURSOS HUMANOS',
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function cancelarPedidoFlashAction(payload: { pedidoId: number; usuarioNome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const r = await buscarPedidoFlashEditavel(db, payload.pedidoId, empresasPermitidas);
    if (r.erro) return { ok: false, erro: r.erro };
    if (r.pedido.status !== 'GERADO') return { ok: false, erro: 'Só é possível cancelar um pedido ainda não pago.' };

    const { error } = await db.from('folha_beneficios_flash_pedidos').update({
      status: 'CANCELADO', cancelado_por: payload.usuarioNome || acesso.perfil.nome, cancelado_em: new Date().toISOString()
    }).eq('id', payload.pedidoId).eq('status', 'GERADO');
    if (error) throw new Error(error.message);

    registrarLogAuditoria({
      usuario_nome: payload.usuarioNome || acesso.perfil.nome,
      acao: `CANCELOU PEDIDO FLASH #${payload.pedidoId} (${r.pedido.mes_referencia})`,
      setor: 'RECURSOS HUMANOS',
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Quem já teve benefício gerado no mês (botão "Gerar Benefício") — o Grid
// mostra aviso e já vem desmarcado, pra não sair Flash/lote em dobro. Não
// conta quem só tinha Flash e o pedido foi cancelado (pode gerar de novo).
async function jaGeradosNoMes(db: ReturnType<typeof supabaseAdmin>, mesReferencia: string): Promise<Record<string, { em: string; geracaoId: number; pagoEm: string | null }>> {
  const { data, error } = await db.from('folha_beneficios_geracoes')
    .select('id, referencia_id, funcionarios, itens, gerado_em, pago_em')
    .eq('mes_referencia', mesReferencia).eq('origem', 'BENEFICIO')
    .order('gerado_em', { ascending: false });
  if (error || !data?.length) return {};
  const cancelados = await pedidosFlashCancelados(db, data);
  const resultado: Record<string, { em: string; geracaoId: number; pagoEm: string | null }> = {};
  data.forEach(g => {
    const flashCancelado = g.referencia_id != null && cancelados.has(g.referencia_id);
    (Array.isArray(g.funcionarios) ? g.funcionarios : []).forEach((nome: string) => {
      if (resultado[nome]) return;
      const seus = (g.itens || []).filter((it: any) => it.funcionario_nome === nome);
      const valeAinda = !flashCancelado || seus.some((it: any) => categoriaMeio(it.meio) !== 'FLASH');
      if (valeAinda) resultado[nome] = { em: g.gerado_em, geracaoId: g.id, pagoEm: g.pago_em || null };
    });
  });
  return resultado;
}

// ============================================================================
// GRID CONSOLIDADO DE BENEFÍCIOS (para a aba e o financeiro)
// Retorna: por funcionário (itens + total) E por meio de pagamento + total geral.
// ============================================================================
export async function gridBeneficiosAction(payload: { mesReferencia: string; meioId?: number | null; base?: BaseBeneficios }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { diasUteisMes, itens } = await calcularBeneficiosMes(db, payload.mesReferencia, empresasPermitidas, opcoesDaBase(payload.mesReferencia, payload.base));

    // Filtro opcional por meio de pagamento
    let filtrados = itens;
    if (payload.meioId) {
      const { data: meios } = await db.from('folha_beneficio_meios').select('id, nome');
      const nomeMeioAlvo = meios?.find(m => m.id === payload.meioId)?.nome;
      if (nomeMeioAlvo) filtrados = itens.filter(it => it.meio === nomeMeioAlvo);
    }

    // Colunas = tipos de benefício que aparecem (ordenados alfabeticamente)
    const tiposSet = new Set<string>();
    filtrados.forEach(it => tiposSet.add(it.tipo));
    const colunas = Array.from(tiposSet).sort((a, b) => a.localeCompare(b));

    // Linhas = funcionários, com o valor de cada tipo + detalhe compacto
    const porFunc: Record<string, any> = {};
    filtrados.forEach(it => {
      (porFunc[it.funcionario_nome] ||= { funcionario_nome: it.funcionario_nome, valores: {}, detalhes: {}, total: 0, totalFlash: 0, totalLote: 0 });
      porFunc[it.funcionario_nome].valores[it.tipo] = (porFunc[it.funcionario_nome].valores[it.tipo] || 0) + it.valorMes;
      // Destino no "Gerar Benefício": arquivo Flash ou lote do Financeiro RH
      if (categoriaMeio(it.meio) === 'FLASH') porFunc[it.funcionario_nome].totalFlash += it.valorMes;
      else porFunc[it.funcionario_nome].totalLote += it.valorMes;
      if (it.modalidade === 'POR_DIARIA' || it.modalidade === 'DIAS_FIXOS') {
        const dias = it.valorBase > 0 ? Math.round(it.valorMes / it.valorBase) : 0;
        porFunc[it.funcionario_nome].detalhes[it.tipo] = `${it.valorBase.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}×${dias}`;
      }
      porFunc[it.funcionario_nome].total += it.valorMes;
    });

    const funcionarios = Object.values(porFunc).sort((a: any, b: any) => a.funcionario_nome.localeCompare(b.funcionario_nome));

    // Totais por coluna (rodapé)
    const totaisColuna: Record<string, number> = {};
    colunas.forEach(c => { totaisColuna[c] = funcionarios.reduce((s: number, f: any) => s + (f.valores[c] || 0), 0); });
    const totalGeral = funcionarios.reduce((s: number, f: any) => s + f.total, 0);
    const jaGerados = await jaGeradosNoMes(db, payload.mesReferencia);

    return { ok: true, info: { diasUteis: diasUteisMes, colunas, funcionarios, totaisColuna, totalGeral, jaGerados } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CATÁLOGOS (tipos e meios)
// ============================================================================
export async function listarCatalogosBeneficioAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const [{ data: tipos }, { data: meios }] = await Promise.all([
      db.from('folha_beneficio_tipos').select('*').eq('ativo', true).order('nome'),
      db.from('folha_beneficio_meios').select('*').eq('ativo', true).order('nome'),
    ]);
    return { ok: true, info: { tipos: tipos || [], meios: meios || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarTipoBeneficioAction(payload: { nome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const nome = payload.nome.toUpperCase().trim();
  if (!nome) return { ok: false, erro: 'Digite um nome para o tipo de benefício.' };
  try {
    const { error } = await db.from('folha_beneficio_tipos').insert({ nome });
    if (error) {
      if (error.code === '23505') return { ok: false, erro: `"${nome}" já existe.` };
      throw new Error(error.message);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarMeioBeneficioAction(payload: { nome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const nome = payload.nome.toUpperCase().trim();
  if (!nome) return { ok: false, erro: 'Digite um nome para o meio de pagamento.' };
  try {
    const { error } = await db.from('folha_beneficio_meios').insert({ nome });
    if (error) {
      if (error.code === '23505') return { ok: false, erro: `"${nome}" já existe.` };
      throw new Error(error.message);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CONCESSÃO DE BENEFÍCIO (cria/atualiza + registra histórico)
// ============================================================================
export async function salvarBeneficioAction(payload: {
  id?: number;
  funcionarioNome: string;
  tipoId: number;
  meioId: number;
  valorMensal: number;
  modalidade: 'VALOR_UNICO' | 'POR_DIARIA' | 'DIAS_FIXOS';
  qtdDias?: number | null;
  observacao?: string | null;
  usuarioNome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { id, funcionarioNome, tipoId, meioId, valorMensal, modalidade, qtdDias, observacao, usuarioNome } = payload;

  if (!funcionarioNome || !tipoId || !meioId) {
    return { ok: false, erro: 'Funcionário, tipo e meio de pagamento são obrigatórios.' };
  }
  if (modalidade === 'DIAS_FIXOS' && (!qtdDias || qtdDias <= 0)) {
    return { ok: false, erro: 'Informe a quantidade de dias para a modalidade "Dias fixos".' };
  }

  const diasField = modalidade === 'DIAS_FIXOS' ? (qtdDias || null) : null;

  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: funcAlvo } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', funcionarioNome).maybeSingle();
    if (!empresaPermitida(empresasPermitidas, funcAlvo?.empresa_id)) {
      return { ok: false, erro: 'Você não tem permissão para conceder benefício a este funcionário.' };
    }

    // Nomes de meio para o histórico legível
    const { data: meios } = await db.from('folha_beneficio_meios').select('id, nome');
    const nomeMeio = (mid: number) => meios?.find(m => m.id === mid)?.nome || null;

    if (id) {
      // Atualização: compara com o atual para registrar o que mudou
      const { data: atual } = await db.from('folha_beneficios').select('*').eq('id', id).maybeSingle();
      if (!atual) return { ok: false, erro: 'Benefício não encontrado.' };

      const { error } = await db.from('folha_beneficios').update({
        tipo_id: tipoId, meio_id: meioId, valor_mensal: valorMensal, modalidade, qtd_dias: diasField,
        observacao: observacao || null, atualizado_em: new Date().toISOString()
      }).eq('id', id);
      if (error) {
        if (error.code === '23505') return { ok: false, erro: 'Este funcionário já tem (ou já teve, removido) este tipo de benefício. Use o +ADD com esse tipo para reativá-lo.' };
        throw new Error(error.message);
      }

      // Registra histórico das mudanças relevantes
      const historico: any[] = [];
      if (Number(atual.valor_mensal) !== Number(valorMensal)) {
        historico.push({ beneficio_id: id, valor_anterior: atual.valor_mensal, valor_novo: valorMensal, acao: 'VALOR_ALTERADO', alterado_por: usuarioNome });
      }
      if (atual.meio_id !== meioId) {
        historico.push({ beneficio_id: id, meio_anterior: nomeMeio(atual.meio_id), meio_novo: nomeMeio(meioId), acao: 'MEIO_ALTERADO', alterado_por: usuarioNome });
      }
      if (historico.length) await db.from('folha_beneficios_historico').insert(historico);
      const trocouModalidade = await registrarTrocaModalidade(db, id, atual, modalidade, diasField, usuarioNome);

      return { ok: true, info: { atualizado: true, mudancas: historico.length + (trocouModalidade ? 1 : 0) } };
    } else {
      // "Remover" só desativa (ativo=false) e a lista esconde os inativos, mas
      // a unique (funcionario_nome, tipo_id) continua valendo — então re-adicionar
      // um tipo já removido batia no 23505. Se existir inativo, reativa o mesmo
      // registro com os valores novos (preserva o histórico dele).
      const { data: existente } = await db.from('folha_beneficios')
        .select('id, ativo, valor_mensal, meio_id, modalidade, qtd_dias')
        .eq('funcionario_nome', funcionarioNome).eq('tipo_id', tipoId).maybeSingle();
      if (existente?.ativo) {
        return { ok: false, erro: 'Este funcionário já tem este tipo de benefício. Edite o existente.' };
      }
      if (existente) {
        const { error } = await db.from('folha_beneficios').update({
          ativo: true, meio_id: meioId, valor_mensal: valorMensal, modalidade, qtd_dias: diasField,
          observacao: observacao || null, atualizado_em: new Date().toISOString()
        }).eq('id', existente.id);
        if (error) throw new Error(error.message);

        const historico: any[] = [{ beneficio_id: existente.id, acao: 'REATIVADO', alterado_por: usuarioNome }];
        if (Number(existente.valor_mensal) !== Number(valorMensal)) {
          historico.push({ beneficio_id: existente.id, valor_anterior: existente.valor_mensal, valor_novo: valorMensal, acao: 'VALOR_ALTERADO', alterado_por: usuarioNome });
        }
        if (existente.meio_id !== meioId) {
          historico.push({ beneficio_id: existente.id, meio_anterior: nomeMeio(existente.meio_id), meio_novo: nomeMeio(meioId), acao: 'MEIO_ALTERADO', alterado_por: usuarioNome });
        }
        await db.from('folha_beneficios_historico').insert(historico);
        await registrarTrocaModalidade(db, existente.id, existente, modalidade, diasField, usuarioNome);

        return { ok: true, info: { criado: true, reativado: true } };
      }

      // Criação
      const { data: novo, error } = await db.from('folha_beneficios').insert({
        funcionario_nome: funcionarioNome, tipo_id: tipoId, meio_id: meioId,
        valor_mensal: valorMensal, modalidade, qtd_dias: diasField, observacao: observacao || null
      }).select('id').single();
      if (error) {
        if (error.code === '23505') return { ok: false, erro: 'Este funcionário já tem este tipo de benefício. Edite o existente.' };
        throw new Error(error.message);
      }

      await db.from('folha_beneficios_historico').insert({
        beneficio_id: novo.id, valor_novo: valorMensal, meio_novo: nomeMeio(meioId),
        acao: 'CRIADO', alterado_por: usuarioNome
      });

      return { ok: true, info: { criado: true } };
    }
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Troca de modalidade/dias vai num insert à parte: as colunas só existem depois
// de .sql/folha_beneficios_historico_modalidade.sql — sem elas este insert
// falha sozinho, sem levar junto o histórico de valor/meio.
async function registrarTrocaModalidade(
  db: ReturnType<typeof supabaseAdmin>, beneficioId: number,
  antes: { modalidade?: string | null; qtd_dias?: number | null },
  modalidade: string, qtdDias: number | null, usuarioNome: string
): Promise<boolean> {
  const modalidadeAntes = antes.modalidade || 'VALOR_UNICO';
  if (modalidadeAntes === modalidade && (antes.qtd_dias ?? null) === (qtdDias ?? null)) return false;
  const { error } = await db.from('folha_beneficios_historico').insert({
    beneficio_id: beneficioId, acao: 'MODALIDADE_ALTERADA',
    modalidade_anterior: modalidadeAntes, modalidade_nova: modalidade,
    qtd_dias_anterior: antes.qtd_dias ?? null, qtd_dias_novo: qtdDias ?? null,
    alterado_por: usuarioNome
  });
  return !error;
}

// Ativa/desativa um benefício (mantém histórico)
export async function alternarBeneficioAction(payload: {
  id: number; ativo: boolean; usuarioNome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: atual } = await db.from('folha_beneficios').select('funcionario_nome').eq('id', payload.id).maybeSingle();
    if (!atual) return { ok: false, erro: 'Benefício não encontrado.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: funcAlvo } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', atual.funcionario_nome).maybeSingle();
    if (!empresaPermitida(empresasPermitidas, funcAlvo?.empresa_id)) return { ok: false, erro: 'Benefício não encontrado.' };

    const { error } = await db.from('folha_beneficios').update({
      ativo: payload.ativo, atualizado_em: new Date().toISOString()
    }).eq('id', payload.id);
    if (error) throw new Error(error.message);

    await db.from('folha_beneficios_historico').insert({
      beneficio_id: payload.id, acao: payload.ativo ? 'REATIVADO' : 'DESATIVADO', alterado_por: payload.usuarioNome
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function historicoBeneficioAction(payload: { beneficioId: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: beneficio } = await db.from('folha_beneficios').select('funcionario_nome').eq('id', payload.beneficioId).maybeSingle();
    if (!beneficio) return { ok: false, erro: 'Benefício não encontrado.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: funcAlvo } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', beneficio.funcionario_nome).maybeSingle();
    if (!empresaPermitida(empresasPermitidas, funcAlvo?.empresa_id)) return { ok: false, erro: 'Benefício não encontrado.' };

    const { data, error } = await db.from('folha_beneficios_historico')
      .select('*').eq('beneficio_id', payload.beneficioId).order('alterado_em', { ascending: false });
    if (error) throw new Error(error.message);
    return { ok: true, info: { historico: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PAINEL CONSOLIDADO: junta benefícios fixos + VR/VT do sistema, por funcionário
// ============================================================================
export async function painelBeneficiosAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);

    // Funcionários ativos
    let qFuncs = db.from('folha_funcionarios')
      .select('nome_completo, tipo_contrato, cargo, empresa_id')
      .eq('ativo', true).order('nome_completo');
    if (empresasPermitidas) qFuncs = qFuncs.in('empresa_id', empresasPermitidas);
    const { data: funcs } = await qFuncs;

    // Benefícios fixos (ativos e removidos), com nomes de tipo e meio — a linha
    // de cada funcionário é montada a partir de `funcs` (já escopado acima),
    // então um `folha_beneficios` de funcionário fora do escopo simplesmente não
    // acha correspondência abaixo (benefPorFunc só é lido por nome de `funcs`).
    // Removidos (ativo=false) vêm à parte, só pra tela "Mostrar removidos".
    const { data: beneficios } = await db.from('folha_beneficios')
      .select('id, funcionario_nome, valor_mensal, modalidade, qtd_dias, ativo, observacao, tipo_id, meio_id, atualizado_em');
    const { data: tipos } = await db.from('folha_beneficio_tipos').select('id, nome');
    const { data: meios } = await db.from('folha_beneficio_meios').select('id, nome');
    const nomeTipo = (id: number) => tipos?.find(t => t.id === id)?.nome || '—';
    const nomeMeio = (id: number) => meios?.find(m => m.id === id)?.nome || '—';

    const benefPorFunc: Record<string, any[]> = {};
    const removidosPorFunc: Record<string, any[]> = {};
    (beneficios || []).forEach(b => {
      const destino = b.ativo === false ? removidosPorFunc : benefPorFunc;
      (destino[b.funcionario_nome] ||= []).push({
        id: b.id, tipoId: b.tipo_id, meioId: b.meio_id,
        tipo: nomeTipo(b.tipo_id), meio: nomeMeio(b.meio_id),
        valor: Number(b.valor_mensal), modalidade: b.modalidade || 'VALOR_UNICO',
        qtdDias: b.qtd_dias, observacao: b.observacao,
        ...(b.ativo === false ? { removidoEm: b.atualizado_em || null } : {})
      });
    });

    // Monta a linha de cada funcionário (só benefícios fixos; VR/VT vive no holerite)
    const linhas = (funcs || []).map(f => {
      const fixos = benefPorFunc[f.nome_completo] || [];
      const removidos = removidosPorFunc[f.nome_completo] || [];
      const totalFixos = fixos.filter(b => b.modalidade === 'VALOR_UNICO').reduce((s, b) => s + b.valor, 0);
      const temVariavel = fixos.some(b => b.modalidade !== 'VALOR_UNICO');
      return {
        nome: f.nome_completo,
        cargo: f.cargo,
        contrato: f.tipo_contrato,
        empresaId: f.empresa_id ?? null,
        beneficiosFixos: fixos,
        removidos,
        totalFixos,
        temVariavel,
        semNenhum: fixos.length === 0
      };
    });

    return { ok: true, info: { linhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}