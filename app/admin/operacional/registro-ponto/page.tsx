"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";

// ============================================================================
// MOTOR DE NORMALIZAÇÃO DE PERMISSÕES
// ============================================================================
const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  return 'USUARIO';
};

// Data (YYYY-MM-DD) de hoje no fuso de São Paulo — mesma convenção usada no
// motor de ponto via WhatsApp (app/lib/pontoWhatsapp.ts), pra não desalinhar
// com o dia que o funcionário está batendo o ponto.
function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

interface Funcionario {
  nome_completo: string;
  cargo: string | null;
  ponto_whatsapp_ativo: boolean;
}

interface RegistroDiario {
  funcionario_nome: string;
  entrada_1: string | null;
  saida_1: string | null;
  entrada_2: string | null;
  saida_2: string | null;
  origem: string;
}

interface AbonoDia {
  funcionario_nome: string;
  dia_todo: boolean;
  hora_inicio: string | null;
  hora_fim: string | null;
  motivo: string | null;
}

type StatusPonto = 'SEM_REGISTRO' | 'INCOMPLETO' | 'COMPLETO' | 'ABONADO';

const ROTULO_ORIGEM: Record<string, string> = {
  WHATSAPP: '📲 WhatsApp',
  CSV_PONTOMAIS: '📄 Pontomais',
  MANUAL: '✍️ Lançado pelo RH',
};

const ROTULO_STATUS: Record<StatusPonto, string> = {
  SEM_REGISTRO: 'Sem registro',
  INCOMPLETO: 'Incompleto',
  COMPLETO: 'Completo',
  ABONADO: 'Abonado',
};

const COR_STATUS: Record<StatusPonto, string> = {
  SEM_REGISTRO: 'bg-red-100 text-red-700 border-red-300',
  INCOMPLETO: 'bg-amber-100 text-amber-700 border-amber-300',
  COMPLETO: 'bg-green-100 text-green-700 border-green-300',
  ABONADO: 'bg-slate-100 text-slate-600 border-slate-300',
};

