"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { listarOPs, atualizarOP, dispararEmailOP } from '../actions';
import { listarNaturezasPagamentoParaSelectAction } from '../actions-naturezas';
import { registrarLogAuditoria } from '../../../actions';
import { Analytics } from "@vercel/analytics/next"
import { useAcessoRota } from '../useAcessoRota';
import { normalizarItensOP, ItemOPNormalizado } from '../utils';
import { DialogOP, DialogOPState, BotaoLinkAssinatura } from '../DialogOP';
import { supabase } from '../../../lib/supabase';
import { ehAdministradorGlobal } from '../../../lib/permissoes';
import { buscarColaboradoresParaOpAction, type ColaboradorParaOp } from '../../comercial/parceiros/actions';

// Os itens em memória já chegam normalizados (ver normalizarItensOP) — não há
// mais motivo para este tipo carregar os campos legados (description/quantity)
// de OPs antigas, então reaproveitamos o mesmo tipo canônico de utils.ts.
type ItemOP = ItemOPNormalizado;

// Mesmas interfaces enxutas de /admin/op/nova, reaproveitadas aqui pro botão
// "Puxar dados" no modal de EDIÇÃO — pedido do usuário 2026-09-17: poder
// corrigir uma OP com dados errados (favorecido/CPF/PIX) sem recriar do zero.
interface FreelancerBusca {
  id: string;
  nome: string;
  cpf: string;
  telefone: string;
  pix_chave: string;
  pix_tipo: string;
  endereco: string;
}

interface OP {
  id: string;
  numero_op: number;
  data_criacao: string;
  responsavel_nome: string;
  natureza_pagamento: string;
  os_numero: string;
  os_cliente: string;
  os_evento: string;
  os_periodo: string;
  empresa_id: number | null;
  empresa_recebedora: string;
  // CNPJ/CPF e endereço do favorecido — existem em NovaOPData/op_ordens_pagamento
  // desde sempre, mas esta tela nunca expunha pra edição (só a de criação,
  // /admin/op/nova). Adicionados junto com chave_pix/banco_* pra permitir
  // corrigir uma OP com dados errados sem precisar recriar do zero.
  cnpj_cpf_recebedora?: string;
  endereco_recebedora?: string;
  cpf_signatario?: string;
  telefone_recebedora?: string;
  tipo_pagamento: string;
  // Tipo da chave Pix (CELULAR/EMAIL/CPF/CNPJ/ALEATÓRIO) — dados_pagamento
  // guarda o VALOR da chave, chave_pix guarda o TIPO (nomes invertidos em
  // relação ao que se esperaria, mesmo padrão de /admin/op/nova). Importa
  // pro envio via API do Itaú (Financeiro RH): sem o tipo certo, a chave não
  // é formatada corretamente antes de mandar pro banco (ex.: celular sem o
  // "+55" na frente é rejeitado pelo DICT).
  chave_pix: string;
  dados_pagamento: string;
  // Só usados quando tipo_pagamento = TRANSFERÊNCIA — mesmas 4 colunas de
  // folha_funcionarios, pra a OP entrar no lote automático do Financeiro RH.
  banco_codigo?: string | null;
  banco_agencia?: string | null;
  banco_conta?: string | null;
  banco_tipo?: string | null;
  total_geral: number;
  data_vencimento: string;
  observacao: string;
  status: string;
  itens: ItemOP[];
  recibo_url?: string;      // Adicionado para suportar a assinatura
  data_assinatura?: string; // Adicionado para suportar a assinatura
}

