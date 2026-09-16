"use client";

import { useState, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { useAcessoRota } from '../useAcessoRota';
import { useToast } from '../../../components/ui/NotificationProvider';
import {
  listarNaturezasPagamentoAction, criarNaturezaPagamentoAction, excluirNaturezaPagamentoAction,
  salvarClassificacaoNaturezaAction, listarCentrosFinanceirosP2sAction, listarSubCentrosFinanceirosP2sAction,
  type NaturezaPagamento
} from '../actions-naturezas';

interface CentroFinanceiro { oid: string; nome: string; }

const TIPOS_CLASSIFICACAO: { value: 'CUSTO' | 'RECEITA'; label: string }[] = [
  { value: 'CUSTO', label: 'Centro de Custo' },
  { value: 'RECEITA', label: 'Centro de Receita' },
];

interface EdicaoClassificacao {
  id: number;
  tipoClassificacao: 'CUSTO' | 'RECEITA';
  centroOid: string;
  centroNome: string;
  subcentroOid: string;
  subcentroNome: string;
  subcentros: CentroFinanceiro[];
  carregandoSubcentros: boolean;
}

export default function NaturezasPagamentoPage() {
  const router = useRouter();
  const { authLoading, acessoNegado, perfil } = useAcessoRota('/admin/op/naturezas');
  const toast = useToast();

  const [naturezas, setNaturezas] = useState<NaturezaPagamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [centros, setCentros] = useState<CentroFinanceiro[]>([]);
  const [carregandoCentros, setCarregandoCentros] = useState(false);

  const [novaNatureza, setNovaNatureza] = useState('');
  const [criando, setCriando] = useState(false);
  const [excluindoId, setExcluindoId] = useState<number | null>(null);

  const [edicao, setEdicao] = useState<EdicaoClassificacao | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const carregar = async () => {
    if (!perfil) return;
    setLoading(true);
    const res = await listarNaturezasPagamentoAction(perfil.accessToken);
    if (res.ok) setNaturezas(res.info.naturezas);
    else toast('Erro ao carregar naturezas: ' + res.erro, 'error');
    setLoading(false);
  };

  useEffect(() => { if (!authLoading && perfil) carregar(); }, [authLoading, perfil]);

  // Catálogo de Centro Financeiro carregado uma vez só, direto do PrimeStart
  // — reaproveitado por qualquer linha que entrar em edição.
  const carregarCentros = async () => {
    if (!perfil || centros.length > 0) return;
    setCarregandoCentros(true);
    const res = await listarCentrosFinanceirosP2sAction(perfil.accessToken);
    if (res.ok) setCentros(res.info.centros);
    else toast('Erro ao carregar Centros Financeiros do PrimeStart: ' + res.erro, 'error');
    setCarregandoCentros(false);
  };

  const criar = async () => {
    if (!perfil || !novaNatureza.trim()) return;
    setCriando(true);
    const res = await criarNaturezaPagamentoAction({ natureza: novaNatureza }, perfil.accessToken);
    if (res.ok) { setNovaNatureza(''); await carregar(); }
    else toast('Erro ao criar natureza: ' + res.erro, 'error');
    setCriando(false);
  };

  const excluir = async (n: NaturezaPagamento) => {
    if (!perfil) return;
    if (!confirm(`Excluir a natureza "${n.natureza}"? OPs já criadas com ela não são afetadas — só deixa de aparecer como opção em novas OPs.`)) return;
    setExcluindoId(n.id);
    const res = await excluirNaturezaPagamentoAction({ id: n.id }, perfil.accessToken);
    if (res.ok) await carregar();
    else toast('Erro ao excluir natureza: ' + res.erro, 'error');
    setExcluindoId(null);
  };

  const abrirEdicao = async (n: NaturezaPagamento) => {
    await carregarCentros();
    setEdicao({
      id: n.id,
      tipoClassificacao: n.tipo_classificacao,
      centroOid: n.centro_financeiro_oid || '',
      centroNome: n.centro_financeiro_nome || '',
      subcentroOid: n.subcentro_financeiro_oid || '',
      subcentroNome: n.subcentro_financeiro_nome || '',
      subcentros: [],
      carregandoSubcentros: false,
    });
    if (n.centro_financeiro_oid) await carregarSubcentros(n.centro_financeiro_oid);
  };

  const carregarSubcentros = async (centroOid: string) => {
    if (!perfil || !centroOid) return;
    setEdicao(prev => prev ? { ...prev, carregandoSubcentros: true } : prev);
    const res = await listarSubCentrosFinanceirosP2sAction({ centroOid }, perfil.accessToken);
    if (res.ok) setEdicao(prev => prev ? { ...prev, subcentros: res.info.subcentros, carregandoSubcentros: false } : prev);
    else {
      toast('Erro ao carregar Sub-Centros do PrimeStart: ' + res.erro, 'error');
      setEdicao(prev => prev ? { ...prev, carregandoSubcentros: false } : prev);
    }
  };

  const mudarCentro = async (oid: string) => {
    const centro = centros.find(c => c.oid === oid);
    setEdicao(prev => prev ? { ...prev, centroOid: oid, centroNome: centro?.nome || '', subcentroOid: '', subcentroNome: '', subcentros: [] } : prev);
    if (oid) await carregarSubcentros(oid);
  };

  const mudarSubcentro = (oid: string) => {
    setEdicao(prev => {
      if (!prev) return prev;
      const sub = prev.subcentros.find(s => s.oid === oid);
      return { ...prev, subcentroOid: oid, subcentroNome: sub?.nome || '' };
    });
  };

  const salvarEdicao = async () => {
    if (!perfil || !edicao) return;
    setSalvandoEdicao(true);
    const res = await salvarClassificacaoNaturezaAction({
      id: edicao.id,
      tipoClassificacao: edicao.tipoClassificacao,
      centroFinanceiroOid: edicao.centroOid || null,
      centroFinanceiroNome: edicao.centroNome || null,
      subcentroFinanceiroOid: edicao.subcentroOid || null,
      subcentroFinanceiroNome: edicao.subcentroNome || null,
    }, perfil.accessToken);
    if (res.ok) { setEdicao(null); await carregar(); toast('Classificação salva.', 'success'); }
    else toast('Erro ao salvar classificação: ' + res.erro, 'error');
    setSalvandoEdicao(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  if (acessoNegado || !perfil) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Natureza & Classificação Financeira.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4 pb-12">
      <Analytics />
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-start mb-6 gap-3">
          <div>
            <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-tight">Natureza & Classificação Financeira</h1>
            <p className="text-[#64748B] font-medium text-sm">Naturezas de pagamento disponíveis na Nova OP, com a Classificação Financeira (Centro/Sub-Centro) enviada ao PrimeStart ao lançar a Conta a Pagar.</p>
          </div>
          <button onClick={() => router.push('/admin/op')} className="text-[10px] md:text-xs font-black bg-white hover:bg-gray-100 border border-[#E2E8F0] text-[#0C1D4D] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase shrink-0">
            ⬅ VOLTAR
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-4 mb-4 flex gap-2">
          <input
            type="text" value={novaNatureza} onChange={e => setNovaNatureza(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') criar(); }}
            placeholder="Nova natureza (ex.: MANUTENÇÃO)"
            className="flex-1 p-2.5 border border-[#CBD5E1] rounded-lg text-sm uppercase outline-none focus:border-[#336699] text-[#0A2A4A]"
          />
          <button onClick={criar} disabled={criando || !novaNatureza.trim()} className="text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 rounded-lg uppercase disabled:opacity-50 shrink-0">
            {criando ? 'Criando...' : '+ Nova Natureza'}
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#F8FAFC]">
              <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                <th className="p-3 border-b-2 border-[#E2E8F0]">Natureza</th>
                <th className="p-3 border-b-2 border-[#E2E8F0]">Classificar como</th>
                <th className="p-3 border-b-2 border-[#E2E8F0]">Centro Financeiro</th>
                <th className="p-3 border-b-2 border-[#E2E8F0]">Sub-Centro Financeiro</th>
                <th className="p-3 border-b-2 border-[#E2E8F0] text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {loading ? (
                <tr><td colSpan={5} className="text-center py-10 text-[#94A3B8] font-bold text-sm">Carregando...</td></tr>
              ) : naturezas.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-[#94A3B8] font-bold text-sm">Nenhuma natureza cadastrada.</td></tr>
              ) : (
                naturezas.map(n => (
                  <Fragment key={n.id}>
                    <tr className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="p-3 font-black text-[#0C1D4D]">{n.natureza}</td>
                      <td className="p-3 font-bold text-[#0A2A4A]">{TIPOS_CLASSIFICACAO.find(t => t.value === n.tipo_classificacao)?.label}</td>
                      <td className="p-3 font-semibold text-[#0A2A4A]">{n.centro_financeiro_nome || <span className="text-amber-600 font-bold">Não configurado</span>}</td>
                      <td className="p-3 font-semibold text-[#0A2A4A]">{n.subcentro_financeiro_nome || '—'}</td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <button onClick={() => abrirEdicao(n)} className="text-[10px] font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg uppercase mr-2">
                          ✏️ Classificar
                        </button>
                        <button onClick={() => excluir(n)} disabled={excluindoId === n.id} className="text-[10px] font-black text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg uppercase disabled:opacity-50">
                          {excluindoId === n.id ? '...' : '🗑'}
                        </button>
                      </td>
                    </tr>
                    {edicao?.id === n.id && (
                      <tr className="bg-[#F8FAFC]">
                        <td colSpan={5} className="p-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[10px] font-black text-[#334155] uppercase mb-1">Classificar como</label>
                              <select
                                value={edicao.tipoClassificacao}
                                onChange={e => setEdicao(prev => prev ? { ...prev, tipoClassificacao: e.target.value as 'CUSTO' | 'RECEITA' } : prev)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white text-[#0A2A4A]"
                              >
                                {TIPOS_CLASSIFICACAO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-black text-[#334155] uppercase mb-1">Centro Financeiro</label>
                              <select
                                value={edicao.centroOid} onChange={e => mudarCentro(e.target.value)} disabled={carregandoCentros}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white text-[#0A2A4A] disabled:opacity-50"
                              >
                                <option value="">{carregandoCentros ? 'Carregando...' : 'Selecione...'}</option>
                                {centros.map(c => <option key={c.oid} value={c.oid}>{c.nome}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-black text-[#334155] uppercase mb-1">Sub-Centro Financeiro</label>
                              <select
                                value={edicao.subcentroOid} onChange={e => mudarSubcentro(e.target.value)}
                                disabled={!edicao.centroOid || edicao.carregandoSubcentros}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white text-[#0A2A4A] disabled:opacity-50"
                              >
                                <option value="">{edicao.carregandoSubcentros ? 'Carregando...' : '(Nenhum)'}</option>
                                {edicao.subcentros.map(s => <option key={s.oid} value={s.oid}>{s.nome}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 mt-3">
                            <button onClick={() => setEdicao(null)} className="text-[10px] font-black text-gray-500 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg uppercase">
                              Cancelar
                            </button>
                            <button onClick={salvarEdicao} disabled={salvandoEdicao || !edicao.centroOid} className="text-[10px] font-black text-white bg-[#336699] hover:bg-[#284B8C] px-4 py-2 rounded-lg uppercase disabled:opacity-50">
                              {salvandoEdicao ? 'Salvando...' : 'Salvar Classificação'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
