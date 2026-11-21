"use client";

import { Analytics } from "@vercel/analytics/next";
import { relatorioOcupacaoAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoRanking, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, decimal, pct, dataBR, type Coluna, type Kpi,
} from '../ui';

// Ocupação e retorno (2026-11-21): uso = unidades × dias (da saída ao retorno das
// fichas confirmadas, kits abertos nos componentes) ÷ estoque × dias do período.
// Retorno = receita do período ÷ valor do bem (indenização ou custo de reposição) × estoque.
type Prod = { produto: string; codigo: string; categoria: string; estoque: number; ocupacao: number | null; diasComUso: number; pico: number; sublocou: string; receita: number; valorBem: number; patrimonio: number; retorno: number | null };
type Cat = { categoria: string; produtos: number; estoque: number; ocupacao: number | null; receita: number; patrimonio: number; retorno: number | null };

const colProd: Coluna<Prod>[] = [
  { chave: 'produto', titulo: 'Equipamento', peso: 3 }, { chave: 'codigo', titulo: 'Código' }, { chave: 'categoria', titulo: 'Categoria', peso: 1.5 },
  { chave: 'estoque', titulo: 'Estoque', direita: true, formato: decimal }, { chave: 'ocupacao', titulo: 'Ocupação', direita: true, formato: pct },
  { chave: 'diasComUso', titulo: 'Dias em uso', direita: true, formato: inteiro }, { chave: 'pico', titulo: 'Pico (un.)', direita: true, formato: decimal },
  { chave: 'sublocou', titulo: 'Passou do estoque' }, { chave: 'receita', titulo: 'Receita', direita: true, formato: moeda, peso: 1.3 },
  { chave: 'patrimonio', titulo: 'Valor do estoque', direita: true, formato: v => (v ? moeda(v) : '—'), peso: 1.3 }, { chave: 'retorno', titulo: 'Retorno', direita: true, formato: pct },
];
const colCat: Coluna<Cat>[] = [
  { chave: 'categoria', titulo: 'Categoria', peso: 2 }, { chave: 'produtos', titulo: 'Equipamentos', direita: true, formato: inteiro }, { chave: 'estoque', titulo: 'Estoque', direita: true, formato: decimal },
  { chave: 'ocupacao', titulo: 'Ocupação', direita: true, formato: pct }, { chave: 'receita', titulo: 'Receita', direita: true, formato: moeda, peso: 1.3 },
  { chave: 'patrimonio', titulo: 'Valor do estoque', direita: true, formato: moeda, peso: 1.3 }, { chave: 'retorno', titulo: 'Retorno', direita: true, formato: pct },
];
const colSemEstoque: Coluna<Prod>[] = [
  { chave: 'produto', titulo: 'Equipamento', peso: 3 }, { chave: 'codigo', titulo: 'Código' }, { chave: 'diasComUso', titulo: 'Dias em uso', direita: true, formato: inteiro },
  { chave: 'pico', titulo: 'Pico (un.)', direita: true, formato: decimal }, { chave: 'receita', titulo: 'Receita', direita: true, formato: moeda, peso: 1.3 },
];

export default function RelatorioOcupacaoPage() {
  const r = useRelatorio('/admin/relatorios/ocupacao', relatorioOcupacaoAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Ocupação média', valor: pct(d.kpis.ocupacaoMedia), detalhe: `ponderada pelo estoque · ${inteiro(d.kpis.dias)} dias` },
    { rotulo: 'Equipamentos com estoque', valor: inteiro(d.kpis.produtos), detalhe: `${inteiro(d.kpis.acima70)} com 70%+ de ocupação` },
    { rotulo: 'Parados no período', valor: inteiro(d.kpis.parados), tom: d.kpis.parados ? 'ruim' : 'bom', detalhe: 'nenhum dia em uso' },
    { rotulo: 'Receita', valor: moeda(d.kpis.receita) },
    { rotulo: 'Valor do estoque', valor: moeda(d.kpis.patrimonio), detalhe: `${inteiro(d.kpis.semValorBem)} sem valor do bem` },
    { rotulo: 'Retorno sobre o estoque', valor: pct(d.kpis.retorno), detalhe: 'receita ÷ valor do estoque' },
  ] : [];
  const montar = () => d && ({
    titulo: 'Ocupação e retorno', subtitulo: r.subtitulo(empresas),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [paraExportar('Por categoria', colCat, d.porCategoria), paraExportar('Por equipamento', colProd, d.porProduto), paraExportar('Parados', colProd, d.parados), paraExportar('Alugados sem estoque cadastrado', colSemEstoque, d.semEstoque)],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Ocupação e Retorno" descricao="Quanto do estoque ficou em uso, o que ficou parado e quanto cada equipamento rendeu sobre o próprio valor.">
        <BotoesExportar nome={`ocupacao-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-3 text-xs">
          O <strong>estoque</strong> vem do saldo do P2S, que só fica confiável depois do inventário da virada — ocupação acima de 100% (&quot;passou do estoque&quot;) ou equipamentos alugados sem estoque costumam ser saldo errado ou sublocação.
          O <strong>retorno</strong> usa o valor de indenização (ou o custo de reposição) do cadastro do produto.
          {d?.kpis.cortado && <> O período foi limitado a 1 ano (até {dataBR(d.kpis.ateUsado)}).</>}
        </div>
        {d && (
          <>
            <Indicadores itens={kpis} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoRanking titulo="Mais ocupados (%)" itens={d.porProduto.slice(0, 10).map((p: Prod) => ({ rotulo: p.produto, valor: p.ocupacao || 0 }))} formatar={v => pct(v)} />
              <GraficoRanking titulo="Maior valor parado" itens={d.parados.slice(0, 10).map((p: Prod) => ({ rotulo: p.produto, valor: p.patrimonio }))} formatar={moedaCurta} />
            </div>
            <Tabela titulo="Por categoria" colunas={colCat} linhas={d.porCategoria} />
            <Tabela titulo="Por equipamento" colunas={colProd} linhas={d.porProduto} limite={50} />
            <Tabela titulo="Parados no período" colunas={colProd} linhas={d.parados} limite={30} vazio="Nenhum equipamento parado." />
            <Tabela titulo="Alugados sem estoque cadastrado" colunas={colSemEstoque} linhas={d.semEstoque} limite={30} vazio="Nenhum." />
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
