'use server';

// app/admin/comercial/eventos-feiras/actions.ts
// Sincronização de Eventos/Feiras direto da API do PrimeStart (TCustomEvento),
// como alternativa ao upload manual de planilha que já existe em page.tsx.
// Grava na mesma tabela eventos_feiras (upsert por nome+data_inicial), então
// convive com o fluxo de upload sem conflito.
//
// Mapeamento validado empiricamente contra o servidor de produção em
// 2026-08-10 (375 eventos reais inspecionados, passados e futuros):
// - "Status" da API SEMPRE vem "U" (nenhuma variação encontrada) — não é o
//   Futuro/Em Execução/Finalizado que a tela usa. Por isso o status aqui é
//   CALCULADO a partir de DataInicial/DataFinal vs. hoje, reproduzindo a
//   mesma classificação que STATUS_DISPONIVEIS (page.tsx) já espera.
// - "Local" (campo texto direto) veio sempre vazio nos registros reais — o
//   nome do local mora em LocalEventoPadrao (ref a TCustomLocalEventoPadrao),
//   por isso é essa referência que é resolvida para preencher a coluna
//   "local" (com o texto direto como fallback, se um dia vier preenchido).
// - Promotor e Montadora NÃO estão no dicionário de classes que a P2S
//   mandou (documento é um "recorte"), mas EXISTEM de verdade como
//   atributos (int ref) na classe real — confirmados por teste direto.
import { supabaseAdmin } from '../../../lib/supabase';
import { consultarObjetos, buscarObjeto, criterio, p2sParaData, type AmbienteP2s, type ObjetoP2s } from '../../../lib/p2s';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/comercial/eventos-feiras';

function nomeExibicao(obj: ObjetoP2s | null): string | null {
  if (!obj) return null;
  const nome = (obj.NomeExibicao || obj.NomeCompleto || obj.Nome || '') as string;
  return nome || null;
}

async function resolverNomes(ambiente: AmbienteP2s, oids: (string | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(oids.filter((oid): oid is string => !!oid && oid !== 'null'))];
  const mapa = new Map<string, string>();
  const TAMANHO_LOTE = 8;
  for (let i = 0; i < unicos.length; i += TAMANHO_LOTE) {
    const lote = unicos.slice(i, i + TAMANHO_LOTE);
    const objetos = await Promise.all(lote.map(oid => buscarObjeto(ambiente, oid).catch(() => null)));
    objetos.forEach((obj, idx) => {
      const nome = nomeExibicao(obj);
      if (nome) mapa.set(lote[idx], nome);
    });
  }
  return mapa;
}

function paraDataISO(serial: unknown): string | null {
  const n = Number(serial);
  if (!n) return null;
  const data = p2sParaData(n);
  return data ? data.toISOString().slice(0, 10) : null;
}

function refOuNull(v: unknown): string | undefined {
  const s = v ? String(v) : '';
  return s && s !== 'null' ? s : undefined;
}

// Reproduz a classificação Futuro / Em Execução / Finalizado (STATUS_DISPONIVEIS
// em page.tsx) a partir das datas, já que o Status cru da API não carrega essa
// informação (ver nota no topo do arquivo).
function statusPorData(dataInicial: number, dataFinal: number, hojeSerial: number): string {
  const fim = dataFinal || dataInicial;
  if (fim && fim < hojeSerial) return 'Finalizado';
  if (dataInicial && dataInicial <= hojeSerial && (!fim || fim >= hojeSerial)) return 'Em Execução';
  return 'Futuro';
}

export interface SincronizarEventosOpcoes {
  ambiente?: AmbienteP2s;
  diasRetroativos?: number;
}

// Puxa os Eventos/Feiras com Data Inicial a partir de N dias atrás (inclui
// todos os futuros, sem limite superior) direto do PrimeStart e grava
// (upsert por nome+data_inicial) na mesma tabela eventos_feiras usada pelo
// upload manual.
export async function sincronizarEventosFeirasP2sAction(opcoes: SincronizarEventosOpcoes, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const ambiente = opcoes.ambiente || 'PRODUCAO';
  const diasRetroativos = opcoes.diasRetroativos ?? 60;

  try {
    const hojeSerial = Math.floor((Date.now() - Date.UTC(1899, 11, 30)) / 86_400_000);
    const desde = hojeSerial - diasRetroativos;

    const resultado = await consultarObjetos(ambiente, 'TCustomEvento', [
      criterio('DataInicial', 'ge', 'dbl', desde),
    ], { order: 'DataInicial' });

    if (resultado.objectlist.length === 0) {
      return { ok: true, info: { processados: 0, totalEncontradas: 0 } };
    }

    const mapaNomes = await resolverNomes(ambiente, resultado.objectlist.flatMap(o => [
      refOuNull(o.LocalEventoPadrao), refOuNull(o.TipoEvento), refOuNull(o.ColaboradorResponsavel),
      refOuNull(o.Promotor), refOuNull(o.Montadora),
    ]));

    const registrosBrutos = resultado.objectlist.map(o => {
      const localOid = refOuNull(o.LocalEventoPadrao);
      const tipoOid = refOuNull(o.TipoEvento);
      const colaboradorOid = refOuNull(o.ColaboradorResponsavel);
      const promotorOid = refOuNull(o.Promotor);
      const montadoraOid = refOuNull(o.Montadora);
      const dataInicialNum = Number(o.DataInicial) || 0;
      const dataFinalNum = Number(o.DataFinal) || 0;
      return {
        nome: String(o.Nome || '').trim(),
        p2s_oid: o.oid,
        data_inicial: paraDataISO(dataInicialNum),
        data_final: paraDataISO(dataFinalNum),
        tipo_evento: tipoOid ? (mapaNomes.get(tipoOid) || null) : null,
        local: (localOid ? mapaNomes.get(localOid) : null) || (String(o.Local || '').trim() || null),
        status: statusPorData(dataInicialNum, dataFinalNum, hojeSerial),
        colaborador_responsavel: colaboradorOid ? (mapaNomes.get(colaboradorOid) || null) : null,
        promotor: promotorOid ? (mapaNomes.get(promotorOid) || null) : null,
        montadora: montadoraOid ? (mapaNomes.get(montadoraOid) || null) : null,
        observacoes: String(o.Observacoes || '').trim() || null,
        updated_at: new Date().toISOString(),
      };
    }).filter(r => r.nome);

    // upsert por (nome, data_inicial) — mesma chave da importação manual;
    // dedup necessário pois o Postgres rejeita atualizar a mesma linha
    // duas vezes no mesmo lote.
    const dedupPorChave = new Map<string, (typeof registrosBrutos)[number]>();
    registrosBrutos.forEach((r, idx) => {
      const chave = r.data_inicial ? `${r.nome}||${r.data_inicial}` : `__sem_data__${idx}`;
      dedupPorChave.set(chave, r);
    });
    const registros = Array.from(dedupPorChave.values());

    const db = supabaseAdmin();
    const TAMANHO_LOTE = 500;
    let processados = 0;
    for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
      const lote = registros.slice(i, i + TAMANHO_LOTE);
      const { error } = await db.from('eventos_feiras').upsert(lote, { onConflict: 'nome,data_inicial' });
      if (error) throw new Error(error.message);
      processados += lote.length;
    }

    return { ok: true, info: { processados, totalEncontradas: resultado.count } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
