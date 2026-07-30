'use server';

// Server actions para a tela de Consignado (empréstimos consignados dos
// funcionários) integrando com o layout "Crédito Trabalhador" da DATAPREV
// (Manual "Dados de consignações para empregadores" v1.7 / leiaute de
// arquivo v1.4 — mesmos campos, dois formatos de acesso):
//
// 1) Consulta ao vivo via API (consultarConsignacoesEmpregadorGovBr): exige
//    certificado digital ICP-Brasil em mTLS vinculado ao CNPJ do empregador
//    (não é OAuth client_id/secret). Ainda não configurado neste projeto.
// 2) Importação manual do arquivo baixado no Portal Emprega Brasil
//    (importarConsignacoesArquivoAction): não depende de certificado — o
//    empregador baixa o JSON mensalmente no portal e importa aqui. Usável
//    hoje, enquanto o certificado da API não sai.
//
// Os dois caminhos alimentam a MESMA tabela porque os campos são idênticos;
// a única diferença observada é o formato das chaves compostas: o arquivo
// baixado do portal usa chaves "achatadas" com ponto literal no nome
// (ex.: {"ifConcessora.codigo": 626}), enquanto a API por certificado pode
// devolver objetos aninhados de verdade (ex.: {"ifConcessora": {"codigo":
// 626}}) — campo() abaixo lê os dois formatos sem duplicar lógica.
//
// Persistência: cada consulta/importação grava um retrato em `folha_consignados`
// (tabela criada manualmente via SQL — ver scratchpad/criar-tabela-folha_consignados.sql
// combinado nesta conversa), com upsert por (cpf, instituicao_codigo, contrato).
// Contratos que desaparecem de um lote pra outro são marcados ativo=false
// (quitados/encerrados). Contratos que aparecem pela primeira vez disparam a
// automação 'novo-emprestimo-consignado' (WhatsApp + E-mail, configurada em
// /admin/agendamentos).
//
// Variáveis de ambiente da API ao vivo (ainda não configuradas):
//   GOVBR_CONSIGNADO_CNPJ              — CNPJ do empregador (com ou sem máscara)
//   GOVBR_CONSIGNADO_CERT_PFX_BASE64   — certificado .pfx/.p12 (ICP-Brasil) em base64
//   GOVBR_CONSIGNADO_CERT_PFX_PATH     — alternativa: caminho local do .pfx (uso em dev)
//   GOVBR_CONSIGNADO_CERT_SENHA        — senha do certificado
//   GOVBR_CONSIGNADO_AMBIENTE          — "homologacao" (padrão) ou "producao"
import https from 'node:https';
import fs from 'node:fs';
import { supabaseAdmin } from '../../../lib/supabase';
import { dispararAutomacaoWhatsApp, dispararAutomacaoEmail } from '../../../lib/automacoes';

// Chave técnica da automação em folha_automacoes que recebe o aviso de novo
// empréstimo. Gerada automaticamente a partir do NOME digitado na tela
// Agendamentos e Disparos — para bater com esta chave, o card precisa se
// chamar exatamente "Novo Empréstimo Consignado".
const CHAVE_AUTOMACAO_NOVO_CONSIGNADO = 'novo-emprestimo-consignado';

export type StatusConsultaConsignado = 'NAO_CONFIGURADO' | 'OK' | 'SEM_CONSIGNACAO' | 'ERRO';

export interface EmprestimoConsignado {
  contrato: string;
  matricula: string; // matrícula atribuída pelo EMPREGADOR (vem no próprio registro de consignação — não é a matrícula/registro do eSocial)
  instituicaoCodigo: string;
  instituicaoNome: string;
  valorParcela: number;
  totalParcelas: number;
  valorEmprestimo: number;
  valorLiberado: number;
  dataInicioContrato: string; // dd/mm/yyyy
  dataFimContrato: string;
  competenciaInicioDesconto: string; // mm/yyyy
  competenciaFimDesconto: string;
}

