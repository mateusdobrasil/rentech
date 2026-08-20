"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { registrarLogAuditoria } from '../../actions';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../components/hooks/usePageAccess';
import { HubErro } from '../../components/ui/HubStates';
import { useToast } from '../../components/ui/NotificationProvider';
import { ehAdministradorGlobal } from '../../lib/permissoes';

interface Freelancer {
  id: string;
  empresa_id: number | null;
  nome: string;
  cpf: string;
  data_nascimento: string;
  email: string;
  telefone: string;
  endereco: string;
  pix_tipo: string;
  pix_chave: string;
  valor_diaria: number | null;
  comentarios: string;
  created_at: string;
  status: string;
}

// Setor de atuação ou nível de experiência — mesma forma nas duas tabelas
// (freelancers_setores / freelancers_niveis), cada uma escopada por empresa.
interface ItemCatalogo {
  id: string;
  empresa_id: number;
  nome: string;
  ordem: number;
  ativo: boolean;
}

interface SetorNivelFreelancer {
  freelancer_id: string;
  setor_id: string;
  nivel_id: string;
}

const CORES_KPI = ['border-green-500', 'border-blue-500', 'border-amber-500', 'border-purple-500', 'border-pink-500', 'border-cyan-500'];
// Tailwind não reconhece classe montada em runtime (`lg:grid-cols-${n}`) —
// precisa ser um literal presente no código-fonte pra entrar no CSS gerado.
const COLUNAS_KPI: Record<number, string> = {
  1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6',
};

