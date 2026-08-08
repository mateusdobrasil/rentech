"use client";

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { Analytics } from "@vercel/analytics/next";

const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  if (p.includes('GESTOR')) return 'GESTORES';
  return 'USUARIO';
};

const somenteDigitos = (v: string): string => (v || '').replace(/\D/g, '');

const formatarCnpj = (cnpjBruto: string): string => {
  const cnpj = somenteDigitos(cnpjBruto);
  if (cnpj.length !== 14) return cnpjBruto || '';
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
};

// Máscara progressiva pro campo do formulário — aplica pontuação conforme o
// usuário digita, sem esperar os 14 dígitos completos (diferente de
// formatarCnpj, usada só pra exibir CNPJ já completo na grid).
const mascararCnpjDigitando = (v: string): string => {
  const d = somenteDigitos(v).slice(0, 14);
  let out = d.slice(0, 2);
  if (d.length > 2) out += '.' + d.slice(2, 5);
  if (d.length > 5) out += '.' + d.slice(5, 8);
  if (d.length > 8) out += '/' + d.slice(8, 12);
  if (d.length > 12) out += '-' + d.slice(12, 14);
  return out;
};

interface Empresa {
  id: number;
  nome: string;
  razao_social: string | null;
  cnpj: string | null;
  ativo: boolean;
}

const empresaFormPadrao = { nome: '', razao_social: '', cnpj: '', ativo: true };

