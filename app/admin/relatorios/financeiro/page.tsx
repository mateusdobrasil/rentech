"use client";

import { Analytics } from "@vercel/analytics/next";
import { relatorioFinanceiroAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoBarras, GraficoRanking, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, pct, dataBR, mesRotulo, SERIE_1, SERIE_2, type Coluna, type Kpi,
} from '../ui';

// Relatório Financeiro (2026-11-17): contas a receber e a pagar do P2S.
type Mes = { mes: string; recebido: number; pago: number };
type Aging = { faixa: string; titulos: number; valor: number };
type Devedor = { cliente: string; titulos: number; valor: number; maisAntigo: string };
type Categoria = { categoria: string; titulos: number; valor: number; participacao: number };

const colMes: Coluna<Mes & { saldo?: number }>[] = [
  { chave: 'mes', titulo: 'Mês', formato: mesRotulo }, { chave: 'recebido', titulo: 'Recebido', direita: true, formato: moeda },
  { chave: 'pago', titulo: 'Pago', direita: true, formato: moeda }, { chave: 'saldo', titulo: 'Saldo', direita: true, formato: moeda },
];
const colAging: Coluna<Aging>[] = [
  { chave: 'faixa', titulo: 'Vencido há', peso: 2 }, { chave: 'titulos', titulo: 'Títulos', direita: true, formato: inteiro }, { chave: 'valor', titulo: 'Valor em aberto', direita: true, formato: moeda, peso: 1.5 },
];
const colDev: Coluna<Devedor>[] = [
  { chave: 'cliente', titulo: 'Cliente', peso: 3 }, { chave: 'titulos', titulo: 'Títulos', direita: true, formato: inteiro },
  { chave: 'valor', titulo: 'Valor vencido', direita: true, formato: moeda, peso: 1.4 }, { chave: 'maisAntigo', titulo: 'Mais antigo', formato: dataBR },
];
const colCat: Coluna<Categoria>[] = [
  { chave: 'categoria', titulo: 'Categoria (centro / subcentro)', peso: 3 }, { chave: 'titulos', titulo: 'Pagamentos', direita: true, formato: inteiro },
  { chave: 'valor', titulo: 'Valor pago', direita: true, formato: moeda, peso: 1.4 }, { chave: 'participacao', titulo: '% do total', direita: true, formato: pct },
];

export default function RelatorioFinanceiroPage() {
  const r = useRelatorio('/admin/relatorios/financeiro', relatorioFinanceiroAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const meses: (Mes & { saldo: number })[] = d ? d.porMes.map((m: Mes) => ({ ...m, saldo: Math.round((m.recebido - m.pago) * 100) / 100 })) : [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Recebido', valor: moeda(d.kpis.recebido), detalhe: 'quitados no período' },
    { rotulo: 'Pago', valor: moeda(d.kpis.pago), detalhe: 'quitados no período' },
    { rotulo: 'Saldo realizado', valor: moeda(d.kpis.saldo), tom: d.kpis.saldo >= 0 ? 'bom' : 'ruim', detalhe: 'recebido − pago' },
    { rotulo: 'A receber', valor: moeda(d.kpis.aReceber), detalhe: 'abertos com vencimento no período' },
    { rotulo: 'A pagar', valor: moeda(d.kpis.aPagar), detalhe: 'abertos com vencimento no período' },
    { rotulo: 'Inadimplência', valor: moeda(d.kpis.vencidoAteUmAno), detalhe: `vencido até 1 ano · ${moeda(d.kpis.vencido)} no total`, tom: 'ruim' },
  ] : [];
  const montar = () => d && ({
    titulo: 'Relatório Financeiro', subtitulo: r.subtitulo(empresas),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [
      paraExportar('Fluxo realizado por mês', colMes, meses, { mes: 'Total', recebido: moeda(d.kpis.recebido), pago: moeda(d.kpis.pago), saldo: moeda(d.kpis.saldo) }),
      paraExportar('Inadimplência por idade', colAging, d.aging),
      paraExportar('Maiores devedores', colDev, d.devedores),
      paraExportar('Pagamentos por categoria', colCat, d.pagosPorCategoria),
    ],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Financeiro" descricao="Contas a receber e a pagar do P2S: realizado no período, previsto e inadimplência.">
        <BotoesExportar nome={`financeiro-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        {d && (
          <>
            <Indicadores itens={kpis} />
            <GraficoBarras titulo="Recebido × pago por mês" categorias={meses.map(m => mesRotulo(m.mes))} formatar={moedaCurta}
              series={[{ nome: 'Recebido', cor: SERIE_1, valores: meses.map(m => m.recebido) }, { nome: 'Pago', cor: SERIE_2, valores: meses.map(m => m.pago) }]} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoRanking titulo="Inadimplência por idade (valor em aberto)" itens={d.aging.map((a: Aging) => ({ rotulo: a.faixa, valor: a.valor }))} formatar={moedaCurta} />
              <GraficoRanking titulo="Top 10 despesas por categoria" itens={d.pagosPorCategoria.slice(0, 10).map((c: Categoria) => ({ rotulo: c.categoria, valor: c.valor }))} formatar={moedaCurta} />
            </div>
            <p className="text-[11px] text-gray-500 px-1">Inadimplência considera todos os títulos em aberto já vencidos (não depende do período). Títulos com mais de 1 ano costumam ser baixa pendente no P2S, não dívida real — por isso o indicador destaca o vencido até 1 ano.</p>
            <Tabela titulo="Fluxo realizado por mês" colunas={colMes} linhas={meses} rodape={{ mes: 'Total', recebido: moeda(d.kpis.recebido), pago: moeda(d.kpis.pago), saldo: moeda(d.kpis.saldo) }} />
            <div className="grid lg:grid-cols-2 gap-4">
              <Tabela titulo="Maiores devedores" colunas={colDev} linhas={d.devedores} limite={20} />
              <Tabela titulo="Pagamentos por categoria" colunas={colCat} linhas={d.pagosPorCategoria} limite={20} />
            </div>
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