// Painel genérico de gerenciamento de um catálogo (setores OU níveis) — usado
// duas vezes na aba Parâmetros. Fica fora do componente principal por ser
// puramente apresentacional (só recebe dados + callbacks).
function PainelCatalogo({
  titulo, itens, novoNome, setNovoNome, onAdicionar, onRenomear, onAlternarAtivo, onMover,
}: {
  titulo: string;
  itens: ItemCatalogo[];
  novoNome: string;
  setNovoNome: (v: string) => void;
  onAdicionar: () => void;
  onRenomear: (item: ItemCatalogo, novoNome: string) => void;
  onAlternarAtivo: (item: ItemCatalogo) => void;
  onMover: (item: ItemCatalogo, direcao: -1 | 1) => void;
}) {
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState('');
  const ordenados = [...itens].sort((a, b) => a.ordem - b.ordem);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5">
      <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-4">{titulo}</h3>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={novoNome}
          onChange={(e) => setNovoNome(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') onAdicionar(); }}
          placeholder={`Novo item...`}
          className="flex-1 p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold uppercase focus:border-[#336699] outline-none"
        />
        <button onClick={onAdicionar} className="bg-[#336699] hover:bg-[#284B8C] text-white font-bold text-xs uppercase px-4 py-2 rounded-lg transition-colors shrink-0">
          Adicionar
        </button>
      </div>
      <div className="space-y-2">
        {ordenados.length === 0 ? (
          <p className="text-xs text-[#94A3B8] font-semibold text-center py-6">Nenhum cadastrado ainda.</p>
        ) : (
          ordenados.map((item, i) => (
            <div key={item.id} className={`flex items-center gap-2 p-2.5 rounded-lg border border-[#E2E8F0] ${item.ativo ? 'bg-[#F8FAFC]' : 'bg-[#F1F5F9] opacity-60'}`}>
              <div className="flex flex-col shrink-0">
                <button onClick={() => onMover(item, -1)} disabled={i === 0} className="text-[#94A3B8] hover:text-[#336699] disabled:opacity-30 leading-none text-[10px]" title="Mover para cima">▲</button>
                <button onClick={() => onMover(item, 1)} disabled={i === ordenados.length - 1} className="text-[#94A3B8] hover:text-[#336699] disabled:opacity-30 leading-none text-[10px]" title="Mover para baixo">▼</button>
              </div>
              {editandoId === item.id ? (
                <input
                  autoFocus
                  value={nomeEdicao}
                  onChange={(e) => setNomeEdicao(e.target.value.toUpperCase())}
                  onBlur={() => { onRenomear(item, nomeEdicao); setEditandoId(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { onRenomear(item, nomeEdicao); setEditandoId(null); } }}
                  className="flex-1 p-1.5 border border-[#336699] rounded text-sm font-semibold uppercase outline-none min-w-0"
                />
              ) : (
                <span onClick={() => { setEditandoId(item.id); setNomeEdicao(item.nome); }} className="flex-1 min-w-0 truncate text-sm font-semibold text-[#0C1D4D] cursor-pointer hover:underline" title="Clique para renomear">
                  {item.nome}
                </span>
              )}
              <button onClick={() => onAlternarAtivo(item)} className={`shrink-0 text-[9px] font-black uppercase px-2 py-1 rounded-full border ${item.ativo ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                {item.ativo ? 'Ativo' : 'Inativo'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function GestaoFreelancers() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, permissaoBruta } = usePageAccess({ nomeFallback: 'Usuário' });
  const toast = useToast();

  const [aba, setAba] = useState<'cadastros' | 'parametros'>('cadastros');

  // Estados de Dados
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [loading, setLoading] = useState(true);
  // setor(es)/nível(is) de cada freelancer atualmente carregado.
  const [setorNivelPorFreelancer, setSetorNivelPorFreelancer] = useState<Record<string, SetorNivelFreelancer[]>>({});

  // Empresa(s) que o usuário pode enxergar (Rentech × AlfaLight) — mesmo
  // padrão usado em /admin/operacional/relatorios.
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

  // Cada empresa tem seus próprios setores de atuação (LED, TV...) e sua
  // própria escala de níveis (Ajudante, Instalador...) — a Rentech loca
  // equipamento diferente da AlfaLight. Catálogo de todas as empresas
  // visíveis ao usuário, carregado uma vez (gerenciado na aba Parâmetros).
  const [setoresCatalogo, setSetoresCatalogo] = useState<ItemCatalogo[]>([]);
  const [niveisCatalogo, setNiveisCatalogo] = useState<ItemCatalogo[]>([]);

  useEffect(() => {
    if (empresasCatalogo.length === 0) return;
    const idsVisiveis = empresasPermitidas === null ? empresasCatalogo.map(e => e.id) : empresasPermitidas;
    if (idsVisiveis.length === 0) return;
    Promise.all([
      supabase.from('freelancers_setores').select('*').in('empresa_id', idsVisiveis).order('ordem'),
      supabase.from('freelancers_niveis').select('*').in('empresa_id', idsVisiveis).order('ordem'),
    ]).then(([resSetores, resNiveis]) => {
      setSetoresCatalogo(resSetores.data || []);
      setNiveisCatalogo(resNiveis.data || []);
    });
  }, [empresasCatalogo, empresasPermitidas]);

  const nomeSetor = (id: string) => setoresCatalogo.find(s => s.id === id)?.nome || '—';
  const nomeNivel = (id: string) => niveisCatalogo.find(n => n.id === id)?.nome || '—';

  // Filtros (aba Cadastros)
  const [busca, setBusca] = useState('');
  const [filtroSetorId, setFiltroSetorId] = useState('');
  const [filtroNivelId, setFiltroNivelId] = useState('');
  // Setor/nível são específicos de cada empresa — trocar a empresa filtrada
  // invalida a escolha anterior.
  useEffect(() => { setFiltroSetorId(''); setFiltroNivelId(''); }, [filtroEmpresaId]);

  // Modal e Edição
  const [modalOpen, setModalOpen] = useState<{ open: boolean; free: Freelancer | null }>({ open: false, free: null });
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Freelancer>>({});
  const [editSetorNiveis, setEditSetorNiveis] = useState<Record<string, string>>({});

  // 2. Carregar dados da tabela
  useEffect(() => {
    if (!authLoading && !acessoNegado) carregarDados();
  }, [authLoading, acessoNegado, filtroEmpresaId]);

  const carregarDados = async () => {
    setLoading(true);
    let query = supabase
      .from('freelancers')
      .select('*')
      .order('nome', { ascending: true });
    if (filtroEmpresaId) query = query.eq('empresa_id', filtroEmpresaId);
    const { data, error } = await query;

    if (data) {
      setFreelancers(data as Freelancer[]);

      const ids = data.map(f => f.id);
      if (ids.length > 0) {
        const { data: setorNivelData } = await supabase
          .from('freelancers_setor_nivel').select('freelancer_id, setor_id, nivel_id').in('freelancer_id', ids);
        const agrupado: Record<string, SetorNivelFreelancer[]> = {};
        (setorNivelData || []).forEach((row: SetorNivelFreelancer) => {
          (agrupado[row.freelancer_id] ||= []).push(row);
        });
        setSetorNivelPorFreelancer(agrupado);
      } else {
        setSetorNivelPorFreelancer({});
      }
    } else if (error) {
      console.error("Erro ao carregar freelancers:", error);
    }
    setLoading(false);
  };

  // Função para formatar o valor da diária
  const formatarMoeda = (valor: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
  };

  const nomeEmpresa = (empresaId: number | null) =>
    empresasCatalogo.find(e => e.id === empresaId)?.nome || '—';

  const filtrados = useMemo(() => {
    let lista = freelancers;
    const termo = busca.toLowerCase().trim();

    if (termo) {
      lista = lista.filter(f => f.nome.toLowerCase().includes(termo) || f.telefone.includes(termo));
    }

    if (filtroSetorId) {
      lista = lista.filter(f => (setorNivelPorFreelancer[f.id] || []).some(sn =>
        sn.setor_id === filtroSetorId && (!filtroNivelId || sn.nivel_id === filtroNivelId)
      ));
    } else if (filtroNivelId) {
      lista = lista.filter(f => (setorNivelPorFreelancer[f.id] || []).some(sn => sn.nivel_id === filtroNivelId));
    }

    return lista;
  }, [freelancers, busca, filtroSetorId, filtroNivelId, setorNivelPorFreelancer]);

  // Setores/níveis disponíveis nos filtros — dependem da empresa filtrada
  // (cada uma tem seu próprio catálogo).
  const setoresDoFiltro = filtroEmpresaId ? setoresCatalogo.filter(s => s.empresa_id === filtroEmpresaId && s.ativo) : [];
  const niveisDoFiltro = filtroEmpresaId ? niveisCatalogo.filter(n => n.empresa_id === filtroEmpresaId && n.ativo) : [];
  // KPIs por setor só fazem sentido dentro de uma empresa (setores diferentes por empresa).
  const setoresParaKpi = filtroEmpresaId ? setoresCatalogo.filter(s => s.empresa_id === filtroEmpresaId && s.ativo) : [];

  // ==========================================
  // AÇÕES DE EDIÇÃO
  // ==========================================
  const iniciarEdicao = () => {
    if (modalOpen.free) {
      setEditForm({ ...modalOpen.free });
      const atual: Record<string, string> = {};
      (setorNivelPorFreelancer[modalOpen.free.id] || []).forEach(sn => { atual[sn.setor_id] = sn.nivel_id; });
      setEditSetorNiveis(atual);
      setIsEditing(true);
    }
  };

  const cancelarEdicao = () => {
    setIsEditing(false);
    setEditForm({});
    setEditSetorNiveis({});
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
        comentarios: editForm.comentarios,
      };

      const { error } = await supabase
        .from('freelancers')
        .update(payloadFinal)
        .eq('id', editForm.id);

      if (error) throw error;

      // Substitui por completo os setores/níveis do freelancer (mais simples
      // que diff linha a linha).
      const freelancerId = editForm.id as string;
      await supabase.from('freelancers_setor_nivel').delete().eq('freelancer_id', freelancerId);
      const linhasSetorNivel = Object.entries(editSetorNiveis)
        .filter(([, nivelId]) => nivelId)
        .map(([setorId, nivelId]) => ({ freelancer_id: freelancerId, setor_id: setorId, nivel_id: nivelId }));
      if (linhasSetorNivel.length > 0) {
        const { error: erroSetores } = await supabase.from('freelancers_setor_nivel').insert(linhasSetorNivel);
        if (erroSetores) throw erroSetores;
      }
      setSetorNivelPorFreelancer(prev => ({ ...prev, [freelancerId]: linhasSetorNivel }));

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

  // ==========================================
  // PARÂMETROS: gerenciamento dos catálogos de setor/nível por empresa
  // ==========================================
  const [parametrosEmpresaId, setParametrosEmpresaId] = useState<number | null>(null);
  useEffect(() => {
    if (empresasCatalogoVisivel.length === 1) setParametrosEmpresaId(empresasCatalogoVisivel[0].id);
  }, [empresasCatalogoVisivel]);

  const [novoSetorNome, setNovoSetorNome] = useState('');
  const [novoNivelNome, setNovoNivelNome] = useState('');

  const proximaOrdem = (catalogo: ItemCatalogo[], empresaId: number) =>
    catalogo.filter(c => c.empresa_id === empresaId).reduce((m, c) => Math.max(m, c.ordem), 0) + 1;

  const adicionarItemCatalogo = async (
    tabela: 'freelancers_setores' | 'freelancers_niveis', empresaId: number, nome: string,
    catalogo: ItemCatalogo[], setCatalogo: (fn: (prev: ItemCatalogo[]) => ItemCatalogo[]) => void, setNome: (v: string) => void
  ) => {
    const nomeTrim = nome.trim().toUpperCase();
    if (!nomeTrim) return;
    const { data, error } = await supabase.from(tabela)
      .insert([{ empresa_id: empresaId, nome: nomeTrim, ordem: proximaOrdem(catalogo, empresaId) }])
      .select().single();
    if (error) { toast('Erro ao adicionar: ' + error.message, 'error'); return; }
    setCatalogo(prev => [...prev, data as ItemCatalogo]);
    setNome('');
  };

  const renomearItemCatalogo = async (
    tabela: 'freelancers_setores' | 'freelancers_niveis', item: ItemCatalogo, novoNome: string,
    setCatalogo: (fn: (prev: ItemCatalogo[]) => ItemCatalogo[]) => void
  ) => {
    const nome = novoNome.trim().toUpperCase();
    if (!nome || nome === item.nome) return;
    const { error } = await supabase.from(tabela).update({ nome }).eq('id', item.id);
    if (error) { toast('Erro ao renomear: ' + error.message, 'error'); return; }
    setCatalogo(prev => prev.map(c => c.id === item.id ? { ...c, nome } : c));
  };

  const alternarAtivoItemCatalogo = async (
    tabela: 'freelancers_setores' | 'freelancers_niveis', item: ItemCatalogo,
    setCatalogo: (fn: (prev: ItemCatalogo[]) => ItemCatalogo[]) => void
  ) => {
    const { error } = await supabase.from(tabela).update({ ativo: !item.ativo }).eq('id', item.id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    setCatalogo(prev => prev.map(c => c.id === item.id ? { ...c, ativo: !c.ativo } : c));
  };

  const moverItemCatalogo = async (
    tabela: 'freelancers_setores' | 'freelancers_niveis', item: ItemCatalogo, direcao: -1 | 1,
    catalogo: ItemCatalogo[], setCatalogo: (fn: (prev: ItemCatalogo[]) => ItemCatalogo[]) => void
  ) => {
    const doGrupo = catalogo.filter(c => c.empresa_id === item.empresa_id).sort((a, b) => a.ordem - b.ordem);
    const idx = doGrupo.findIndex(c => c.id === item.id);
    const vizinho = doGrupo[idx + direcao];
    if (!vizinho) return;
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from(tabela).update({ ordem: vizinho.ordem }).eq('id', item.id),
      supabase.from(tabela).update({ ordem: item.ordem }).eq('id', vizinho.id),
    ]);
    if (e1 || e2) { toast('Erro ao reordenar.', 'error'); return; }
    setCatalogo(prev => prev.map(c => {
      if (c.id === item.id) return { ...c, ordem: vizinho.ordem };
      if (c.id === vizinho.id) return { ...c, ordem: item.ordem };
      return c;
    }));
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

      {/* ABAS */}
      <div className="px-4 md:px-8 pt-4 flex-shrink-0 flex flex-wrap gap-2 border-b border-[#E2E8F0] bg-white">
        <button
          onClick={() => setAba('cadastros')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'cadastros' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          👷 Cadastros
        </button>
        <button
          onClick={() => setAba('parametros')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'parametros' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          ⚙️ Parâmetros
        </button>
      </div>

      {/* ============================================================ */}
      {/* ABA: CADASTROS */}
      {/* ============================================================ */}
      {aba === 'cadastros' && (
        <>
          {/* DASHBOARD RÁPIDO & FILTROS */}
          <div className="p-4 md:px-8 pt-6 flex-shrink-0">
            <div className={`grid grid-cols-2 md:grid-cols-3 gap-4 mb-6 ${COLUNAS_KPI[Math.min(setoresParaKpi.length + 1, 6)]}`}>
              <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-[#336699]">
                <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Total Cadastrados</h3>
                <p className="text-2xl font-black text-[#0C1D4D] mt-1">{freelancers.length}</p>
              </div>
              {setoresParaKpi.map((s, i) => (
                <div key={s.id} className={`bg-white p-5 rounded-xl shadow-sm border-l-4 ${CORES_KPI[i % CORES_KPI.length]}`}>
                  <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider truncate" title={s.nome}>Espec. em {s.nome}</h3>
                  <p className="text-2xl font-black text-[#0C1D4D] mt-1">
                    {freelancers.filter(f => (setorNivelPorFreelancer[f.id] || []).some(sn => sn.setor_id === s.id)).length}
                  </p>
                </div>
              ))}
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
                  className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#0C1D4D] outline-none transition-all cursor-pointer focus:border-[#336699] bg-[#F8FAFC] disabled:opacity-70 disabled:cursor-not-allowed"
                  value={filtroSetorId}
                  onChange={(e) => setFiltroSetorId(e.target.value)}
                  disabled={!filtroEmpresaId}
                  title={!filtroEmpresaId ? 'Escolha uma empresa pra filtrar por setor' : undefined}
                >
                  <option value="">⚙️ Todos os Setores</option>
                  {setoresDoFiltro.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>
              <div className="w-full lg:w-56 shadow-sm">
                <select
                  className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#0C1D4D] outline-none transition-all cursor-pointer focus:border-[#336699] bg-[#F8FAFC] disabled:opacity-70 disabled:cursor-not-allowed"
                  value={filtroNivelId}
                  onChange={(e) => setFiltroNivelId(e.target.value)}
                  disabled={!filtroEmpresaId}
                  title={!filtroEmpresaId ? 'Escolha uma empresa pra filtrar por nível' : undefined}
                >
                  <option value="">📊 Todos os Níveis</option>
                  {niveisDoFiltro.map(n => <option key={n.id} value={n.id}>{n.nome}</option>)}
                </select>
              </div>
              <div className="w-full lg:w-56 shadow-sm">
                <select
                  className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#0C1D4D] outline-none transition-all cursor-pointer focus:border-[#336699] bg-[#F8FAFC] disabled:opacity-70 disabled:cursor-not-allowed"
                  value={filtroEmpresaId ?? ''}
                  onChange={(e) => setFiltroEmpresaId(e.target.value ? Number(e.target.value) : null)}
                  disabled={empresasCatalogoVisivel.length <= 1}
                >
                  {empresasCatalogoVisivel.length !== 1 && <option value="">🏭 Todas as Empresas</option>}
                  {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
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
                          <span className="block text-[9px] text-[#94A3B8] font-black uppercase tracking-wider mt-0.5">🏭 {nomeEmpresa(free.empresa_id)}</span>
                        </td>
                        <td className="p-4">
                          <div className="flex gap-2 flex-wrap max-w-[350px]">
                            {(setorNivelPorFreelancer[free.id] || []).length === 0 ? (
                              <span className="text-[9px] text-[#CBD5E1] font-bold uppercase">Sem setor cadastrado</span>
                            ) : (
                              (setorNivelPorFreelancer[free.id] || []).map(sn => (
                                <span key={sn.setor_id} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">
                                  {nomeSetor(sn.setor_id)}: {nomeNivel(sn.nivel_id)}
                                </span>
                              ))
                            )}
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
        </>
      )}

      {/* ============================================================ */}
      {/* ABA: PARÂMETROS (setores e níveis por empresa) */}
      {/* ============================================================ */}
      {aba === 'parametros' && (
        <div className="px-4 md:px-8 py-6">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] mb-6 flex flex-wrap items-center gap-3">
            <label className="text-xs font-black text-[#64748B] uppercase tracking-wider">Empresa:</label>
            <select
              value={parametrosEmpresaId ?? ''}
              onChange={(e) => setParametrosEmpresaId(e.target.value ? Number(e.target.value) : null)}
              disabled={empresasCatalogoVisivel.length <= 1}
              className="p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold text-[#0C1D4D] outline-none focus:border-[#336699] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {empresasCatalogoVisivel.length !== 1 && <option value="">-- Selecione --</option>}
              {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <p className="text-[10px] text-[#94A3B8] font-semibold">Cada empresa loca equipamento diferente — seus setores e níveis são só dela.</p>
          </div>

          {!parametrosEmpresaId ? (
            <p className="text-center text-[#94A3B8] font-bold py-12">Selecione uma empresa para gerenciar os setores e níveis dela.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PainelCatalogo
                titulo="Setores de Atuação"
                itens={setoresCatalogo.filter(s => s.empresa_id === parametrosEmpresaId)}
                novoNome={novoSetorNome}
                setNovoNome={setNovoSetorNome}
                onAdicionar={() => adicionarItemCatalogo('freelancers_setores', parametrosEmpresaId, novoSetorNome, setoresCatalogo, setSetoresCatalogo, setNovoSetorNome)}
                onRenomear={(item, nome) => renomearItemCatalogo('freelancers_setores', item, nome, setSetoresCatalogo)}
                onAlternarAtivo={(item) => alternarAtivoItemCatalogo('freelancers_setores', item, setSetoresCatalogo)}
                onMover={(item, dir) => moverItemCatalogo('freelancers_setores', item, dir, setoresCatalogo, setSetoresCatalogo)}
              />
              <PainelCatalogo
                titulo="Níveis de Experiência"
                itens={niveisCatalogo.filter(n => n.empresa_id === parametrosEmpresaId)}
                novoNome={novoNivelNome}
                setNovoNome={setNovoNivelNome}
                onAdicionar={() => adicionarItemCatalogo('freelancers_niveis', parametrosEmpresaId, novoNivelNome, niveisCatalogo, setNiveisCatalogo, setNovoNivelNome)}
                onRenomear={(item, nome) => renomearItemCatalogo('freelancers_niveis', item, nome, setNiveisCatalogo)}
                onAlternarAtivo={(item) => alternarAtivoItemCatalogo('freelancers_niveis', item, setNiveisCatalogo)}
                onMover={(item, dir) => moverItemCatalogo('freelancers_niveis', item, dir, niveisCatalogo, setNiveisCatalogo)}
              />
            </div>
          )}
        </div>
      )}

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
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Empresa de Cadastro</span>
                        <strong className="text-xs text-[#0C1D4D]">{nomeEmpresa(modalOpen.free.empresa_id)}</strong>
                      </div>
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
                      {setoresCatalogo.filter(s => s.empresa_id === modalOpen.free!.empresa_id && s.ativo).map(s => {
                        const entrada = (setorNivelPorFreelancer[modalOpen.free!.id] || []).find(sn => sn.setor_id === s.id);
                        return (
                          <div key={s.id} className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                            <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">{s.nome}</span>
                            <strong className={`text-xs ${entrada ? 'text-[#0C1D4D]' : 'text-[#94A3B8]'}`}>{entrada ? nomeNivel(entrada.nivel_id) : 'Não trabalho com o Item'}</strong>
                          </div>
                        );
                      })}
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
                      {setoresCatalogo.filter(s => s.empresa_id === modalOpen.free!.empresa_id && s.ativo).map(s => (
                        <div key={s.id}>
                          <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">{s.nome}</label>
                          <select
                            value={editSetorNiveis[s.id] || ''}
                            onChange={(e) => setEditSetorNiveis(prev => ({ ...prev, [s.id]: e.target.value }))}
                            className="w-full p-2.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs font-semibold focus:border-[#336699] outline-none"
                          >
                            <option value="">Não trabalho com o Item</option>
                            {niveisCatalogo.filter(n => n.empresa_id === modalOpen.free!.empresa_id && n.ativo).map(n => <option key={n.id} value={n.id}>{n.nome}</option>)}
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