export default function RegistroDePontoOperacional() {
  const router = useRouter();
  const pathname = usePathname();

  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios').select('*').eq('id', session.user.id).single();
      if (perfilError || !perfil) { router.push('/login'); return; }

      const { data: rotaPermissao } = await supabase
        .from('folha_paginas_permissoes')
        .select('permissoes_permitidas')
        .eq('endereco_route', pathname)
        .single();

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }
      setAuthLoading(false);
    }
    checkAuth();
  }, [router, pathname]);

  const [dataSelecionada, setDataSelecionada] = useState(hojeSaoPaulo);
  const [busca, setBusca] = useState('');
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [registrosDoDia, setRegistrosDoDia] = useState<RegistroDiario[]>([]);
  const [abonosDoDia, setAbonosDoDia] = useState<AbonoDia[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    supabase.from('folha_funcionarios')
      .select('nome_completo, cargo, ponto_whatsapp_ativo')
      .eq('ativo', true)
      .order('nome_completo')
      .then(({ data }) => setFuncionarios(data || []));
  }, [authLoading, acessoNegado]);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    setLoading(true);
    Promise.all([
      supabase.from('folha_ponto_diaria')
        .select('funcionario_nome, entrada_1, saida_1, entrada_2, saida_2, origem')
        .eq('data_registro', dataSelecionada),
      supabase.from('folha_ponto_abono')
        .select('funcionario_nome, dia_todo, hora_inicio, hora_fim, motivo')
        .eq('data_abono', dataSelecionada),
    ]).then(([{ data: registros }, { data: abonos }]) => {
      setRegistrosDoDia(registros || []);
      setAbonosDoDia(abonos || []);
      setLoading(false);
    });
  }, [dataSelecionada, authLoading, acessoNegado]);

  const linhas = useMemo(() => {
    return funcionarios
      .filter(f => f.nome_completo.toLowerCase().includes(busca.trim().toLowerCase()))
      .map(f => {
        const registro = registrosDoDia.find(r => r.funcionario_nome === f.nome_completo) || null;
        const abono = abonosDoDia.find(a => a.funcionario_nome === f.nome_completo) || null;

        const e1 = registro?.entrada_1 || null;
        const s1 = registro?.saida_1 || null;
        const e2 = registro?.entrada_2 || null;
        const s2 = registro?.saida_2 || null;
        const temAlgumaBatida = !!(e1 || s1 || e2 || s2);
        // Mesma checagem de batida assimétrica usada no espelho de ponto do RH
        // (app/admin/rh/ponto/page.tsx) — entrada sem saída correspondente etc.
        const batidaAssimetrica = (!!e1 && !s1) || (!e2 && !!s2) || (!!e2 && !s2);

        let status: StatusPonto;
        if (!temAlgumaBatida && abono?.dia_todo) status = 'ABONADO';
        else if (!temAlgumaBatida) status = 'SEM_REGISTRO';
        else if (batidaAssimetrica) status = 'INCOMPLETO';
        else status = 'COMPLETO';

        return { funcionario: f, e1, s1, e2, s2, origem: registro?.origem || null, abono, status };
      });
  }, [funcionarios, registrosDoDia, abonosDoDia, busca]);

  const resumo = useMemo(() => {
    const c = { SEM_REGISTRO: 0, INCOMPLETO: 0, COMPLETO: 0, ABONADO: 0 } as Record<StatusPonto, number>;
    linhas.forEach(l => { c[l.status]++; });
    return c;
  }, [linhas]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

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

  const ehHoje = dataSelecionada === hojeSaoPaulo();

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] pt-4">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col sm:flex-row gap-3 justify-between sm:items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          🕒 <strong>Registro de Ponto</strong>. Consulta somente leitura — para corrigir uma batida, fale com o RH.
        </p>
        <button onClick={() => router.push('/admin/operacional')} className="self-start sm:self-auto text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-wrap items-center gap-3">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Dia</label>
            <input type="date" value={dataSelecionada} onChange={(e) => setDataSelecionada(e.target.value)} className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold outline-none focus:border-[#336699] bg-[#F8FAFC] flex-grow sm:flex-grow-0" />
            {!ehHoje && (
              <button onClick={() => setDataSelecionada(hojeSaoPaulo())} className="text-[10px] font-black text-[#336699] hover:underline uppercase">Voltar para hoje</button>
            )}
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex items-center gap-3 flex-grow">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider shrink-0">Buscar</label>
            <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do colaborador..." className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-medium outline-none focus:border-[#336699] bg-[#F8FAFC] flex-grow min-w-0" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {(Object.keys(ROTULO_STATUS) as StatusPonto[]).map(s => (
            <span key={s} className={`text-xs font-black px-3 py-1.5 rounded-full uppercase border ${COR_STATUS[s]}`}>
              {ROTULO_STATUS[s]}: {resumo[s]}
            </span>
          ))}
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-8 text-center text-gray-400 font-bold">Carregando...</div>
        ) : linhas.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-8 text-center text-gray-400 font-bold">Nenhum colaborador encontrado.</div>
        ) : (
          <>
            {/* Mobile: cartões empilhados — a tabela de 7 colunas não cabe numa
                tela de celular sem cortar/espremer texto. */}
            <div className="md:hidden space-y-3">
              {linhas.map(l => (
                <div key={l.funcionario.nome_completo} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="font-bold text-[#0C1D4D] leading-tight">{l.funcionario.nome_completo}</div>
                      <div className="text-[11px] text-gray-400 font-medium">{l.funcionario.cargo || 'Sem função'}</div>
                    </div>
                    <span className={`shrink-0 text-[10px] font-black px-2.5 py-1 rounded-full uppercase border ${COR_STATUS[l.status]}`} title={l.abono?.motivo || undefined}>
                      {ROTULO_STATUS[l.status]}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center mb-3">
                    {[
                      { rotulo: 'Entrada 1', valor: l.e1 },
                      { rotulo: 'Saída 1', valor: l.s1 },
                      { rotulo: 'Entrada 2', valor: l.e2 },
                      { rotulo: 'Saída 2', valor: l.s2 },
                    ].map(b => (
                      <div key={b.rotulo} className="bg-[#F8FAFC] rounded-lg py-2 px-2 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-wide">{b.rotulo}</span>
                        <span className="text-xs font-bold text-[#0C1D4D]">{b.valor || '--:--'}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[10px] font-bold text-gray-500">{l.origem ? (ROTULO_ORIGEM[l.origem] || l.origem) : '—'}</span>
                    {l.funcionario.ponto_whatsapp_ativo && <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-full font-black uppercase">WhatsApp habilitado</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: tabela completa */}
            <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-center border-collapse">
                  <thead>
                    <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0] text-xs uppercase font-black tracking-wider text-[#0C1D4D]">
                      <th className="p-3 text-left">Colaborador</th>
                      <th className="p-3">Entrada 1</th>
                      <th className="p-3">Saída 1</th>
                      <th className="p-3">Entrada 2</th>
                      <th className="p-3">Saída 2</th>
                      <th className="p-3">Origem</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {linhas.map(l => (
                      <tr key={l.funcionario.nome_completo} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="p-3 text-left">
                          <div className="font-bold text-[#0C1D4D]">{l.funcionario.nome_completo}</div>
                          <div className="text-[10px] text-gray-400 font-medium flex items-center gap-1.5">
                            {l.funcionario.cargo || 'Sem função'}
                            {l.funcionario.ponto_whatsapp_ativo && <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-full font-black uppercase">WhatsApp habilitado</span>}
                          </div>
                        </td>
                        <td className="p-3 font-medium">{l.e1 || '--:--'}</td>
                        <td className="p-3 font-medium">{l.s1 || '--:--'}</td>
                        <td className="p-3 font-medium">{l.e2 || '--:--'}</td>
                        <td className="p-3 font-medium">{l.s2 || '--:--'}</td>
                        <td className="p-3 text-[11px] font-bold text-gray-500">{l.origem ? (ROTULO_ORIGEM[l.origem] || l.origem) : '—'}</td>
                        <td className="p-3">
                          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase border ${COR_STATUS[l.status]}`} title={l.abono?.motivo || undefined}>
                            {ROTULO_STATUS[l.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
