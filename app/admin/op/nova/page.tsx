"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { criarOP, NovaOPData } from '../actions';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { useAcessoRota } from '../useAcessoRota';
import { useToast } from '../../../components/ui/NotificationProvider';
import { ehAdministradorGlobal } from '../../../lib/permissoes';

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

// Interface simplificada do Funcionário para o Modal do Banco de Funcionários (REEMBOLSO)
interface FuncionarioBusca {
  id: string;
  nome_completo: string;
  cpf: string | null;
  celular: string | null;
  pix_chave: string | null;
  pix_tipo: string | null;
  endereco: string | null;
}

export default function NovaOrdemPagamento() {
  const router = useRouter();

  // Sessão + permissão da rota, resolvidas pelo hook compartilhado do módulo.
  const { authLoading, acessoNegado, perfil } = useAcessoRota('/admin/op/nova');
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; success: boolean; msg: string; title: string }>({ open: false, success: false, msg: '', title: '' });

  // Estado dos Dados Pessoais / Projeto
  const [responsavelNome, setResponsavelNome] = useState('');
  const [responsavelEmail, setResponsavelEmail] = useState('');
  const [carregandoUsuario, setCarregandoUsuario] = useState(true);
  const [natureza, setNatureza] = useState('SUBLOCAÇÃO');

  // Empresa (Rentech × AlfaLight) da OP. null = ainda não sabemos o que o
  // usuário pode ver; [] catálogo ainda carregando. Trava sozinho quando o
  // usuário só tem acesso a uma empresa (empresasCatalogoVisivel.length === 1).
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [osNum, setOsNum] = useState('');
  const [osCliente, setOsCliente] = useState('');
  const [osEvento, setOsEvento] = useState('');
  const [osPeriodo, setOsPeriodo] = useState('');

  // Estado do Favorecido (Recebedor)
  const [empresaRecebedora, setEmpresaRecebedora] = useState('');
  const [cnpjCpf, setCnpjCpf] = useState('');
  const [endereco, setEndereco] = useState('');
  // Celular de quem vai assinar o recibo digitalmente — obrigatório: é o
  // canal usado pela Autentique para enviar o link de assinatura.
  const [celularSignatario, setCelularSignatario] = useState('');
  // CPF do signatário só é pedido separadamente quando o favorecido é PJ
  // (cnpjCpf com 14 dígitos): a Autentique valida por CPF, nunca por CNPJ.
  // Quando o favorecido já é pessoa física, o CPF digitado acima é reaproveitado
  // — não faz sentido pedir o mesmo documento duas vezes.
  const [cpfSignatario, setCpfSignatario] = useState('');
  const cpfFavorecidoLimpo = cnpjCpf.replace(/\D/g, '');
  const favorecidoEhPessoaFisica = cpfFavorecidoLimpo.length === 11;
  
  // Estado Financeiro
  const [tipoPagamento, setTipoPagamento] = useState('PIX');
  const [chavePix, setChavePix] = useState('CELULAR');
  const [dadosPagamento, setDadosPagamento] = useState('');
  const [dataVencimento, setDataVencimento] = useState('');
  const [obs, setObs] = useState('');
  
  // Captura dos arquivos selecionados — pode anexar mais de um comprovante
  // (NF + recibo + comprovante de PIX, por exemplo).
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [uploadStatus, setUploadStatus] = useState('');

  // Modais e Estados da Busca de Freelancers
  const [modalFreelanceAberto, setModalFreelanceAberto] = useState(false);
  const [listaFreelancers, setListaFreelancers] = useState<FreelancerBusca[]>([]);
  const [termoBuscaFree, setTermoBuscaFree] = useState('');
  const [loadingFree, setLoadingFree] = useState(false);

  // Modais e Estados da Busca de Funcionários (Banco de Funcionários, para REEMBOLSO)
  const [modalFuncionarioAberto, setModalFuncionarioAberto] = useState(false);
  const [listaFuncionarios, setListaFuncionarios] = useState<FuncionarioBusca[]>([]);
  const [termoBuscaFunc, setTermoBuscaFunc] = useState('');
  const [loadingFunc, setLoadingFunc] = useState(false);

  // Gestão Dinâmica de Itens
  const [itens, setItens] = useState<ItemOP[]>(
    Array.from({ length: 3 }, (_, i) => ({ id: i, descricao: '', qtd: 0, valorUnitario: 0 }))
  );

  // Deriva os dados de exibição do responsável a partir do perfil já
  // validado pelo hook (nome cadastrado > nome dos metadados de auth > nome
  // "bonito" extraído do e-mail).
  useEffect(() => {
    if (!perfil) return;

    setResponsavelEmail(perfil.email);
    const nomeMetadados = perfil.userMetadata.full_name || perfil.userMetadata.nome || perfil.userMetadata.name;
    const nome = perfil.nome || nomeMetadados || (perfil.email ? perfil.email.split('@')[0].replace(/[._-]/g, ' ') : '');
    setResponsavelNome((nome as string).toUpperCase());
    setCarregandoUsuario(false);
  }, [perfil]);

  // Carrega o catálogo de empresas e a que(is) o usuário logado pode ver —
  // só quem é literalmente "Administrador" (ehAdministradorGlobal) enxerga
  // todas; Diretoria/Gerência/demais ficam restritos ao vínculo deles em
  // perfis_usuarios_empresas, igual ao resto do sistema.
  useEffect(() => {
    if (!perfil) return;
    async function carregarEmpresas() {
      const { data: empresasData } = await supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome');
      setEmpresasCatalogo(empresasData || []);

      if (ehAdministradorGlobal(perfil!.permissaoBruta)) {
        setEmpresasPermitidas(null);
        return;
      }
      const { data: vinculos } = await supabase
        .from('perfis_usuarios_empresas').select('empresa_id').eq('perfil_id', perfil!.id);
      setEmpresasPermitidas((vinculos || []).map(v => v.empresa_id));
    }
    carregarEmpresas();
  }, [perfil]);

  const empresasCatalogoVisivel = useMemo(() =>
    empresasPermitidas === null
      ? empresasCatalogo
      : empresasCatalogo.filter(e => empresasPermitidas.includes(e.id)),
    [empresasCatalogo, empresasPermitidas]);

  // Se só existe uma empresa visível, trava nela automaticamente.
  useEffect(() => {
    if (empresasCatalogoVisivel.length === 1) {
      setEmpresaId(empresasCatalogoVisivel[0].id);
    }
  }, [empresasCatalogoVisivel]);

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

  const aplicarMascaraCpfSignatario = (valor: string) => {
    const v = valor.replace(/\D/g, "").slice(0, 11)
      .replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    setCpfSignatario(v);
  };

  const aplicarMascaraCelularSignatario = (valor: string) => {
    const v = valor.replace(/\D/g, "").slice(0, 11)
      .replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
    setCelularSignatario(v);
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
    if (!e.target.files || e.target.files.length === 0) return;
    const selecionados = Array.from(e.target.files);
    e.target.value = ''; // permite selecionar o mesmo arquivo de novo depois de removê-lo

    const validos: File[] = [];
    const grandesDemais: string[] = [];
    for (const file of selecionados) {
      if (file.size > 5 * 1024 * 1024) grandesDemais.push(file.name);
      else validos.push(file);
    }
    if (grandesDemais.length > 0) {
      toast(`Arquivo(s) muito grande(s) (limite 5MB): ${grandesDemais.join(', ')}`, 'error');
    }
    if (validos.length > 0) {
      setArquivos(prev => [...prev, ...validos]);
    }
  };

  const removerArquivo = (idx: number) => {
    setArquivos(prev => prev.filter((_, i) => i !== idx));
  };

  // ============================================================================
  // FUNÇÕES DE BUSCA DE FREELANCER (MODAL)
  // ============================================================================
  const abrirModalFreelance = async () => {
    setModalFreelanceAberto(true);
    setLoadingFree(true);
    // Sem limit baixo aqui: era .limit(100), então freelancers cadastrados
    // há mais tempo (fora dos 100 mais recentes) nunca apareciam na busca,
    // mesmo digitando o nome/CPF exato — a lista inteira precisa estar
    // carregada pro filtro abaixo (freelancersFiltrados) ter o que buscar.
    const { data, error } = await supabase.from('freelancers').select('id, nome, cpf, telefone, pix_chave, pix_tipo, endereco, valor_diaria').order('created_at', { ascending: false }).limit(5000);
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
    // Freelancer é sempre pessoa física — o CPF acima já serve como
    // signatário; não precisa preencher o campo separado.
    aplicarMascaraCelularSignatario(free.telefone || '');
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
    // CPF é comparado só pelos dígitos dos dois lados: o cadastro nem sempre
    // grava o CPF com a mesma pontuação que a pessoa digitou (não há máscara
    // obrigatória no formulário público de freelancer), então comparar a
    // string crua fazia buscas por CPF sem pontuação nunca baterem.
    const termoDigitos = termo.replace(/\D/g, '');
    return listaFreelancers.filter(f =>
      f.nome.toLowerCase().includes(termo) ||
      (termoDigitos && f.cpf && f.cpf.replace(/\D/g, '').includes(termoDigitos))
    );
  }, [listaFreelancers, termoBuscaFree]);

  // ============================================================================
  // FUNÇÕES DE BUSCA DE FUNCIONÁRIO (MODAL — REEMBOLSO)
  // ============================================================================
  const abrirModalFuncionario = async () => {
    if (!empresaId) {
      toast("Selecione a empresa da OP antes de buscar no Banco de Funcionários.", 'error');
      return;
    }
    setModalFuncionarioAberto(true);
    setLoadingFunc(true);
    // Reembolso é sempre de um funcionário — filtra pela mesma empresa
    // escolhida no topo do formulário, pra não misturar funcionário
    // Rentech numa OP marcada como AlfaLight (ou vice-versa).
    const { data, error } = await supabase
      .from('folha_funcionarios')
      .select('id, nome_completo, cpf, celular, pix_chave, pix_tipo, endereco')
      .eq('ativo', true)
      .eq('empresa_id', empresaId)
      .order('nome_completo', { ascending: true });
    if (!error && data) {
      setListaFuncionarios(data);
    }
    setLoadingFunc(false);
  };

  const selecionarFuncionario = (func: FuncionarioBusca) => {
    setEmpresaRecebedora(func.nome_completo);
    setCnpjCpf(func.cpf || '');
    aplicarMascaraCpfCnpj(func.cpf || '');
    setEndereco(func.endereco || '');
    // Funcionário é sempre pessoa física — o CPF acima já serve como
    // signatário; não precisa preencher o campo separado.
    aplicarMascaraCelularSignatario(func.celular || '');
    setTipoPagamento('PIX');

    let tipoMapeado = 'CELULAR';
    const tipoFunc = (func.pix_tipo || '').toUpperCase();
    if (tipoFunc.includes('CPF') || tipoFunc.includes('CNPJ')) tipoMapeado = 'CPF/CNPJ';
    if (tipoFunc.includes('EMAIL') || tipoFunc.includes('E-MAIL')) tipoMapeado = 'EMAIL';
    if (tipoFunc.includes('ALEAT')) tipoMapeado = 'ALEATÓRIO';

    setChavePix(tipoMapeado);
    setDadosPagamento(func.pix_chave || '');
    setModalFuncionarioAberto(false);
  };

  const funcionariosFiltrados = useMemo(() => {
    if (!termoBuscaFunc) return listaFuncionarios;
    const termo = termoBuscaFunc.toLowerCase();
    // Mesmo tratamento do Banco de Talentos: compara CPF só pelos dígitos,
    // já que o cadastro de RH nem sempre grava com a mesma pontuação digitada.
    const termoDigitos = termo.replace(/\D/g, '');
    return listaFuncionarios.filter(f =>
      f.nome_completo.toLowerCase().includes(termo) ||
      (termoDigitos && f.cpf && f.cpf.replace(/\D/g, '').includes(termoDigitos))
    );
  }, [listaFuncionarios, termoBuscaFunc]);

  // ============================================================================
  // ENVIO DO FORMULÁRIO 
  // ============================================================================
  const handleSubmeterFormulario = async () => {
    setLoading(true);
    setUploadStatus('');

    if (!empresaId) {
      setModal({ open: true, success: false, title: 'Atenção', msg: 'Selecione a empresa (Rentech/AlfaLight) desta OP.' });
      setLoading(false);
      return;
    }

    const itensValidos = itens
      .filter(i => i.descricao.trim() !== '' && i.qtd > 0)
      .map(i => ({ descricao: i.descricao.toUpperCase(), qtd: i.qtd, valor_unitario: i.valorUnitario, total: i.qtd * i.valorUnitario }));

    if (itensValidos.length === 0) {
      setModal({ open: true, success: false, title: 'Atenção', msg: 'Adicione pelo menos um item válido com quantidade e valor.' });
      setLoading(false);
      return;
    }

    const cpfSignatarioFinal = favorecidoEhPessoaFisica ? cnpjCpf : cpfSignatario;
    if (cpfSignatarioFinal.replace(/\D/g, '').length !== 11) {
      setModal({ open: true, success: false, title: 'Atenção', msg: 'Informe um CPF válido do signatário — é obrigatório para o envio da assinatura digital.' });
      setLoading(false);
      return;
    }
    if (celularSignatario.replace(/\D/g, '').length < 10) {
      setModal({ open: true, success: false, title: 'Atenção', msg: 'Informe um celular válido do signatário (com DDD) — é obrigatório para o envio da assinatura digital.' });
      setLoading(false);
      return;
    }

    const urlsAnexos: string[] = [];

    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i];
      setUploadStatus(arquivos.length > 1 ? `Fazendo upload do comprovante ${i + 1} de ${arquivos.length}...` : 'Fazendo upload do comprovante...');
      const fileExt = arquivo.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `anexos_ops/${fileName}`;

      const { error: uploadError } = await supabase.storage.from('comprovantes').upload(filePath, arquivo);

      if (uploadError) {
        setModal({ open: true, success: false, title: 'Erro no Anexo', msg: `Falha ao fazer upload de "${arquivo.name}": ${uploadError.message}` });
        setLoading(false);
        return;
      }
      const { data: publicUrlData } = supabase.storage.from('comprovantes').getPublicUrl(filePath);
      urlsAnexos.push(publicUrlData.publicUrl);
    }

    setUploadStatus('Registrando ordem de pagamento...');

    const payload: NovaOPData = {
      responsavel_nome: responsavelNome.toUpperCase() || 'USUÁRIO DO SISTEMA',
      responsavel_email: responsavelEmail,
      natureza_pagamento: natureza,
      empresa_id: empresaId,
      os_numero: osNum.toUpperCase(),
      os_cliente: osCliente.toUpperCase(),
      os_evento: osEvento.toUpperCase(),
      os_periodo: osPeriodo.toUpperCase(),
      empresa_recebedora: empresaRecebedora.toUpperCase(),
      cnpj_cpf_recebedora: cnpjCpf,
      endereco_recebedora: endereco.toUpperCase(),
      cpf_signatario: cpfSignatarioFinal,
      telefone_recebedora: celularSignatario,
      tipo_pagamento: tipoPagamento,
      chave_pix: tipoPagamento === 'PIX' ? chavePix : '',
      dados_pagamento: dadosPagamento, 
      data_vencimento: dataVencimento,
      observacao: obs.toUpperCase(),
      itens: itensValidos,
      total_geral: totalGeral,
      file_url: urlsAnexos[0] || '',
      file_urls: urlsAnexos,
    };

    const resposta = await criarOP(payload, perfil?.accessToken || '');

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

      {/* Modal do Banco de Funcionários (REEMBOLSO) */}
      {modalFuncionarioAberto && (
        <div className="fixed inset-0 z-[8000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-wider text-sm">👷 Buscar no Banco de Funcionários</h3>
              <button onClick={() => setModalFuncionarioAberto(false)} className="text-white hover:text-red-400 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <input
                type="text"
                placeholder="Pesquisar por nome ou CPF..."
                className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] outline-none focus:border-[#336699]"
                value={termoBuscaFunc}
                onChange={(e) => setTermoBuscaFunc(e.target.value)}
              />
            </div>

            <div className="overflow-y-auto flex-grow p-4 bg-white">
              {loadingFunc ? (
                <div className="text-center py-10 text-[#64748B] font-bold text-sm">Carregando funcionários...</div>
              ) : funcionariosFiltrados.length === 0 ? (
                <div className="text-center py-10 text-[#64748B] font-bold text-sm">Nenhum funcionário encontrado.</div>
              ) : (
                <div className="space-y-3">
                  {funcionariosFiltrados.map((func) => (
                    <div key={func.id} className="border border-[#E2E8F0] rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-[#336699] transition-colors">
                      <div>
                        <strong className="block text-sm font-black text-[#0C1D4D]">{func.nome_completo}</strong>
                        <p className="text-xs text-[#64748B] mt-1">CPF: {func.cpf || 'Não info.'} | Cel: {func.celular || 'Não info.'}</p>
                      </div>
                      <button
                        onClick={() => selecionarFuncionario(func)}
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
        
        {/* Cabeçalho — sem logo fixa: a tela é usada por qualquer empresa do grupo (Rentech, AlfaLight, ...) */}
        <div className="bg-[#0C1D4D] p-6 lg:p-8 flex flex-col items-end gap-3 print:bg-transparent print:border-b-2 print:border-black">
          <div className="text-right">
            <h2 className="text-2xl font-black text-white uppercase tracking-wider print:text-black">Ordem de Pagamento</h2>
            <p className="text-[#999999] text-sm font-bold print:text-gray-500">Solicitação Financeira Administrativa</p>
          </div>
          <button
            onClick={() => router.push('/admin/op')}
            className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
          >
            ⬅ VOLTAR AO OP
          </button>
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
              <label className="block text-xs font-bold text-[#64748B] uppercase tracking-wider mb-2">Empresa</label>
              <select
                className="w-full p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-sm text-[#0A2A4A] focus:border-[#00A8E8] outline-none font-semibold cursor-pointer mb-4 disabled:opacity-70 disabled:cursor-not-allowed"
                value={empresaId ?? ''}
                onChange={(e) => setEmpresaId(e.target.value ? Number(e.target.value) : null)}
                disabled={empresasCatalogoVisivel.length <= 1}
              >
                {empresasCatalogoVisivel.length !== 1 && <option value="">Selecione a empresa...</option>}
                {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
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
              {natureza === 'REEMBOLSO' && (
                <button
                  onClick={abrirModalFuncionario}
                  className="bg-[#0C1D4D] text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-[#284B8C] transition-colors flex items-center gap-2 shadow-sm"
                >
                  👷 Autocompletar do Banco de Funcionários
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

            <div className="bg-[#F0F4F8] border border-[#CBD5E1] rounded-xl p-4 space-y-2">
              <p className="text-[10px] font-black text-[#64748B] uppercase tracking-wider">
                ✍️ Assinatura digital (obrigatório — usado pela Autentique para validar e enviar por WhatsApp)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {favorecidoEhPessoaFisica ? (
                  <div className="w-full p-3 bg-white border border-dashed border-[#CBD5E1] rounded-lg text-sm text-[#64748B] font-medium flex items-center">
                    CPF do signatário: <span className="ml-1 font-bold text-[#0A2A4A]">{cnpjCpf}</span> (mesmo do favorecido acima)
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder="CPF DE QUEM VAI ASSINAR (a Autentique não aceita CNPJ)"
                    className="w-full p-3 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] font-bold focus:border-[#336699] outline-none"
                    value={cpfSignatario}
                    onChange={(e) => aplicarMascaraCpfSignatario(e.target.value)}
                  />
                )}
                <input
                  type="text"
                  placeholder="CELULAR DO SIGNATÁRIO (COM DDD)"
                  className="w-full p-3 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] font-bold focus:border-[#336699] outline-none"
                  value={celularSignatario}
                  onChange={(e) => aplicarMascaraCelularSignatario(e.target.value)}
                />
              </div>
            </div>
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
                  multiple
                  onChange={handleFileChange}
                  className="w-full text-sm text-[#64748B] file:mr-4 file:py-2.5 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[#E0F2FE] file:text-[#0369A1] hover:file:bg-[#BAE6FD] cursor-pointer"
                  accept=".pdf, image/*"
                />
                <p className="text-[10px] text-[#94A3B8] mt-1">Formatos aceitos: PDF, JPG, PNG (Max 5MB por arquivo) — pode selecionar mais de um</p>
                {arquivos.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {arquivos.map((f, idx) => (
                      <li key={`${f.name}-${f.lastModified}-${idx}`} className="flex items-center justify-between gap-2 bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 text-xs">
                        <span className="truncate text-[#0A2A4A] font-semibold" title={f.name}>{f.name}</span>
                        <span className="text-[#94A3B8] shrink-0">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                        <button
                          type="button"
                          onClick={() => removerArquivo(idx)}
                          className="shrink-0 text-red-500 hover:text-red-700 font-black px-1"
                          title="Remover"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
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