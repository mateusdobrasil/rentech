// app/portal/lib/espelhoPonto.ts
// Montagem do espelho de ponto do mês, extraída de actions-ponto.ts para poder
// ser chamada tanto pela Server Action do Portal web (app/portal/actions/actions-ponto.ts)
// quanto pela Route Handler usada pelo app mobile (app/api/portal/espelho-ponto/route.ts).
// Módulos "use server" só podem exportar Server Actions — funções soltas de
// dentro deles não são um jeito confiável de compartilhar lógica com uma Route
// Handler, daí a extração pra cá.
import { supabaseAdmin } from '../../lib/supabase';
import { RegistroPontoDia } from '../../lib/gerarEspelhoPontoPdf';

export interface EspelhoDoMes {
  cpf: string | null;
  dataAdmissao: string | null;
  dataDesligamento: string | null;
  registros: RegistroPontoDia[];
  feriados: string[];
  empresaNome: string;
}

export async function montarEspelhoDoMes(
  db: ReturnType<typeof supabaseAdmin>,
  funcionarioNome: string,
  mesReferencia: string
): Promise<EspelhoDoMes> {
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
  (pontoData || []).forEach((r: {
    data_registro: string; minutos_trabalhados: number | null;
    entrada_1: string | null; saida_1: string | null; entrada_2: string | null; saida_2: string | null;
  }) => {
    porDia[r.data_registro] = {
      data: r.data_registro, entrada_1: r.entrada_1, saida_1: r.saida_1,
      entrada_2: r.entrada_2, saida_2: r.saida_2,
      minutosTrabalhados: r.minutos_trabalhados || 0, minutosAbonados: 0, motivoAbono: null,
    };
  });
  (abonoData || []).forEach((a: { data_abono: string; minutos_abonados: number | null; motivo: string | null }) => {
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
    feriados: (fData || []).map((f: { data_feriado: string }) => f.data_feriado),
    empresaNome,
  };
}
