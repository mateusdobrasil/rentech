"use client";

import { Analytics } from "@vercel/analytics/next";
import { relatorioClientesAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoRanking, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, pct, dataBR, type Coluna, type Kpi,
} from '../ui';

// Clientes — curva ABC (2026-11-21): fichas confirmadas pela data do evento (= Vendas).
// A = clientes que somam os primeiros 80% da receita; B = até 95%; C = o resto.
type Cli = { cliente: string; cidade: string; classe: string; locacoes: number; receita: number; ticket: number; participacao: number; acumulado: number; ultima: string; receitaAnterior: number; variacao: number | null; novo: string };
type Classe = { classe: string; clientes: number; receita: number; participacao: number; ticket: number };
type Perdido = { cliente: string; cidade: string; locacoes: number; receitaAnterior: number; ultima: string };

const colCli: Coluna<Cli>[] = [
  { chave: 'classe', titulo: 'Classe' }, { chave: 'cliente', titulo: 'Cliente', peso: 3 }, { chave: 'cidade', titulo: 'Cidade', peso: 1.3 },
  { chave: 'locacoes', titulo: 'Locações', direita: true, formato: inteiro }, { chave: 'receita', titulo: 'Receita', direita: true, formato: moeda, peso: 1.4 },
  { chave: 'ticket', titulo: 'Ticket', direita: true, formato: moeda, peso: 1.2 }, { chave: 'participacao', titulo: '% da receita', direita: true, formato: pct },
  { chave: 'acumulado', titulo: '% acumulado', direita: true, formato: pct }, { chave: 'receitaAnterior', titulo: 'Ano anterior', direita: true, formato: moeda, peso: 1.3 },
  { chave: 'variacao', titulo: 'Variação', direita: true, formato: pct }, { chave: 'ultima', titulo: 'Última locação', formato: dataBR }, { chave: 'novo', titulo: 'Novo' },
];
const colClasse: Coluna<Classe>[] = [
  { chave: 'classe', titulo: 'Classe' }, { chave: 'clientes', titulo: 'Clientes', direita: true, formato: inteiro }, { chave: 'receita', titulo: 'Receita', direita: true, formato: moeda, peso: 1.4 },
  { chave: 'participacao', titulo: '% da receita', direita: true, formato: pct }, { chave: 'ticket', titulo: 'Receita por cliente', direita: true, formato: moeda, peso: 1.3 },
];
const colPerdido: Coluna<Perdido>[] = [
  { chave: 'cliente', titulo: 'Cliente', peso: 3 }, { chave: 'cidade', titulo: 'Cidade', peso: 1.3 }, { chave: 'locacoes', titulo: 'Locações no ano anterior', direita: true, formato: inteiro },
  { chave: 'receitaAnterior', titulo: 'Receita no ano anterior', direita: true, formato: moeda, peso: 1.4 }, { chave: 'ultima', titulo: 'Última locação', formato: dataBR },
];

export default function RelatorioClientesPage() {
  const r = useRelatorio('/admin/relatorios/clientes', relatorioClientesAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Clientes atendidos', valor: inteiro(d.kpis.clientes), detalhe: `${inteiro(d.kpis.recompra)} alugaram 2+ vezes` },
    { rotulo: 'Receita', valor: moeda(d.kpis.receita), detalhe: d.kpis.variacao === null ? 'sem base no ano anterior' : `${d.kpis.variacao >= 0 ? '+' : ''}${pct(d.kpis.variacao)} vs ano anterior`, tom: d.kpis.variacao === null ? 'neutro' : d.kpis.variacao >= 0 ? 'bom' : 'ruim' },
    { rotulo: 'Receita por cliente', valor: moeda(d.kpis.ticketCliente) },
    { rotulo: 'Classe A', valor: `${inteiro(d.kpis.classeA)} clientes`, detalhe: `${pct(d.kpis.classeAPct)} da receita` },
    { rotulo: 'Clientes novos', valor: inteiro(d.kpis.novos), detalhe: 'primeira locação no período' },
    { rotulo: 'Pararam de alugar', valor: inteiro(d.kpis.perdidos), detalhe: `${moeda(d.kpis.receitaPerdida)} no ano anterior`, tom: d.kpis.perdidos ? 'ruim' : 'bom' },
  ] : [];
  const montar = () => d && ({
    titulo: 'Clientes — curva ABC', subtitulo: r.subtitulo(empresas),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [paraExportar('Resumo por classe', colClasse, d.classes), paraExportar('Clientes', colCli, d.clientes), paraExportar('Pararam de alugar', colPerdido, d.perdidos)],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Clientes — Curva ABC" descricao="Quem traz a receita, quem é novo, quem voltou e quem parou de alugar (comparado com o mesmo período do ano anterior).">
        <BotoesExportar nome={`clientes-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} vendedores={r.info?.vendedores} soDoVendedor={r.info?.soDoVendedor} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        {d && (
          <>
            <Indicadores itens={kpis} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoRanking titulo="Top 10 clientes por receita" itens={d.clientes.slice(0, 10).map((c: Cli) => ({ rotulo: c.cliente, valor: c.receita }))} formatar={moedaCurta} />
              <Tabela titulo="Resumo por classe" colunas={colClasse} linhas={d.classes} />
            </div>
            <Tabela titulo="Clientes (curva ABC)" colunas={colCli} linhas={d.clientes} limite={50} />
            <Tabela titulo="Pararam de alugar (alugaram no ano anterior, não neste período)" colunas={colPerdido} linhas={d.perdidos} limite={30} vazio="Nenhum cliente do ano anterior ficou de fora." />
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
