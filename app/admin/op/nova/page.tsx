"use client";

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import logoColorido from '../../../../app/imgs/logo.png';
import { criarOP, NovaOPData } from '../actions'; 
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

interface ItemOP {
  id: number;
  descricao: string;
  qtd: number;
  valorUnitario: number;
}

// Interface simplificada do Freelancer para o Modal (AGORA COM VALOR DIARIA)
interface FreelancerBusca {
  id: string;
  nome: string;
  cpf: string;
  telefone: string;
  pix_chave: string;
  pix_tipo: string;
  endereco: string;
  valor_diaria: number | null;
}

export default function NovaOrdemPagamento() {
  const router = useRouter();
  const pathname = usePathname();
  
  // Estados de Segurança e Autenticação
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [usuarioNome, setUsuarioNome] = useState('Usuário');

  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; success: boolean; msg: string; title: string }>({ open: false, success: false, msg: '', title: '' });

  // Estado dos Dados Pessoais / Projeto
  const [responsavelNome, setResponsavelNome] = useState(''); 
  const [responsavelEmail, setResponsavelEmail] = useState(''); 
  const [carregandoUsuario, setCarregandoUsuario] = useState(true);
  const [natureza, setNatureza] = useState('SUBLOCAÇÃO');
  const [osNum, setOsNum] = useState('');
  const [osCliente, setOsCliente] = useState('');
  const [osEvento, setOsEvento] = useState('');
  const [osPeriodo, setOsPeriodo] = useState('');

  // Estado do Favorecido (Recebedor)
  const [empresaRecebedora, setEmpresaRecebedora] = useState('');
  const [cnpjCpf, setCnpjCpf] = useState('');
  const [endereco, setEndereco] = useState('');
  
  // Estado Financeiro
  const [tipoPagamento, setTipoPagamento] = useState('PIX');
  const [chavePix, setChavePix] = useState('CELULAR');
  const [dadosPagamento, setDadosPagamento] = useState('');
  const [dataVencimento, setDataVencimento] = useState('');
  const [obs, setObs] = useState('');
  
  // Captura do arquivo selecionado
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState('');

  // Modais e Estados da Busca de Freelancers
  const [modalFreelanceAberto, setModalFreelanceAberto] = useState(false);
  const [listaFreelancers, setListaFreelancers] = useState<FreelancerBusca[]>([]);
  const [termoBuscaFree, setTermoBuscaFree] = useState('');
  const [loadingFree, setLoadingFree] = useState(false);

  // Gestão Dinâmica de Itens
  const [itens, setItens] = useState<ItemOP[]>(
    Array.from({ length: 3 }, (_, i) => ({ id: i, descricao: '', qtd: 0, valorUnitario: 0 }))
  );

  // 1. Validar Sessão e Consultar Permissões Dinâmicas no Banco
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) { 
        router.push('/login'); 
        return; 
      }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios')
        .select('*')
        .eq('id', session.user.id)
        .single();
      
      if (perfilError || !perfil) {
        console.error("Erro crítico ao buscar perfil do usuário:", perfilError);
        router.push('/login');
        return;
      }

      // Consulta no banco de dados quem pode aceder a esta rota
      const { data: rotaPermissao, error: rotaError } = await supabase
        .from('folha_paginas_permissoes')
        .select('permissoes_permitidas')
        .eq('endereco_route', pathname)
        .single();

      if (rotaError && rotaError.code !== 'PGRST116') {
        console.error("Erro ao buscar permissão da rota:", rotaError);
      }

      // Normaliza o perfil logado e verifica contra o banco
      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }

      // Aprovado
      setUsuarioNome(perfil.nome || 'Usuário');
      setResponsavelEmail(session.user.email ?? '');
      const metadados = session.user.user_metadata ?? {};
      const nomeMetadados = metadados.full_name || metadados.nome || metadados.name;
      const nome = perfil.nome || nomeMetadados || (session.user.email ? session.user.email.split('@')[0].replace(/[._-]/g, ' ') : '');
      setResponsavelNome((nome as string).toUpperCase());
      setCarregandoUsuario(false);
      setAuthLoading(false);
    }

    checkAuth();
  }, [router, pathname]);



  const formatarMoeda = (valor: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
  };

  const aplicarMascaraCpfCnpj = (valor: string) => {
    let v = valor.replace(/\D/g, "");
    if (v.length <= 11) {
      v = v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    } else {
      v = v.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
    }
    setCnpjCpf(v);
  };

  // ============================================================================
  // BUSCA AUTOMÁTICA DA DIÁRIA AO DIGITAR O CPF
  // ============================================================================
  const handleCpfBlur = async () => {
    if (natureza !== 'FREELANCE' || !cnpjCpf) return;
    
    // Tira os pontos e traços para procurar no banco (caso esteja salvo limpo)
    const cpfLimpo = cnpjCpf.replace(/\D/g, "");
    
    // Busca na tabela freelancers se o CPF existe
    const { data } = await supabase
      .from('freelancers')
      .select('valor_diaria')
      // Procura tanto pelo valor com máscara quanto sem máscara
      .or(`cpf.eq.${cnpjCpf},cpf.eq.${cpfLimpo}`)
      .limit(1)
      .single();

    if (data && data.valor_diaria) {
      setItens(prev => {
        const arr = [...prev];
        // Preenche a linha 1 apenas se ela ainda estiver vazia (para não apagar algo que você já tenha digitado)
        if (!arr[0].descricao || arr[0].valorUnitario === 0) {
          arr[0] = { ...arr[0], descricao: 'DIÁRIA DE TRABALHO', qtd: 1, valorUnitario: data.valor_diaria };
        }
        return arr;
      });
    }
  };

  const adicionarLinhaItem = () => {
    setItens([...itens, { id: Date.now(), descricao: '', qtd: 0, valorUnitario: 0 }]);
  };

  const removerLinhaItem = (id: number) => {
    if (itens.length > 1) {
      setItens(itens.filter(item => item.id !== id));
    }
  };

  const atualizarItem = (id: number, campo: keyof ItemOP, valor: any) => {
    setItens(itens.map(item => item.id === id ? { ...item, [campo]: valor } : item));
  };

  const totalGeral = useMemo(() => {
    return itens.reduce((acc, item) => acc + (item.qtd * item.valorUnitario), 0);
  }, [itens]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        alert("O arquivo é muito grande. O limite máximo é 5MB.");
        e.target.value = '';
        return;
      }
      setArquivo(file);
    }
  };

  // ============================================================================
  // FUNÇÕES DE BUSCA DE FREELANCER (MODAL)
  // ============================================================================
  const abrirModalFreelance = async () => {
    setModalFreelanceAberto(true);
    setLoadingFree(true);
    const { data, error } = await supabase.from('freelancers').select('id, nome, cpf, telefone, pix_chave, pix_tipo, endereco, valor_diaria').order('created_at', { ascending: false }).limit(100);
    if (!error && data) {
      setListaFreelancers(data);
    }
    setLoadingFree(false);
  };

  const selecionarFreelancer = (free: FreelancerBusca) => {
    setEmpresaRecebedora(free.nome);
    setCnpjCpf(free.cpf || '');
    aplicarMascaraCpfCnpj(free.cpf || '');
    setEndereco(free.endereco || '');
    setTipoPagamento('PIX');
    
    let tipoMapeado = 'CELULAR';
    const tipoFree = (free.pix_tipo || '').toUpperCase();
    if (tipoFree.includes('CPF') || tipoFree.includes('CNPJ')) tipoMapeado = 'CPF/CNPJ';
    if (tipoFree.includes('EMAIL') || tipoFree.includes('E-MAIL')) tipoMapeado = 'EMAIL';
    if (tipoFree.includes('ALEAT')) tipoMapeado = 'ALEATÓRIO';
    
    setChavePix(tipoMapeado);
    setDadosPagamento(free.pix_chave);
    setModalFreelanceAberto(false);

    // Preenche a tabela de itens automaticamente com a diária!
    if (free.valor_diaria) {
      setItens(prev => {
        const arr = [...prev];
        arr[0] = { ...arr[0], descricao: 'DIÁRIA DE TRABALHO', qtd: 1, valorUnitario: free.valor_diaria! };
        return arr;
      });
    }
  };

  const freelancersFiltrados = useMemo(() => {
    if (!termoBuscaFree) return listaFreelancers;
    const termo = termoBuscaFree.toLowerCase();
    return listaFreelancers.filter(f => f.nome.toLowerCase().includes(termo) || (f.cpf && f.cpf.includes(termo)));
  }, [listaFreelancers, termoBuscaFree]);

  // ============================================================================
  // ENVIO DO FORMULÁRIO 
  // ============================================================================
  const handleSubmeterFormulario = async () => {
    setLoading(true);
    setUploadStatus('');
    
    const itensValidos = itens
      .filter(i => i.descricao.trim() !== '' && i.qtd > 0)
      .map(i => ({ descricao: i.descricao.toUpperCase(), qtd: i.qtd, valor_unitario: i.valorUnitario, total: i.qtd * i.valorUnitario }));

    if (itensValidos.length === 0) {
      setModal({ open: true, success: false, title: 'Atenção', msg: 'Adicione pelo menos um item válido com quantidade e valor.' });
      setLoading(false);
      return;
    }

    let urlFinalAnexo = '';

    if (arquivo) {
      setUploadStatus('Fazendo upload do comprovante...');
      const fileExt = arquivo.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `anexos_ops/${fileName}`;

      const { error: uploadError } = await supabase.storage.from('comprovantes').upload(filePath, arquivo);

      if (uploadError) {
        setModal({ open: true, success: false, title: 'Erro no Anexo', msg: `Falha ao fazer upload: ${uploadError.message}` });
        setLoading(false);
        return;
      }
      const { data: publicUrlData } = supabase.storage.from('comprovantes').getPublicUrl(filePath);
      urlFinalAnexo = publicUrlData.publicUrl;
    }

    setUploadStatus('Registrando ordem de pagamento...');

    const payload: NovaOPData = {
      responsavel_nome: responsavelNome.toUpperCase() || 'USUÁRIO DO SISTEMA',
      responsavel_email: responsavelEmail,
      natureza_pagamento: natureza,
      os_numero: osNum.toUpperCase(),
      os_cliente: osCliente.toUpperCase(),
      os_evento: osEvento.toUpperCase(),
      os_periodo: osPeriodo.toUpperCase(),
      empresa_recebedora: empresaRecebedora.toUpperCase(),
      cnpj_cpf_recebedora: cnpjCpf,
      endereco_recebedora: endereco.toUpperCase(),
      telefone_recebedora: '', 
      tipo_pagamento: tipoPagamento,
      chave_pix: tipoPagamento === 'PIX' ? chavePix : '',
      dados_pagamento: dadosPagamento, 
      data_vencimento: dataVencimento,
      observacao: obs.toUpperCase(),
      itens: itensValidos,
      total_geral: totalGeral,
      file_url: urlFinalAnexo 
    };

    const resposta = await criarOP(payload);

    if (resposta.success) {
      setModal({ open: true, success: true, title: 'Sucesso!', msg: 'A Ordem de Pagamento foi registrada e enviada ao Financeiro.' });
    } else {
      setModal({ open: true, success: false, title: 'Erro de Conexão', msg: resposta.message || 'Falha ao salvar no banco de dados.' });
    }
    setLoading(false);
    setUploadStatus('');
  };

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para criar Ordens de Pagamento.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-4 lg:p-10 font-sans text-[#0A2A4A] print:bg-white print:p-0">
      <Analytics/>
      
      {/* Modal de Feedback Principal */}
      {modal.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm print:hidden">
          <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full mx-4 transform transition-all">
            <div className={`text-6xl mb-4 ${modal.success ? 'text-green-500' : 'text-red-500'}`}>
              {modal.success ? '✅' : '❌'}
            </div>
            <h3 className="text-2xl font-black text-[#0A2A4A] mb-2">{modal.title}</h3>
            <p className="text-[#64748B] mb-8 font-medium">{modal.msg}</p>
            <button 
              onClick={() => {
                setModal({ ...modal, open: false });
                if (modal.success) router.push('/admin/op'); 
              }}
              className="w-full py-3 bg-[#0C1D4D] text-white font-bold rounded-lg hover:bg-[#284B8C] transition-colors"
            >
              OK, VOLTAR
            </button>
          </div>
        </div>
      )}

      {/* Modal do Banco de Talentos (Freelancers) */}
      {modalFreelanceAberto && (
        <div className="fixed inset-0 z-[8000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-wider text-sm">👷 Buscar no Banco de Talentos</h3>
              <button onClick={() => setModalFreelanceAberto(false)} className="text-white hover:text-red-400 text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <input 
                type="text" 
                placeholder="Pesquisar por nome ou CPF..." 
                className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] outline-none focus:border-[#336699]"
                value={termoBuscaFree}
                onChange={(e) => setTermoBuscaFree(e.target.value)}
              />
            </div>

            <div className="overflow-y-auto flex-grow p-4 bg-white">
              {loadingFree ? (
                <div className="text-center py-10 text-[#64748B] font-bold text-sm">Carregando freelancers...</div>
              ) : freelancersFiltrados.length === 0 ? (
                <div className="text-center py-10 text-[#64748B] font-bold text-sm">Nenhum profissional encontrado.</div>
              ) : (
                <div className="space-y-3">
                  {freelancersFiltrados.map((free) => (
                    <div key={free.id} className="border border-[#E2E8F0] rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-[#336699] transition-colors">
                      <div>
                        <strong className="block text-sm font-black text-[#0C1D4D]">{free.nome}</strong>
                        <p className="text-xs text-[#64748B] mt-1">CPF: {free.cpf || 'Não info.'} | Cel: {free.telefone}</p>
                      </div>
                      <button 
                        onClick={() => selecionarFreelancer(free)}
                        className="w-full sm:w-auto bg-[#E0F2FE] text-[#0369A1] hover:bg-[#BAE6FD] font-bold text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg transition-colors flex-shrink-0"
                      >
                        Selecionar Dados
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg border border-[#E2E8F0] overflow-hidden print:border-none print:shadow-none">
        
        {/* Cabeçalho */}
        <div className="bg-[#0C1D4D] p-6 lg:p-8 flex flex-col sm:flex-row justify-between items-center gap-4 print:bg-transparent print:border-b-2 print:border-black">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} className="print:grayscale" />
          <div className="text-center sm:text-right">
            <h2 className="text-2xl font-black text-white uppercase tracking-wider print:text-black">Ordem de Pagamento</h2>
            <p className="text-[#999999] text-sm font-bold print:text-gray-500">Solicitação Financeira Administrativa</p>
            <br/>
            <button
              onClick={() => router.push('/admin/op')}
              className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
            >
              ⬅ VOLTAR AO OP
            </button>
          </div>
        </div>

        <div className="p-6 lg:p-8 space-y-8">
          
          {/* Sessão 1: Responsável e Natureza */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-[#0369A1] uppercase tracking-wider">Responsável (Logado)</label>
                <span className="text-[9px] font-black uppercase tracking-wider bg-[#0369A1] text-white px-2 py-0.5 rounded-full">Automático</span>
              </div>
              {carregandoUsuario ? (
                <p className="text-sm text-[#64748B] font-semibold animate-pulse py-1">Identificando usuário...</p>
              ) : (
                <>
                  <input
                    type="text"
                    readOnly
                    placeholder="Nome não identificado"
                    className="w-full p-3 bg-white border border-[#BAE6FD] rounded-lg text-sm text-[#0A2A4A] outline-none font-bold uppercase cursor-default"
                    value={responsavelNome}
                  />
                  <p className="text-xs text-[#0369A1] font-semibold mt-2 truncate">
                    ✉️ {responsavelEmail || 'E-mail não disponível'}
                  </p>
                </>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-[#64748B] uppercase tracking-wider mb-2">Natureza do Pagamento</label>
              <select className="w-full p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-sm text-[#0A2A4A] focus:border-[#00A8E8] outline-none font-semibold cursor-pointer" value={natureza} onChange={(e) => setNatureza(e.target.value)}>
                <option value="SUBLOCAÇÃO">SUBLOCAÇÃO</option>
                <option value="FREELANCE">FREELANCE (Diárias)</option>
                <option value="REEMBOLSO">REEMBOLSO</option>
                <option value="HOSPEDAGEM">HOSPEDAGEM</option>
                <option value="BV">BV (BONIFICAÇÃO/COMISSÃO)</option>
              </select>
            </div>
          </section>

          {/* Sessão 2: Dados da OS */}
          <section className="bg-[#F8FAFC] p-5 rounded-xl border border-[#E2E8F0]">
            <h3 className="text-sm font-black text-[#0A2A4A] uppercase tracking-widest mb-4 border-b border-[#E2E8F0] pb-2">Dados do Projeto / Evento</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input type="text" placeholder="Nº DA OS" className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase focus:border-[#336699] outline-none" value={osNum} onChange={(e) => setOsNum(e.target.value)} />
              <input type="text" placeholder="CLIENTE" className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase focus:border-[#336699] outline-none" value={osCliente} onChange={(e) => setOsCliente(e.target.value)} />
              <input type="text" placeholder="EVENTO" className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase focus:border-[#336699] outline-none" value={osEvento} onChange={(e) => setOsEvento(e.target.value)} />
              <input type="text" placeholder="PERÍODO (Ex: 10/05 a 12/05)" className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase focus:border-[#336699] outline-none" value={osPeriodo} onChange={(e) => setOsPeriodo(e.target.value)} />
            </div>
          </section>

          {/* Sessão 3: Favorecido */}
          <section className="space-y-4">
            <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-2 mb-2">
              <h3 className="text-sm font-black text-[#0A2A4A] uppercase tracking-widest">Dados do Favorecido (Recebedor)</h3>
              
              {natureza === 'FREELANCE' && (
                <button 
                  onClick={abrirModalFreelance} 
                  className="bg-[#0C1D4D] text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-[#284B8C] transition-colors flex items-center gap-2 shadow-sm"
                >
                  👷 Autocompletar do Banco de Talentos
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input type="text" placeholder="NOME DA EMPRESA OU PROFISSIONAL" className="w-full p-3 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase font-bold focus:border-[#336699] outline-none" value={empresaRecebedora} onChange={(e) => setEmpresaRecebedora(e.target.value)} />
              
              {/* CAMPO DE CPF COM O EVENTO onBlur ADICIONADO */}
              <input 
                type="text" 
                placeholder="CNPJ OU CPF" 
                className="w-full p-3 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] font-bold focus:border-[#336699] outline-none" 
                value={cnpjCpf} 
                onChange={(e) => aplicarMascaraCpfCnpj(e.target.value)} 
                onBlur={handleCpfBlur} 
              />
            </div>
            <input type="text" placeholder="ENDEREÇO COMPLETO (OPCIONAL)" className="w-full p-3 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase focus:border-[#336699] outline-none" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
          </section>

          {/* Sessão 4: Financeiro */}
          <section className="bg-[#E0F2FE]/40 p-5 rounded-xl border border-[#BAE6FD]">
            <h3 className="text-sm font-black text-[#0284C7] uppercase tracking-widest mb-4 border-b border-[#BAE6FD] pb-2">Dados Bancários para Pagamento</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-[10px] font-bold text-[#0369A1] uppercase tracking-wider mb-1">Forma</label>
                <select className="w-full p-2.5 bg-white border border-[#BAE6FD] rounded-lg text-sm text-[#0A2A4A] font-bold outline-none focus:ring-2 focus:ring-[#00A8E8]" value={tipoPagamento} onChange={(e) => setTipoPagamento(e.target.value)}>
                  <option value="PIX">PIX</option>
                  <option value="BOLETO">BOLETO BANCÁRIO</option>
                  <option value="TRANSFERÊNCIA">TRANSFERÊNCIA (TED/DOC)</option>
                  <option value="DINHEIRO">DINHEIRO (ESPÉCIE)</option>
                </select>
              </div>

              {tipoPagamento === 'PIX' && (
                <div>
                  <label className="block text-[10px] font-bold text-[#0369A1] uppercase tracking-wider mb-1">Tipo de Chave</label>
                  <select className="w-full p-2.5 bg-white border border-[#BAE6FD] rounded-lg text-sm text-[#0A2A4A] font-bold outline-none focus:ring-2 focus:ring-[#00A8E8]" value={chavePix} onChange={(e) => setChavePix(e.target.value)}>
                    <option value="CELULAR">CELULAR</option>
                    <option value="EMAIL">E-MAIL</option>
                    <option value="CPF/CNPJ">CPF / CNPJ</option>
                    <option value="ALEATÓRIO">CHAVE ALEATÓRIA</option>
                  </select>
                </div>
              )}

              <div className={tipoPagamento !== 'PIX' ? 'md:col-span-2' : ''}>
                <label className="block text-[10px] font-bold text-[#EF4444] uppercase tracking-wider mb-1">Data de Vencimento Obrigatória</label>
                <input type="date" className="w-full p-2.5 bg-white border border-[#FCA5A5] rounded-lg text-sm text-[#0A2A4A] font-bold outline-none focus:ring-2 focus:ring-red-400" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} required />
              </div>
            </div>

            <input type="text" placeholder="DIGITE A CHAVE PIX, CÓDIGO DE BARRAS OU AGÊNCIA/CONTA" className="w-full p-3 bg-white border border-[#BAE6FD] rounded-lg text-sm text-[#0A2A4A] font-bold outline-none focus:ring-2 focus:ring-[#00A8E8]" value={dadosPagamento} onChange={(e) => setDadosPagamento(e.target.value)} />
          </section>

          {/* Sessão 5: Itens da OP */}
          <section className="space-y-4">
            <h3 className="text-sm font-black text-[#0A2A4A] uppercase tracking-widest mb-2 border-b border-[#E2E8F0] pb-2">Detalhamento dos Itens a Pagar</h3>
            
            <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="bg-[#0C1D4D] text-white text-[11px] uppercase tracking-wider font-bold">
                    <th className="p-3 w-1/2">Descrição do Serviço / Item</th>
                    <th className="p-3 w-24 text-center">Qtd</th>
                    <th className="p-3 w-32">Valor Unit. (R$)</th>
                    <th className="p-3 w-32 text-right">Total (R$)</th>
                    <th className="p-3 w-12 text-center print:hidden">🗑️</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {itens.map((item) => (
                    <tr key={item.id} className="bg-white hover:bg-[#F8FAFC]">
                      <td className="p-2">
                        <input type="text" placeholder={natureza === 'FREELANCE' ? "Ex: Diária de Painel de LED..." : "Detalhes do serviço..."} className="w-full p-2 border border-transparent hover:border-[#CBD5E1] focus:border-[#00A8E8] rounded bg-transparent uppercase text-sm outline-none" value={item.descricao} onChange={(e) => atualizarItem(item.id, 'descricao', e.target.value)} />
                      </td>
                      <td className="p-2">
                        <input type="number" min="0" className="w-full p-2 border border-[#CBD5E1] rounded text-center text-sm font-semibold outline-none focus:border-[#00A8E8]" value={item.qtd || ''} onChange={(e) => atualizarItem(item.id, 'qtd', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="p-2">
                        <input type="number" min="0" step="0.01" className="w-full p-2 border border-[#CBD5E1] rounded text-sm font-semibold outline-none focus:border-[#00A8E8]" value={item.valorUnitario || ''} onChange={(e) => atualizarItem(item.id, 'valorUnitario', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="p-2 text-right font-bold text-[#0C1D4D]">
                        {formatarMoeda(item.qtd * item.valorUnitario)}
                      </td>
                      <td className="p-2 text-center print:hidden">
                        <button onClick={() => removerLinhaItem(item.id)} className="text-red-400 hover:text-red-600 hover:scale-110 transition-transform disabled:opacity-30" disabled={itens.length === 1}>✖</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={adicionarLinhaItem} className="w-full py-3 bg-[#F0F4F8] border border-dashed border-[#94A3B8] text-[#64748B] font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#E2E8F0] hover:text-[#0A2A4A] transition-colors print:hidden">
              ➕ Adicionar Nova Linha de Item
            </button>

            {/* Totalizador */}
            <div className="bg-[#0C1D4D] text-white p-6 rounded-xl flex justify-between items-center shadow-lg mt-6">
              <span className="text-sm font-black uppercase tracking-widest text-[#94A3B8]">Valor Total a Pagar</span>
              <span className="text-3xl font-black tracking-tighter text-[#00A8E8]">{formatarMoeda(totalGeral)}</span>
            </div>
          </section>

          {/* Sessão 6: Anexos e Finalização */}
          <section className="bg-[#F8FAFC] p-5 rounded-xl border border-[#E2E8F0] print:hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-[#0A2A4A] uppercase tracking-wider mb-2">📎 Anexar Comprovante / NF / Recibo</label>
                <input 
                  type="file" 
                  onChange={handleFileChange}
                  className="w-full text-sm text-[#64748B] file:mr-4 file:py-2.5 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[#E0F2FE] file:text-[#0369A1] hover:file:bg-[#BAE6FD] cursor-pointer" 
                  accept=".pdf, image/*" 
                />
                <p className="text-[10px] text-[#94A3B8] mt-1">Formatos aceitos: PDF, JPG, PNG (Max 5MB)</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#64748B] uppercase tracking-wider mb-2">Observações Adicionais</label>
                <input type="text" placeholder="Qualquer informação extra para o financeiro..." className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase focus:border-[#336699] outline-none" value={obs} onChange={(e) => setObs(e.target.value)} />
              </div>
            </div>
          </section>

          {/* Botão de Envio */}
          <div className="pt-4 border-t border-[#E2E8F0] print:hidden">
            <button 
              onClick={handleSubmeterFormulario}
              disabled={loading}
              className="w-full py-4 bg-green-600 text-white font-black text-lg rounded-xl hover:bg-green-500 hover:shadow-[0_0_20px_rgba(22,163,74,0.3)] transition-all uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (uploadStatus || 'PROCESSANDO ORDEM DE PAGAMENTO...') : 'SALVAR E ENVIAR AO FINANCEIRO ➔'}
            </button>
            <p className="text-center text-[10px] text-[#94A3B8] mt-3 font-semibold uppercase tracking-widest">
              AO ENVIAR, ESTA OP ENTRARÁ NO FLUXO DE APROVAÇÃO GERENCIAL
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}