'use server';

// app/admin/rh/actions/actions-relatorio-colaboradores.ts
// Relatório de Colaboradores (aba "Colaboradores" em /admin/rh/relatorios):
// ficha cadastral, contato, salário, benefícios ativos e bônus fixos de cada
// colaborador, com a situação de hoje (ativo, em férias, afastado, desligado).
//
// Montado no servidor: salário e benefícios são dado sensível, e a restrição
// por empresa sai do perfil de quem pede (obterEmpresasPermitidas), nunca de
// um valor vindo da tela.
//
// Salário, diária, benefícios e bônus só saem para quem também tem acesso ao
// Financeiro (rota /admin/financeiro, com o 2FA dela) — decisão de 2026-11-24.
// O perfil RH vê a lista, a situação e o contato, sem valores.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/rh/relatorios';
const ROTA_VALORES = '/admin/financeiro';

export type SituacaoColaborador = 'ATIVO' | 'FERIAS' | 'AFASTADO' | 'DESLIGADO';

export interface BeneficioColaborador {
  tipo: string;
  modalidade: string;          // VALOR_UNICO | DIAS_FIXOS | POR_DIARIA
  valor: number;               // valor cadastrado (por dia em POR_DIARIA/DIAS_FIXOS)
  qtdDias: number | null;
  mensal: number | null;       // valor do mês; null quando depende dos dias trabalhados
}

export interface BonusColaborador { descricao: string; valor: number; desde: string | null; ate: string | null }

export interface LinhaColaborador {
  id: string;
  nome: string;
  cpf: string | null;
  empresaId: number | null;
  cargo: string | null;
  departamento: string | null;
  tipoContrato: string | null;
  dataAdmissao: string | null;
  dataDesligamento: string | null;
  dataNascimento: string | null;
  situacao: SituacaoColaborador;
  situacaoDetalhe: string | null;   // ex.: "Férias até 12/12/2026", "Afastamento (INSS) até ..."
  celular: string | null;
  email: string | null;
  endereco: string | null;          // linha única: rua, nº, compl. — bairro — cidade — CEP
  salarioFolha: number;
  salarioContrato: number;
  valorDiaria: number;
  beneficios: BeneficioColaborador[];
  totalBeneficiosMes: number;       // soma só do que tem valor fixo no mês
  temBeneficioPorDiaria: boolean;
  bonusFixos: BonusColaborador[];
  totalBonusMes: number;
}

const hojeISO = () => {
  // data de hoje no fuso de São Paulo (o servidor roda em UTC)
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // YYYY-MM-DD
};

const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

