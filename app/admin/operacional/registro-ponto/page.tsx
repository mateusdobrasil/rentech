"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import RegistroPontoConsulta from './RegistroPontoConsulta';
import SolicitacoesFolga from './SolicitacoesFolga';
import { listarSolicitacoesFolgaAction } from '../../rh/actions/actions-ponto-whatsapp';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { supabase } from '../../../lib/supabase';
import { ehAdministradorGlobal } from '../../../lib/permissoes';

export default function RegistroDePontoOperacional() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken, permissaoBruta } = usePageAccess({ nomeFallback: 'Gestor' });
  const [aba, setAba] = useState<'consulta' | 'folga'>('consulta');
  const [folgasPendentes, setFolgasPendentes] = useState(0);

  // Empresa(s) que o usuário pode enxergar (Rentech × AlfaLight) — mesmo
  // padrão usado em /admin/operacional/relatorios. A proteção de verdade é
  // a RLS/server action; isto só afeta o que fica visível nesta tela.
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);
  const [filtroEmpresaId, setFiltroEmpresaId] = useState<number | null>(null);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    async function carregarEmpresas() {
      const { data: empresasData } = await supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome');
      setEmpresasCatalogo(empresasData || []);

      if (ehAdministradorGlobal(permissaoBruta)) {
        setEmpresasPermitidas(null);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: vinculos } = await supabase
        .from('perfis_usuarios_empresas').select('empresa_id').eq('perfil_id', session.user.id);
      setEmpresasPermitidas((vinculos || []).map(v => v.empresa_id));
    }
    carregarEmpresas();
  }, [authLoading, acessoNegado, permissaoBruta]);

  const empresasCatalogoVisivel = empresasPermitidas === null
    ? empresasCatalogo
    : empresasCatalogo.filter(e => empresasPermitidas.includes(e.id));

  useEffect(() => {
    if (empresasCatalogoVisivel.length === 1) setFiltroEmpresaId(empresasCatalogoVisivel[0].id);
  }, [empresasCatalogoVisivel]);

  // Só pra alimentar o badge de pendentes no botão da aba antes de abri-la —
  // a própria aba (SolicitacoesFolga) faz sua própria leitura ao montar.
  useEffect(() => {
    if (authLoading || acessoNegado) return;
    listarSolicitacoesFolgaAction(accessToken).then(res => {
      if (res.ok) setFolgasPendentes((res.info || []).filter(s => s.status === 'PENDENTE').length);
    });
  }, [authLoading, acessoNegado]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Registro de Ponto.</p>
          <button onClick={() => router.push('/admin/operacional')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Setor Operacional
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] pt-4">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col sm:flex-row gap-3 justify-between sm:items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          🕒 <strong>Registro de Ponto</strong>. Consulta de batidas somente leitura (para corrigir, fale com o RH) e aprovação de solicitações de folga.
        </p>
        <button onClick={() => router.push('/admin/operacional')} className="self-start sm:self-auto text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR
        </button>
      </div>

      <div className="px-4 md:px-8 pt-6 flex-shrink-0 flex flex-wrap items-center justify-between gap-3">
        <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm gap-1">
          <button onClick={() => setAba('consulta')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${aba === 'consulta' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
            🕒 Consulta
          </button>
          <button onClick={() => setAba('folga')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 ${aba === 'folga' ? 'bg-cyan-600 text-white shadow-sm' : 'text-[#64748B] hover:text-cyan-700'}`}>
            🏖️ Solicitação Folga
            {folgasPendentes > 0 && <span className="bg-white/25 px-1.5 py-0.5 rounded-full text-[9px]">{folgasPendentes}</span>}
          </button>
        </div>

        <select
          value={filtroEmpresaId ?? ''}
          onChange={(e) => setFiltroEmpresaId(e.target.value ? Number(e.target.value) : null)}
          disabled={empresasCatalogoVisivel.length <= 1}
          className="p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer bg-white disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {empresasCatalogoVisivel.length !== 1 && <option value="">🏭 TODAS AS EMPRESAS</option>}
          {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
        {aba === 'consulta' && <RegistroPontoConsulta mostrarPainelDesabilitados={false} filtroEmpresaId={filtroEmpresaId} />}
        {aba === 'folga' && <SolicitacoesFolga usuarioAtual={usuarioAtual} accessToken={accessToken} onCountChange={setFolgasPendentes} mostrarCalendario filtroEmpresaId={filtroEmpresaId} />}
      </div>
    </div>
  );
}