export interface ConsignadoFuncionario {
  nome_completo: string;
  cpf: string | null;
  matricula: string | null;
  status: StatusConsultaConsignado;
  mensagem: string | null;
  qtd_emprestimos: number;
  valor_total_parcelas: number;
  emprestimos: EmprestimoConsignado[];
  consultado_em: string | null;
}

type Resultado = { ok: boolean; erro?: string; info?: any };
type Funcionario = { nome_completo: string; cpf: string | null };

// Mensagens dos códigos de retorno documentados no Apêndice 4.1 do manual da API.
const MENSAGENS_CODIGO_RETORNO: Record<string, string> = {
  CT: 'Competência inválida ou ainda não fechada pela Dataprev para consulta (a competência mensal fecha sempre dia 20).',
  PR: 'O certificado digital usado não possui procuração outorgada pelo CNPJ do empregador.',
  SJ: 'O CNPJ configurado (GOVBR_CONSIGNADO_CNPJ) está com o dígito verificador inválido.',
  SP: 'O CNPJ configurado (GOVBR_CONSIGNADO_CNPJ) não é um CNPJ raiz ou completo válido.',
  SQ: 'CPF informado com dígito verificador inválido.',
  OZ: 'O serviço "Crédito Trabalhador" da Dataprev está suspenso no momento.'
};

// Lê um campo aceitando tanto a chave achatada literal (formato do arquivo
// do Portal Emprega Brasil, ex.: "ifConcessora.codigo") quanto o caminho
// aninhado equivalente (formato mais comum de JSON de API REST).
function campo(r: any, chaveAchatada: string, ...caminhoAninhado: string[]): any {
  if (r && Object.prototype.hasOwnProperty.call(r, chaveAchatada)) return r[chaveAchatada];
  let atual = r;
  for (const parte of caminhoAninhado) {
    if (atual == null) return undefined;
    atual = atual[parte];
  }
  return atual;
}

function mapearRegistroParaEmprestimo(r: any): EmprestimoConsignado {
  return {
    contrato: String(campo(r, 'contrato') ?? ''),
    matricula: String(campo(r, 'matricula') ?? ''),
    instituicaoCodigo: String(campo(r, 'ifConcessora.codigo', 'ifConcessora', 'codigo') ?? ''),
    instituicaoNome: String(campo(r, 'ifConcessora.descricao', 'ifConcessora', 'descricao') ?? ''),
    valorParcela: Number(campo(r, 'valorParcela')) || 0,
    totalParcelas: Number(campo(r, 'totalParcelas')) || 0,
    valorEmprestimo: Number(campo(r, 'valorEmprestimo')) || 0,
    valorLiberado: Number(campo(r, 'valorLiberado')) || 0,
    dataInicioContrato: String(campo(r, 'dataInicioContrato') ?? ''),
    dataFimContrato: String(campo(r, 'dataFimContrato') ?? ''),
    competenciaInicioDesconto: String(campo(r, 'competenciaInicioDesconto') ?? ''),
    competenciaFimDesconto: String(campo(r, 'competenciaFimDesconto') ?? '')
  };
}

function agruparPorCpf(registros: any[]): Map<string, EmprestimoConsignado[]> {
  const porCpf = new Map<string, EmprestimoConsignado[]>();
  for (const r of registros) {
    const cpfTrabalhador = String(campo(r, 'cpf') || '').replace(/\D/g, '');
    if (!cpfTrabalhador) continue;
    if (!porCpf.has(cpfTrabalhador)) porCpf.set(cpfTrabalhador, []);
    porCpf.get(cpfTrabalhador)!.push(mapearRegistroParaEmprestimo(r));
  }
  return porCpf;
}

