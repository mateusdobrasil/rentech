"use client";

import { Analytics } from "@vercel/analytics/next";
import { relatorioOrcamentosAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoBarras, Tabela, BotoesExportar,
  paraExportar, moeda, inteiro, pct, dataBR, mesRotulo, SERIE_1, SERIE_2, type Coluna, type Kpi,
} from '../ui';

// Orçamentos e Conversão (2026-11-17): fichas pela data de emissão.
type Vend = { nome: string; emitidos: number; aprovados: number; perdidos: number; abertos: number; taxa: number | null; valorEmitido: number; valorAprovado: number };
type Motivo = { motivo: string; qtd: number; valor: number };
type Aberto = { ficha: string; cliente: string; evento: string; vendedor: string; emissao: string; validade: string; inicio: string; valor: number; status: string };

const colVend: Coluna<Vend>[] = [
  { chave: 'nome', titulo: 'Vendedor', peso: 3 },
  { chave: 'emitidos', titulo: 'Emitidos', direita: true, formato: inteiro },
  { chave: 'aprovados', titulo: 'Aprovados', direita: true, formato: inteiro },
  { chave: 'perdidos', titulo: 'Perdidos', direita: true, formato: inteiro },
  { chave: 'abertos', titulo: 'Em aberto', direita: true, formato: inteiro },
  { chave: 'taxa', titulo: 'Conversão', direita: true, formato: pct },
  { chave: 'valorEmitido', titulo: 'Valor emitido', direita: true, formato: moeda, peso: 1.4 },
  { chave: 'valorAprovado', titulo: 'Valor aprovado', direita: true, formato: moeda, peso: 1.4 },
];
const colMotivo: Coluna<Motivo>[] = [
  { chave: 'motivo', titulo: 'Motivo da perda', peso: 4 },
  { chave: 'qtd', titulo: 'Orçamentos', direita: true, formato: inteiro },
  { chave: 'valor', titulo: 'Valor perdido', direita: true, formato: moeda, peso: 1.4 },
];
const colAberto: Coluna<Aberto>[] = [
  { chave: 'ficha', titulo: 'Ficha' }, { chave: 'cliente', titulo: 'Cliente', peso: 2.5 }, { chave: 'evento', titulo: 'Evento', peso: 2 },
  { chave: 'vendedor', titulo: 'Vendedor', peso: 1.5 }, { chave: 'emissao', titulo: 'Emissão', formato: dataBR }, { chave: 'validade', titulo: 'Validade', formato: dataBR },
  { chave: 'inicio', titulo: 'Evento em', formato: dataBR }, { chave: 'valor', titulo: 'Valor', direita: true, formato: moeda, peso: 1.3 },
];

export default function RelatorioOrcamentosPage() {
  const r = useRelatorio('/admin/relatorios/orcamentos', relatorioOrcamentosAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Orçamentos emitidos', valor: inteiro(d.kpis.emitidos), detalhe: moeda(d.kpis.valorEmitido) },
    { rotulo: 'Aprovados', valor: inteiro(d.kpis.aprovados), detalhe: moeda(d.kpis.valorAprovado), tom: 'bom' },
    { rotulo: 'Perdidos', valor: inteiro(d.kpis.perdidos), detalhe: moeda(d.kpis.valorPerdido), tom: 'ruim' },
    { rotulo: 'Em aberto', valor: inteiro(d.kpis.abertos), detalhe: moeda(d.kpis.valorAberto) },
    { rotulo: 'Taxa de conversão', valor: pct(d.kpis.taxa), detalhe: 'aprovados ÷ (aprovados + perdidos)' },
    { rotulo: 'Prazo até aprovar', valor: d.kpis.prazoMedioDias === null ? '—' : `${d.kpis.prazoMedioDias} dias`, detalhe: 'média, da emissão à aprovação' },
  ] : [];
  const montar = () => d && ({
    titulo: 'Orçamentos e Conversão', subtitulo: r.subtitulo(empresas) + (r.info?.soDoVendedor ? ` · ${r.info.soDoVendedor}` : ''),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [
      paraExportar('Conversão por mês', [
        { chave: 'mes', titulo: 'Mês', formato: mesRotulo }, { chave: 'emitidos', titulo: 'Emitidos', direita: true, formato: inteiro }, { chave: 'aprovados', titulo: 'Aprovados', direita: true, formato: inteiro },
      ] as Coluna<any>[], d.porMes),
      paraExportar('Por vendedor', colVend, d.porVendedor),
      paraExportar('Motivos de perda', colMotivo, d.motivosPerda),
      paraExportar('Orçamentos em aberto', colAberto, d.emAberto),
    ],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Orçamentos e Conversão" descricao="Fichas pela data de emissão: quanto virou locação, quanto se perdeu e o que está em aberto.">
        <BotoesExportar nome={`orcamentos-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} vendedores={r.info?.vendedores} soDoVendedor={r.info?.soDoVendedor} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        {d && (
          <>
            {d.kpis.semEmissao > 0 && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{inteiro(d.kpis.semEmissao)} ficha(s) do P2S ainda sem data de emissão entraram pela data do evento — a carga do histórico completa isso.</p>}
            <Indicadores itens={kpis} />
            <GraficoBarras titulo="Orçamentos emitidos × aprovados por mês" categorias={d.porMes.map((m: any) => mesRotulo(m.mes))} formatar={inteiro}
              series={[{ nome: 'Emitidos', cor: SERIE_1, valores: d.porMes.map((m: any) => m.emitidos) }, { nome: 'Aprovados', cor: SERIE_2, valores: d.porMes.map((m: any) => m.aprovados) }]} />
            <Tabela titulo="Conversão por vendedor" colunas={colVend} linhas={d.porVendedor} />
            <div className="grid lg:grid-cols-[2fr_3fr] gap-4">
              <Tabela titulo="Motivos de perda" colunas={colMotivo} linhas={d.motivosPerda} vazio="Nenhum orçamento perdido no período." />
              <Tabela titulo="Orçamentos em aberto (por validade)" colunas={colAberto} linhas={d.emAberto} limite={30} vazio="Nenhum orçamento em aberto." />
            </div>
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
