"use client";

import { Analytics } from "@vercel/analytics/next";
import { relatorioEventosAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoBarras, GraficoRanking, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, pct, dataBR, mesRotulo, SERIE_1, SERIE_2, type Coluna, type Kpi,
} from '../ui';

// Eventos e feiras (2026-11-21): fichas confirmadas pela data do evento, agrupadas
// por evento. "Edição anterior" = evento com o mesmo nome sem o ano no período
// do ano anterior (ex.: EXPOMAFE 2026 × EXPOMAFE 2027).
type Ev = { evento: string; local: string; data: string; os: number; clientes: number; receita: number; ticket: number; participacao: number; edicaoAnterior: number | null; variacao: number | null };
type NaoRep = { evento: string; os: number; receitaAnterior: number };

const colEv: Coluna<Ev>[] = [
  { chave: 'evento', titulo: 'Evento', peso: 3 }, { chave: 'local', titulo: 'Local', peso: 2 }, { chave: 'data', titulo: 'Início', formato: dataBR },
  { chave: 'os', titulo: 'OS', direita: true, formato: inteiro }, { chave: 'clientes', titulo: 'Clientes', direita: true, formato: inteiro },
  { chave: 'receita', titulo: 'Receita', direita: true, formato: moeda, peso: 1.4 }, { chave: 'ticket', titulo: 'Ticket por OS', direita: true, formato: moeda, peso: 1.2 },
  { chave: 'participacao', titulo: '% dos eventos', direita: true, formato: pct },
  { chave: 'edicaoAnterior', titulo: 'Edição anterior', direita: true, formato: v => (v === null ? '—' : moeda(v)), peso: 1.3 }, { chave: 'variacao', titulo: 'Variação', direita: true, formato: pct },
];
const colNaoRep: Coluna<NaoRep>[] = [
  { chave: 'evento', titulo: 'Evento (ano anterior)', peso: 3 }, { chave: 'os', titulo: 'OS', direita: true, formato: inteiro }, { chave: 'receitaAnterior', titulo: 'Receita', direita: true, formato: moeda, peso: 1.4 },
];

export default function RelatorioEventosPage() {
  const r = useRelatorio('/admin/relatorios/eventos', relatorioEventosAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Eventos atendidos', valor: inteiro(d.kpis.eventos), detalhe: `${inteiro(d.kpis.repetidos)} com edição anterior` },
    { rotulo: 'Receita em eventos', valor: moeda(d.kpis.receitaEventos), detalhe: `${pct(d.kpis.participacaoEventos)} da receita` },
    { rotulo: 'Receita por evento', valor: moeda(d.kpis.ticketEvento) },
    { rotulo: 'Maior evento', valor: moedaCurta(d.kpis.maiorValor), detalhe: d.kpis.maior },
    { rotulo: 'Repetidos × edição anterior', valor: d.kpis.crescimentoRepetidos === null ? '—' : `${d.kpis.crescimentoRepetidos >= 0 ? '+' : ''}${pct(d.kpis.crescimentoRepetidos)}`, tom: d.kpis.crescimentoRepetidos === null ? 'neutro' : d.kpis.crescimentoRepetidos >= 0 ? 'bom' : 'ruim', detalhe: 'mesmos eventos, ano a ano' },
    { rotulo: 'OS sem evento', valor: inteiro(d.kpis.osSemEvento), detalhe: moeda(d.kpis.receitaSemEvento) },
  ] : [];
  const montar = () => d && ({
    titulo: 'Eventos e feiras', subtitulo: r.subtitulo(empresas),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [paraExportar('Eventos', colEv, d.eventos), paraExportar('Não se repetiram', colNaoRep, d.naoRepetidos)],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Eventos e Feiras" descricao="Receita, OS e clientes por evento, comparando com a edição anterior.">
        <BotoesExportar nome={`eventos-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} vendedores={r.info?.vendedores} soDoVendedor={r.info?.soDoVendedor} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-3 text-xs">O evento só está ligado às fichas a partir de <strong>junho/2026</strong> (sincronização incremental). As fichas do histórico do P2S chegaram sem o evento, então períodos anteriores aparecem como &quot;OS sem evento&quot; e as edições anteriores ficam sem comparação.</div>
        {d && (
          <>
            <Indicadores itens={kpis} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoBarras titulo="Receita em eventos por mês" categorias={d.porMes.map((m: any) => mesRotulo(m.mes))} formatar={moedaCurta}
                series={[{ nome: 'Período', cor: SERIE_1, valores: d.porMes.map((m: any) => m.atual) }, { nome: 'Ano anterior', cor: SERIE_2, valores: d.porMes.map((m: any) => m.anterior) }]} />
              <GraficoRanking titulo="Top 10 eventos por receita" itens={d.eventos.slice(0, 10).map((e: Ev) => ({ rotulo: e.evento, valor: e.receita }))} formatar={moedaCurta} />
            </div>
            <Tabela titulo="Eventos" colunas={colEv} linhas={d.eventos} limite={50} />
            <Tabela titulo="Eventos do ano anterior que não se repetiram" colunas={colNaoRep} linhas={d.naoRepetidos} limite={30} vazio="Nenhum (ou o ano anterior ainda não tem eventos ligados às fichas)." />
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
