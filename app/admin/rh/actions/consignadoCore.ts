// Lógica de negócio do Consignado, SEM "use server" — só funções puras/de banco,
// importadas tanto por actions-consignado.ts (que expõe as versões protegidas por
// accessToken pra UI) quanto por app/api/cron/consignado/route.ts (rotina diária,
// já protegida por CRON_SECRET, sem sessão de usuário). Ficar fora de um arquivo
// "use server" é o que garante que esta função não vira um endpoint de Server
// Action chamável direto por qualquer um — só é alcançável via import server-side.
//
// Ver app/admin/rh/actions/actions-consignado.ts para o contexto completo da
// integração (DATAPREV/GOV.BR, layout do arquivo, etc.) — os comentários deste
// arquivo cobrem só o que foi movido pra cá.
import { supabaseAdmin } from '../../../lib/supabase';
import { dispararAutomacoesPorEventoWhatsApp, dispararAutomacoesPorEventoEmail } from '../../../lib/automacoes';

export type StatusConsultaConsignado = 'NAO_CONFIGURADO' | 'OK' | 'SEM_CONSIGNACAO' | 'ERRO';

export interface EmprestimoConsignado {
  contrato: string;
  matricula: string;
  instituicaoCodigo: string;
  instituicaoNome: string;
  valorParcela: number;
  totalParcelas: number;
  valorEmprestimo: number;
  valorLiberado: number;
  dataInicioContrato: string;
  dataFimContrato: string;
  competenciaInicioDesconto: string;
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

export type ResultadoConsignado = { ok: boolean; erro?: string; info?: any };
type Funcionario = { nome_completo: string; cpf: string | null };

const MENSAGENS_CODIGO_RETORNO: Record<string, string> = {
  CT: 'Competência inválida ou ainda não fechada pela Dataprev para consulta (a competência mensal fecha sempre dia 20).',
  PR: 'O certificado digital usado não possui procuração outorgada pelo CNPJ do empregador.',
  SJ: 'O CNPJ configurado (GOVBR_CONSIGNADO_CNPJ) está com o dígito verificador inválido.',
  SP: 'O CNPJ configurado (GOVBR_CONSIGNADO_CNPJ) não é um CNPJ raiz ou completo válido.',
  SQ: 'CPF informado com dígito verificador inválido.',
  OZ: 'O serviço "Crédito Trabalhador" da Dataprev está suspenso no momento.'
};

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

export function agruparPorCpf(registros: any[]): Map<string, EmprestimoConsignado[]> {
  const porCpf = new Map<string, EmprestimoConsignado[]>();
  for (const r of registros) {
    const cpfTrabalhador = String(campo(r, 'cpf') || '').replace(/\D/g, '');
    if (!cpfTrabalhador) continue;
    if (!porCpf.has(cpfTrabalhador)) porCpf.set(cpfTrabalhador, []);
    porCpf.get(cpfTrabalhador)!.push(mapearRegistroParaEmprestimo(r));
  }
  return porCpf;
}

export function construirLista(
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

export async function buscarFuncionariosAtivos(empresaIds: number[] | null = null): Promise<Funcionario[]> {
  const db = supabaseAdmin();
  let q = db
    .from('folha_funcionarios')
    .select('nome_completo, cpf')
    .eq('ativo', true)
    .order('nome_completo');
  if (empresaIds) q = q.in('empresa_id', empresaIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

function dataBrParaIso(dataBr: string | null | undefined): string | null {
  const m = String(dataBr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function competenciaBrParaIso(compBr: string | null | undefined): string | null {
  const m = String(compBr || '').match(/^(\d{2})\/(\d{4})$/);
  return m ? `${m[2]}-${m[1]}` : null;
}
export function isoParaDataBr(iso: string | null | undefined): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
}
export function isoParaCompetenciaBr(iso: string | null | undefined): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : (iso || '');
}

interface LinhaConsignadoDB {
  cpf: string;
  funcionario_nome: string;
  empresa_id: number | null;
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

async function notificarNovosConsignados(novos: LinhaConsignadoDB[], competenciaIso: string) {
  const nomesUnicos = [...new Set(novos.map(n => n.funcionario_nome))];
  const contexto = {
    quantidade: novos.length,
    funcionarios: nomesUnicos.join(', '),
    competencia: isoParaCompetenciaBr(competenciaIso) || competenciaIso || '—',
  };

  await Promise.allSettled([
    dispararAutomacoesPorEventoWhatsApp('NOVO_EMPRESTIMO_CONSIGNADO', contexto),
    dispararAutomacoesPorEventoEmail('NOVO_EMPRESTIMO_CONSIGNADO', contexto, 'Novo empréstimo consignado identificado'),
  ]);
}

export async function persistirConsignacoesEDetectarNovos(registros: any[], origem: 'ARQUIVO' | 'API'): Promise<number> {
  if (registros.length === 0) return 0;
  const db = supabaseAdmin();

  const competenciaIso = competenciaBrParaIso(campo(registros[0], 'competencia')) || '';
  const agora = new Date().toISOString();

  // empresa_id vem do funcionário casado por CPF (mais confiável que nome
  // aqui, já que o registro do GOV.BR/arquivo traz CPF sempre) — cai em null
  // se o CPF não bater com ninguém cadastrado (ex.: ex-funcionário).
  const { data: todosFuncs } = await db.from('folha_funcionarios').select('nome_completo, cpf, empresa_id');
  const empresaPorCpf = new Map<string, number | null>(
    (todosFuncs || []).filter(f => f.cpf).map(f => [String(f.cpf).replace(/\D/g, ''), f.empresa_id])
  );

  const linhas: LinhaConsignadoDB[] = registros.map((r) => {
    const cpfLimpo = String(campo(r, 'cpf') || '').replace(/\D/g, '');
    return {
    cpf: cpfLimpo,
    funcionario_nome: String(campo(r, 'nomeTrabalhador') || ''),
    empresa_id: empresaPorCpf.get(cpfLimpo) ?? null,
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
    };
  }).filter(l => l.cpf && l.contrato);

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
    const https = require('node:https');
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      minVersion: 'TLSv1.2',
      pfx: tls.pfx,
      passphrase: tls.passphrase,
      headers: { Accept: 'application/json' }
    }, (res: any) => {
      let raw = '';
      res.on('data', (chunk: any) => { raw += chunk; });
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

async function consultarConsignacoesEmpregadorGovBr(competencia: string): Promise<ConsultaResultado> {
  const fs = require('node:fs');
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

// Consulta ao vivo + persiste + detecta novos — chamada tanto pela action da UI
// (protegida por accessToken em actions-consignado.ts) quanto pela rotina diária
// em app/api/cron/consignado/route.ts (protegida por CRON_SECRET). Ficar aqui,
// fora do arquivo "use server", é o que impede que ela vire um endpoint de
// Server Action alcançável direto por RPC sem nenhuma das duas proteções.
export async function listarConsignados(competencia: string /* AAAAMM */, empresaIds: number[] | null = null): Promise<ResultadoConsignado> {
  try {
    const funcionarios = await buscarFuncionariosAtivos(empresaIds);
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
