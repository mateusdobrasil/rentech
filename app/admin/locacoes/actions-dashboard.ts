'use server';

// app/admin/locacoes/actions-dashboard.ts
// Painel do hub Locações (/admin/locacoes). Tudo de locacao_fichas_reserva —
// fichas daqui + as do P2S importadas (2026-11-23: saiu do espelho antigo
// fichas_reserva, que para de ser alimentado na virada da chave).
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

    const CONFIRMADAS = ['APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];
    let emAndamento = db.from('locacao_fichas_reserva').select('id', { count: 'exact', head: true })
      .in('status', CONFIRMADAS).lte('data_inicio', hoje).gte('data_fim', hoje);
    let proximos7 = db.from('locacao_fichas_reserva').select('id', { count: 'exact', head: true })
      .in('status', CONFIRMADAS).gt('data_inicio', hoje).lte('data_inicio', em7dias);
    if (filtroEmpresa) {
      emAndamento = emAndamento.or(filtroEmpresa);
      proximos7 = proximos7.or(filtroEmpresa);
    }

    // Fichas próprias (locacao_fichas_reserva) — empresa_id é obrigatório lá.
    // só evento futuro: o P2S tem centenas de orçamentos antigos nunca fechados
    let orcAbertos = db.from('locacao_fichas_reserva').select('valor_total').in('status', ['ORCAMENTO', 'ENVIADO']).gte('data_inicio', hoje);
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
