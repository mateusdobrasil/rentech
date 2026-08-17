'use server';

// app/admin/financeiro/contas-pagar/actions.ts
// Painel de consulta de Contas a Pagar (TCustomContaPagar) direto do
// PrimeStart — tela nova, sem planilha/import manual anterior (diferente de
// fichas_reserva/eventos_feiras). Grava na tabela contas_pagar (ver
// sql/contas_pagar.sql), upsert por p2s_oid.
//
// Descobertas empíricas em produção (2026-08-10, 4787 contas em aberto no
// total, ~13KB/registro completo):
// - proxy=true reduz o payload em ~27x (62MB → 1,9MB pros mesmos 1384
//   registros) e mantém todos os campos usados aqui — inclusive
//   DescricaoCentroFinanceiro/DescricaoSubCentroFinanceiro, que já vêm como
//   texto pronto (sem precisar resolver referência).
// - Existem registros com DataVencimento claramente corrompida (valores
//   absurdos como -620149, dias antes do ano 0) — provavelmente lixo de
//   migração antiga. O filtro por janela de datas (abaixo) já exclui esses
//   registros por não caírem no intervalo, mas paraDataISO() também rejeita
//   qualquer serial fora de uma faixa sã como defesa extra.
// - Nem toda conta tem Entidade (fornecedor) ou FormaPagamento vinculados —
//   por isso a tabela não tem NOT NULL nesses campos.
import { supabaseAdmin } from '../../../lib/supabase';
import { consultarObjetos, buscarObjeto, criterio, p2sParaData, type AmbienteP2s, type ObjetoP2s } from '../../../lib/p2s';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/financeiro/contas-pagar';

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

// Serial fora dessa faixa (aprox. anos 1900–2173) é lixo, não data real — ver
// nota no topo do arquivo sobre DataVencimento corrompida encontrada em
// produção.
function paraDataISO(serial: unknown): string | null {
  const n = Number(serial);
  if (!n || n < 1 || n > 100_000) return null;
  const data = p2sParaData(n);
  return data ? data.toISOString().slice(0, 10) : null;
}

function refOuNull(v: unknown): string | undefined {
  const s = v ? String(v) : '';
  return s && s !== 'null' ? s : undefined;
}

function textoOuNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

export interface SincronizarContasPagarOpcoes {
  ambiente?: AmbienteP2s;
  diasRetroativos?: number;
}

// Puxa Contas a Pagar (abertas E quitadas) com vencimento a partir de N dias
// atrás (inclui todas as futuras, sem limite superior) — janela que, de
// quebra, já filtra fora os registros com DataVencimento corrompida (ver
// nota no topo do arquivo). Trazer as quitadas também é o que permite o
// upsert corrigir o campo `quitado` de contas que já estavam sincronizadas
// como abertas e foram pagas depois — sem isso elas ficariam com
// quitado=false pra sempre, já que sairiam da janela de consulta.
export async function sincronizarContasPagarP2sAction(opcoes: SincronizarContasPagarOpcoes, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const ambiente = opcoes.ambiente || 'PRODUCAO';
  const diasRetroativos = opcoes.diasRetroativos ?? 180;

  try {
    const hojeSerial = Math.floor((Date.now() - Date.UTC(1899, 11, 30)) / 86_400_000);
    const desde = hojeSerial - diasRetroativos;

    const criterios = [criterio('DataVencimento', 'ge', 'dbl', desde)];

    const resultado = await consultarObjetos(ambiente, 'TCustomContaPagar', criterios, { order: 'DataVencimento', proxy: true });

    if (resultado.objectlist.length === 0) {
      return { ok: true, info: { processados: 0, totalEncontradas: 0 } };
    }

    const mapaNomes = await resolverNomes(ambiente, resultado.objectlist.flatMap(o => [
      refOuNull(o.Entidade), refOuNull(o.FormaPagamento), refOuNull(o.ContaFinanceira),
    ]));

    const registros = resultado.objectlist.map(o => {
      const entidadeOid = refOuNull(o.Entidade);
      const formaPagamentoOid = refOuNull(o.FormaPagamento);
      const contaFinanceiraOid = refOuNull(o.ContaFinanceira);
      return {
        p2s_oid: o.oid,
        descricao: textoOuNull(o.Descricao),
        centro: textoOuNull(o.DescricaoCentroFinanceiro),
        sub_centro: textoOuNull(o.DescricaoSubCentroFinanceiro),
        fornecedor: entidadeOid ? (mapaNomes.get(entidadeOid) || null) : null,
        forma_pagamento: formaPagamentoOid ? (mapaNomes.get(formaPagamentoOid) || null) : null,
        conta_financeira: contaFinanceiraOid ? (mapaNomes.get(contaFinanceiraOid) || null) : null,
        num_documento: textoOuNull(o.NumDocumento),
        num_parcela: textoOuNull(o.NumParcela),
        valor: Number(o.Valor) || null,
        valor_pago: Number(o.ValorPago) || null,
        data_vencimento: paraDataISO(o.DataVencimento),
        data_emissao: paraDataISO(o.DataEmissaoPagamentoRecebimento) || paraDataISO(o.DataCompetencia),
        quitado: String(o.FlagQuitado) === 'true',
        data_quitacao: paraDataISO(o.DataQuitacao),
        observacoes: textoOuNull(o.Observacoes),
        updated_at: new Date().toISOString(),
      };
    });

    const db = supabaseAdmin();
    const TAMANHO_LOTE = 500;
    let processados = 0;
    for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
      const lote = registros.slice(i, i + TAMANHO_LOTE);
      const { error } = await db.from('contas_pagar').upsert(lote, { onConflict: 'p2s_oid' });
      if (error) throw new Error(error.message);
      processados += lote.length;
    }

    return { ok: true, info: { processados, totalEncontradas: resultado.count } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
