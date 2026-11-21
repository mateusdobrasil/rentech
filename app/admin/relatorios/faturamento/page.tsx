"use client";

import { Analytics } from "@vercel/analytics/next";
import { relatorioFaturamentoAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoBarras, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, decimal, pct, dataBR, mesRotulo, SERIE_1, SERIE_2, type Coluna, type Kpi,
} from '../ui';

// Faturamento (2026-11-21): Notas de Débito do P2S (uma nota = parcelas com o mesmo
// nº) + Notas OFICIAIS daqui; prazo devolução → nota pela Ficha de Locação citada;
// a faturar = fichas de locação devolvidas "Não faturado" no P2S + OS daqui com saldo.
type Nota = { numero: string; origem: string; cliente: string; emissao: string; fl: string; valor: number; recebido: number };
type Cli = { cliente: string; notas: number; valor: number; recebido: number; participacao: number };
type AF = { referencia: string; origem: string; cliente: string; devolucao: string; diasParado: number; valorOs: number };
type Faixa = { faixa: string; notas: number; participacao: number };

const colNota: Coluna<Nota>[] = [
  { chave: 'numero', titulo: 'Nº' }, { chave: 'origem', titulo: 'Origem' }, { chave: 'emissao', titulo: 'Emissão', formato: dataBR }, { chave: 'cliente', titulo: 'Cliente', peso: 3 },
  { chave: 'fl', titulo: 'Ficha de locação' }, { chave: 'valor', titulo: 'Valor', direita: true, formato: moeda, peso: 1.3 }, { chave: 'recebido', titulo: 'Recebido', direita: true, formato: moeda, peso: 1.3 },
];
const colCli: Coluna<Cli>[] = [
  { chave: 'cliente', titulo: 'Cliente', peso: 3 }, { chave: 'notas', titulo: 'Notas', direita: true, formato: inteiro }, { chave: 'valor', titulo: 'Faturado', direita: true, formato: moeda, peso: 1.4 },
  { chave: 'recebido', titulo: 'Recebido', direita: true, formato: moeda, peso: 1.4 }, { chave: 'participacao', titulo: '% do total', direita: true, formato: pct },
];
const colAF: Coluna<AF>[] = [
  { chave: 'referencia', titulo: 'Ficha / OS' }, { chave: 'origem', titulo: 'Origem' }, { chave: 'cliente', titulo: 'Cliente', peso: 3 }, { chave: 'devolucao', titulo: 'Devolução', formato: dataBR },
  { chave: 'diasParado', titulo: 'Dias sem faturar', direita: true, formato: inteiro }, { chave: 'valorOs', titulo: 'Valor da OS', direita: true, formato: moeda, peso: 1.3 },
];
const colFaixa: Coluna<Faixa>[] = [{ chave: 'faixa', titulo: 'Devolução → nota', peso: 2 }, { chave: 'notas', titulo: 'Notas', direita: true, formato: inteiro }, { chave: 'participacao', titulo: '%', direita: true, formato: pct }];

export default function RelatorioFaturamentoPage() {
  const r = useRelatorio('/admin/relatorios/faturamento', relatorioFaturamentoAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Faturado (Notas de Débito)', valor: moeda(d.kpis.total), detalhe: d.kpis.variacao === null ? 'sem base no ano anterior' : `${d.kpis.variacao >= 0 ? '+' : ''}${pct(d.kpis.variacao)} vs ano anterior`, tom: d.kpis.variacao === null ? 'neutro' : d.kpis.variacao >= 0 ? 'bom' : 'ruim' },
    { rotulo: 'Notas emitidas', valor: inteiro(d.kpis.notas), detalhe: d.kpis.notasSistema ? `${inteiro(d.kpis.notasSistema)} pelo sistema` : 'todas pelo P2S' },
    { rotulo: 'Valor médio por nota', valor: moeda(d.kpis.ticket) },
    { rotulo: 'Já recebido', valor: moeda(d.kpis.recebido), detalhe: `${pct(d.kpis.total ? (d.kpis.recebido / d.kpis.total) * 100 : null)} do faturado` },
    { rotulo: 'Devolução → nota', valor: d.kpis.prazoMedio === null ? '—' : `${decimal(d.kpis.prazoMedio)} dias`, detalhe: d.kpis.prazoMediana === null ? '' : `mediana ${d.kpis.prazoMediana} dia(s) · ${inteiro(d.kpis.prazosBase)} notas` },
    { rotulo: 'A faturar', valor: inteiro(d.kpis.aFaturar), detalhe: `${moeda(d.kpis.aFaturarValor)} em OS`, tom: d.kpis.aFaturar ? 'ruim' : 'bom' },
  ] : [];
  const montar = () => d && ({
    titulo: 'Faturamento', subtitulo: r.subtitulo(empresas),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [paraExportar('A faturar', colAF, d.aFaturar), paraExportar('Por cliente', colCli, d.porCliente), paraExportar('Prazo devolução → nota', colFaixa, d.distribuicao), paraExportar('Notas emitidas', colNota, d.notas)],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Faturamento" descricao="Notas de Débito emitidas, o que ainda falta faturar e quanto tempo leva da devolução até a nota.">
        <BotoesExportar nome={`faturamento-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        {d && (
          <>
            <Indicadores itens={kpis} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoBarras titulo="Faturado por mês" categorias={d.porMes.map((m: any) => mesRotulo(m.mes))} formatar={moedaCurta}
                series={[{ nome: 'Período', cor: SERIE_1, valores: d.porMes.map((m: any) => m.atual) }, { nome: 'Ano anterior', cor: SERIE_2, valores: d.porMes.map((m: any) => m.anterior) }]} />
              <Tabela titulo="Prazo da devolução até a nota" colunas={colFaixa} linhas={d.distribuicao} />
            </div>
            <Tabela titulo="A faturar — devolvidas no período e ainda sem nota" colunas={colAF} linhas={d.aFaturar} limite={30} vazio="Nada pendente." />
            <Tabela titulo="Por cliente" colunas={colCli} linhas={d.porCliente} limite={30} />
            <Tabela titulo="Notas emitidas" colunas={colNota} linhas={d.notas} limite={50} />
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