export default function EmpresasPage() {
  const router = useRouter();
  const pathname = usePathname();

  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [usuarioAtual, setUsuarioAtual] = useState('');

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [funcionariosPorEmpresa, setFuncionariosPorEmpresa] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

  const [form, setForm] = useState(empresaFormPadrao);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios').select('nome, permissao').eq('id', session.user.id).single();
      if (perfilError || !perfil) { router.push('/login'); return; }

      const { data: rotaPermissao } = await supabase
        .from('folha_paginas_permissoes').select('permissoes_permitidas').eq('endereco_route', pathname).single();

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }

      setUsuarioAtual(perfil.nome || 'Usuário');
      setAuthLoading(false);
      carregarEmpresas();
    }
    checkAuth();
  }, [router, pathname]);

  const carregarEmpresas = async () => {
    setLoading(true);
    try {
      const [empresasRes, funcionariosRes] = await Promise.all([
        supabase.from('empresas').select('*').order('nome'),
        supabase.from('folha_funcionarios').select('empresa_id'),
      ]);
      if (empresasRes.error) throw empresasRes.error;
      setEmpresas((empresasRes.data || []) as Empresa[]);

      const contagem: Record<number, number> = {};
      (funcionariosRes.data || []).forEach((f: { empresa_id: number | null }) => {
        if (f.empresa_id) contagem[f.empresa_id] = (contagem[f.empresa_id] || 0) + 1;
      });
      setFuncionariosPorEmpresa(contagem);
    } catch (error) {
      console.error(error);
      mostrarFeedback('Erro ao carregar empresas.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const mostrarFeedback = (msg: string, type: 'success' | 'error') => {
    setFeedback({ show: true, msg, type });
    setTimeout(() => setFeedback({ show: false, msg: '', type: 'success' }), 3000);
  };

  const prepararEdicao = (e: Empresa) => {
    setForm({ nome: e.nome, razao_social: e.razao_social || '', cnpj: mascararCnpjDigitando(e.cnpj || ''), ativo: e.ativo });
    setEditandoId(e.id);
  };

  const limparForm = () => {
    setForm(empresaFormPadrao);
    setEditandoId(null);
  };

  const salvarEmpresa = async () => {
    if (!form.nome.trim()) return mostrarFeedback('Informe o nome da empresa.', 'error');

    setSalvando(true);
    try {
      const payload = {
        nome: form.nome.trim().toUpperCase(),
        razao_social: form.razao_social.trim() || null,
        cnpj: somenteDigitos(form.cnpj) || null,
        ativo: form.ativo,
      };

      let error;
      if (editandoId) {
        ({ error } = await supabase.from('empresas').update(payload).eq('id', editandoId));
      } else {
        ({ error } = await supabase.from('empresas').insert([payload]));
      }
      if (error) {
        if (error.code === '23505') throw new Error('Já existe uma empresa cadastrada com este nome ou CNPJ.');
        throw error;
      }

      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: editandoId ? 'ATUALIZOU EMPRESA' : 'CADASTROU EMPRESA',
        setor: 'PARÂMETROS / EMPRESAS',
        equipamento_nome: payload.nome,
      });

      mostrarFeedback(editandoId ? 'Empresa atualizada com sucesso!' : 'Empresa cadastrada com sucesso!', 'success');
      limparForm();
      carregarEmpresas();
    } catch (error: any) {
      mostrarFeedback(error.message || 'Erro ao salvar empresa.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const removerEmpresa = async (empresa: Empresa) => {
    const emUso = funcionariosPorEmpresa[empresa.id] || 0;
    const aviso = emUso > 0
      ? ` Atenção: ${emUso} funcionário(s) está(ão) vinculado(s) a esta empresa e ficará(ão) sem empresa definida.`
      : '';
    if (!confirm(`Remover a empresa "${empresa.nome}"?${aviso}`)) return;

    try {
      const { error } = await supabase.from('empresas').delete().eq('id', empresa.id);
      if (error) throw error;

      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'REMOVEU EMPRESA',
        setor: 'PARÂMETROS / EMPRESAS',
        equipamento_nome: empresa.nome,
      });

      mostrarFeedback('Empresa removida.', 'success');
      if (editandoId === empresa.id) limparForm();
      carregarEmpresas();
    } catch (error) {
      console.error(error);
      mostrarFeedback('Erro ao remover empresa.', 'error');
    }
  };

  const empresasFiltradas = useMemo(() => {
    const termo = busca.toLowerCase();
    return empresas.filter(e =>
      e.nome.toLowerCase().includes(termo) ||
      (e.razao_social || '').toLowerCase().includes(termo) ||
      (e.cnpj || '').includes(somenteDigitos(termo))
    );
  }, [empresas, busca]);

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para aceder ao Cadastro de Empresas.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics/>

      <div className="px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">Cadastro de Empresas</h1>
          <p className="text-sm font-medium text-gray-500">Empresas do Grupo Rentech usadas para vincular funcionários e restringir acesso por CNPJ.</p>
        </div>
        <Link href="/admin/parametros" className="text-xs font-bold bg-white hover:bg-gray-100 border border-gray-300 text-gray-600 px-6 py-3 rounded-lg transition-colors uppercase tracking-wider shadow-sm">
          ⬅ Voltar ao Hub
        </Link>
      </div>

      {feedback.show && (
        <div className={`fixed top-6 right-8 px-6 py-3 rounded-lg shadow-xl z-50 font-black text-xs uppercase tracking-wider ${feedback.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {feedback.type === 'success' ? '✅ ' : '❌ '}{feedback.msg}
        </div>
      )}

      <div className="px-4 md:px-8 pb-8 flex-grow flex flex-col lg:flex-row gap-6 overflow-hidden">

        <div className="w-full lg:w-[400px] bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] h-fit space-y-4">
          <div className="border-b border-gray-100 pb-2">
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">
              {editandoId ? 'Editar Empresa' : 'Nova Empresa'}
            </h2>
            <p className="text-[11px] text-gray-400 font-bold uppercase mt-0.5">CNPJ é opcional, mas recomendado</p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Nome (identificador curto)</label>
              <input type="text" placeholder="Ex: RENTECH LOGÍSTICA" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-bold uppercase bg-gray-50 text-[#0C1D4D]" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Razão Social</label>
              <input type="text" placeholder="Ex: Rentech Logística e Transportes LTDA" value={form.razao_social} onChange={e => setForm({ ...form, razao_social: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">CNPJ</label>
              <input type="text" inputMode="numeric" placeholder="00.000.000/0000-00" maxLength={18} value={form.cnpj} onChange={e => setForm({ ...form, cnpj: mascararCnpjDigitando(e.target.value) })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
            </div>
            <label className="flex items-center gap-2 font-bold text-xs text-[#0C1D4D] cursor-pointer select-none">
              <input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} className="w-4 h-4 accent-[#336699]" />
              Empresa ativa
            </label>

            <div className="pt-2 flex gap-2">
              {editandoId && (
                <button onClick={limparForm} className="bg-gray-100 text-gray-500 font-black text-[10px] uppercase tracking-wider px-4 py-3 rounded-xl hover:bg-gray-200 transition-colors">
                  Cancelar
                </button>
              )}
              <button onClick={salvarEmpresa} disabled={salvando} className="w-full bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-[#284B8C] transition-all shadow-md disabled:opacity-50">
                {salvando ? '...' : editandoId ? '💾 Gravar Alterações' : '➕ Cadastrar Empresa'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex-grow bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col h-full">
          <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
            <input
              type="text"
              placeholder="🔍 Buscar por nome, razão social ou CNPJ..."
              value={busca} onChange={e => setBusca(e.target.value)}
              className="w-full max-w-md p-2 border border-gray-300 rounded-lg text-xs font-semibold outline-none focus:border-[#336699]"
            />
          </div>

          <div className="overflow-auto flex-grow">
            {loading ? (
              <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider text-xs">Carregando...</p>
            ) : empresasFiltradas.length === 0 ? (
              <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider text-xs">Nenhuma empresa cadastrada.</p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] sticky top-0 text-[10px] font-black uppercase text-gray-400 tracking-wider">
                  <tr>
                    <th className="p-4 w-20 text-center">Status</th>
                    <th className="p-4">Empresa / Razão Social</th>
                    <th className="p-4">CNPJ</th>
                    <th className="p-4 text-center w-32">Funcionários</th>
                    <th className="p-4 text-center w-40">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-sm font-medium">
                  {empresasFiltradas.map(e => (
                    <tr key={e.id} className={`hover:bg-gray-50 transition-colors ${!e.ativo ? 'opacity-40 bg-gray-50' : ''}`}>
                      <td className="p-4 text-center">
                        <div className={`w-3 h-3 rounded-full mx-auto ${e.ativo ? 'bg-green-500 shadow-sm' : 'bg-red-500 shadow-sm'}`}></div>
                      </td>
                      <td className="p-4">
                        <strong className="block text-[#0C1D4D] font-black uppercase tracking-tight">{e.nome}</strong>
                        <span className="text-xs text-[#64748B] font-bold">{e.razao_social || '—'}</span>
                      </td>
                      <td className="p-4 text-xs text-gray-600 font-mono">{formatarCnpj(e.cnpj || '') || '—'}</td>
                      <td className="p-4 text-center text-xs font-bold text-gray-600">{funcionariosPorEmpresa[e.id] || 0}</td>
                      <td className="p-4 text-center">
                        <div className="flex justify-center items-center gap-2">
                          <button onClick={() => prepararEdicao(e)} className="bg-blue-50 border border-blue-200 text-[#0369A1] font-bold text-[10px] uppercase px-3 py-1.5 rounded-md hover:bg-blue-100 transition-colors">
                            Editar
                          </button>
                          <button onClick={() => removerEmpresa(e)} className="bg-red-50 border border-red-200 text-red-600 font-bold text-[10px] uppercase px-3 py-1.5 rounded-md hover:bg-red-100 transition-colors">
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
