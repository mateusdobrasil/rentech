"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { registrarLogAuditoria } from '../../actions';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../components/hooks/usePageAccess';
import { HubErro } from '../../components/ui/HubStates';
import { useToast } from '../../components/ui/NotificationProvider';

interface Freelancer {
  id: string;
  nome: string;
  cpf: string;
  data_nascimento: string;
  email: string;
  telefone: string;
  endereco: string;
  pix_tipo: string;
  pix_chave: string;
  valor_diaria: number | null;
  nivel_led: string;
  nivel_videowall: string;
  nivel_tv: string;
  nivel_audio: string;
  nivel_luz: string;
  comentarios: string;
  created_at: string;
  status: string;
}

// Função para normalizar os dados antigos do CSV para os novos Selects do sistema
const normalizarNivel = (val: string | null | undefined) => {
  if (!val) return 'Não trabalho com o Item';
  
  const lower = val.toLowerCase();
  
  // Se for exatamente uma das opções atuais, retorna ela mesma
  if (
    val === 'Não trabalho com o Item' || 
    val === 'Ajudante' || 
    val === 'Instalador' || 
    val === 'Instala e Configura' || 
    val === 'Instalador, Configura e Opera' || 
    val === 'Coordenador'
  ) {
    return val;
  }

  // Conversão das strings antigas (Google Forms) para o nível mais alto encontrado
  if (lower.includes('coordena')) return 'Coordenador';
  if (lower.includes('opera')) return 'Instalador, Configura e Opera';
  if (lower.includes('configura')) return 'Instala e Configura';
  if (lower.includes('instala')) return 'Instalador';
  if (lower.includes('ajudante')) return 'Ajudante';
  
  return 'Não trabalho com o Item';
};

