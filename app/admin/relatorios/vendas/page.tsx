"use client";

import { Analytics } from "@vercel/analytics/next";
import { relatorioVendasAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoBarras, GraficoRanking, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, pct, mesRotulo, SERIE_1, SERIE_2, type Coluna, type Kpi,
} from '../ui';

// Relatório de Vendas (2026-11-17): fichas confirmadas pela data do evento.
type Grupo = { nome: string; fichas: number; clientes: number; total: number; ticket: number; participacao: number };
const colunas = (rotulo: string): Coluna<Grupo>[] => [
  { chave: 'nome', titulo: rotulo, peso: 3 },
  { chave: 'fichas', titulo: 'Fichas', direita: true, formato: inteiro },
  { chave: 'clientes', titulo: 'Clientes', direita: true, formato: inteiro },
  { chave: 'total', titulo: 'Total', direita: true, formato: moeda, peso: 1.4 },
  { chave: 'ticket', titulo: 'Ticket médio', direita: true, formato: moeda, peso: 1.3 },
  { chave: 'participacao', titulo: '% do total', direita: true, formato: pct },
];

export default function RelatorioVendasPage() {
  const r = useRelatorio('/admin/relatorios/vendas', relatorioVendasAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Total vendido', valor: moeda(d.kpis.total), detalhe: d.kpis.variacao === null ? 'sem base no ano anterior' : `${d.kpis.variacao >= 0 ? '▲' : '▼'} ${pct(Math.abs(d.kpis.variacao))} vs. ano anterior`, tom: d.kpis.variacao === null ? 'neutro' : d.kpis.variacao >= 0 ? 'bom' : 'ruim' },
    { rotulo: 'Ano anterior', valor: moeda(d.kpis.totalAnterior), detalhe: 'mesmo período' },
    { rotulo: 'Fichas', valor: inteiro(d.kpis.fichas) },
    { rotulo: 'Ticket médio', valor: moeda(d.kpis.ticket) },
    { rotulo: 'Clientes atendidos', valor: inteiro(d.kpis.clientes) },
  ] : [];
  const montar = () => d && ({
    titulo: 'Relatório de Vendas', subtitulo: r.subtitulo(empresas) + (r.info?.soDoVendedor ? ` · ${r.info.soDoVendedor}` : ''),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [
      paraExportar('Vendas por mês', [
        { chave: 'mes', titulo: 'Mês', formato: mesRotulo }, { chave: 'atual', titulo: 'Período', direita: true, formato: moeda }, { chave: 'anterior', titulo: 'Ano anterior', direita: true, formato: moeda },
      ] as Coluna<any>[], d.porMes),
      paraExportar('Por vendedor', colunas('Vendedor'), d.porVendedor),
      paraExportar('Por cliente', colunas('Cliente'), d.porCliente),
      paraExportar('Por evento', colunas('Evento'), d.porEvento),
    ],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Vendas" descricao="Locações confirmadas (aprovadas, reservadas, em locação e finalizadas), pela data do evento.">
        <BotoesExportar nome={`vendas-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} vendedores={r.info?.vendedores} soDoVendedor={r.info?.soDoVendedor} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        {d && (
          <>
            <Indicadores itens={kpis} />
            <GraficoBarras titulo="Vendas por mês" categorias={d.porMes.map((m: any) => mesRotulo(m.mes))} formatar={moedaCurta}
              series={[{ nome: 'Período', cor: SERIE_1, valores: d.porMes.map((m: any) => m.atual) }, { nome: 'Ano anterior', cor: SERIE_2, valores: d.porMes.map((m: any) => m.anterior) }]} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoRanking titulo="Top 10 vendedores" itens={d.porVendedor.slice(0, 10).map((v: Grupo) => ({ rotulo: v.nome, valor: v.total }))} formatar={moedaCurta} />
              <GraficoRanking titulo="Top 10 clientes" itens={d.porCliente.slice(0, 10).map((v: Grupo) => ({ rotulo: v.nome, valor: v.total }))} formatar={moedaCurta} />
            </div>
            <Tabela titulo="Por vendedor" colunas={colunas('Vendedor')} linhas={d.porVendedor} rodape={{ nome: 'Total', fichas: inteiro(d.kpis.fichas), total: moeda(d.kpis.total), ticket: moeda(d.kpis.ticket) }} />
            <Tabela titulo="Por cliente (top 50)" colunas={colunas('Cliente')} linhas={d.porCliente} />
            <Tabela titulo="Por evento (top 50)" colunas={colunas('Evento')} linhas={d.porEvento} />
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