export async function relatorioColaboradoresAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  try {
    const db = supabaseAdmin();
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const hoje = hojeISO();
    const mesAtual = hoje.slice(0, 7);
    // valores só para quem acessa o Financeiro; sem isso nem são consultados
    const verRemuneracao = (await validarAcesso(accessToken, ROTA_VALORES)).ok;
    const nada = Promise.resolve({ data: [] as any[], error: null });

    let qFuncs = db.from('folha_funcionarios').select(
      'id, nome_completo, cpf, empresa_id, cargo, departamento, tipo_contrato, data_admissao, data_desligamento, data_nascimento, ativo, ' +
      'celular, email, cep, cidade, endereco, numero, complemento, bairro' +
      (verRemuneracao ? ', salario_folha, salario_contrato, valor_diaria' : '')
    ).order('nome_completo');
    if (empresasPermitidas) qFuncs = qFuncs.in('empresa_id', empresasPermitidas);

    const [funcsRes, benRes, tiposRes, bonusRes, feriasRes, afastRes, tiposAfastRes] = await Promise.all([
      qFuncs,
      !verRemuneracao ? nada : db.from('folha_beneficios').select('funcionario_id, funcionario_nome, tipo_id, valor_mensal, modalidade, qtd_dias').eq('ativo', true),
      !verRemuneracao ? nada : db.from('folha_beneficio_tipos').select('id, nome'),
      !verRemuneracao ? nada : db.from('folha_bonus').select('funcionario_id, funcionario_nome, descricao, valor, mes_referencia, mes_fim').eq('recorrencia', 'MENSAL'),
      db.from('folha_ferias').select('funcionario_id, funcionario_nome, data_inicio_gozo, data_fim_gozo, status')
        .lte('data_inicio_gozo', hoje).gte('data_fim_gozo', hoje),
      db.from('folha_afastamentos').select('funcionario_id, funcionario_nome, tipo_id, data_inicio, data_fim, status')
        .eq('status', 'ATIVO').lte('data_inicio', hoje),
      db.from('folha_afastamento_tipos').select('id, nome'),
    ]);
    const erro = [funcsRes, benRes, tiposRes, bonusRes, feriasRes, afastRes, tiposAfastRes].find(r => r.error)?.error;
    if (erro) return { ok: false, erro: erro.message };

    // Registros ligados pela ficha (funcionario_id); os antigos sem id, pelo nome
    const chaves = (r: { funcionario_id?: string | null; funcionario_nome?: string | null }) =>
      [r.funcionario_id ? `id:${r.funcionario_id}` : null, r.funcionario_nome ? `nome:${r.funcionario_nome}` : null].filter(Boolean) as string[];
    function agrupar<T extends { funcionario_id?: string | null; funcionario_nome?: string | null }>(linhas: T[]) {
      const m = new Map<string, T[]>();
      for (const l of linhas) {
        // pelo id quando tem; só cai no nome quando o registro não tem id
        const k = l.funcionario_id ? `id:${l.funcionario_id}` : chaves(l)[0];
        if (!k) continue;
        m.set(k, [...(m.get(k) || []), l]);
      }
      return (f: { id: string; nome_completo: string }) => [
        ...(m.get(`id:${f.id}`) || []),
        ...(m.get(`nome:${f.nome_completo}`) || []),
      ];
    }

    const nomeTipo = new Map(((tiposRes.data || []) as any[]).map(t => [t.id, String(t.nome)]));
    const nomeTipoAfast = new Map(((tiposAfastRes.data || []) as any[]).map(t => [t.id, String(t.nome)]));
    const beneficiosDe = agrupar((benRes.data || []) as any[]);
    const bonusDe = agrupar(((bonusRes.data || []) as any[]).filter(b =>
      (!b.mes_referencia || b.mes_referencia <= mesAtual) && (!b.mes_fim || b.mes_fim >= mesAtual)));
    const feriasDe = agrupar(((feriasRes.data || []) as any[]).filter(f => !/CANCEL/i.test(String(f.status || ''))));
    const afastDe = agrupar(((afastRes.data || []) as any[]).filter(a => !a.data_fim || a.data_fim >= hoje));

    const linhas: LinhaColaborador[] = ((funcsRes.data || []) as any[]).map(f => {
      const beneficios: BeneficioColaborador[] = beneficiosDe(f).map((b: any) => {
        const valor = Number(b.valor_mensal) || 0;
        const qtd = b.qtd_dias != null ? Number(b.qtd_dias) : null;
        const mensal = b.modalidade === 'POR_DIARIA' ? null : b.modalidade === 'DIAS_FIXOS' ? valor * (qtd || 0) : valor;
        return { tipo: nomeTipo.get(b.tipo_id) || `Tipo ${b.tipo_id}`, modalidade: String(b.modalidade || 'VALOR_UNICO'), valor, qtdDias: qtd, mensal };
      }).sort((a, b) => a.tipo.localeCompare(b.tipo, 'pt-BR'));

      const bonusFixos: BonusColaborador[] = bonusDe(f).map((b: any) => ({
        descricao: String(b.descricao || 'Bônus'), valor: Number(b.valor) || 0, desde: b.mes_referencia || null, ate: b.mes_fim || null,
      }));

      let situacao: SituacaoColaborador = 'ATIVO';
      let situacaoDetalhe: string | null = null;
      if (!f.ativo) {
        situacao = 'DESLIGADO';
        situacaoDetalhe = f.data_desligamento ? `Desligado em ${dataBR(f.data_desligamento)}` : 'Inativo sem data de desligamento';
      } else {
        const af = afastDe(f)[0] as any;
        const fe = feriasDe(f)[0] as any;
        if (af) {
          situacao = 'AFASTADO';
          situacaoDetalhe = `${nomeTipoAfast.get(af.tipo_id) || 'Afastamento'}${af.data_fim ? ` até ${dataBR(af.data_fim)}` : ' (sem data de volta)'}`;
        } else if (fe) {
          situacao = 'FERIAS';
          situacaoDetalhe = `Férias até ${dataBR(fe.data_fim_gozo)}`;
        }
      }

      const endereco = [
        [f.endereco, f.numero].filter(Boolean).join(', ') + (f.complemento ? ` ${f.complemento}` : ''),
        f.bairro, f.cidade, f.cep ? `CEP ${f.cep}` : null,
      ].map(s => (s || '').trim()).filter(Boolean).join(' — ');

      return {
        id: f.id,
        nome: f.nome_completo,
        cpf: f.cpf || null,
        empresaId: f.empresa_id ?? null,
        cargo: f.cargo || null,
        departamento: f.departamento || null,
        tipoContrato: f.tipo_contrato || null,
        dataAdmissao: f.data_admissao || null,
        dataDesligamento: f.data_desligamento || null,
        dataNascimento: f.data_nascimento || null,
        situacao,
        situacaoDetalhe,
        celular: f.celular || null,
        email: f.email || null,
        endereco: endereco || null,
        salarioFolha: Number(f.salario_folha) || 0,
        salarioContrato: Number(f.salario_contrato) || 0,
        valorDiaria: Number(f.valor_diaria) || 0,
        beneficios,
        totalBeneficiosMes: beneficios.reduce((s, b) => s + (b.mensal || 0), 0),
        temBeneficioPorDiaria: beneficios.some(b => b.mensal == null),
        bonusFixos,
        totalBonusMes: bonusFixos.reduce((s, b) => s + b.valor, 0),
      };
    });

    return { ok: true, info: { linhas, geradoEm: hoje, verRemuneracao } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