export default function PainelResponsavel() {
  const router = useRouter();

  // Sessão + permissão da rota, resolvidas pelo hook compartilhado do módulo.
  const { authLoading, acessoNegado, perfil } = useAcessoRota('/admin/op/responsavel');

  // Estados Principais
  const [ops, setOps] = useState<OP[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados de Filtro
  const [busca, setBusca] = useState('');
  const [filtroResponsavel, setFiltroResponsavel] = useState('');
  const [filtroFavorecido, setFiltroFavorecido] = useState('');
  const [filtroEmpresa, setFiltroEmpresa] = useState<number | null>(null);

  // Empresa(s) que o usuário pode enxergar (Rentech × AlfaLight): só quem é
  // literalmente "Administrador" (ehAdministradorGlobal) vê todas — Diretoria/
  // Gerência/demais ficam restritos ao vínculo em perfis_usuarios_empresas,
  // igual ao resto do sistema.
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);
  // Catálogo de Natureza do Pagamento (op_naturezas_pagamento — gerido em
  // /admin/op/naturezas), usado no select de edição da OP.
  const [naturezasDisponiveis, setNaturezasDisponiveis] = useState<string[]>([]);

  // Estados de Modais
  const [modalDetalhes, setModalDetalhes] = useState<{ open: boolean; op: OP | null }>({ open: false, op: null });
  const [modalEdit, setModalEdit] = useState<{ open: boolean; op: Partial<OP> | null }>({ open: false, op: null });
  const [dialog, setDialog] = useState<DialogOPState>({ open: false, type: 'loading', title: '', msg: '' });

  // Modais e Estados da Busca de Freelancers/Colaboradores — só usados
  // dentro do modal de EDIÇÃO, pra "puxar dados" e corrigir uma OP errada.
  const [modalFreelanceAberto, setModalFreelanceAberto] = useState(false);
  const [listaFreelancers, setListaFreelancers] = useState<FreelancerBusca[]>([]);
  const [termoBuscaFree, setTermoBuscaFree] = useState('');
  const [loadingFree, setLoadingFree] = useState(false);

  const [modalColaboradorAberto, setModalColaboradorAberto] = useState(false);
  const [listaColaboradores, setListaColaboradores] = useState<ColaboradorParaOp[]>([]);
  const [termoBuscaColaborador, setTermoBuscaColaborador] = useState('');
  const [loadingColaborador, setLoadingColaborador] = useState(false);

  // Busca de dados — só executa depois que o hook resolve sessão + permissão.
  const carregarDados = async (tokenOverride?: string) => {
    const token = tokenOverride || perfil?.accessToken;
    if (!token) return;
    setLoading(true);
    const res = await listarOPs(token, '/admin/op/responsavel');
    if (res.success && res.data) {
      const opsNormalizadas = res.data.map((op: any) => ({ ...op, itens: normalizarItensOP(op.itens) }));
      setOps(opsNormalizadas);
    } else if (!res.success) {
      // Antes uma falha aqui (sessão expirada, permissão negada etc.) ficava
      // muda — a tela só mostrava "Nenhuma OP encontrada", indistinguível de
      // realmente não haver OPs.
      setDialog({ open: true, type: 'error', title: 'Erro ao Carregar', msg: res.message || 'Não foi possível carregar as suas Ordens de Pagamento.' });
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && perfil) carregarDados(perfil.accessToken);
  }, [authLoading, perfil]);

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

  useEffect(() => {
    if (!perfil) return;
    async function carregarNaturezas() {
      const res = await listarNaturezasPagamentoParaSelectAction(perfil!.accessToken);
      if (res.ok && res.info.naturezas.length > 0) setNaturezasDisponiveis(res.info.naturezas);
    }
    carregarNaturezas();
  }, [perfil]);

  const empresasCatalogoVisivel = useMemo(() =>
    empresasPermitidas === null
      ? empresasCatalogo
      : empresasCatalogo.filter(e => empresasPermitidas.includes(e.id)),
    [empresasCatalogo, empresasPermitidas]);

  // Se só existe uma empresa visível, trava o filtro nela.
  useEffect(() => {
    if (empresasCatalogoVisivel.length === 1) {
      setFiltroEmpresa(empresasCatalogoVisivel[0].id);
    }
  }, [empresasCatalogoVisivel]);

  // Listas únicas para dropdowns
  const responsaveisUnicos = useMemo(() => {
    const nomes = ops.map(op => (op.responsavel_nome || '').toUpperCase().trim()).filter(Boolean);
    return [...new Set(nomes)].sort();
  }, [ops]);

  const favorecidosUnicos = useMemo(() => {
    const favorecidos = ops.map(op => (op.empresa_recebedora || '').toUpperCase().trim()).filter(Boolean);
    return [...new Set(favorecidos)].sort();
  }, [ops]);

  // OPs filtradas
  const opsFiltradas = useMemo(() => {
    const termo = busca.toLowerCase().trim();
    return ops.filter((op) => {
      const matchBusca = !termo || [
        String(op.numero_op),
        op.os_numero, op.os_cliente, op.responsavel_nome,
        op.os_evento, op.os_periodo,
        op.natureza_pagamento, op.empresa_recebedora, op.status,
      ].some((campo) => (campo || '').toLowerCase().includes(termo));

      const nomeResponsavelLimpo = (op.responsavel_nome || '').toUpperCase().trim();
      const matchResponsavel = !filtroResponsavel || nomeResponsavelLimpo === filtroResponsavel;

      const nomeFavorecidoLimpo = (op.empresa_recebedora || '').toUpperCase().trim();
      const matchFavorecido = !filtroFavorecido || nomeFavorecidoLimpo === filtroFavorecido;

      // OPs antigas (anteriores à coluna empresa_id) ficam com empresa_id
      // nulo — tratadas como visíveis independente do filtro, mesmo critério
      // já usado no resto do sistema (empresaPermitida em app/lib/serverAuth.ts).
      const matchEmpresa = !filtroEmpresa || op.empresa_id == null || op.empresa_id === filtroEmpresa;

      return matchBusca && matchResponsavel && matchFavorecido && matchEmpresa;
    });
  }, [ops, busca, filtroResponsavel, filtroFavorecido, filtroEmpresa]);

  const limparFiltros = () => {
    setBusca('');
    setFiltroResponsavel('');
    setFiltroFavorecido('');
    // Só libera "Todas" se o usuário de fato tem mais de uma empresa — senão
    // o filtro fica travado e não é uma opção pra limpar.
    if (empresasCatalogoVisivel.length > 1) setFiltroEmpresa(null);
  };

  const filtrosAtivos = busca || filtroResponsavel || filtroFavorecido || (empresasCatalogoVisivel.length > 1 && filtroEmpresa);

  // Utilitários
  const formatarMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatarData = (d: string) => d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '---';

  // Lógica de edição
  const abrirEdicao = (op: OP) => {
    const copiaOp = JSON.parse(JSON.stringify(op));
    if (!copiaOp.itens || copiaOp.itens.length === 0)
      copiaOp.itens = [{ descricao: '', qtd: 0, valor_unitario: 0, total: 0 }];
    setModalEdit({ open: true, op: copiaOp });
  };

  const updateEditField = (field: keyof OP, value: any) => {
    if (modalEdit.op) setModalEdit({ ...modalEdit, op: { ...modalEdit.op, [field]: value } });
  };

  const updateEditItem = (index: number, field: keyof ItemOP, value: any) => {
    if (!modalEdit.op || !modalEdit.op.itens) return;
    const novosItens = [...modalEdit.op.itens];
    novosItens[index] = { ...novosItens[index], [field]: value };
    if (field === 'qtd' || field === 'valor_unitario')
      novosItens[index].total = (novosItens[index].qtd || 0) * (novosItens[index].valor_unitario || 0);
    setModalEdit({ ...modalEdit, op: { ...modalEdit.op, itens: novosItens } });
  };

  const addEditItem = () => {
    if (modalEdit.op?.itens)
      setModalEdit({ ...modalEdit, op: { ...modalEdit.op, itens: [...modalEdit.op.itens, { descricao: '', qtd: 0, valor_unitario: 0, total: 0 }] } });
  };

  const removeEditItem = (index: number) => {
    if (modalEdit.op?.itens && modalEdit.op.itens.length > 1) {
      const novosItens = modalEdit.op.itens.filter((_, i) => i !== index);
      setModalEdit({ ...modalEdit, op: { ...modalEdit.op, itens: novosItens } });
    }
  };

  const totalEdit = useMemo(() =>
    modalEdit.op?.itens?.reduce((acc, curr) => acc + (curr.total || 0), 0) || 0
  , [modalEdit.op?.itens]);

  const mascaraCpfCnpj = (valor: string) => {
    let v = valor.replace(/\D/g, '');
    if (v.length <= 11) {
      v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    } else {
      v = v.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
    }
    return v;
  };
  const mascaraCelular = (valor: string) =>
    valor.replace(/\D/g, '').slice(0, 11).replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');

  // ============================================================================
  // "PUXAR DADOS" NO MODAL DE EDIÇÃO — Banco de Talentos (freelancers) e
  // Banco de Colaboradores (folha_funcionarios), pra corrigir favorecido/CPF/PIX errados sem
  // recriar a OP. Mesma lógica de /admin/op/nova, adaptada pra escrever em
  // modalEdit.op via updateEditField em vez de setters individuais.
  // ============================================================================
  const abrirModalFreelance = async () => {
    setModalFreelanceAberto(true);
    setLoadingFree(true);
    const { data, error } = await supabase.from('freelancers')
      .select('id, nome, cpf, telefone, pix_chave, pix_tipo, endereco')
      .order('created_at', { ascending: false }).limit(5000);
    if (!error && data) setListaFreelancers(data);
    setLoadingFree(false);
  };

  const selecionarFreelancer = (free: FreelancerBusca) => {
    if (!modalEdit.op) return;
    let tipoMapeado = 'CELULAR';
    const tipoFree = (free.pix_tipo || '').toUpperCase();
    if (tipoFree.includes('CPF') || tipoFree.includes('CNPJ')) tipoMapeado = 'CPF/CNPJ';
    if (tipoFree.includes('EMAIL') || tipoFree.includes('E-MAIL')) tipoMapeado = 'EMAIL';
    if (tipoFree.includes('ALEAT')) tipoMapeado = 'ALEATÓRIO';

    setModalEdit({
      ...modalEdit,
      op: {
        ...modalEdit.op,
        empresa_recebedora: free.nome,
        cnpj_cpf_recebedora: mascaraCpfCnpj(free.cpf || ''),
        endereco_recebedora: free.endereco || '',
        // Freelancer é sempre pessoa física — o CPF acima já serve como signatário.
        cpf_signatario: mascaraCpfCnpj(free.cpf || ''),
        telefone_recebedora: mascaraCelular(free.telefone || ''),
        tipo_pagamento: 'PIX',
        chave_pix: tipoMapeado,
        dados_pagamento: free.pix_chave || '',
      },
    });
    setModalFreelanceAberto(false);
  };

  const freelancersFiltrados = useMemo(() => {
    if (!termoBuscaFree) return listaFreelancers;
    const termo = termoBuscaFree.toLowerCase();
    const termoDigitos = termo.replace(/\D/g, '');
    return listaFreelancers.filter(f =>
      f.nome.toLowerCase().includes(termo) ||
      (termoDigitos && f.cpf && f.cpf.replace(/\D/g, '').includes(termoDigitos))
    );
  }, [listaFreelancers, termoBuscaFree]);

  const abrirModalColaborador = async () => {
    if (!perfil?.accessToken) return;
    setModalColaboradorAberto(true);
    setLoadingColaborador(true);
    const res = await buscarColaboradoresParaOpAction(perfil.accessToken);
    if (res.ok) setListaColaboradores(res.info.registros);
    else setDialog({ open: true, type: 'error', title: 'Erro', msg: 'Não foi possível carregar o Banco de Colaboradores: ' + res.erro });
    setLoadingColaborador(false);
  };

  // buscarColaboradoresParaOpAction busca só em folha_funcionarios (nossa
  // própria base, não o PrimeStart) — aqui é só aplicar o registro escolhido.
  const selecionarColaborador = (col: ColaboradorParaOp) => {
    if (!modalEdit.op) return;
    const temPix = !!col.pix_chave;
    const temContaBancaria = !!(col.banco_codigo && col.banco_agencia && col.banco_conta);
    let tipoMapeado = 'CELULAR';
    if (temPix) {
      const tipoPix = (col.pix_tipo || '').toUpperCase();
      if (tipoPix.includes('CPF') || tipoPix.includes('CNPJ')) tipoMapeado = 'CPF/CNPJ';
      if (tipoPix.includes('EMAIL') || tipoPix.includes('E-MAIL')) tipoMapeado = 'EMAIL';
      if (tipoPix.includes('ALEAT')) tipoMapeado = 'ALEATÓRIO';
    }

    setModalEdit(atual => atual.op ? {
      ...atual,
      op: {
        ...atual.op,
        empresa_recebedora: col.nome,
        cnpj_cpf_recebedora: mascaraCpfCnpj(col.cpf || ''),
        endereco_recebedora: col.endereco || '',
        cpf_signatario: mascaraCpfCnpj(col.cpf || ''),
        telefone_recebedora: mascaraCelular(col.telefone || ''),
        ...(temPix
          ? { tipo_pagamento: 'PIX', chave_pix: tipoMapeado, dados_pagamento: col.pix_chave || '' }
          : temContaBancaria
            ? { tipo_pagamento: 'TRANSFERÊNCIA', banco_tipo: col.banco_tipo || 'CORRENTE', banco_codigo: col.banco_codigo, banco_agencia: col.banco_agencia, banco_conta: col.banco_conta, dados_pagamento: '' }
            : {}),
      },
    } : atual);
    setModalColaboradorAberto(false);

    setDialog({
      open: true,
      type: (temPix || temContaBancaria) ? 'success' : 'error',
      title: (temPix || temContaBancaria) ? 'Dados Importados' : 'Sem PIX/Conta Cadastrados',
      msg: (temPix || temContaBancaria)
        ? 'Nome/CPF/endereço preenchidos e PIX/conta encontrados no cadastro de funcionário.'
        : 'Nome/CPF/endereço preenchidos. Sem PIX/conta cadastrados na folha — preencha manualmente.',
    });
  };

  const colaboradoresFiltrados = useMemo(() => {
    if (!termoBuscaColaborador) return listaColaboradores;
    const termo = termoBuscaColaborador.toLowerCase();
    const termoDigitos = termo.replace(/\D/g, '');
    return listaColaboradores.filter(c =>
      c.nome.toLowerCase().includes(termo) ||
      (termoDigitos && c.cpf && c.cpf.replace(/\D/g, '').includes(termoDigitos))
    );
  }, [listaColaboradores, termoBuscaColaborador]);

  const salvarEdicao = async () => {
    if (!modalEdit.op?.id || !perfil) return;
    // Grava só os campos canônicos (descricao/qtd/valor_unitario/total) — os
    // nomes legados em inglês (description/quantity) de OPs antigas não
    // precisam mais ser replicados a cada edição; normalizarItensOP já sabe
    // ler ambos os formatos na leitura.
    const itensValidos = modalEdit.op.itens?.filter(i => i.descricao.trim() !== '' && i.qtd > 0).map(i => ({
      descricao: i.descricao,
      qtd: i.qtd,
      valor_unitario: i.valor_unitario,
      total: i.total,
    }));
    if (!itensValidos || itensValidos.length === 0) {
      setDialog({ open: true, type: 'error', title: 'Atenção', msg: 'A OP precisa ter pelo menos um item válido com quantidade e valor.' });
      return;
    }
    setDialog({ open: true, type: 'loading', title: 'Salvando...', msg: 'Atualizando as informações no banco de dados.' });
    const payloadAtualizacao = {
      os_cliente: modalEdit.op.os_cliente, os_evento: modalEdit.op.os_evento,
      os_periodo: modalEdit.op.os_periodo, natureza_pagamento: modalEdit.op.natureza_pagamento,
      empresa_recebedora: modalEdit.op.empresa_recebedora,
      cnpj_cpf_recebedora: modalEdit.op.cnpj_cpf_recebedora, endereco_recebedora: modalEdit.op.endereco_recebedora,
      tipo_pagamento: modalEdit.op.tipo_pagamento,
      chave_pix: modalEdit.op.chave_pix,
      dados_pagamento: modalEdit.op.dados_pagamento, data_vencimento: modalEdit.op.data_vencimento,
      banco_codigo: modalEdit.op.banco_codigo, banco_agencia: modalEdit.op.banco_agencia,
      banco_conta: modalEdit.op.banco_conta, banco_tipo: modalEdit.op.banco_tipo,
      observacao: modalEdit.op.observacao, itens: itensValidos, total_geral: totalEdit,
      cpf_signatario: modalEdit.op.cpf_signatario, telefone_recebedora: modalEdit.op.telefone_recebedora,
    };
    const res = await atualizarOP(modalEdit.op.id, payloadAtualizacao, perfil.accessToken);
    if (res.success) {
      setModalEdit({ open: false, op: null });
      setDialog({ open: true, type: 'success', title: 'Concluído!', msg: 'Ordem de Pagamento atualizada com sucesso.' });
      carregarDados();
    } else {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: res.message });
    }
  };

  const solicitarCopia = async (op: OP) => {
    if (!perfil) return;
    setDialog({ open: true, type: 'loading', title: 'Enviando...', msg: 'Enviando cópia para o seu e-mail.' });

    // O destinatário agora é sempre decidido no servidor (e-mail do usuário
    // autenticado que fez a chamada) — nunca de um valor vindo do cliente.
    const res = await dispararEmailOP(op.id, perfil.accessToken, true);
    if (res.success) {
      registrarLogAuditoria({
        usuario_nome: perfil.nome,
        acao: 'SOLICITOU CÓPIA DA OP POR E-MAIL',
        setor: 'OP',
        equipamento_id: op.id,
        equipamento_nome: `OP #${op.numero_op} — OS ${op.os_numero || 'S/N'}`,
      });
      setDialog({ open: true, type: 'success', title: 'Cópia Enviada', msg: `A cópia foi enviada para ${perfil.email || 'o seu e-mail cadastrado'}.` });
    } else {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: res.message || 'Falha ao enviar e-mail.' });
    }
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o painel de Minhas OPs.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      {/* HEADER */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          👤 <strong>Olá, {perfil.nome || 'Usuário'}</strong>.{' '}
          {perfil.altaGestao
            ? 'Você tem visão administrativa sobre todas as OPs do sistema.'
            : 'Estas são as solicitações sob sua responsabilidade.'}
        </p>
        <button
          onClick={() => router.push('/admin/op')}
          className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
        >
          ⬅ VOLTAR AO OP
        </button>
      </div>

      {/* BARRA DE FILTROS */}
      <div className="px-4 md:px-8 pt-5 pb-3 flex-shrink-0">
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm px-4 py-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Buscar por Nº da OP, OS, cliente, evento, período, natureza..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] focus:ring-1 focus:ring-[#336699]/30 transition-all placeholder:text-[#94A3B8]"
            />
          </div>

          <select
            value={filtroEmpresa ?? ''}
            onChange={(e) => setFiltroEmpresa(e.target.value ? Number(e.target.value) : null)}
            disabled={empresasCatalogoVisivel.length <= 1}
            className="py-2.5 px-3 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] focus:ring-1 focus:ring-[#336699]/30 transition-all text-[#0A2A4A] bg-white md:w-52 shrink-0 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {empresasCatalogoVisivel.length !== 1 && <option value="">🏭 Todas as empresas</option>}
            {empresasCatalogoVisivel.map((e) => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>

          <select
            value={filtroResponsavel}
            onChange={(e) => setFiltroResponsavel(e.target.value)}
            className="py-2.5 px-3 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] focus:ring-1 focus:ring-[#336699]/30 transition-all text-[#0A2A4A] bg-white md:w-52 shrink-0"
          >
            <option value="">👤 Todos os responsáveis</option>
            {responsaveisUnicos.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          <select
            value={filtroFavorecido}
            onChange={(e) => setFiltroFavorecido(e.target.value)}
            className="py-2.5 px-3 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] focus:ring-1 focus:ring-[#336699]/30 transition-all text-[#0A2A4A] bg-white md:w-52 shrink-0"
          >
            <option value="">🏢 Todos os favorecidos</option>
            {favorecidosUnicos.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          {filtrosAtivos && (
            <button
              onClick={limparFiltros}
              className="shrink-0 py-2.5 px-4 bg-red-50 border border-red-200 text-red-500 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-red-100 transition-colors"
            >
              ✕ Limpar
            </button>
          )}
        </div>
        <p className="text-[11px] text-[#94A3B8] font-medium mt-2 ml-1">
          {filtrosAtivos
            ? `${opsFiltradas.length} de ${ops.length} OPs encontradas`
            : `${ops.length} OPs no total`}
        </p>
      </div>

      {/* TABELA RECALIBRADA */}
      <div className="px-4 md:px-8 pb-6 flex-grow overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
          <table className="w-full text-left border-collapse min-w-[920px]">
            <thead className="bg-[#F8FAFC] sticky top-0 shadow-sm z-10">
              <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                <th className="p-2.5 border-b-2 border-[#E2E8F0] w-20">Data OP</th>
                <th className="p-2.5 border-b-2 border-[#E2E8F0] w-16">Nº OP</th>
                <th className="p-2.5 border-b-2 border-[#E2E8F0] min-w-[120px] max-w-[135px]">OS / Evento / Período</th>
                <th className="p-2.5 border-b-2 border-[#E2E8F0] w-28">Responsável</th>
                <th className="p-2.5 border-b-2 border-[#E2E8F0] min-w-[100px] max-w-[120px]">Cliente</th>
                <th className="p-2.5 border-b-2 border-[#E2E8F0] min-w-[130px] max-w-[150px]">Natureza / Descrição</th>
                <th className="p-2.5 border-b-2 border-[#E2E8F0] min-w-[110px] max-w-[130px]">Favorecido</th>
                <th className="p-2.5 border-b-2 border-[#E2E8F0] w-24">Valor Total</th>
                <th className="p-2.5 border-b-2 border-[#E2E8F0] w-24">Status</th>
                <th className="p-2.5 border-b-2 border-[#E2E8F0] w-28 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {loading ? (
                <tr><td colSpan={10} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Buscando as solicitações...</td></tr>
              ) : opsFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12">
                    <p className="text-[#94A3B8] font-bold text-sm">Nenhuma OP encontrada.</p>
                    {filtrosAtivos && (
                      <button onClick={limparFiltros} className="mt-3 text-[#336699] font-bold text-xs underline">
                        Limpar filtros
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                opsFiltradas.map((op) => {
                  const isPago = op.status.includes('PAGO');
                  return (
                    <tr key={op.id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="p-2.5 font-semibold text-[#94A3B8] whitespace-nowrap">{formatarData(op.data_criacao)}</td>
                      <td className="p-2.5 font-black text-[#0C1D4D]">#{op.numero_op}</td>
                      <td className="p-2.5">
                        <span className="bg-[#E0F2FE] text-[#0369A1] font-bold px-2 py-1 rounded-md text-xs whitespace-nowrap inline-block mb-1">{op.os_numero || 'S/N'}</span>
                        <div className="text-xs text-[#64748B] font-semibold truncate max-w-[120px]" title={op.os_evento}>{op.os_evento || '—'}</div>
                        <div className="text-xs text-[#94A3B8] truncate max-w-[120px]" title={op.os_periodo}>{op.os_periodo || '—'}</div>
                      </td>
                      <td className="p-2.5 font-bold text-[#336699] truncate max-w-[110px]" title={op.responsavel_nome}>{op.responsavel_nome}</td>
                      <td className="p-2.5 font-bold truncate max-w-[120px]" title={op.os_cliente}>{op.os_cliente}</td>
                      <td className="p-2.5">
                        <div className="font-semibold text-[#0A2A4A] truncate max-w-[150px] mb-1">{op.natureza_pagamento}</div>
                        <button onClick={() => setModalDetalhes({ open: true, op })} className="text-[9px] font-black uppercase tracking-wider text-[#336699] hover:underline">Ver Detalhes</button>
                      </td>
                      <td className="p-2.5 font-bold text-[#64748B] truncate max-w-[130px]" title={op.empresa_recebedora}>{op.empresa_recebedora}</td>
                      <td className="p-2.5 font-black text-[#0C1D4D] whitespace-nowrap">{formatarMoeda(op.total_geral)}</td>
                      <td className="p-2.5">
                        <span className={`px-2 py-1 rounded-full text-[9px] font-black tracking-wider whitespace-nowrap ${op.status.includes('ASSINADO') ? 'bg-purple-100 text-purple-700 border border-purple-200' : isPago ? 'bg-green-100 text-green-700 border border-green-200' : op.status === 'REPROVADA' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-orange-100 text-orange-700 border border-orange-200'}`}>
                          {op.status}
                        </span>
                      </td>
                      <td className="p-2.5">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          <button
                            onClick={() => abrirEdicao(op)}
                            disabled={isPago}
                            title="Editar"
                            className="w-8 h-8 flex items-center justify-center bg-amber-100 border border-amber-300 text-amber-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-200 shrink-0"
                          >
                            ✏️
                          </button>

                          <BotaoLinkAssinatura opId={op.id} />

                          {op.recibo_url && (
                            <a href={op.recibo_url} target="_blank" rel="noreferrer" title="Ver Assinatura" className="w-8 h-8 flex items-center justify-center bg-purple-100 hover:bg-purple-200 border border-purple-300 text-purple-700 rounded transition-colors shadow-sm shrink-0">
                              👁️
                            </a>
                          )}

                          <button
                            onClick={() => solicitarCopia(op)}
                            title="Receber Cópia"
                            className="w-8 h-8 flex items-center justify-center bg-[#F0F4F8] border border-[#CBD5E1] text-[#64748B] rounded transition-colors hover:bg-[#E2E8F0] shrink-0"
                          >
                            📩
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: VER DETALHES */}
      {modalDetalhes.open && modalDetalhes.op && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="bg-[#336699] p-4 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-wider text-sm">Resumo da Solicitação #{modalDetalhes.op.numero_op}</h3>
              <button onClick={() => setModalDetalhes({ open: false, op: null })} className="text-white hover:text-red-400 text-xl leading-none">&times;</button>
            </div>
            <div className="p-6">
              <div className="space-y-2 mb-4">
                <div className="text-sm font-bold text-[#0A2A4A] border-b border-[#E2E8F0] pb-1 flex justify-between">
                  <span>Itens Solicitados</span><span>Total</span>
                </div>
                {modalDetalhes.op.itens?.map((it, idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs py-1 border-b border-dashed border-[#F1F5F9]">
                    <span className="text-[#64748B] font-semibold uppercase">{it.descricao} <span className="font-normal">(x{it.qtd})</span></span>
                    <strong className="text-[#0C1D4D]">{formatarMoeda(it.total)}</strong>
                  </div>
                ))}
              </div>
              <div className="text-right text-xl font-black text-[#336699] pt-2">
                TOTAL: {formatarMoeda(modalDetalhes.op.total_geral)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Banco de Talentos (freelancers) — "puxar dados" dentro da EDIÇÃO */}
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

      {/* MODAL: Banco de Colaboradores (folha_funcionarios) — "puxar dados" dentro da EDIÇÃO */}
      {modalColaboradorAberto && (
        <div className="fixed inset-0 z-[8000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-wider text-sm">🪪 Buscar no Banco de Colaboradores</h3>
              <button onClick={() => setModalColaboradorAberto(false)} className="text-white hover:text-red-400 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <input
                type="text"
                placeholder="Pesquisar por nome ou CPF..."
                className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] outline-none focus:border-[#336699]"
                value={termoBuscaColaborador}
                onChange={(e) => setTermoBuscaColaborador(e.target.value)}
              />
              <p className="text-[10px] text-[#94A3B8] font-semibold mt-2">
                ℹ Nome/CPF/endereço/celular vêm do PrimeStart e/ou da folha. PIX/conta bancária vêm da folha quando cadastrados.
              </p>
            </div>
            <div className="overflow-y-auto flex-grow p-4 bg-white">
              {loadingColaborador ? (
                <div className="text-center py-10 text-[#64748B] font-bold text-sm">Carregando colaboradores...</div>
              ) : colaboradoresFiltrados.length === 0 ? (
                <div className="text-center py-10 text-[#64748B] font-bold text-sm">Nenhum colaborador encontrado.</div>
              ) : (
                <div className="space-y-3">
                  {colaboradoresFiltrados.map((col) => (
                    <div key={col.chave} className="border border-[#E2E8F0] rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-[#336699] transition-colors">
                      <div>
                        <strong className="block text-sm font-black text-[#0C1D4D]">{col.nome}</strong>
                        <p className="text-xs text-[#64748B] mt-1">CPF: {col.cpf || 'Não info.'} | Cel: {col.telefone || 'Não info.'}</p>
                        {(col.pix_chave || col.banco_conta) && (
                          <p className="text-[10px] text-emerald-600 mt-1 font-bold">✓ PIX/conta cadastrados (folha)</p>
                        )}
                      </div>
                      <button
                        onClick={() => selecionarColaborador(col)}
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

      {/* MODAL: EDIÇÃO */}
      {modalEdit.open && modalEdit.op && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto py-10">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden mb-10 relative">
            <div className="bg-amber-500 p-5 flex justify-between items-center text-white sticky top-0 z-10">
              <h3 className="font-black uppercase tracking-wider text-sm">✏️ Editando OP #{modalEdit.op.numero_op} - OS: {modalEdit.op.os_numero}</h3>
              <button onClick={() => setModalEdit({ open: false, op: null })} className="text-white hover:text-red-900 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <h4 className="text-[10px] font-black uppercase text-white bg-[#0A2A4A] inline-block px-3 py-1 rounded mb-3">Dados do Evento e Cliente</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">CLIENTE</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.os_cliente || ''} onChange={e => updateEditField('os_cliente', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">EVENTO</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.os_evento || ''} onChange={e => updateEditField('os_evento', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">PERÍODO</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.os_periodo || ''} onChange={e => updateEditField('os_periodo', e.target.value)} /></div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] mb-1">NATUREZA</label>
                    <select className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm outline-none focus:border-[#336699] text-[#0A2A4A]" value={modalEdit.op.natureza_pagamento || ''} onChange={e => updateEditField('natureza_pagamento', e.target.value)}>
                      {/* A natureza atual da OP pode ter sido excluída do catálogo depois de
                          criada — inclui ela mesma na lista pra não sumir do select nesse caso. */}
                      {[...new Set([...(modalEdit.op.natureza_pagamento ? [modalEdit.op.natureza_pagamento] : []), ...naturezasDisponiveis])].map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                  <h4 className="text-[10px] font-black uppercase text-white bg-[#0A2A4A] inline-block px-3 py-1 rounded">Financeiro e Pagamento</h4>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={abrirModalFreelance} className="bg-[#0C1D4D] text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-[#284B8C] transition-colors flex items-center gap-2 shadow-sm">
                      👷 Puxar do Banco de Talentos
                    </button>
                    <button type="button" onClick={abrirModalColaborador} className="bg-white text-[#0C1D4D] border border-[#CBD5E1] px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-[#F0F4F8] transition-colors flex items-center gap-2 shadow-sm">
                      🪪 Puxar do Banco de Colaboradores
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">FAVORECIDO</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm font-bold outline-none focus:border-[#336699]" value={modalEdit.op.empresa_recebedora || ''} onChange={e => updateEditField('empresa_recebedora', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">CNPJ OU CPF</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm font-bold outline-none focus:border-[#336699]" value={modalEdit.op.cnpj_cpf_recebedora || ''} onChange={e => updateEditField('cnpj_cpf_recebedora', mascaraCpfCnpj(e.target.value))} /></div>
                  <div className="md:col-span-2"><label className="block text-[10px] font-bold text-[#64748B] mb-1">ENDEREÇO (OPCIONAL)</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.endereco_recebedora || ''} onChange={e => updateEditField('endereco_recebedora', e.target.value)} /></div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] mb-1">FORMA</label>
                    <select className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm outline-none focus:border-[#336699]" value={modalEdit.op.tipo_pagamento || 'PIX'} onChange={e => updateEditField('tipo_pagamento', e.target.value)}>
                      <option value="PIX">PIX</option><option value="BOLETO">BOLETO</option><option value="TRANSFERÊNCIA">TRANSFERÊNCIA</option><option value="DINHEIRO">DINHEIRO</option>
                    </select>
                  </div>
                  {modalEdit.op.tipo_pagamento === 'PIX' && (
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] mb-1">TIPO DE CHAVE</label>
                      <select className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm outline-none focus:border-[#336699]" value={modalEdit.op.chave_pix || 'CELULAR'} onChange={e => updateEditField('chave_pix', e.target.value)}>
                        <option value="CELULAR">CELULAR</option>
                        <option value="EMAIL">E-MAIL</option>
                        <option value="CPF/CNPJ">CPF / CNPJ</option>
                        <option value="ALEATÓRIO">CHAVE ALEATÓRIA</option>
                      </select>
                    </div>
                  )}
                  {modalEdit.op.tipo_pagamento === 'TRANSFERÊNCIA' ? (
                    <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-[#64748B] mb-1">TIPO DE CONTA</label>
                        <select className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm outline-none focus:border-[#336699]" value={modalEdit.op.banco_tipo || 'CORRENTE'} onChange={e => updateEditField('banco_tipo', e.target.value)}>
                          <option value="CORRENTE">Corrente</option>
                          <option value="POUPANCA">Poupança</option>
                        </select>
                      </div>
                      <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">BANCO (CÓDIGO)</label><input type="text" placeholder="341" className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm font-bold outline-none focus:border-[#336699]" value={modalEdit.op.banco_codigo || ''} onChange={e => updateEditField('banco_codigo', e.target.value)} /></div>
                      <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">AGÊNCIA</label><input type="text" placeholder="0000" className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm font-bold outline-none focus:border-[#336699]" value={modalEdit.op.banco_agencia || ''} onChange={e => updateEditField('banco_agencia', e.target.value)} /></div>
                      <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">CONTA</label><input type="text" placeholder="00000-0" className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm font-bold outline-none focus:border-[#336699]" value={modalEdit.op.banco_conta || ''} onChange={e => updateEditField('banco_conta', e.target.value)} /></div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] mb-1">{modalEdit.op.tipo_pagamento === 'PIX' ? 'CHAVE PIX' : 'DADOS BANCÁRIOS'}</label>
                      <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.dados_pagamento || ''} onChange={e => updateEditField('dados_pagamento', e.target.value)} />
                    </div>
                  )}
                  <div><label className="block text-[10px] font-bold text-red-500 mb-1">VENCIMENTO</label><input type="date" className="w-full p-2.5 border border-red-300 rounded text-sm outline-none focus:border-red-500 font-bold" value={modalEdit.op.data_vencimento || ''} onChange={e => updateEditField('data_vencimento', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">CPF DO SIGNATÁRIO (ASSINATURA DIGITAL)</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm outline-none focus:border-[#336699] font-bold" value={modalEdit.op.cpf_signatario || ''} onChange={e => updateEditField('cpf_signatario', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">CELULAR DO SIGNATÁRIO (ASSINATURA DIGITAL)</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm outline-none focus:border-[#336699] font-bold" value={modalEdit.op.telefone_recebedora || ''} onChange={e => updateEditField('telefone_recebedora', e.target.value)} /></div>
                </div>
              </div>
              <div>
                <h4 className="text-[10px] font-black uppercase text-white bg-[#0A2A4A] inline-block px-3 py-1 rounded mb-3">Detalhamento de Itens</h4>
                <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#F8FAFC]">
                      <tr>
                        <th className="p-3 border-b border-[#E2E8F0] w-1/2">Descrição</th>
                        <th className="p-3 border-b border-[#E2E8F0] w-20 text-center">Qtd</th>
                        <th className="p-3 border-b border-[#E2E8F0] w-32">Unitário (R$)</th>
                        <th className="p-3 border-b border-[#E2E8F0] w-12 text-center">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {modalEdit.op.itens?.map((it, idx) => (
                        <tr key={idx}>
                          <td className="p-2"><input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none uppercase" value={it.descricao} onChange={e => updateEditItem(idx, 'descricao', e.target.value)} /></td>
                          <td className="p-2"><input type="number" min="0" className="w-full p-2 border border-[#CBD5E1] rounded outline-none text-center font-bold" value={it.qtd || ''} onChange={e => updateEditItem(idx, 'qtd', parseFloat(e.target.value) || 0)} /></td>
                          <td className="p-2"><input type="number" min="0" step="0.01" className="w-full p-2 border border-[#CBD5E1] rounded outline-none font-bold" value={it.valor_unitario || ''} onChange={e => updateEditItem(idx, 'valor_unitario', parseFloat(e.target.value) || 0)} /></td>
                          <td className="p-2 text-center"><button onClick={() => removeEditItem(idx)} className="text-red-500 font-bold bg-red-100 p-2 rounded hover:bg-red-200">&times;</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={addEditItem} className="mt-2 w-full py-2 bg-[#F0F4F8] border border-dashed border-[#94A3B8] text-[#64748B] font-bold text-[10px] uppercase rounded-lg hover:bg-[#E2E8F0] transition-colors">➕ Adicionar Item</button>
              </div>
              <div className="flex justify-between items-center bg-[#F8FAFC] p-4 rounded-lg border border-[#E2E8F0]">
                <span className="text-sm font-black uppercase text-[#64748B]">Total Calculado</span>
                <span className="text-2xl font-black text-[#336699]">{formatarMoeda(totalEdit)}</span>
              </div>
              <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">OBSERVAÇÕES ADICIONAIS</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.observacao || ''} onChange={e => updateEditField('observacao', e.target.value)} /></div>
              <button onClick={salvarEdicao} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black text-sm uppercase py-4 rounded-xl shadow-lg transition-colors">
                💾 SALVAR ALTERAÇÕES DA OP
              </button>
            </div>
          </div>
        </div>
      )}

      <DialogOP dialog={dialog} onClose={() => setDialog({ ...dialog, open: false })} />

    </div>
  );
}
