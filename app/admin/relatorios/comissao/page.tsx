"use client";

import Link from 'next/link';
import { Analytics } from "@vercel/analytics/next";
import { relatorioComissaoAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoRanking, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, pct, dataBR, type Coluna, type Kpi,
} from '../ui';

// Comissão de vendedores (2026-11-21): números do módulo oficial (Comercial ›
// Comissões) — regra de cada vendedor, liberada conforme o cliente paga.
// Fechada = lançamentos gravados no fechamento; em aberto = calculada agora.
type Vend = { vendedor: string; fichas: number; faturado: number; recebido: number; comissaoFechada: number; comissaoAberta: number; comissao: number; pctEfetivo: number | null; regra: string };
type Linha = { vendedor: string; recebido_em: string; ficha: string; cliente: string; origem: string; valor: number; pct: number; comissao: number; situacao: string };
type Pend = { recebido_em: string; cliente: string; descricao: string; valor: number; motivo: string };

const colVend: Coluna<Vend>[] = [
  { chave: 'vendedor', titulo: 'Vendedor', peso: 2.5 }, { chave: 'regra', titulo: 'Regra', peso: 1.6 },
  { chave: 'fichas', titulo: 'Fichas vendidas', direita: true, formato: inteiro }, { chave: 'faturado', titulo: 'Vendido', direita: true, formato: moeda, peso: 1.4 },
  { chave: 'recebido', titulo: 'Recebido', direita: true, formato: moeda, peso: 1.4 }, { chave: 'comissaoFechada', titulo: 'Comissão fechada', direita: true, formato: moeda, peso: 1.3 },
  { chave: 'comissaoAberta', titulo: 'Comissão em aberto', direita: true, formato: moeda, peso: 1.3 }, { chave: 'comissao', titulo: 'Comissão total', direita: true, formato: moeda, peso: 1.3 },
  { chave: 'pctEfetivo', titulo: '% efetivo', direita: true, formato: pct },
];
const colLinha: Coluna<Linha>[] = [
  { chave: 'recebido_em', titulo: 'Recebido em', formato: dataBR }, { chave: 'vendedor', titulo: 'Vendedor', peso: 2 }, { chave: 'ficha', titulo: 'Ficha' },
  { chave: 'cliente', titulo: 'Cliente', peso: 2.5 }, { chave: 'origem', titulo: 'Origem' }, { chave: 'valor', titulo: 'Recebido', direita: true, formato: moeda, peso: 1.3 },
  { chave: 'pct', titulo: '%', direita: true, formato: v => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` }, { chave: 'comissao', titulo: 'Comissão', direita: true, formato: moeda, peso: 1.2 },
  { chave: 'situacao', titulo: 'Situação' },
];
const colPend: Coluna<Pend>[] = [
  { chave: 'recebido_em', titulo: 'Recebido em', formato: dataBR }, { chave: 'cliente', titulo: 'Cliente', peso: 2 }, { chave: 'descricao', titulo: 'Descrição', peso: 3 },
  { chave: 'valor', titulo: 'Valor', direita: true, formato: moeda, peso: 1.2 }, { chave: 'motivo', titulo: 'Motivo', peso: 2 },
];

export default function RelatorioComissaoPage() {
  const r = useRelatorio('/admin/relatorios/comissao', relatorioComissaoAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Comissão no período', valor: moeda(d.kpis.comissao), detalhe: `${moeda(d.kpis.fechada)} fechada` },
    { rotulo: 'Em aberto', valor: moeda(d.kpis.aberta), detalhe: 'ainda não fechada' },
    { rotulo: 'Recebido (base)', valor: moeda(d.kpis.recebido), detalhe: 'recebimentos com vendedor' },
    { rotulo: 'Vendido no período', valor: moeda(d.kpis.faturado), detalhe: 'fichas confirmadas (data do evento)' },
    { rotulo: 'Vendedores', valor: inteiro(d.kpis.vendedores) },
    { rotulo: 'Recebimentos sem vendedor', valor: inteiro(d.kpis.pendencias), detalhe: moeda(d.kpis.pendenciasValor), tom: d.kpis.pendencias ? 'ruim' : 'bom' },
  ] : [];
  const montar = () => d && ({
    titulo: 'Comissão de vendedores', subtitulo: r.subtitulo(empresas),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [paraExportar('Por vendedor', colVend, d.porVendedor), paraExportar('Recebimentos', colLinha, d.linhas), paraExportar('Sem vendedor ou ficha', colPend, d.pendencias)],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Comissão de Vendedores" descricao="Vendido × recebido e a comissão de cada vendedor pela regra do módulo de Comissões (liberada conforme o cliente paga).">
        <BotoesExportar nome={`comissao-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} vendedores={r.info?.vendedores} soDoVendedor={r.info?.soDoVendedor} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        {d && (
          <div className="bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E3A8A] rounded-2xl px-4 py-3 text-xs">
            Comissão calculada a partir de <strong>{dataBR(d.kpis.inicio)}</strong> (início configurado em Comissões). Regras, fechamento e conferência ficam em <Link href="/admin/comercial/comissoes" className="font-black underline">Comercial › Comissões</Link>.
            {d.kpis.antesDoInicio && <> O período escolhido é anterior a essa data — não há comissão a mostrar.</>}
          </div>
        )}
        {d && (
          <>
            <Indicadores itens={kpis} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoRanking titulo="Comissão por vendedor" itens={d.porVendedor.filter((v: Vend) => v.comissao > 0).slice(0, 10).map((v: Vend) => ({ rotulo: v.vendedor, valor: v.comissao }))} formatar={moedaCurta} />
              <GraficoRanking titulo="Vendido por vendedor" itens={d.porVendedor.slice(0, 10).map((v: Vend) => ({ rotulo: v.vendedor, valor: v.faturado }))} formatar={moedaCurta} />
            </div>
            <Tabela titulo="Por vendedor" colunas={colVend} linhas={d.porVendedor} />
            <Tabela titulo="Recebimentos que geram comissão" colunas={colLinha} linhas={d.linhas} limite={50} vazio="Nenhum recebimento no período." />
            <Tabela titulo="Recebimentos sem vendedor ou sem ficha" colunas={colPend} linhas={d.pendencias} limite={30} vazio="Nenhum." />
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
