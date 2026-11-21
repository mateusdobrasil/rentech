"use client";

import { Analytics } from "@vercel/analytics/next";
import { relatorioSublocacaoAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoRanking, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, decimal, pct, dataBR, type Coluna, type Kpi,
} from '../ui';

// Sublocação (2026-11-21): sublocações do período (pela retirada). Receita = preço
// da OS × quantidade sublocada; custo = itens + frete + avarias cobradas pelo parceiro.
type Forn = { fornecedor: string; sublocacoes: number; unidades: number; custo: number; frete: number; avarias: number; custoTotal: number; receita: number; margem: number; margemPct: number | null };
type Prod = { produto: string; vezes: number; unidades: number; custo: number };
type Sub = { numero: string; data: string; fornecedor: string; os: string; status: string; itens: string; custo: number; receita: number; margem: number };

const colForn: Coluna<Forn>[] = [
  { chave: 'fornecedor', titulo: 'Parceiro', peso: 2.5 }, { chave: 'sublocacoes', titulo: 'Sublocações', direita: true, formato: inteiro }, { chave: 'unidades', titulo: 'Unidades', direita: true, formato: decimal },
  { chave: 'custo', titulo: 'Locação', direita: true, formato: moeda, peso: 1.2 }, { chave: 'frete', titulo: 'Frete', direita: true, formato: moeda }, { chave: 'avarias', titulo: 'Avarias', direita: true, formato: moeda },
  { chave: 'custoTotal', titulo: 'Custo total', direita: true, formato: moeda, peso: 1.3 }, { chave: 'receita', titulo: 'Receita na OS', direita: true, formato: moeda, peso: 1.3 },
  { chave: 'margem', titulo: 'Margem', direita: true, formato: moeda, peso: 1.2 }, { chave: 'margemPct', titulo: 'Margem %', direita: true, formato: pct },
];
const colProd: Coluna<Prod>[] = [
  { chave: 'produto', titulo: 'Equipamento que faltou', peso: 3 }, { chave: 'vezes', titulo: 'Vezes', direita: true, formato: inteiro },
  { chave: 'unidades', titulo: 'Unidades', direita: true, formato: decimal }, { chave: 'custo', titulo: 'Custo', direita: true, formato: moeda, peso: 1.3 },
];
const colSub: Coluna<Sub>[] = [
  { chave: 'numero', titulo: 'Sublocação' }, { chave: 'data', titulo: 'Retirada', formato: dataBR }, { chave: 'fornecedor', titulo: 'Parceiro', peso: 2 }, { chave: 'os', titulo: 'OS' },
  { chave: 'itens', titulo: 'Itens', peso: 3 }, { chave: 'custo', titulo: 'Custo', direita: true, formato: moeda, peso: 1.2 }, { chave: 'receita', titulo: 'Receita', direita: true, formato: moeda, peso: 1.2 },
  { chave: 'margem', titulo: 'Margem', direita: true, formato: moeda, peso: 1.2 }, { chave: 'status', titulo: 'Situação' },
];

export default function RelatorioSublocacaoPage() {
  const r = useRelatorio('/admin/relatorios/sublocacao', relatorioSublocacaoAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Sublocações', valor: inteiro(d.kpis.sublocacoes), detalhe: `${inteiro(d.kpis.os)} OS · ${inteiro(d.kpis.fornecedores)} parceiro(s)` },
    { rotulo: 'Custo com parceiros', valor: moeda(d.kpis.custo), detalhe: 'locação + frete + avarias' },
    { rotulo: 'Receita na OS', valor: moeda(d.kpis.receita), detalhe: 'do que foi sublocado' },
    { rotulo: 'Margem', valor: moeda(d.kpis.margem), tom: d.kpis.margem >= 0 ? 'bom' : 'ruim', detalhe: pct(d.kpis.margemPct) },
    { rotulo: 'Avarias de parceiro', valor: moeda(d.kpis.avarias) },
  ] : [];
  const montar = () => d && ({
    titulo: 'Sublocação', subtitulo: r.subtitulo(empresas),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [paraExportar('Por parceiro', colForn, d.porFornecedor), paraExportar('O que faltou', colProd, d.porProduto), paraExportar('Sublocações', colSub, d.sublocacoes)],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Sublocação" descricao="Quanto custou pegar equipamento com parceiros, a margem que sobrou na OS e o que mais faltou.">
        <BotoesExportar nome={`sublocacao-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        {d && (
          <>
            <Indicadores itens={kpis} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoRanking titulo="Custo por parceiro" itens={d.porFornecedor.slice(0, 10).map((f: Forn) => ({ rotulo: f.fornecedor, valor: f.custoTotal }))} formatar={moedaCurta} />
              <GraficoRanking titulo="O que mais faltou (unidades)" itens={d.porProduto.slice(0, 10).map((p: Prod) => ({ rotulo: p.produto, valor: p.unidades }))} formatar={decimal} />
            </div>
            <Tabela titulo="Por parceiro" colunas={colForn} linhas={d.porFornecedor} vazio="Nenhuma sublocação no período (as sublocações são registradas em Locações › Sublocações)." />
            <Tabela titulo="O que faltou e foi sublocado" colunas={colProd} linhas={d.porProduto} limite={30} vazio="Nada." />
            <Tabela titulo="Sublocações" colunas={colSub} linhas={d.sublocacoes} limite={50} vazio="Nenhuma." />
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