// Junta o cadastro interno (funcionários ativos) com as consignações
// agrupadas por CPF. Se erroGlobal estiver preenchido, todo mundo recebe
// esse status/mensagem (ex.: integração não configurada, ou falha na API).
function construirLista(
  funcionarios: Funcionario[],
  porCpf: Map<string, EmprestimoConsignado[]>,
  erroGlobal: { status: StatusConsultaConsignado; mensagem: string } | null,
  consultadoEm: string | null
): ConsignadoFuncionario[] {
  return funcionarios.map((f) => {
    if (!f.cpf) {
      return {
        nome_completo: f.nome_completo, cpf: null, matricula: null,
        status: 'ERRO', mensagem: 'Funcionário sem CPF cadastrado.',
        qtd_emprestimos: 0, valor_total_parcelas: 0, emprestimos: [], consultado_em: null
      };
    }

    if (erroGlobal) {
      return {
        nome_completo: f.nome_completo, cpf: f.cpf, matricula: null,
        status: erroGlobal.status, mensagem: erroGlobal.mensagem,
        qtd_emprestimos: 0, valor_total_parcelas: 0, emprestimos: [], consultado_em: null
      };
    }

    const cpfDigits = f.cpf.replace(/\D/g, '');
    const emprestimos = porCpf.get(cpfDigits) || [];
    const valorTotal = emprestimos.reduce((acc, e) => acc + e.valorParcela, 0);
    // A matrícula vem do próprio registro de consignação (atribuída pelo
    // empregador na Dataprev), não do cadastro interno — pega do primeiro empréstimo.
    const matricula = emprestimos.find(e => e.matricula)?.matricula || null;

    return {
      nome_completo: f.nome_completo, cpf: f.cpf, matricula,
      status: emprestimos.length > 0 ? 'OK' : 'SEM_CONSIGNACAO',
      mensagem: emprestimos.length > 0 ? null : 'Nenhuma consignação apta a desconto nesta competência.',
      qtd_emprestimos: emprestimos.length, valor_total_parcelas: valorTotal,
      emprestimos, consultado_em: consultadoEm
    };
  });
}

async function buscarFuncionariosAtivos(): Promise<Funcionario[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('folha_funcionarios')
    .select('nome_completo, cpf')
    .eq('ativo', true)
    .order('nome_completo');
  if (error) throw new Error(error.message);
  return data || [];
}

// dd/mm/yyyy -> yyyy-mm-dd (para gravar em coluna `date`); mm/yyyy -> yyyy-mm.
function dataBrParaIso(dataBr: string | null | undefined): string | null {
  const m = String(dataBr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function competenciaBrParaIso(compBr: string | null | undefined): string | null {
  const m = String(compBr || '').match(/^(\d{2})\/(\d{4})$/);
  return m ? `${m[2]}-${m[1]}` : null;
}
function isoParaDataBr(iso: string | null | undefined): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
}
function isoParaCompetenciaBr(iso: string | null | undefined): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : (iso || '');
}

interface LinhaConsignadoDB {
  cpf: string;
  funcionario_nome: string;
  matricula: string | null;
  instituicao_codigo: string;
  instituicao_nome: string;
  contrato: string;
  valor_parcela: number;
  total_parcelas: number | null;
  valor_emprestimo: number | null;
  valor_liberado: number | null;
  data_inicio_contrato: string | null;
  data_fim_contrato: string | null;
  competencia_inicio_desconto: string | null;
  competencia_fim_desconto: string | null;
  competencia: string;
  origem: 'ARQUIVO' | 'API';
  ativo: boolean;
  importado_em: string;
}

// Dispara a automação (WhatsApp + E-mail) cadastrada em /admin/agendamentos
// com o nome "Novo Empréstimo Consignado" (chave gerada: 'novo-emprestimo-consignado').
// Ambos os disparos são no-op silencioso se a automação não existir, estiver
// desativada, ou não tiver o canal correspondente marcado — dispararAutomacaoWhatsApp
// e dispararAutomacaoEmail já tratam isso.
async function notificarNovosConsignados(novos: LinhaConsignadoDB[], competenciaIso: string) {
  const nomesUnicos = [...new Set(novos.map(n => n.funcionario_nome))];
  const contexto = {
    quantidade: novos.length,
    funcionarios: nomesUnicos.join(', '),
    competencia: isoParaCompetenciaBr(competenciaIso) || competenciaIso || '—',
  };

  await Promise.allSettled([
    dispararAutomacaoWhatsApp(CHAVE_AUTOMACAO_NOVO_CONSIGNADO, contexto),
    dispararAutomacaoEmail(CHAVE_AUTOMACAO_NOVO_CONSIGNADO, contexto, 'Novo empréstimo consignado identificado'),
  ]);
}

