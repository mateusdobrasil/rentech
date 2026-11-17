'use server';

// app/admin/locacoes/actions-dashboard.ts
// Painel do hub Locações (/admin/locacoes). Enquanto a Ficha de Reserva
// própria (locacao_fichas_reserva) não entra em uso, os números vêm do
// espelho do P2S (fichas_reserva) — mesmo dado que a tela de fichas mostra.
import { supabaseAdmin } from '../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas } from '../../lib/serverAuth';
import { hojeISO, somarDias } from '../../lib/locacao/datas';

type Resultado = { ok: boolean; erro?: string; info?: any };

export async function painelLocacoesAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, '/admin/locacoes');
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    // supabaseAdmin() ignora RLS — filtra pelas empresas do usuário.
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const filtroEmpresa = empresasPermitidas
      ? `empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`
      : null;

    const hoje = hojeISO();
    const em7dias = somarDias(hoje, 7);

    let emAndamento = db.from('fichas_reserva').select('id', { count: 'exact', head: true })
      .lte('data_inicial', hoje).gte('data_final', hoje);
    let proximos7 = db.from('fichas_reserva').select('id', { count: 'exact', head: true })
      .gt('data_inicial', hoje).lte('data_inicial', em7dias);
    if (filtroEmpresa) {
      emAndamento = emAndamento.or(filtroEmpresa);
      proximos7 = proximos7.or(filtroEmpresa);
    }

    // Fichas próprias (locacao_fichas_reserva) — empresa_id é obrigatório lá.
    let orcAbertos = db.from('locacao_fichas_reserva').select('valor_total').in('status', ['ORCAMENTO', 'ENVIADO', 'APROVADO']);
    let reservas7 = db.from('locacao_fichas_reserva').select('id', { count: 'exact', head: true })
      .eq('status', 'RESERVADA').gte('data_inicio', hoje).lte('data_inicio', em7dias);
    if (empresasPermitidas) {
      orcAbertos = orcAbertos.in('empresa_id', empresasPermitidas.length ? empresasPermitidas : [0]);
      reservas7 = reservas7.in('empresa_id', empresasPermitidas.length ? empresasPermitidas : [0]);
    }

    const [rAndamento, rProximos, rOrc, rRes] = await Promise.all([emAndamento, proximos7, orcAbertos.limit(5000), reservas7]);
    if (rAndamento.error) throw rAndamento.error;
    if (rProximos.error) throw rProximos.error;

    return {
      ok: true,
      info: {
        fichasEmAndamento: rAndamento.count || 0,
        fichasProximos7Dias: rProximos.count || 0,
        orcamentosAbertos: rOrc.data?.length || 0,
        valorOrcamentosAbertos: (rOrc.data || []).reduce((s: number, f: any) => s + Number(f.valor_total || 0), 0),
        reservasProximos7Dias: rRes.count || 0,
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
