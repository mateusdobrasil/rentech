"use client";

import Link from 'next/link';
import { Analytics } from "@vercel/analytics/next";
import { relatorioNotasFiscaisAction } from '../actions';
import {
  useRelatorio, TelaRelatorio, Cabecalho, BarraFiltros, Indicadores, GraficoBarras, Tabela, BotoesExportar,
  paraExportar, moeda, moedaCurta, inteiro, dataBR, mesRotulo, SERIE_1, SERIE_2, type Coluna, type Kpi,
} from '../ui';

// Notas fiscais (2026-11-21): NF-e e NFS-e emitidas pelo sistema (Focus NFe).
// Os números contam só PRODUÇÃO; as de homologação aparecem na lista, marcadas.
type Op = { operacao: string; emitidas: number; autorizadas: number; canceladas: number; erro: number; valor: number };
type Nota = { data: string; operacao: string; numero: string; cliente: string; valor: number; situacao: string; ambiente: string; observacao: string };

const colOp: Coluna<Op>[] = [
  { chave: 'operacao', titulo: 'Tipo', peso: 2 }, { chave: 'emitidas', titulo: 'Emitidas', direita: true, formato: inteiro }, { chave: 'autorizadas', titulo: 'Autorizadas', direita: true, formato: inteiro },
  { chave: 'canceladas', titulo: 'Canceladas', direita: true, formato: inteiro }, { chave: 'erro', titulo: 'Com erro', direita: true, formato: inteiro }, { chave: 'valor', titulo: 'Valor autorizado', direita: true, formato: moeda, peso: 1.4 },
];
const colNota: Coluna<Nota>[] = [
  { chave: 'data', titulo: 'Data', formato: dataBR }, { chave: 'operacao', titulo: 'Tipo', peso: 1.6 }, { chave: 'numero', titulo: 'Nº' }, { chave: 'cliente', titulo: 'Cliente', peso: 2.5 },
  { chave: 'valor', titulo: 'Valor', direita: true, formato: moeda, peso: 1.2 }, { chave: 'situacao', titulo: 'Situação' }, { chave: 'ambiente', titulo: 'Ambiente' }, { chave: 'observacao', titulo: 'Observação', peso: 2.5 },
];

export default function RelatorioNotasFiscaisPage() {
  const r = useRelatorio('/admin/relatorios/notas-fiscais', relatorioNotasFiscaisAction);
  if (r.bloqueio) return r.bloqueio;
  const d = r.info?.dados;
  const empresas = r.info?.empresas || [];
  const kpis: Kpi[] = d ? [
    { rotulo: 'Notas autorizadas', valor: inteiro(d.kpis.autorizadas), detalhe: `${inteiro(d.kpis.nfe)} NF-e · ${inteiro(d.kpis.nfse)} NFS-e` },
    { rotulo: 'Valor autorizado', valor: moeda(d.kpis.valor) },
    { rotulo: 'Canceladas', valor: inteiro(d.kpis.canceladas) },
    { rotulo: 'Com erro', valor: inteiro(d.kpis.erro), tom: d.kpis.erro ? 'ruim' : 'bom', detalhe: 'recusadas pela SEFAZ/Prefeitura' },
    { rotulo: 'Em homologação', valor: inteiro(d.kpis.homologacao), detalhe: 'testes, sem valor fiscal' },
  ] : [];
  const montar = () => d && ({
    titulo: 'Notas fiscais', subtitulo: r.subtitulo(empresas),
    indicadores: kpis.map(k => ({ rotulo: k.rotulo, valor: k.valor, detalhe: k.detalhe })),
    tabelas: [paraExportar('Por tipo', colOp, d.porOperacao), paraExportar('Notas', colNota, d.notas)],
  });
  return (
    <TelaRelatorio>
      <Analytics />
      <Cabecalho titulo="Notas Fiscais" descricao="NF-e e NFS-e emitidas pelo sistema, por tipo e período — autorizadas, canceladas e com erro.">
        <BotoesExportar nome={`notas-fiscais-${r.filtros.de}-a-${r.filtros.ate}`} accessToken={r.accessToken} montar={montar} avisar={r.avisar} />
      </Cabecalho>
      <div className="px-4 md:px-8 pb-8 space-y-4">
        <BarraFiltros filtros={r.filtros} mudar={r.setFiltros} empresas={empresas} carregando={r.carregando} />
        {r.falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{r.falha}</div>}
        <div className="bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E3A8A] rounded-2xl px-4 py-3 text-xs">Contam só as notas de <strong>produção</strong> emitidas pelo sistema (Focus NFe); as do P2S não entram. Emissão, DANFE e cancelamento ficam em <Link href="/admin/financeiro/fiscal" className="font-black underline">Financeiro › Fiscal</Link>.</div>
        {d && (
          <>
            <Indicadores itens={kpis} />
            <div className="grid lg:grid-cols-2 gap-4">
              <GraficoBarras titulo="Valor autorizado por mês" categorias={d.porMes.map((m: any) => mesRotulo(m.mes))} formatar={moedaCurta}
                series={[{ nome: 'NF-e', cor: SERIE_1, valores: d.porMes.map((m: any) => m.nfe) }, { nome: 'NFS-e', cor: SERIE_2, valores: d.porMes.map((m: any) => m.nfse) }]} />
              <Tabela titulo="Por tipo" colunas={colOp} linhas={d.porOperacao} vazio="Nenhuma nota de produção no período." />
            </div>
            <Tabela titulo="Notas" colunas={colNota} linhas={d.notas} limite={50} vazio="Nenhuma nota no período." />
          </>
        )}
      </div>
    </TelaRelatorio>
  );
}
