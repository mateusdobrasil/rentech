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
// A lógica de negócio (consulta GOV.BR, persistência, montagem de lista) vive
// em consignadoCore.ts, SEM "use server" — é reaproveitada também pela rotina
// diária em app/api/cron/consignado/route.ts (protegida por CRON_SECRET, sem
// sessão de usuário). As actions daqui só validam accessToken+permissão de
// rota (validarAcesso) e delegam pro core; assim o cron não precisa de sessão
// admin, e a UI não passa por uma action sem checagem.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import {
  buscarFuncionariosAtivos, construirLista, agruparPorCpf, isoParaCompetenciaBr,
  persistirConsignacoesEDetectarNovos, listarConsignados,
  type ResultadoConsignado, type ConsignadoFuncionario,
} from './consignadoCore';

export type { ConsignadoFuncionario, ResultadoConsignado };

const ROTA = '/admin/financeiro/consignado';

// ============================================================================
// CARREGAMENTO PADRÃO DA TELA — último retrato persistido em folha_consignados
// ============================================================================
export async function listarConsignadosPersistidosAction(accessToken: string): Promise<ResultadoConsignado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  try {
    const db = supabaseAdmin();
    const funcionarios = await buscarFuncionariosAtivos();

    const { data: linhas, error } = await db
      .from('folha_consignados')
      .select('*')
      .eq('ativo', true);
    if (error) throw new Error(error.message);

    const porCpf = new Map<string, any[]>();
    let ultimaAtualizacao: string | null = null;
    let competenciaMaisRecente: string | null = null;

    for (const l of (linhas || [])) {
      const emprestimo = {
        contrato: l.contrato,
        matricula: l.matricula || '',
        instituicaoCodigo: l.instituicao_codigo,
        instituicaoNome: l.instituicao_nome,
        valorParcela: Number(l.valor_parcela) || 0,
        totalParcelas: Number(l.total_parcelas) || 0,
        valorEmprestimo: Number(l.valor_emprestimo) || 0,
        valorLiberado: Number(l.valor_liberado) || 0,
        dataInicioContrato: l.data_inicio_contrato,
        dataFimContrato: l.data_fim_contrato,
        competenciaInicioDesconto: l.competencia_inicio_desconto,
        competenciaFimDesconto: l.competencia_fim_desconto,
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
export async function listarConsignadosAction(competencia: string /* AAAAMM */, accessToken: string): Promise<ResultadoConsignado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  return listarConsignados(competencia);
}

// ============================================================================
// IMPORTAÇÃO MANUAL — arquivo baixado no Portal Emprega Brasil (sem certificado)
// ============================================================================
export async function importarConsignacoesArquivoAction(payload: { registros: any[] }, accessToken: string): Promise<ResultadoConsignado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  try {
    const registros = Array.isArray(payload.registros) ? payload.registros : [];
    if (registros.length === 0) {
      return { ok: false, erro: 'O arquivo não contém registros de consignação.' };
    }

    const novosDetectados = await persistirConsignacoesEDetectarNovos(registros, 'ARQUIVO');

    const funcionarios = await buscarFuncionariosAtivos();
    const porCpf = agruparPorCpf(registros);
    const lista = construirLista(funcionarios, porCpf, null, new Date().toISOString());

    const competenciaArquivo = String(registros[0]?.competencia ?? '');

    return { ok: true, info: { lista, competencia: competenciaArquivo, novosDetectados } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
