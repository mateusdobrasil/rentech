'use server';

// app/admin/operacional/fichas/actions.ts
// Sincronização de Fichas de Reserva de Locação direto da API do PrimeStart
// (TCustomFichaReservaLocacao), como alternativa ao upload manual de
// planilha que já existe em page.tsx. Grava na mesma tabela fichas_reserva
// (upsert por "numero"), então convive com o fluxo de upload sem conflito.
//
// Mapeamento validado empiricamente contra o servidor de produção em
// 2026-08-10 (1495 fichas reais inspecionadas):
// - "Data de Entrega" (data_entrega/data_entrega_agenda) NÃO tem campo
//   equivalente na API — CampoAdicional1 a 6 simplesmente não existem nessa
//   classe nesta instância (só existem CampoAdicional7-12 e
//   CampoAdicionalSel1/2, que só guardam "Sim"/vazio). Por decisão do
//   usuário, ficam null na sincronização via API até acharmos a origem real.
// - Status vem em CÓDIGOS CURTOS (EN, EP, RE, CA, A, E, X, SB), não nos
//   rótulos em português que a tela usa (STATUS_DISPONIVEIS em page.tsx).
//   Por decisão do usuário, o código cru é gravado sem tradução por ora —
//   ou seja, o filtro de status da tela (baseado nos rótulos) não vai casar
//   com linhas vindas da API até esse mapeamento ser confirmado com a P2S.
import { supabaseAdmin } from '../../../lib/supabase';
import { consultarObjetos, buscarObjeto, criterio, p2sParaData, type AmbienteP2s, type ObjetoP2s } from '../../../lib/p2s';

type Resultado = { ok: boolean; erro?: string; info?: any };

function nomeExibicao(obj: ObjetoP2s | null): string | null {
  if (!obj) return null;
  const nome = (obj.NomeExibicao || obj.NomeCompleto || obj.Nome || '') as string;
  return nome || null;
}

// Resolve os nomes de uma lista de oids (Parceiro/Evento/VendedorRep/Centro)
// em lotes de concorrência limitada — evita tanto uma chamada por linha
// quanto sobrecarregar o servidor on-premise do cliente com uma rajada
// enorme de conexões simultâneas.
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

// Resumo em texto dos itens da ficha, a partir do que já vem embutido na
// própria resposta (sem chamada extra por item) — quantidade + observação
// digitada na ficha (ex: "3.5X2", "8 PAINEL 0,50X4"). É uma aproximação:
// não resolve o nome do produto (exigiria mais uma chamada em cadeia,
// ItemEstoque → Produto, por item).
function resumoItens(itens: unknown): string | null {
  if (!Array.isArray(itens) || itens.length === 0) return null;
  const partes = itens
    .map((item: any) => {
      const qtd = Number(item?.QuantidadePositiva) || 0;
      const obs = String(item?.Observacoes || '').trim();
      if (!qtd && !obs) return null;
      return obs ? `${qtd}x ${obs}` : `${qtd}x`;
    })
    .filter((s): s is string => !!s);
  return partes.length ? partes.join('; ') : null;
}

export interface SincronizarFichasReservaOpcoes {
  ambiente?: AmbienteP2s;
  diasRetroativos?: number;
}

// Puxa as Fichas de Reserva de Locação emitidas nos últimos N dias direto do
// PrimeStart e grava (upsert por "numero") na mesma tabela fichas_reserva
// usada pelo upload manual — sem exigir a exportação/upload de planilha.
export async function sincronizarFichasReservaP2sAction(opcoes: SincronizarFichasReservaOpcoes = {}): Promise<Resultado> {
  const ambiente = opcoes.ambiente || 'PRODUCAO';
  const diasRetroativos = opcoes.diasRetroativos ?? 90;

  try {
    const hojeSerial = Math.floor((Date.now() - Date.UTC(1899, 11, 30)) / 86_400_000);
    const desde = hojeSerial - diasRetroativos;

    const resultado = await consultarObjetos(ambiente, 'TCustomFichaReservaLocacao', [
      criterio('DataEmissao', 'ge', 'dbl', desde),
    ], { order: 'DataEmissao', proxy: false });

    if (resultado.objectlist.length === 0) {
      return { ok: true, info: { processados: 0, totalEncontradas: 0 } };
    }

    const mapaNomes = await resolverNomes(ambiente, resultado.objectlist.flatMap(o => [
      refOuNull(o.Parceiro), refOuNull(o.Evento), refOuNull(o.VendedorRep), refOuNull(o.Centro),
    ]));

    const registros = resultado.objectlist.map(o => {
      const parceiroOid = refOuNull(o.Parceiro);
      const eventoOid = refOuNull(o.Evento);
      const vendedorOid = refOuNull(o.VendedorRep);
      const centroOid = refOuNull(o.Centro);
      return {
        numero: String(o.Numero || o.oid),
        status: String(o.Status || '') || null,
        // "cliente" tem constraint NOT NULL na tabela (confirmado por erro real
        // em produção) — nunca deixar null, mesmo sem Parceiro vinculado ou
        // falha ao resolver o nome.
        cliente: (parceiroOid ? mapaNomes.get(parceiroOid) : null) || '(sem cliente)',
        evento_feira: eventoOid ? (mapaNomes.get(eventoOid) || null) : null,
        data_emissao: paraDataISO(o.DataEmissao),
        data_inicial: paraDataISO(o.DataInicial),
        data_final: paraDataISO(o.DataFinal),
        valor_final: Number(o.ValorFinal) || null,
        valor_itens: Number(o.ValorTotalItens) || null,
        vendedor: vendedorOid ? (mapaNomes.get(vendedorOid) || null) : null,
        centro: centroOid ? (mapaNomes.get(centroOid) || null) : null,
        observacoes: String(o.Observacoes || '') || null,
        status_faturamento: String(o.StatusUltimoFaturamento || '') || null,
        faturamento_suspenso: String(o.FaturamentoSuspenso) === 'true',
        faturamento_antecipado: String(o.FlagTemFaturamentoAntecipado) === 'true',
        justificativa_suspensao: String(o.JustificativaSuspensao || '') || null,
        itens: resumoItens(o.Itens),
        updated_at: new Date().toISOString(),
      };
    });

    const db = supabaseAdmin();
    const TAMANHO_LOTE = 500;
    let processados = 0;
    for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
      const lote = registros.slice(i, i + TAMANHO_LOTE);
      const { error } = await db.from('fichas_reserva').upsert(lote, { onConflict: 'numero' });
      if (error) throw new Error(error.message);
      processados += lote.length;
    }

    return { ok: true, info: { processados, totalEncontradas: resultado.count } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
