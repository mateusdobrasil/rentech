'use server';

// app/admin/estoque/expedicao/actions.ts
// Escrita no PrimeStart (P2S): ao finalizar um Checklist de Carga vinculado
// a um evento, marca como Finalizada (Status="F") todas as Fichas de
// Locação daquele evento que ainda não estiverem. Primeira integração de
// ESCRITA construída (as anteriores — fichas de reserva, eventos, contas a
// pagar, produtos — são só leitura/sincronização).
//
// Descoberta crítica em produção (2026-08-10): filtrar TCustomFichaLocacao
// pelo campo de referência "Evento" usando propvaluetype "str" com o oid
// completo ("P,573460") NÃO dá erro — só ignora o critério silenciosamente
// e devolve TODAS as fichas (só percebido testando com um oid
// propositalmente inexistente, que devolveu a mesma contagem de resultados).
// O formato correto é propvaluetype "int" com só a parte numérica do oid —
// ver criterioRef() em app/lib/p2s.ts, criada especificamente por causa
// desse bug. Sem esse teste, essa ação teria marcado como Finalizada TODA
// ficha de locação do sistema, não só as do evento certo.
//
// Status "F" (Finalizada) confirmado testando 371 fichas já devolvidas em
// produção (350 delas com Status="F"). "A" = Ativa.
import { atualizarObjeto, consultarObjetos, criterioRef, type AmbienteP2s } from '../../../lib/p2s';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/estoque/expedicao';
const STATUS_FINALIZADA = 'F';

export interface FinalizarFichasLocacaoInfo {
  totalFichasDoEvento: number;
  jaEstavamFinalizadas: number;
  atualizadas: number;
  falhas: { numero: string; erro: string }[];
}

// Busca as Fichas de Locação do evento (por oid do PrimeStart) e marca como
// Finalizada (Status="F") as que ainda não estiverem. Idempotente — pode
// ser chamada de novo sem duplicar efeito (fichas já "F" são só puladas).
export async function finalizarFichasLocacaoPorEventoAction(eventoP2sOid: string, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  if (!eventoP2sOid) return { ok: false, erro: 'Checklist não está vinculado a um evento do PrimeStart.' };

  const ambiente: AmbienteP2s = 'PRODUCAO';

  try {
    const resultado = await consultarObjetos(ambiente, 'TCustomFichaLocacao', [
      criterioRef('Evento', eventoP2sOid),
    ]);

    const pendentes = resultado.objectlist.filter(f => String(f.Status) !== STATUS_FINALIZADA);
    const falhas: { numero: string; erro: string }[] = [];
    let atualizadas = 0;

    for (const ficha of pendentes) {
      try {
        await atualizarObjeto(ambiente, 'TCustomFichaLocacao', ficha.oid, { Status: STATUS_FINALIZADA });
        atualizadas++;
      } catch (e: any) {
        falhas.push({ numero: String(ficha.Numero || ficha.oid), erro: e.message });
      }
    }

    const info: FinalizarFichasLocacaoInfo = {
      totalFichasDoEvento: resultado.count,
      jaEstavamFinalizadas: resultado.objectlist.length - pendentes.length,
      atualizadas,
      falhas,
    };
    return { ok: true, info };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
