"use server";

// app/portal/actions/actions-ponto.ts
// Espelho de ponto do PRÓPRIO funcionário logado, só leitura. Mesma lógica de
// montagem dia a dia usada em actions-assinatura.ts (gerarEspelhoPontoBytes),
// mas devolvendo os dados prontos para a tabela do Portal e, opcionalmente,
// o PDF gerado sob demanda (não há PDF arquivado fora do fluxo de assinatura
// de holerite — aqui ele é gerado na hora, não persistido).
import { supabaseAdmin } from '../../lib/supabase';
import { resolverFuncionarioPortal } from './actions-acesso';
import { gerarEspelhoPontoPdf, RegistroPontoDia } from '../../lib/gerarEspelhoPontoPdf';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ERRO_SESSAO = 'Sessão inválida ou expirada. Faça login novamente.';

async function montarEspelhoDoMes(db: ReturnType<typeof supabaseAdmin>, funcionarioNome: string, mesReferencia: string) {
  const [ano, mes] = mesReferencia.split('-');
  const dataInicio = `${ano}-${mes}-01`;
  const dataFim = `${ano}-${mes}-${new Date(Number(ano), Number(mes), 0).getDate()}`;

  const [{ data: func }, { data: pontoData }, { data: abonoData }, { data: fData }] = await Promise.all([
    db.from('folha_funcionarios').select('cpf, data_admissao, data_desligamento, empresa_id').eq('nome_completo', funcionarioNome).maybeSingle(),
    db.from('folha_ponto_diaria')
      .select('data_registro, minutos_trabalhados, entrada_1, saida_1, entrada_2, saida_2')
      .eq('funcionario_nome', funcionarioNome)
      .gte('data_registro', dataInicio).lte('data_registro', dataFim),
    db.from('folha_ponto_abono')
      .select('data_abono, minutos_abonados, motivo')
      .eq('funcionario_nome', funcionarioNome)
      .gte('data_abono', dataInicio).lte('data_abono', dataFim),
    db.from('folha_feriados').select('data_feriado'),
  ]);

  const porDia: Record<string, RegistroPontoDia> = {};
  (pontoData || []).forEach((r: any) => {
    porDia[r.data_registro] = {
      data: r.data_registro, entrada_1: r.entrada_1, saida_1: r.saida_1,
      entrada_2: r.entrada_2, saida_2: r.saida_2,
      minutosTrabalhados: r.minutos_trabalhados || 0, minutosAbonados: 0, motivoAbono: null,
    };
  });
  (abonoData || []).forEach((a: any) => {
    if (!porDia[a.data_abono]) {
      porDia[a.data_abono] = {
        data: a.data_abono, entrada_1: null, saida_1: null, entrada_2: null, saida_2: null,
        minutosTrabalhados: 0, minutosAbonados: 0, motivoAbono: null,
      };
    }
    porDia[a.data_abono].minutosAbonados = a.minutos_abonados || 0;
    porDia[a.data_abono].motivoAbono = a.motivo || null;
  });

  let empresaNome = 'RENTECH';
  if (func?.empresa_id) {
    const { data: empresa } = await db.from('empresas').select('nome').eq('id', func.empresa_id).maybeSingle();
    empresaNome = empresa?.nome || empresaNome;
  }

  return {
    cpf: func?.cpf || null,
    dataAdmissao: func?.data_admissao || null,
    dataDesligamento: func?.data_desligamento || null,
    registros: Object.values(porDia),
    feriados: (fData || []).map((f: any) => f.data_feriado),
    empresaNome,
  };
}

export async function buscarMeuEspelhoPontoAction(accessToken: string, mesReferencia: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const espelho = await montarEspelhoDoMes(db, func.funcionarioNome, mesReferencia);
    return { ok: true, info: espelho };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function baixarMeuEspelhoPontoPdfAction(accessToken: string, mesReferencia: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const espelho = await montarEspelhoDoMes(db, func.funcionarioNome, mesReferencia);
    const bytes = await gerarEspelhoPontoPdf({
      nome: func.funcionarioNome,
      cpf: espelho.cpf,
      mesReferencia,
      registros: espelho.registros,
      feriados: espelho.feriados,
      dataAdmissao: espelho.dataAdmissao,
      dataDesligamento: espelho.dataDesligamento,
      empresaNome: espelho.empresaNome,
    });
    return { ok: true, info: { pdfBase64: Buffer.from(bytes).toString('base64') } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
