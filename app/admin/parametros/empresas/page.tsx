"use client";

// app/admin/parametros/empresas/page.tsx
// Cadastro de Empresas (2026-11-24): lista → ficha em abas (FichaEmpresa).
// Tudo grava pelo servidor (./actions.ts). No topo, para o Administrador, a
// ficha "Sistema (todas as empresas)" com o cofre dos serviços comuns
// (WhatsApp, e-mail, P2S, Autentique, Claude).
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Analytics } from '@vercel/analytics/next';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useConfirm, useToast } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { dadosEmpresasAction, excluirEmpresaAction, type DadosTelaEmpresas, type EmpresaCadastro } from './actions';
import FichaEmpresa from './FichaEmpresa';

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const fmtCnpj = (v: unknown) => { const d = so(v); return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : '—'; };
const REGIME: Record<string, string> = { MEI: 'MEI', SIMPLES: 'Simples', PRESUMIDO: 'Presumido', REAL: 'Real' };

type Aberta = { tipo: 'empresa'; id: number } | { tipo: 'nova' } | { tipo: 'sistema' } | null;

export default function EmpresasPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ nomeFallback: 'Usuário' });
  const [dados, setDados] = useState<DadosTelaEmpresas | null>(null);
  const [erroCarga, setErroCarga] = useState('');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<Aberta>(null);

  const carregar = useCallback(async () => {
    if (!accessToken) return;
    const r = await dadosEmpresasAction(accessToken);
    if (!r.ok || !r.info) { setErroCarga(r.erro || 'Erro ao carregar as empresas.'); return; }
    setErroCarga(''); setDados(r.info);
  }, [accessToken]);

  useEffect(() => {
    if (authLoading || acessoNegado || !accessToken) return;
    let vivo = true;
    dadosEmpresasAction(accessToken).then(r => {
      if (!vivo) return;
      if (!r.ok || !r.info) { setErroCarga(r.erro || 'Erro ao carregar as empresas.'); return; }
      setDados(r.info);
    });
    return () => { vivo = false; };
  }, [authLoading, acessoNegado, accessToken]);

  const filtradas = useMemo(() => {
    const t = busca.toLowerCase().trim();
    return (dados?.empresas || []).filter(e => !t
      || String(e.nome).toLowerCase().includes(t)
      || String(e.razao_social || '').toLowerCase().includes(t)
      || (so(t) && so(e.cnpj).includes(so(t))));
  }, [dados, busca]);

  const excluir = async (e: EmpresaCadastro) => {
    const emUso = dados?.funcionarios[e.id] || 0;
    const aviso = emUso ? ` ${emUso} funcionário(s) ficarão sem empresa.` : '';
    if (!(await confirmar({ title: 'Excluir empresa', message: `Excluir "${e.nome}"?${aviso} Se ela já tiver movimento, prefira desativar.`, danger: true, confirmLabel: 'Excluir' }))) return;
    const r = await excluirEmpresaAction(e.id, accessToken);
    if (!r.ok) { toast(r.erro || 'Erro ao excluir.', 'error'); return; }
    toast('Empresa excluída.', 'success');
    carregar();
  };

  if (authLoading) {
    return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  }
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Cadastro de Empresas.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C]">Voltar ao Menu Principal</button>
        </div>
      </div>
    );
  }

  const empresaAberta = aberta?.tipo === 'empresa' ? dados?.empresas.find(e => e.id === aberta.id) || null : null;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />
      <div className="px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">Cadastro de Empresas</h1>
          <p className="text-sm font-medium text-gray-500">Dados de cada CNPJ do grupo{dados?.podeCredenciais ? ' e as credenciais dos serviços' : ''}.</p>
        </div>
        <Link href="/admin/parametros" className="text-xs font-bold bg-white hover:bg-gray-100 border border-gray-300 text-gray-600 px-6 py-3 rounded-lg uppercase tracking-wider shadow-sm">⬅ Voltar ao Hub</Link>
      </div>

      <div className="px-4 md:px-8 pb-8">
        {erroCarga && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-xs font-bold px-4 py-3 rounded-lg">{erroCarga}</div>}

        {aberta && dados ? (
          <FichaEmpresa
            key={aberta.tipo === 'empresa' ? aberta.id : aberta.tipo}
            empresa={empresaAberta}
            sistema={aberta.tipo === 'sistema'}
            accessToken={accessToken}
            podeCredenciais={dados.podeCredenciais}
            sqlCadastro={dados.sqlCadastro}
            onFechar={() => setAberta(null)}
            onSalvou={async id => { await carregar(); setAberta({ tipo: 'empresa', id }); }}
          />
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap gap-3 justify-between">
              <input type="text" placeholder="🔍 Buscar por nome, razão social ou CNPJ..." value={busca} onChange={e => setBusca(e.target.value)}
                className="w-full max-w-md p-2 border border-gray-300 rounded-lg text-xs font-semibold outline-none focus:border-[#336699]" />
              <button onClick={() => setAberta({ tipo: 'nova' })} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-[10px] px-5 py-2.5 rounded-lg hover:bg-[#284B8C]">+ Nova empresa</button>
            </div>

            {!dados ? (
              <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider text-xs">Carregando...</p>
            ) : (
              <div className="divide-y divide-[#E2E8F0]">
                {dados.podeCredenciais && (
                  <button onClick={() => setAberta({ tipo: 'sistema' })} className="w-full flex flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-[#F8FAFC]">
                    <div>
                      <p className="text-sm font-black text-[#0C1D4D] uppercase">⚙️ Sistema (todas as empresas)</p>
                      <p className="text-[11px] text-[#64748B]">Credenciais comuns: WhatsApp, e-mail, PrimeStart, Autentique e Claude.</p>
                    </div>
                    <span className="text-[10px] font-black uppercase text-[#336699]">🔐 Credenciais ›</span>
                  </button>
                )}
                {filtradas.length === 0 && <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider text-xs">Nenhuma empresa encontrada.</p>}
                {filtradas.map(e => (
                  <div key={e.id} className={`flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-[#F8FAFC] ${e.ativo === false ? 'opacity-50' : ''}`}>
                    <button onClick={() => setAberta({ tipo: 'empresa', id: e.id })} className="flex-1 min-w-0 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${corSeloEmpresa(e.id)}`}>{String(e.nome_curto || e.nome)}</span>
                        <strong className="text-[#0C1D4D] font-black uppercase tracking-tight text-sm">{e.nome}</strong>
                        {e.ativo === false && <span className="text-[9px] font-black uppercase text-red-600">Inativa</span>}
                        {e.fonte_recebimentos === 'EXTERNA' && <span className="text-[9px] font-black uppercase text-amber-700">Recebimentos: outra fonte</span>}
                      </div>
                      <p className="text-xs text-[#64748B] font-bold mt-1 truncate">
                        {String(e.razao_social || '—')} · <span className="font-mono">{fmtCnpj(e.cnpj)}</span>
                        {e.regime_tributario ? ` · ${REGIME[String(e.regime_tributario)] || ''}` : ''}
                        {e.cidade ? ` · ${String(e.cidade)}/${String(e.uf || '')}` : ''}
                      </p>
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-gray-500 whitespace-nowrap">{dados.funcionarios[e.id] || 0} funcionário(s)</span>
                      <button onClick={() => setAberta({ tipo: 'empresa', id: e.id })} className="bg-blue-50 border border-blue-200 text-[#0369A1] font-bold text-[10px] uppercase px-3 py-1.5 rounded-md hover:bg-blue-100">Abrir</button>
                      <button onClick={() => excluir(e)} className="bg-red-50 border border-red-200 text-red-600 font-bold text-[10px] uppercase px-3 py-1.5 rounded-md hover:bg-red-100">Excluir</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