export default function GestaoFreelancers() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente } = usePageAccess({ nomeFallback: 'Usuário' });
  const toast = useToast();

  // Estados de Dados
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtros
  const [busca, setBusca] = useState('');
  const [filtroEspecialidade, setFiltroEspecialidade] = useState('');
  const [filtroNivel, setFiltroNivel] = useState(''); 

  // Modal e Edição
  const [modalOpen, setModalOpen] = useState<{ open: boolean; free: Freelancer | null }>({ open: false, free: null });
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Freelancer>>({});

  // 2. Carregar dados da tabela
  useEffect(() => {
    if (!authLoading && !acessoNegado) carregarDados();
  }, [authLoading, acessoNegado]);

  const carregarDados = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('freelancers')
      .select('*')
      .order('nome', { ascending: true });
    
    if (data) {
      setFreelancers(data as Freelancer[]);
    } else if (error) {
      console.error("Erro ao carregar freelancers:", error);
    }
    setLoading(false);
  };

  // Função para formatar o valor da diária
  const formatarMoeda = (valor: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
  };

  const filtrados = useMemo(() => {
    let lista = freelancers;
    const termo = busca.toLowerCase().trim();

    if (termo) {
      lista = lista.filter(f => f.nome.toLowerCase().includes(termo) || f.telefone.includes(termo));
    }

    const nivelProcurado = filtroNivel.toLowerCase();

    if (filtroEspecialidade && !filtroNivel) {
      lista = lista.filter(f => {
        const nivelStr = String((f as any)[`nivel_${filtroEspecialidade}`] || '').toLowerCase();
        return nivelStr && !nivelStr.includes('não trabalho');
      });
    } else if (!filtroEspecialidade && filtroNivel) {
      lista = lista.filter(f => 
        String(f.nivel_led || '').toLowerCase().includes(nivelProcurado) ||
        String(f.nivel_videowall || '').toLowerCase().includes(nivelProcurado) ||
        String(f.nivel_tv || '').toLowerCase().includes(nivelProcurado) ||
        String(f.nivel_audio || '').toLowerCase().includes(nivelProcurado) ||
        String(f.nivel_luz || '').toLowerCase().includes(nivelProcurado)
      );
    } else if (filtroEspecialidade && filtroNivel) {
      lista = lista.filter(f => {
        const nivelStr = String((f as any)[`nivel_${filtroEspecialidade}`] || '').toLowerCase();
        return nivelStr && nivelStr.includes(nivelProcurado);
      });
    }

    return lista;
  }, [freelancers, busca, filtroEspecialidade, filtroNivel]);

  // ==========================================
  // AÇÕES DE EDIÇÃO
  // ==========================================
  const iniciarEdicao = () => {
    if (modalOpen.free) {
      setEditForm({
        ...modalOpen.free,
        // Aplica a normalização para preencher os selects corretamente
        nivel_led: normalizarNivel(modalOpen.free.nivel_led),
        nivel_videowall: normalizarNivel(modalOpen.free.nivel_videowall),
        nivel_tv: normalizarNivel(modalOpen.free.nivel_tv),
        nivel_audio: normalizarNivel(modalOpen.free.nivel_audio),
        nivel_luz: normalizarNivel(modalOpen.free.nivel_luz),
      });
      setIsEditing(true);
    }
  };

  const cancelarEdicao = () => {
    setIsEditing(false);
    setEditForm({});
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  const salvarEdicao = async () => {
    if (!editForm.id) return;
    setIsSaving(true);
    try {
      let valorDiariaTratado = editForm.valor_diaria;
      if (typeof valorDiariaTratado === 'string') {
        valorDiariaTratado = parseFloat((valorDiariaTratado as string).replace(',', '.'));
      }

      const payloadFinal = {
        nome: editForm.nome,
        cpf: editForm.cpf,
        data_nascimento: editForm.data_nascimento,
        email: editForm.email,
        telefone: editForm.telefone,
        endereco: editForm.endereco,
        pix_tipo: editForm.pix_tipo,
        pix_chave: editForm.pix_chave,
        valor_diaria: valorDiariaTratado || null,
        nivel_led: editForm.nivel_led,
        nivel_videowall: editForm.nivel_videowall,
        nivel_tv: editForm.nivel_tv,
        nivel_audio: editForm.nivel_audio,
        nivel_luz: editForm.nivel_luz,
        comentarios: editForm.comentarios,
      };

      const { error } = await supabase
        .from('freelancers')
        .update(payloadFinal)
        .eq('id', editForm.id);

      if (error) throw error;

      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'EDITOU FREELANCER',
        setor: 'FREELANCE',
        equipamento_id: editForm.id,
        equipamento_nome: editForm.nome ?? null,
      });

      const updatedFreelancer = { ...modalOpen.free, ...payloadFinal } as Freelancer;

      setFreelancers(prev => prev.map(f => f.id === updatedFreelancer.id ? updatedFreelancer : f));
      setModalOpen({ open: true, free: updatedFreelancer });
      setIsEditing(false);
      
    } catch (error: any) {
      toast("Erro ao atualizar dados: " + error.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================================
  // BARREIRAS DE ACESSO VISUAIS
  // ============================================================================
  if (authLoading || loading) {
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Banco de Talentos.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      
      {/* NAVEGAÇÃO E TÍTULO */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          👷 <strong>Banco de Talentos</strong>. Gestão de Freelancers Cadastrados.
        </p>
        <button 
          onClick={() => router.push('/admin')} 
          className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
        >
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      {/* DASHBOARD RÁPIDO & FILTROS */}
      <div className="p-4 md:px-8 pt-6 flex-shrink-0">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-[#336699]">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Total Cadastrados</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">{freelancers.length}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-green-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Espec. em LED</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">
              {freelancers.filter(f => f.nivel_led && !f.nivel_led.toLowerCase().includes('não trabalho')).length}
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-blue-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Espec. em TV / VW</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">
              {freelancers.filter(f => (f.nivel_tv && !f.nivel_tv.toLowerCase().includes('não trabalho')) || (f.nivel_videowall && !f.nivel_videowall.toLowerCase().includes('não trabalho'))).length}
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-amber-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Espec. em SOM</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">
              {freelancers.filter(f => f.nivel_audio && !f.nivel_audio.toLowerCase().includes('não trabalho')).length}
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-purple-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Espec. em LUZ</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">
              {freelancers.filter(f => f.nivel_luz && !f.nivel_luz.toLowerCase().includes('não trabalho')).length}
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] flex flex-col lg:flex-row gap-3 items-center">
          <div className="flex-1 w-full">
            <input 
              type="text" 
              placeholder="🔍 Buscar por Nome ou Telefone..." 
              className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#0A2A4A] focus:border-[#336699] outline-none transition-all"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="w-full lg:w-56 shadow-sm">
            <select 
              className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#0C1D4D] outline-none transition-all cursor-pointer focus:border-[#336699] bg-[#F8FAFC]"
              value={filtroEspecialidade}
              onChange={(e) => setFiltroEspecialidade(e.target.value)}
            >
              <option value="">⚙️ Todos os Setores</option>
              <option value="led">Painel de LED</option>
              <option value="videowall">Video Wall</option>
              <option value="tv">Televisores</option>
              <option value="audio">Áudio / Sonorização</option>
              <option value="luz">Iluminação</option>
            </select>
          </div>
          <div className="w-full lg:w-56 shadow-sm">
            <select 
              className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#0C1D4D] outline-none transition-all cursor-pointer focus:border-[#336699] bg-[#F8FAFC]"
              value={filtroNivel}
              onChange={(e) => setFiltroNivel(e.target.value)}
            >
              <option value="">📊 Todos os Níveis</option>
              <option value="Ajudante">Ajudante / Carregador</option>
              <option value="Instalador">Instalador Estrutural</option>
              <option value="Configura">Configuração Técnica</option>
              <option value="Opera">Operador de Sistema</option>
              <option value="Coordena">Coordenador / Líder</option>
            </select>
          </div>
        </div>
      </div>

      {/* TABELA DE FREELANCERS */}
      <div className="px-4 md:px-8 pb-8 flex-grow overflow-hidden flex flex-col mt-2">
        <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead className="bg-[#F8FAFC] sticky top-0 z-10 shadow-sm">
              <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                <th className="p-4 border-b-2 border-[#E2E8F0]">Nome e Contato</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Níveis de Skill Cadastrados</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">PIX (Tipo/Chave)</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Data de Cadastro</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Diária (Base)</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {filtrados.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Nenhum freelancer encontrado para os filtros selecionados.</td></tr>
              ) : (
                filtrados.map((free) => (
                  <tr key={free.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="p-4">
                      <strong className="block text-sm text-[#0C1D4D] font-black">{free.nome}</strong>
                      <span className="text-[#64748B] font-semibold">📱 {free.telefone}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2 flex-wrap max-w-[350px]">
                        {free.nivel_led && !free.nivel_led.toLowerCase().includes('não trabalho') && <span className="bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" title={free.nivel_led}>LED: {free.nivel_led.split(',')[0]}</span>}
                        {free.nivel_tv && !free.nivel_tv.toLowerCase().includes('não trabalho') && <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" title={free.nivel_tv}>TV: {free.nivel_tv.split(',')[0]}</span>}
                        {free.nivel_videowall && !free.nivel_videowall.toLowerCase().includes('não trabalho') && <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" title={free.nivel_videowall}>VW: {free.nivel_videowall.split(',')[0]}</span>}
                        {free.nivel_audio && !free.nivel_audio.toLowerCase().includes('não trabalho') && <span className="bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" title={free.nivel_audio}>Som: {free.nivel_audio.split(',')[0]}</span>}
                        {free.nivel_luz && !free.nivel_luz.toLowerCase().includes('não trabalho') && <span className="bg-purple-50 text-purple-600 border border-purple-200 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" title={free.nivel_luz}>Luz: {free.nivel_luz.split(',')[0]}</span>}
                      </div>
                    </td>
                    <td className="p-4">
                      <strong className="block text-[#0C1D4D] font-bold">{free.pix_chave}</strong>
                      <span className="text-[10px] text-[#94A3B8] font-black uppercase tracking-widest">{free.pix_tipo}</span>
                    </td>
                    <td className="p-4 font-semibold text-[#64748B]">
                      {new Date(free.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-4 font-black text-[#16A34A] whitespace-nowrap">
                      {free.valor_diaria ? formatarMoeda(free.valor_diaria) : <span className="text-[#94A3B8] text-xs font-normal">N/I</span>}
                    </td>
                    <td className="p-4 text-center">
                      <button 
                        onClick={() => { setModalOpen({ open: true, free }); setIsEditing(false); }}
                        className="bg-white border border-[#CBD5E1] text-[#336699] font-bold text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors shadow-sm"
                      >
                        Ver Perfil
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL DO PERFIL COMPLETO / EDIÇÃO */}
      {modalOpen.open && modalOpen.free && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[95vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white flex-shrink-0">
              <h3 className="font-black uppercase tracking-wider text-sm">
                {isEditing ? '✏️ Editar Ficha Técnica' : 'Ficha Técnica do Freelancer'}
              </h3>
              <div className="flex items-center gap-3">
                {!isEditing && (
                  <button onClick={iniciarEdicao} className="text-[10px] font-bold uppercase bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-colors">
                    Editar Dados
                  </button>
                )}
                <button onClick={() => { setModalOpen({ open: false, free: null }); setIsEditing(false); }} className="text-white hover:text-red-400 text-2xl leading-none">&times;</button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 flex-grow">
              
              {!isEditing ? (
                // ==========================================
                // MODO VISUALIZAÇÃO (VIEW)
                // ==========================================
                <>
                  <div className="flex flex-col md:flex-row justify-between items-start border-b border-[#E2E8F0] pb-4 gap-4">
                    <div>
                      <h2 className="text-2xl font-black text-[#0C1D4D]">{modalOpen.free.nome}</h2>
                      <p className="text-sm font-semibold text-[#64748B]">📱 WhatsApp: <a href={`https://wa.me/${modalOpen.free.telefone.replace(/\D/g,'')}`} target="_blank" className="text-[#336699] hover:underline">{modalOpen.free.telefone}</a></p>
                      
                      <div className="bg-[#E0F2FE] border border-[#BAE6FD] p-2 rounded-lg mt-3 inline-block">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#0369A1]">Pretensão de Diária (Base)</span>
                        <strong className="text-sm text-[#0C1D4D]">{modalOpen.free.valor_diaria ? formatarMoeda(modalOpen.free.valor_diaria) : 'Não informado'}</strong>
                      </div>
                    </div>
                    <div className="text-right bg-[#F8FAFC] border border-[#E2E8F0] p-3 rounded-xl min-w-[150px]">
                      <span className="block text-[9px] font-black uppercase tracking-widest text-[#64748B]">CHAVE PIX ({modalOpen.free.pix_tipo})</span>
                      <strong className="text-base text-[#16A34A] block truncate" title={modalOpen.free.pix_chave}>{modalOpen.free.pix_chave}</strong>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black uppercase text-[#64748B] tracking-widest mb-3">Dados Pessoais e Endereço</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">CPF</span>
                        <strong className="text-xs text-[#0C1D4D]">{modalOpen.free.cpf || '---'}</strong>
                      </div>
                      <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Data de Nascimento</span>
                        <strong className="text-xs text-[#0C1D4D]">{modalOpen.free.data_nascimento ? new Date(modalOpen.free.data_nascimento).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '---'}</strong>
                      </div>
                      <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg lg:col-span-1">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">E-mail</span>
                        <strong className="text-xs text-[#0C1D4D] truncate block" title={modalOpen.free.email}>{modalOpen.free.email || '---'}</strong>
                      </div>
                      <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg md:col-span-2 lg:col-span-3">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Endereço Completo</span>
                        <strong className="text-xs text-[#0C1D4D]">{modalOpen.free.endereco || '---'}</strong>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black uppercase text-[#64748B] tracking-widest mb-3">Avaliação Técnica do Profissional</h4>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                      <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Painel de LED</span>
                        <strong className={`text-xs ${modalOpen.free.nivel_led?.toLowerCase().includes('não trabalho') ? 'text-[#94A3B8]' : 'text-[#0C1D4D]'}`}>{modalOpen.free.nivel_led}</strong>
                      </div>
                      <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Video Wall</span>
                        <strong className={`text-xs ${modalOpen.free.nivel_videowall?.toLowerCase().includes('não trabalho') ? 'text-[#94A3B8]' : 'text-[#0C1D4D]'}`}>{modalOpen.free.nivel_videowall}</strong>
                      </div>
                      <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Televisores</span>
                        <strong className={`text-xs ${modalOpen.free.nivel_tv?.toLowerCase().includes('não trabalho') ? 'text-[#94A3B8]' : 'text-[#0C1D4D]'}`}>{modalOpen.free.nivel_tv}</strong>
                      </div>
                      <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Áudio</span>
                        <strong className={`text-xs ${modalOpen.free.nivel_audio?.toLowerCase().includes('não trabalho') ? 'text-[#94A3B8]' : 'text-[#0C1D4D]'}`}>{modalOpen.free.nivel_audio}</strong>
                      </div>
                      <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Iluminação</span>
                        <strong className={`text-xs ${modalOpen.free.nivel_luz?.toLowerCase().includes('não trabalho') ? 'text-[#94A3B8]' : 'text-[#0C1D4D]'}`}>{modalOpen.free.nivel_luz}</strong>
                      </div>
                    </div>
                  </div>

                  {modalOpen.free.comentarios && (
                    <div>
                      <h4 className="text-[10px] font-black uppercase text-[#64748B] tracking-widest mb-2">Comentários e Experiência</h4>
                      <p className="bg-[#F0F4F8] p-4 rounded-xl text-sm text-[#0A2A4A] font-medium leading-relaxed whitespace-pre-line">
                        {modalOpen.free.comentarios}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                // ==========================================
                // MODO EDIÇÃO (EDIT)
                // ==========================================
                <div className="space-y-6">
                  {/* Dados Básicos */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Nome Completo</label>
                      <input type="text" name="nome" value={editForm.nome || ''} onChange={handleEditChange} className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">CPF</label>
                      <input type="text" name="cpf" value={editForm.cpf || ''} onChange={handleEditChange} className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Data de Nascimento (AAAA-MM-DD)</label>
                      <input type="date" name="data_nascimento" value={editForm.data_nascimento || ''} onChange={handleEditChange} className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">WhatsApp</label>
                      <input type="text" name="telefone" value={editForm.telefone || ''} onChange={handleEditChange} className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">E-mail</label>
                      <input type="email" name="email" value={editForm.email || ''} onChange={handleEditChange} className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Endereço Completo</label>
                      <input type="text" name="endereco" value={editForm.endereco || ''} onChange={handleEditChange} className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none" />
                    </div>
                  </div>

                  {/* PIX e Diária */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-[#E2E8F0] pt-4">
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Tipo de PIX</label>
                      <select name="pix_tipo" value={editForm.pix_tipo || ''} onChange={handleEditChange} className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none">
                        <option value="CPF">CPF</option>
                        <option value="Celular">Celular</option>
                        <option value="E-mail">E-mail</option>
                        <option value="Chave Aleatória">Chave Aleatória</option>
                        <option value="CNPJ">CNPJ</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Chave PIX</label>
                      <input type="text" name="pix_chave" value={editForm.pix_chave || ''} onChange={handleEditChange} className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none" />
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-[10px] font-bold text-[#0369A1] uppercase tracking-wider mb-1">Valor da Diária (Apenas números)</label>
                      <input type="number" step="0.01" name="valor_diaria" value={editForm.valor_diaria || ''} onChange={handleEditChange} className="w-full p-2.5 bg-blue-50 border border-[#BAE6FD] rounded-lg text-sm font-bold text-[#0C1D4D] focus:border-[#336699] outline-none" />
                    </div>
                  </div>

                  {/* Nível Técnico */}
                  <div className="border-t border-[#E2E8F0] pt-4">
                    <h4 className="text-[10px] font-black uppercase text-[#64748B] tracking-widest mb-3">Nível Técnico</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {[
                        { name: 'nivel_led', label: 'Painel de LED' },
                        { name: 'nivel_videowall', label: 'Video Wall' },
                        { name: 'nivel_tv', label: 'Televisores' }, 
                        { name: 'nivel_audio', label: 'Sonorização' },
                        { name: 'nivel_luz', label: 'Iluminação' },
                      ].map((item) => (
                        <div key={item.name}>
                          <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">{item.label}</label>
                          <select name={item.name} value={(editForm as any)[item.name] || 'Não trabalho com o Item'} onChange={handleEditChange} className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs font-semibold focus:border-[#336699] outline-none">
                            <option value="Não trabalho com o Item">Não trabalho com o Item</option>
                            <option value="Ajudante">Ajudante / Carregador</option>
                            <option value="Instalador">Instalador Estrutural</option>
                            <option value="Instala e Configura">Instala e Configura</option>
                            <option value="Instalador, Configura e Opera">Instala, Configura e Opera</option>
                            <option value="Coordenador">Coordenador de Equipe</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Comentários */}
                  <div className="border-t border-[#E2E8F0] pt-4">
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Comentários e Experiência</label>
                    <textarea name="comentarios" rows={3} value={editForm.comentarios || ''} onChange={handleEditChange} className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none resize-none"></textarea>
                  </div>
                </div>
              )}

            </div>
            
            {/* FOOTER DO MODAL (Botões de Ação na Edição) */}
            {isEditing && (
              <div className="bg-[#F8FAFC] p-5 border-t border-[#E2E8F0] flex justify-end gap-3 flex-shrink-0">
                <button onClick={cancelarEdicao} disabled={isSaving} className="px-5 py-2.5 rounded-lg text-xs font-bold text-[#64748B] bg-white border border-[#CBD5E1] hover:bg-[#E2E8F0] transition-colors disabled:opacity-50 uppercase tracking-wider">
                  Cancelar
                </button>
                <button onClick={salvarEdicao} disabled={isSaving} className="px-6 py-2.5 rounded-lg text-xs font-bold text-white bg-[#16A34A] hover:bg-[#15803D] transition-colors shadow-sm disabled:opacity-50 uppercase tracking-wider">
                  {isSaving ? 'A Salvar...' : 'Gravar Alterações'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}