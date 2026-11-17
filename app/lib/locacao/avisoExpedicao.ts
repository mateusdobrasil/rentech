// app/lib/locacao/avisoExpedicao.ts
// Gatilho de ficha aprovada (2026-11-17): avisa a operação no app (inbox +
// push) de quem acessa a Expedição que há uma OS nova para separar. Na tela da
// Expedição ela aparece no painel "OS para separar" (osParaSepararAction) até
// entrar num checklist. Nunca derruba a aprovação se o aviso falhar.
import type { supabaseAdmin } from '../supabase';
import { notificarPush } from '../push';
import { numeroFichaPorId } from './fichaNumero';

type Db = ReturnType<typeof supabaseAdmin>;
const ROTA_EXPEDICAO = '/admin/estoque/expedicao';
const dataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

export async function avisarOsParaSeparar(db: Db, fichaId: number): Promise<void> {
  try {
    const { data: f } = await db.from('locacao_fichas_reserva')
      .select('id, data_saida, data_montagem, data_inicio, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome)')
      .eq('id', fichaId).maybeSingle();
    if (!f) return;
    const x: any = f;
    const cliente = x.parceiro ? (x.parceiro.nome_exibicao || x.parceiro.nome_completo) : 'cliente';
    const saida = x.data_saida || x.data_montagem || x.data_inicio;
    await notificarPush(
      ROTA_EXPEDICAO,
      `📦 Nova OS para separar: ${numeroFichaPorId(fichaId)}`,
      `${cliente}${x.evento?.nome ? ` · ${x.evento.nome}` : ''} · saída ${dataBR(saida)}`,
      { tipo: 'OS_PARA_SEPARAR', ficha_id: fichaId, rota: ROTA_EXPEDICAO },
    );
  } catch (e: any) {
    console.error('[avisoExpedicao] falha ao avisar a operação:', e?.message);
  }
}