// Grava o lote (upsert por cpf+instituicao+contrato), desativa contratos que
// sumiram do lote, detecta quais chaves nunca tinham sido vistas (= "novo
// empréstimo") e dispara a notificação quando há alguma. Retorna quantos eram novos.
async function persistirConsignacoesEDetectarNovos(registros: any[], origem: 'ARQUIVO' | 'API'): Promise<number> {
  if (registros.length === 0) return 0;
  const db = supabaseAdmin();

  const competenciaIso = competenciaBrParaIso(campo(registros[0], 'competencia')) || '';
  const agora = new Date().toISOString();

  const linhas: LinhaConsignadoDB[] = registros.map((r) => ({
    cpf: String(campo(r, 'cpf') || '').replace(/\D/g, ''),
    funcionario_nome: String(campo(r, 'nomeTrabalhador') || ''),
    matricula: campo(r, 'matricula') ? String(campo(r, 'matricula')) : null,
    instituicao_codigo: String(campo(r, 'ifConcessora.codigo', 'ifConcessora', 'codigo') ?? ''),
    instituicao_nome: String(campo(r, 'ifConcessora.descricao', 'ifConcessora', 'descricao') ?? ''),
    contrato: String(campo(r, 'contrato') || ''),
    valor_parcela: Number(campo(r, 'valorParcela')) || 0,
    total_parcelas: Number(campo(r, 'totalParcelas')) || null,
    valor_emprestimo: Number(campo(r, 'valorEmprestimo')) || null,
    valor_liberado: Number(campo(r, 'valorLiberado')) || null,
    data_inicio_contrato: dataBrParaIso(campo(r, 'dataInicioContrato')),
    data_fim_contrato: dataBrParaIso(campo(r, 'dataFimContrato')),
    competencia_inicio_desconto: competenciaBrParaIso(campo(r, 'competenciaInicioDesconto')),
    competencia_fim_desconto: competenciaBrParaIso(campo(r, 'competenciaFimDesconto')),
    competencia: competenciaIso,
    origem,
    ativo: true,
    importado_em: agora,
  })).filter(l => l.cpf && l.contrato);

  if (linhas.length === 0) return 0;

  const { data: existentes, error: erroSelect } = await db
    .from('folha_consignados')
    .select('cpf, instituicao_codigo, contrato');
  if (erroSelect) throw new Error(erroSelect.message);

  const chavesExistentes = new Set((existentes || []).map(e => `${e.cpf}|${e.instituicao_codigo}|${e.contrato}`));
  const novos = linhas.filter(l => !chavesExistentes.has(`${l.cpf}|${l.instituicao_codigo}|${l.contrato}`));

  const { error: erroUpsert } = await db
    .from('folha_consignados')
    .upsert(linhas, { onConflict: 'cpf,instituicao_codigo,contrato' });
  if (erroUpsert) throw new Error(erroUpsert.message);

  // Contratos que estavam ativos mas não vieram neste lote = quitados/encerrados.
  const chavesDoLote = new Set(linhas.map(l => `${l.cpf}|${l.instituicao_codigo}|${l.contrato}`));
  const { data: ativosAtuais } = await db
    .from('folha_consignados')
    .select('id, cpf, instituicao_codigo, contrato')
    .eq('ativo', true);
  const idsParaDesativar = (ativosAtuais || [])
    .filter(a => !chavesDoLote.has(`${a.cpf}|${a.instituicao_codigo}|${a.contrato}`))
    .map(a => a.id);
  if (idsParaDesativar.length > 0) {
    await db.from('folha_consignados').update({ ativo: false }).in('id', idsParaDesativar);
  }

  if (novos.length > 0) {
    await notificarNovosConsignados(novos, competenciaIso).catch(e =>
      console.error('Falha ao notificar novos consignados:', e)
    );
  }

  return novos.length;
}

