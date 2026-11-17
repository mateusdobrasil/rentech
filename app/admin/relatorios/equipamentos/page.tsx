"use client";

import { Analytics } from "@vercel/analytics/next";
import { relatorioEquipamentosAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoRanking, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, decimal, dataBR, type Coluna, type Kpi,
} from '../ui';

// Equipamentos e Operação (2026-11-17): itens das fichas confirmadas (pela
// data do evento) + fichas de locação do P2S (saídas, devoluções, atrasos).
type Prod = { produto: string; codigo: string; categoria: string; locacoes: number; quantidade: number; diarias: number; receita: number };
type Cat = { categoria: string; produtos: number; locacoes: number; receita: number };
type Parado = { produto: string; codigo: string; categoria: string };
type Atraso = { ficha: string; cliente: string; saida: string; retornoPrevisto: string; diasAtraso: number };

const colProd: Coluna<Prod>[] = [
  { chave: 'produto', titulo: 'Equipamento', peso: 3 }, { chave: 'codigo', titulo: 'Código' }, { chave: 'categoria', titulo: 'Categoria', peso: 1.5 },
  { chave: 'locacoes', titulo: 'Locações', direita: true, formato: inteiro }, { chave: 'quantidade', titulo: 'Unidades', direita: true, formato: decimal },
  { chave: 'diarias', titulo: 'Diárias', direita: true, formato: decimal }, { chave: 'receita', titulo: 'Receita', direita: true, formato: moeda, peso: 1.4 },
];
const colCat: Coluna<Cat>[] = [
  { chave: 'categoria', titulo: 'Categoria', peso: 2 }, { chave: 'produtos', titulo: 'Equipamentos', direita: true, formato: inteiro },
  { chave: 'locacoes', titulo: 'Locações', direita: true, formato: inteiro }, { chave: 'receita', titulo: 'Receita', direita: true, formato: moeda, peso: 1.4 },
];
const colParado: Coluna<Parado>[] = [{ chave: 'produto', titulo: 'Equipamento', peso: 3 }, { chave: 'codigo', titulo: 'Código' }, { chave: 'categoria', titulo: 'Categoria', peso: 1.5 }];
const colAtraso: Coluna<Atraso>[] = [
  { chave: 'ficha', titulo: 'Ficha de locação' }, { chave: 'cliente', titulo: 'Cliente', peso: 2.5 }, { chave: 'saida', titulo: 'Saída', formato: dataBR },
  { chave: 'retornoPrevisto', titulo: 'Retorno previsto', formato: dataBR }, { chave: 'diasAtraso', titulo: 'Dias de atraso', direita: true, formato: inteiro },
];

export default function RelatorioEquipamentosPage() {
  const r = useRelatorio('/admin/relatorios/equipamentos', relatorioEquipamentosAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Receita de equipamentos', valor: moeda(d.kpis.receita), detalhe: `${inteiro(d.kpis.fichas)} ficha(s) confirmadas` },
    { rotulo: 'Equipamentos locados', valor: inteiro(d.kpis.produtosLocados), detalhe: `${decimal(d.kpis.unidades)} unidades` },
    { rotulo: 'Sem nenhuma locação', valor: inteiro(d.kpis.parados), detalhe: 'habilitados para locação' },
    { rotulo: 'Saídas (fichas de locação)', valor: inteiro(d.kpis.saidas), detalhe: `${inteiro(d.kpis.devolvidas)} já devolvidas` },
    { rotulo: 'Devoluções atrasadas', valor: inteiro(d.kpis.atrasadas), tom: d.kpis.atrasadas ? 'ruim' : 'bom', detalhe: 'passou do retorno previsto' },
  ] : [];
  const montar = () => d && ({
    titulo: 'Equipamentos e Operação', subtitulo: r.subtitulo(empresas),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [
      paraExportar('Por equipamento', colProd, d.porProduto),
      paraExportar('Por categoria', colCat, d.porCategoria),
      paraExportar('Devoluções atrasadas', colAtraso, d.atrasadas),
      paraExportar('Sem nenhuma locação no período', colParado, d.parados),
    ],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Equipamentos e Operação" descricao="O que mais e menos aluga, quanto rende, e as saídas e devoluções do período.">
        <BotoesExportar nome={`equipamentos-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        {d && (
          <>
            <Indicadores itens={kpis} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoRanking titulo="Top 10 equipamentos por receita" itens={d.porProduto.slice(0, 10).map((p: Prod) => ({ rotulo: p.produto, valor: p.receita }))} formatar={moedaCurta} />
              <GraficoRanking titulo="Receita por categoria" itens={d.porCategoria.slice(0, 10).map((c: Cat) => ({ rotulo: c.categoria, valor: c.receita }))} formatar={moedaCurta} />
            </div>
            <Tabela titulo="Por equipamento" colunas={colProd} linhas={d.porProduto} limite={50} />
            <div className="grid lg:grid-cols-2 gap-4">
              <Tabela titulo="Por categoria" colunas={colCat} linhas={d.porCategoria} />
              <Tabela titulo="Devoluções atrasadas" colunas={colAtraso} linhas={d.atrasadas} vazio="Nenhuma devolução atrasada (ou as fichas de locação ainda não foram importadas — ver Parâmetros → Histórico do P2S)." />
            </div>
            <Tabela titulo="Sem nenhuma locação no período" colunas={colParado} linhas={d.parados} limite={30} />
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
