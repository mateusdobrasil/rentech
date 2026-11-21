"use client";

import { Analytics } from "@vercel/analytics/next";
import { relatorioAvariasAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoRanking, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, decimal, dataBR, type Coluna, type Kpi,
} from '../ui';

// Avarias e extravios (2026-11-21): ocorrências registradas aqui (avarias da
// manutenção e extravios das fichas de locação) + cobranças de reposição
// (títulos daqui e os de "REPOSIÇÃO" do P2S).
type Oc = { tipo: string; data: string; produto: string; cliente: string; quantidade: number; custo: number; cobranca: string; valorCobrado: number; descricao: string };
type Cob = { origem: string; data: string; cliente: string; descricao: string; valor: number; recebido: number; situacao: string };
type Cli = { cliente: string; ocorrencias: number; custo: number; cobrado: number; recebido: number };
type Prod = { produto: string; ocorrencias: number; quantidade: number; custo: number };

const colOc: Coluna<Oc>[] = [
  { chave: 'data', titulo: 'Data', formato: dataBR }, { chave: 'tipo', titulo: 'Tipo' }, { chave: 'produto', titulo: 'Equipamento', peso: 2.5 }, { chave: 'cliente', titulo: 'Cliente', peso: 2 },
  { chave: 'quantidade', titulo: 'Qtd', direita: true, formato: decimal }, { chave: 'custo', titulo: 'Custo de reposição', direita: true, formato: moeda, peso: 1.3 },
  { chave: 'cobranca', titulo: 'Cobrança' }, { chave: 'descricao', titulo: 'Descrição', peso: 2.5 },
];
const colCob: Coluna<Cob>[] = [
  { chave: 'data', titulo: 'Emissão', formato: dataBR }, { chave: 'origem', titulo: 'Origem' }, { chave: 'cliente', titulo: 'Cliente', peso: 2 }, { chave: 'descricao', titulo: 'Descrição', peso: 3 },
  { chave: 'valor', titulo: 'Cobrado', direita: true, formato: moeda, peso: 1.2 }, { chave: 'recebido', titulo: 'Recebido', direita: true, formato: moeda, peso: 1.2 }, { chave: 'situacao', titulo: 'Situação' },
];
const colCli: Coluna<Cli>[] = [
  { chave: 'cliente', titulo: 'Cliente', peso: 3 }, { chave: 'ocorrencias', titulo: 'Ocorrências', direita: true, formato: inteiro }, { chave: 'custo', titulo: 'Custo de reposição', direita: true, formato: moeda, peso: 1.3 },
  { chave: 'cobrado', titulo: 'Cobrado', direita: true, formato: moeda, peso: 1.2 }, { chave: 'recebido', titulo: 'Recebido', direita: true, formato: moeda, peso: 1.2 },
];
const colProd: Coluna<Prod>[] = [
  { chave: 'produto', titulo: 'Equipamento', peso: 3 }, { chave: 'ocorrencias', titulo: 'Ocorrências', direita: true, formato: inteiro },
  { chave: 'quantidade', titulo: 'Unidades', direita: true, formato: decimal }, { chave: 'custo', titulo: 'Custo de reposição', direita: true, formato: moeda, peso: 1.3 },
];

export default function RelatorioAvariasPage() {
  const r = useRelatorio('/admin/relatorios/avarias', relatorioAvariasAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Ocorrências', valor: inteiro(d.kpis.ocorrencias), detalhe: `${inteiro(d.kpis.avarias)} avaria(s) · ${inteiro(d.kpis.extravios)} extravio(s)` },
    { rotulo: 'Custo de reposição', valor: moeda(d.kpis.custo), detalhe: 'valor do bem × quantidade' },
    { rotulo: 'Cobrado dos clientes', valor: moeda(d.kpis.cobrado) },
    { rotulo: 'Recebido', valor: moeda(d.kpis.recebido), tom: 'bom' },
    { rotulo: 'Em aberto', valor: moeda(d.kpis.emAberto), tom: d.kpis.emAberto > 0 ? 'ruim' : 'bom' },
    { rotulo: 'Perdoado', valor: moeda(d.kpis.perdoado), detalhe: 'cobrança cancelada ou "não cobrar"' },
  ] : [];
  const montar = () => d && ({
    titulo: 'Avarias e extravios', subtitulo: r.subtitulo(empresas),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [paraExportar('Por cliente', colCli, d.porCliente), paraExportar('Por equipamento', colProd, d.porProduto), paraExportar('Ocorrências', colOc, d.ocorrencias), paraExportar('Cobranças de reposição', colCob, d.cobrancas)],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Avarias e Extravios" descricao="O que voltou quebrado ou não voltou, quanto custa repor e quanto foi cobrado × recebido × perdoado.">
        <BotoesExportar nome={`avarias-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        <div className="bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E3A8A] rounded-2xl px-4 py-3 text-xs">As <strong>ocorrências</strong> vêm do registro de avarias e extravios daqui (Estoque e Fichas de Locação). Do P2S entram só as <strong>cobranças</strong> de reposição (centro REPOSIÇÃO), porque o P2S não guarda a avaria em si.</div>
        {d && (
          <>
            <Indicadores itens={kpis} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoRanking titulo="Cobrado por cliente" itens={d.porCliente.filter((c: Cli) => c.cobrado > 0).slice(0, 10).map((c: Cli) => ({ rotulo: c.cliente, valor: c.cobrado }))} formatar={moedaCurta} />
              <GraficoRanking titulo="Custo de reposição por equipamento" itens={d.porProduto.slice(0, 10).map((p: Prod) => ({ rotulo: p.produto, valor: p.custo }))} formatar={moedaCurta} />
            </div>
            <Tabela titulo="Por cliente" colunas={colCli} linhas={d.porCliente} limite={30} />
            <Tabela titulo="Por equipamento" colunas={colProd} linhas={d.porProduto} limite={30} vazio="Nenhuma avaria ou extravio registrado aqui no período." />
            <Tabela titulo="Ocorrências" colunas={colOc} linhas={d.ocorrencias} limite={50} vazio="Nenhuma ocorrência registrada aqui no período." />
            <Tabela titulo="Cobranças de reposição" colunas={colCob} linhas={d.cobrancas} limite={50} vazio="Nenhuma cobrança no período." />
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