function requestComCertificado(urlStr: string, tls: { pfx: Buffer; passphrase: string }): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      minVersion: 'TLSv1.2',
      pfx: tls.pfx,
      passphrase: tls.passphrase,
      headers: { Accept: 'application/json' }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed: any = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode || 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

type ConsultaResultado =
  | { ok: true; registros: any[] }
  | { ok: false; status: StatusConsultaConsignado; mensagem: string };

// Ponto único de integração com a API "Crédito Trabalhador" da Dataprev.
// Uma única chamada cobre TODOS os funcionários do CNPJ para a competência
// pedida.
async function consultarConsignacoesEmpregadorGovBr(competencia: string): Promise<ConsultaResultado> {
  const cnpj = (process.env.GOVBR_CONSIGNADO_CNPJ || '').replace(/\D/g, '');
  const pfxBase64 = process.env.GOVBR_CONSIGNADO_CERT_PFX_BASE64;
  const pfxPath = process.env.GOVBR_CONSIGNADO_CERT_PFX_PATH;
  const senha = process.env.GOVBR_CONSIGNADO_CERT_SENHA;
  const ambiente = (process.env.GOVBR_CONSIGNADO_AMBIENTE || 'homologacao').toLowerCase();

  if (!cnpj || !senha || (!pfxBase64 && !pfxPath)) {
    return {
      ok: false,
      status: 'NAO_CONFIGURADO',
      mensagem: 'Integração ao vivo com a API do GOV.BR ainda não configurada — faltam CNPJ e/ou certificado digital ICP-Brasil (GOVBR_CONSIGNADO_CNPJ, GOVBR_CONSIGNADO_CERT_PFX_BASE64, GOVBR_CONSIGNADO_CERT_SENHA). Use a importação manual do arquivo do Portal Emprega Brasil enquanto isso.'
    };
  }

  const baseUrl = ambiente === 'producao' ? 'https://papiecotrab.dataprev.gov.br' : 'https://hapidf-mssl.dataprev.gov.br';
  const url = `${baseUrl}/credito-trabalhador-empregador/v1.0.0/dados-consignacoes-empregador?codigoInscricao=1&numeroInscricao=${cnpj}&competencia=${competencia}`;

  try {
    const pfx = pfxBase64 ? Buffer.from(pfxBase64, 'base64') : fs.readFileSync(pfxPath!);
    const { status, body } = await requestComCertificado(url, { pfx, passphrase: senha });

    if (status >= 200 && status < 300) {
      const registros: any[] = Array.isArray(body) ? body : (body?.registros || body?.consignacoes || (body ? [body] : []));
      return { ok: true, registros };
    }

    const codigo = body?.codigo || body?.code || '';

    // LF = "Consulta não encontrou registros": não é erro, é a empresa sem
    // nenhuma consignação apta a desconto nessa competência.
    if (codigo === 'LF') {
      return { ok: true, registros: [] };
    }

    const mensagemApi = body?.mensagem || body?.message || body?.erro || '';
    return {
      ok: false,
      status: 'ERRO',
      mensagem: MENSAGENS_CODIGO_RETORNO[codigo] || mensagemApi || `Falha na consulta ao GOV.BR (HTTP ${status}).`
    };
  } catch (e: any) {
    return { ok: false, status: 'ERRO', mensagem: `Falha de conexão com a API do GOV.BR: ${e.message}` };
  }
}

