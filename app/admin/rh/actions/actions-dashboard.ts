'use server';

// app/admin/rh/actions/actions-dashboard.ts
// Painel de pendências do hub de RH (/admin/rh) — agrega, num só round-trip,
// os números que hoje só aparecem depois de entrar em cada módulo.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas } from '../../../lib/serverAuth';
import { painelDocumentosAction } from './actions-documentos-func';
import { painelFeriasAction } from './actions-ferias';
import { painelAfastamentosAction } from './actions-afastamentos';
import { painelRescisoesAction } from './actions-rescisao';

type Resultado = { ok: boolean; erro?: string; info?: any };

// Competência de folha = mês anterior ao corrente (mesma convenção usada em
// /admin/rh/holerite e /admin/rh/ponto — a Rentech paga no mês seguinte).
function competenciaAberta(): string {
  const hoje = new Date();
  const comp = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${comp.getFullYear()}-${String(comp.getMonth() + 1).padStart(2, '0')}`;
}

// Mesma regra de "batida OK" usada em /admin/rh/ponto e /admin/rh/holerite:
// uma quantidade par de batidas (nenhuma, duas — quaisquer duas — ou as 4
// completas) está OK. Só uma quantidade ímpar (1 ou 3) é inconsistência.
function diaComBatidasOk(r: { entrada_1: string | null; saida_1: string | null; entrada_2: string | null; saida_2: string | null }): boolean {
  const { entrada_1: e1, saida_1: s1, entrada_2: e2, saida_2: s2 } = r;
  const qtdBatidas = [e1, s1, e2, s2].filter(Boolean).length;
  return qtdBatidas % 2 === 0;
}

export async function painelRhAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, '/admin/rh');
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const filtroEmpresa = <T,>(q: T): T => {
      if (!empresasPermitidas) return q;
      // Linha sem empresa (legado) continua visível, igual à política de RLS.
      return (q as any).or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    };

    const mesAno = competenciaAberta();
    const [ano, mes] = mesAno.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const dataFim = `${ano}-${mes}-${new Date(Number(ano), Number(mes), 0).getDate()}`;
    const hojeMes = String(new Date().getMonth() + 1).padStart(2, '0');

    const [
      docsRes,
      funcsRes,
      regrasRes,
      holeritesRes,
      assinaturasRes,
      solicitacoesRes,
      pontoMesRes,
      feriasRes,
      afastamentosRes,
      rescisoesRes
    ] = await Promise.all([
      painelDocumentosAction(accessToken),
      filtroEmpresa(db.from('folha_funcionarios').select('nome_completo, tipo_contrato, ativo, data_admissao, data_nascimento, departamento').eq('ativo', true)),
      db.from('folha_parametros').select('nome_regra, so_documental'),
      filtroEmpresa(db.from('folha_holerites').select('funcionario_nome').eq('mes_referencia', mesAno)),
      filtroEmpresa(db.from('folha_holerite_assinaturas').select('id, status').not('status', 'in', '("ASSINADO","REJEITADO")')),
      filtroEmpresa(db.from('folha_ponto_whatsapp_solicitacoes').select('id').eq('status', 'PENDENTE')),
      filtroEmpresa(db.from('folha_ponto_diaria').select('funcionario_nome, data_registro, entrada_1, saida_1, entrada_2, saida_2')
        .gte('data_registro', dataInicio).lte('data_registro', dataFim)),
      painelFeriasAction(accessToken),
      painelAfastamentosAction(accessToken),
      painelRescisoesAction(accessToken)
    ]);

    // Holerites em aberto: funcionário ativo, já admitido até a competência,
    // regra não é "só documental", e ainda não tem linha em folha_holerites
    // desse mês (mesma lógica de fecharFolhaTodos em /admin/rh/holerite).
    const soDocumentalPorRegra = new Set(
      (regrasRes.data || []).filter(r => r.so_documental === true).map(r => r.nome_regra)
    );
    const fechados = new Set((holeritesRes.data || []).map(h => h.funcionario_nome));
    const elegiveis = (funcsRes.data || []).filter(f =>
      !soDocumentalPorRegra.has(f.tipo_contrato) &&
      (!f.data_admissao || f.data_admissao.slice(0, 7) <= mesAno)
    );
    const holeritesAbertos = elegiveis.filter(f => !fechados.has(f.nome_completo)).length;

    // Pontos ímpares (batidas incompletas) no mês de competência aberto.
    const pontosImpares = (pontoMesRes.data || []).filter(r => !diaComBatidasOk(r)).length;

    // Aniversariantes do mês corrente (não da competência — é sobre hoje).
    const aniversariantes = (funcsRes.data || [])
      .filter(f => f.data_nascimento && f.data_nascimento.slice(5, 7) === hojeMes)
      .map(f => ({
        nome: f.nome_completo, dia: Number(f.data_nascimento!.slice(8, 10)), mes: Number(f.data_nascimento!.slice(5, 7)),
        departamento: f.departamento || null
      }))
      .sort((a, b) => a.dia - b.dia);

    return {
      ok: true,
      info: {
        mesAno,
        documentosVencidos: docsRes.ok ? docsRes.info?.totais?.vencidos || 0 : 0,
        documentosVencendo: docsRes.ok ? docsRes.info?.totais?.vencendo || 0 : 0,
        holeritesAbertos,
        assinaturasPendentes: (assinaturasRes.data || []).length,
        solicitacoesPontoPendentes: (solicitacoesRes.data || []).length,
        pontosImpares,
        aniversariantes,
        feriasVencidas: feriasRes.ok ? feriasRes.info?.totais?.vencidas || 0 : 0,
        feriasVencendo: feriasRes.ok ? feriasRes.info?.totais?.vencendo || 0 : 0,
        afastamentosAtivos: afastamentosRes.ok ? afastamentosRes.info?.totais?.ativos || 0 : 0,
        rescisoesEmAndamento: rescisoesRes.ok ? rescisoesRes.info?.totais?.emAndamento || 0 : 0
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
