// app/admin/comercial/fichas/fichasCore.ts
// Lógica de negócio do sync de Fichas de Reserva, SEM "use server" —
// importada tanto por actions.ts (que expõe a versão protegida por
// accessToken pra UI) quanto por app/api/cron/sync-p2s/route.ts (rotina
// agendada, protegida só por CRON_SECRET, sem sessão de usuário). Ficar fora
// de um arquivo "use server" é o que garante que esta função não vira um
// endpoint de Server Action chamável direto por qualquer um — só é
// alcançável via import server-side. Mesmo padrão de
// app/admin/rh/actions/consignadoCore.ts.
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
import { obterCursorIncremental, registrarSincronizacao, calcularProximoCursor, cursorParaSerialP2s } from '../../../lib/syncLog';

type Resultado = { ok: boolean; erro?: string; info?: any };

function nomeExibicao(obj: ObjetoP2s | null): string | null {
  if (!obj) return null;
  // NomeItem cobre o caso de ItemEstoque (ref de item de ficha) apontar pra
  // um TCustomProduto — sem isso, o resumo de itens ficava só com a
  // quantidade ("10x"), sem o nome do equipamento (ex: "METROS DE PAINEL DE
  // LED P3 RETO"), porque a maioria dos itens tem Observacoes vazio.
  const nome = (obj.NomeExibicao || obj.NomeCompleto || obj.Nome || obj.NomeItem || '') as string;
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

// Resumo em texto dos itens da ficha: quantidade + nome do produto
// (resolvido via ItemEstoque, que aponta direto pra um TCustomProduto) +
// observação digitada na ficha, se houver (ex: "3.5X2", "8 PAINEL 0,50X4").
// Nome do produto é essencial aqui — testado em produção (2026-08-17) que a
// maioria dos itens tem Observacoes VAZIO, então sem resolver o produto o
// resumo virava só "10x" sem dizer o quê.
function resumoItens(itens: unknown, mapaNomesProduto: Map<string, string>): string | null {
  if (!Array.isArray(itens) || itens.length === 0) return null;
  const partes = itens
    .map((item: any) => {
      const qtd = Number(item?.QuantidadePositiva) || 0;
      const obs = String(item?.Observacoes || '').trim();
      const itemEstoqueOid = refOuNull(item?.ItemEstoque);
      const nomeProduto = itemEstoqueOid ? mapaNomesProduto.get(itemEstoqueOid) : undefined;
      if (!qtd && !obs && !nomeProduto) return null;
      const descricao = [nomeProduto, obs].filter(Boolean).join(' — ');
      return descricao ? `${qtd}x ${descricao}` : `${qtd}x`;
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
export async function sincronizarFichasReservaCore(opcoes: SincronizarFichasReservaOpcoes = {}): Promise<Resultado> {
  const ambiente = opcoes.ambiente || 'PRODUCAO';
  const diasRetroativos = opcoes.diasRetroativos ?? 90;
  const iniciadoEm = new Date();
  const cursor = await obterCursorIncremental('fichas_reserva', ambiente);

  try {
    // Primeira sincronização: mantém o recorte deliberado de N dias por
    // DataEmissao (não é limite técnico, é o escopo pretendido do módulo).
    // Depois disso, incremental por DataUltimaAlteracaoCadastro — sem o
    // limite de dias, porque uma ficha antiga que for alterada hoje precisa
    // ser pega mesmo estando fora da janela original de emissão.
    let criterios;
    if (cursor) {
      criterios = [criterio('DataUltimaAlteracaoCadastro', 'ge', 'dbl', cursorParaSerialP2s(cursor))];
    } else {
      const hojeSerial = Math.floor((Date.now() - Date.UTC(1899, 11, 30)) / 86_400_000);
      criterios = [criterio('DataEmissao', 'ge', 'dbl', hojeSerial - diasRetroativos)];
    }

    const resultado = await consultarObjetos(ambiente, 'TCustomFichaReservaLocacao', criterios, { order: 'DataEmissao', proxy: false });

    if (resultado.objectlist.length === 0) {
      await registrarSincronizacao({
        integracao: 'fichas_reserva', ambiente, tipo: cursor ? 'incremental' : 'completa',
        cursorDesde: cursor, cursorAte: calcularProximoCursor(iniciadoEm),
        encontrados: 0, processados: 0, status: 'sucesso', iniciadoEm,
      });
      return { ok: true, info: { processados: 0, totalEncontradas: 0 } };
    }

    const oidsItensEstoque = resultado.objectlist.flatMap(o =>
      (Array.isArray(o.Itens) ? o.Itens : []).map((item: any) => refOuNull(item?.ItemEstoque))
    );
    const mapaNomes = await resolverNomes(ambiente, [
      ...resultado.objectlist.flatMap(o => [refOuNull(o.Parceiro), refOuNull(o.Evento), refOuNull(o.VendedorRep), refOuNull(o.Centro)]),
      ...oidsItensEstoque,
    ]);

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
        itens: resumoItens(o.Itens, mapaNomes),
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

    await registrarSincronizacao({
      integracao: 'fichas_reserva', ambiente, tipo: cursor ? 'incremental' : 'completa',
      cursorDesde: cursor, cursorAte: calcularProximoCursor(iniciadoEm),
      encontrados: resultado.count, processados, status: 'sucesso', iniciadoEm,
    });
    return { ok: true, info: { processados, totalEncontradas: resultado.count } };
  } catch (e: any) {
    await registrarSincronizacao({
      integracao: 'fichas_reserva', ambiente, tipo: cursor ? 'incremental' : 'completa',
      cursorDesde: cursor, cursorAte: null,
      encontrados: 0, processados: 0, status: 'erro', erro: e.message, iniciadoEm,
    });
    return { ok: false, erro: e.message };
  }
}