// ============================================================================
// CARREGAMENTO PADRÃO DA TELA — último retrato persistido em folha_consignados
// ============================================================================
export async function listarConsignadosPersistidosAction(): Promise<Resultado> {
  try {
    const db = supabaseAdmin();
    const funcionarios = await buscarFuncionariosAtivos();

    const { data: linhas, error } = await db
      .from('folha_consignados')
      .select('*')
      .eq('ativo', true);
    if (error) throw new Error(error.message);

    const porCpf = new Map<string, EmprestimoConsignado[]>();
    let ultimaAtualizacao: string | null = null;
    let competenciaMaisRecente: string | null = null;

    for (const l of (linhas || [])) {
      const emprestimo: EmprestimoConsignado = {
        contrato: l.contrato,
        matricula: l.matricula || '',
        instituicaoCodigo: l.instituicao_codigo,
        instituicaoNome: l.instituicao_nome,
        valorParcela: Number(l.valor_parcela) || 0,
        totalParcelas: Number(l.total_parcelas) || 0,
        valorEmprestimo: Number(l.valor_emprestimo) || 0,
        valorLiberado: Number(l.valor_liberado) || 0,
        dataInicioContrato: isoParaDataBr(l.data_inicio_contrato),
        dataFimContrato: isoParaDataBr(l.data_fim_contrato),
        competenciaInicioDesconto: isoParaCompetenciaBr(l.competencia_inicio_desconto),
        competenciaFimDesconto: isoParaCompetenciaBr(l.competencia_fim_desconto),
      };
      if (!porCpf.has(l.cpf)) porCpf.set(l.cpf, []);
      porCpf.get(l.cpf)!.push(emprestimo);

      if (!ultimaAtualizacao || l.importado_em > ultimaAtualizacao) ultimaAtualizacao = l.importado_em;
      if (!competenciaMaisRecente || l.competencia > competenciaMaisRecente) competenciaMaisRecente = l.competencia;
    }

    const lista = construirLista(funcionarios, porCpf, null, ultimaAtualizacao);
    return {
      ok: true,
      info: {
        lista,
        competencia: isoParaCompetenciaBr(competenciaMaisRecente),
        atualizadoEm: ultimaAtualizacao,
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// LISTAGEM AO VIVO — via API (certificado digital)
// ============================================================================
export async function listarConsignadosAction(competencia: string /* AAAAMM */): Promise<Resultado> {
  try {
    const funcionarios = await buscarFuncionariosAtivos();
    const consulta = await consultarConsignacoesEmpregadorGovBr(competencia);

    if (!consulta.ok) {
      const lista = construirLista(funcionarios, new Map(), { status: consulta.status, mensagem: consulta.mensagem }, null);
      return { ok: true, info: { lista, novosDetectados: 0 } };
    }

    const novosDetectados = await persistirConsignacoesEDetectarNovos(consulta.registros, 'API');

    const porCpf = agruparPorCpf(consulta.registros);
    const lista = construirLista(funcionarios, porCpf, null, new Date().toISOString());
    return { ok: true, info: { lista, novosDetectados } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// IMPORTAÇÃO MANUAL — arquivo baixado no Portal Emprega Brasil (sem certificado)
// ============================================================================
export async function importarConsignacoesArquivoAction(payload: { registros: any[] }): Promise<Resultado> {
  try {
    const registros = Array.isArray(payload.registros) ? payload.registros : [];
    if (registros.length === 0) {
      return { ok: false, erro: 'O arquivo não contém registros de consignação.' };
    }

    const novosDetectados = await persistirConsignacoesEDetectarNovos(registros, 'ARQUIVO');

    const funcionarios = await buscarFuncionariosAtivos();
    const porCpf = agruparPorCpf(registros);
    const lista = construirLista(funcionarios, porCpf, null, new Date().toISOString());

    // Todos os registros de um mesmo arquivo compartilham a mesma competência.
    const competenciaArquivo = String(campo(registros[0], 'competencia') ?? '');

    return { ok: true, info: { lista, competencia: competenciaArquivo, novosDetectados } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
