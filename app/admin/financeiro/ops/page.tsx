"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { listarOPs, atualizarStatus, dispararEmailOP } from '../../op/actions';
import { conciliarOpsComContasPagarAction, enviarOpParaPrimeStartAction } from './actions';
import { sincronizarContasPagarP2sAction } from '../contas-pagar/actions';
import { sincronizarParceirosP2sAction, sincronizarColaboradoresP2sAction } from '../../comercial/parceiros/actions';
import { registrarLogAuditoria } from '../../../actions';
import { Analytics } from "@vercel/analytics/next";
import logoColorido from '../../../../app/imgs/logo.png';
import { useAcessoRota } from '../../op/useAcessoRota';
import { normalizarItensOP, ItemOPNormalizado } from '../../op/utils';
import { DialogOP, DialogOPState, BotaoLinkAssinatura } from '../../op/DialogOP';

// Os itens em memória já chegam normalizados (ver normalizarItensOP) — não há
// mais motivo para este tipo carregar os campos legados (description/quantity)
// de OPs antigas, então reaproveitamos o mesmo tipo canônico de utils.ts.
type ItemOP = ItemOPNormalizado;

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
  empresa_recebedora: string;
  cnpj_cpf_recebedora?: string;
  tipo_pagamento: string;
  dados_pagamento: string;
  total_geral: number;
  data_vencimento: string;
  status: string;
  itens: ItemOP[];
  file_url: string;
  recibo_url?: string;
  data_assinatura?: string;
  p2s_conta_pagar_oid?: string | null;
}

export default function PainelFinanceiro() {
  const router = useRouter();

  // Sessão + permissão da rota, resolvidas pelo hook compartilhado do módulo.
  const { authLoading, acessoNegado, perfil } = useAcessoRota('/admin/financeiro/ops');

  // Estados de Dados
  const [ops, setOps] = useState<OP[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados de Filtro
  const [busca, setBusca] = useState('');
  const [tipoFiltroData, setTipoFiltroData] = useState<'DIA' | 'MES' | 'ANO'>('MES');
  const [filtroData, setFiltroData] = useState('');
  const [filtroResponsavel, setFiltroResponsavel] = useState('');
  const [filtroFavorecido, setFiltroFavorecido] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');

  // Estados de UI (Modais)
  const [modalDetalhes, setModalDetalhes] = useState<{ open: boolean; op: OP | null }>({ open: false, op: null });
  const [modalRecibo, setModalRecibo] = useState<{ open: boolean; op: OP | null }>({ open: false, op: null });
  const [dialog, setDialog] = useState<DialogOPState>({ open: false, type: 'loading', title: '', msg: '' });
  const [conciliando, setConciliando] = useState(false);
  const [sincronizandoContasPagar, setSincronizandoContasPagar] = useState(false);

  // Busca os dados iniciais do banco — só executa depois que o hook resolve
  // sessão + permissão.
  const carregarDados = async (tokenOverride?: string) => {
    const token = tokenOverride || perfil?.accessToken;
    if (!token) return;
    setLoading(true);
    const res = await listarOPs(token, '/admin/financeiro/ops');
    if (res.success && res.data) {
      const opsNormalizadas = res.data.map((op: any) => ({ ...op, itens: normalizarItensOP(op.itens) }));
      setOps(opsNormalizadas);
    } else if (!res.success) {
      // Antes uma falha aqui (sessão expirada, permissão negada etc.) ficava
      // muda — a tela só mostrava a tabela vazia, indistinguível de realmente
      // não haver OPs.
      setDialog({ open: true, type: 'error', title: 'Erro ao Carregar', msg: res.message || 'Não foi possível carregar as Ordens de Pagamento.' });
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && perfil) carregarDados(perfil.accessToken);
  }, [authLoading, perfil]);

  const responsaveisUnicos = useMemo(() => {
    const nomes = ops.map(op => (op.responsavel_nome || '').toUpperCase().trim()).filter(Boolean);
    return [...new Set(nomes)].sort();
  }, [ops]);

  const favorecidosUnicos = useMemo(() => {
    const nomes = ops.map(op => (op.empresa_recebedora || '').toUpperCase().trim()).filter(Boolean);
    return [...new Set(nomes)].sort();
  }, [ops]);

  const statusUnicos = useMemo(() => {
    const status = ops.map(op => (op.status || '').toUpperCase().trim()).filter(Boolean);
    return [...new Set(status)].sort();
  }, [ops]);

  // Formatadores Básicos
  const formatarMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatarData = (d: string) => {
    if (!d) return '---';
    const date = new Date(d);
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  };

  // Filtro Dinâmico Multi-Critérios
  const opsFiltradas = useMemo(() => {
    const termoBusca = busca.toLowerCase().trim();

    return ops.filter(op => {
      const matchBusca = !termoBusca || [
        String(op.numero_op), // Adicionado número da OP na busca
        op.os_numero,
        op.os_cliente,
        op.os_evento,
        op.os_periodo,
        op.responsavel_nome,
        op.natureza_pagamento,
        op.empresa_recebedora
      ].some((campo) => (campo || '').toLowerCase().includes(termoBusca));

      const nomeResponsavelLimpo = (op.responsavel_nome || '').toUpperCase().trim();
      const matchResponsavel = !filtroResponsavel || nomeResponsavelLimpo === filtroResponsavel;

      const nomeFavorecidoLimpo = (op.empresa_recebedora || '').toUpperCase().trim();
      const matchFavorecido = !filtroFavorecido || nomeFavorecidoLimpo === filtroFavorecido;

      const statusLimpo = (op.status || '').toUpperCase().trim();
      const matchStatus = !filtroStatus || statusLimpo === filtroStatus;

      let matchData = true;
      if (filtroData) {
        const opDate = op.data_criacao ? op.data_criacao.split('T')[0] : '';
        matchData = opDate.startsWith(filtroData);
      }

      return matchBusca && matchResponsavel && matchFavorecido && matchStatus && matchData;
    });
  }, [ops, busca, filtroResponsavel, filtroFavorecido, filtroStatus, filtroData]);

  const limparFiltros = () => {
    setBusca('');
    setFiltroData('');
    setFiltroResponsavel('');
    setFiltroFavorecido('');
    setFiltroStatus('');
  };

  const temFiltroAtivo = busca || filtroData || filtroResponsavel || filtroFavorecido || filtroStatus;

  const metricas = useMemo(() => {
    let tGeral = 0, tPendente = 0, tPago = 0;
    const naturezas: Record<string, number> = {};

    opsFiltradas.forEach(op => {
      const val = Number(op.total_geral) || 0;
      tGeral += val;
      if (op.status.includes('PAGO')) tPago += val;
      else tPendente += val;

      const nat = op.natureza_pagamento || "NÃO INFORMADA";
      naturezas[nat] = (naturezas[nat] || 0) + val;
    });

    return { tGeral, tPendente, tPago, qtd: opsFiltradas.length, naturezas };
  }, [opsFiltradas]);

  // Baixa de Pagamento
  const confirmarBaixa = (id: string, osNum: string) => {
    if (!perfil) return;
    setDialog({
      open: true,
      type: 'confirm',
      title: 'Baixar OP',
      msg: `Confirma o pagamento e a baixa da OS ${osNum} no sistema?`,
      onConfirm: async () => {
        setDialog({ open: true, type: 'loading', title: 'Aguarde...', msg: 'Atualizando o banco de dados...' });
        const res = await atualizarStatus(id, 'PAGO', perfil.accessToken);
        if (res.success) {
          await carregarDados();
          setDialog(d => ({ ...d, open: false }));
        } else {
          setDialog({ open: true, type: 'error', title: 'Erro', msg: res.message });
        }
      }
    });
  };

  // Mesma Server Action do botão "Sincronizar agora" em
  // /admin/financeiro/contas-pagar — trazida pra cá pra permitir atualizar
  // as contas a pagar sem sair da tela de OPs antes de conciliar. Usa a
  // mesma permissão daquela tela (checada dentro da action), não a de
  // /admin/financeiro/ops. Dispara junto Parceiros e Colaboradores (mesmas
  // actions de /admin/comercial/parceiros) — é a base que "Enviar pro
  // PrimeStart" usa pra achar o CPF/CNPJ do favorecido e vincular a
  // Entidade certa, então mantê-la atualizada aqui evita ter que ir em duas
  // telas separadas antes de mandar uma OP. Cada sincronização usa sua
  // própria permissão (checada dentro de cada action) — se o usuário não
  // tiver acesso a Parceiros/Colaboradores, aquela parte falha sem impedir
  // as demais.
  const sincronizarContasPagar = async () => {
    if (!perfil) return;
    setSincronizandoContasPagar(true);
    try {
      const [resContas, resParceiros, resColaboradores] = await Promise.all([
        sincronizarContasPagarP2sAction({}, perfil.accessToken),
        sincronizarParceirosP2sAction({}, perfil.accessToken),
        sincronizarColaboradoresP2sAction({}, perfil.accessToken),
      ]);

      const partes: string[] = [];
      const erros: string[] = [];

      if (resContas.ok) partes.push(`${resContas.info.processados} conta(s) a pagar`);
      else erros.push(`Contas a Pagar: ${resContas.erro}`);

      if (resParceiros.ok) partes.push(`${resParceiros.info.processados} parceiro(s)`);
      else erros.push(`Parceiros: ${resParceiros.erro}`);

      if (resColaboradores.ok) partes.push(`${resColaboradores.info.processados} colaborador(es)`);
      else erros.push(`Colaboradores: ${resColaboradores.erro}`);

      setDialog({
        open: true,
        type: resContas.ok ? 'success' : 'error',
        title: erros.length > 0 ? 'Sincronizado com Ressalvas' : 'Sincronizado',
        msg: [
          partes.length > 0 ? `Sincronizado: ${partes.join(', ')}.` : '',
          erros.length > 0 ? `⚠ ${erros.join(' | ')}` : '',
        ].filter(Boolean).join(' '),
      });
    } finally {
      setSincronizandoContasPagar(false);
    }
  };

  // Lê as Contas a Pagar já quitadas (sincronizadas do PrimeStart) em busca do
  // padrão "OP: <número>" ou "#<número>" na descrição e baixa automaticamente
  // as Ordens de Pagamento correspondentes para PAGO — evita clicar em
  // "Baixar OP" uma por uma quando o Financeiro já identificou a OP na hora
  // de lançar a conta.
  const conciliarPagamentos = async () => {
    if (!perfil) return;
    setConciliando(true);
    try {
      const res = await conciliarOpsComContasPagarAction(perfil.accessToken);
      if (!res.ok) {
        setDialog({ open: true, type: 'error', title: 'Erro na Conciliação', msg: res.erro });
        return;
      }

      const { baixadas, semCorrespondencia, jaEstavamPagas } = res.info;
      if (baixadas.length === 0 && semCorrespondencia.length === 0) {
        setDialog({ open: true, type: 'success', title: 'Nada a Conciliar', msg: 'Nenhuma conta paga com "OP: número" ou "#número" na descrição foi encontrada.' });
        return;
      }

      const partes: string[] = [];
      if (baixadas.length > 0) partes.push(`${baixadas.length} OP(s) baixada(s) para PAGO: ${baixadas.map(b => `#${b.numero_op}`).join(', ')}.`);
      if (jaEstavamPagas > 0) partes.push(`${jaEstavamPagas} já estava(m) paga(s).`);
      if (semCorrespondencia.length > 0) partes.push(`⚠ ${semCorrespondencia.length} conta(s) citam uma OP que não existe no sistema: ${semCorrespondencia.map(s => `#${s.numero_op}`).join(', ')} — confira o número digitado na descrição da conta.`);

      setDialog({
        open: true,
        type: semCorrespondencia.length > 0 && baixadas.length === 0 ? 'error' : 'success',
        title: 'Conciliação Concluída',
        msg: partes.join(' '),
      });

      if (baixadas.length > 0) await carregarDados();
    } finally {
      setConciliando(false);
    }
  };

  // Cria a Conta a Pagar correspondente no PrimeStart (produção) — evita
  // redigitar a OP manualmente lá. Disparo manual, um clique por OP; depois
  // de enviada, o backend bloqueia reenvio (p2s_conta_pagar_oid já setado).
  const enviarParaPrimeStart = (op: OP) => {
    if (!perfil) return;
    setDialog({
      open: true,
      type: 'confirm',
      title: 'Enviar pro PrimeStart',
      msg: `Confirma a criação de uma Conta a Pagar no PrimeStart (produção) pra OP #${op.numero_op} — ${op.empresa_recebedora}, valor ${formatarMoeda(op.total_geral)}?`,
      onConfirm: async () => {
        setDialog({ open: true, type: 'loading', title: 'Aguarde...', msg: 'Criando lançamento no PrimeStart...' });
        const res = await enviarOpParaPrimeStartAction(op.id, perfil.accessToken);
        if (!res.ok) {
          setDialog({ open: true, type: 'error', title: 'Erro no Envio', msg: res.erro });
          return;
        }
        await carregarDados();
        const mensagemVinculo: Record<string, string> = {
          parceiro: 'vinculada ao parceiro já cadastrado no PrimeStart.',
          colaborador: 'vinculada ao colaborador já cadastrado no PrimeStart.',
          parceiro_criado: 'e um novo Parceiro/Fornecedor foi cadastrado automaticamente no PrimeStart (cadastro mínimo — vale complementar os dados depois).',
        };
        setDialog({
          open: true,
          type: res.info.fornecedorVinculado ? 'success' : 'error',
          title: res.info.fornecedorVinculado ? 'Enviado!' : 'Enviado — Sem CNPJ/CPF',
          msg: res.info.fornecedorVinculado
            ? `Conta a pagar criada no PrimeStart ${mensagemVinculo[res.info.origemVinculo || ''] || 'e vinculada ao fornecedor.'}`
            : 'Conta a pagar criada no PrimeStart, mas a OP não tem CNPJ/CPF do favorecido preenchido — não deu pra buscar nem cadastrar o fornecedor. Vincule manualmente no PrimeStart.',
        });
      }
    });
  };

  const dispararReenvio = (op: OP) => {
    if (!perfil) return;
    setDialog({
      open: true,
      type: 'confirm',
      title: 'Reenviar E-mail',
      msg: `Deseja enviar a OP ${op.os_numero || 'S/N'} para o seu e-mail (${perfil.email}) e para o Financeiro?`,
      onConfirm: async () => {
        setDialog({ open: true, type: 'loading', title: 'Enviando E-mail...', msg: 'Isso pode levar alguns segundos.' });
        try {
          const res = await dispararEmailOP(op.id, perfil.accessToken);
          if (res.success) {
            registrarLogAuditoria({
              usuario_nome: perfil.nome,
              acao: 'REENVIO DE E-MAIL DA OP',
              setor: 'OP',
              equipamento_id: op.id,
              equipamento_nome: `OP #${op.numero_op} — OS ${op.os_numero || 'S/N'}`,
            });
            setDialog({ open: true, type: 'success', title: 'E-mail Enviado!', msg: 'A cópia da OP foi enviada com sucesso para os departamentos.' });
          } else {
            throw new Error(res.message);
          }
        } catch (error: any) {
          setDialog({ open: true, type: 'error', title: 'Erro no Envio', msg: error.message || 'Não foi possível enviar o e-mail.' });
        }
      }
    });
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Painel Financeiro de OPs.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  const anoAtual = new Date().getFullYear();
  const anosDisponiveis = [anoAtual - 1, anoAtual, anoAtual + 1, anoAtual + 2];

  // ============================================================================
  // TEMPLATE DO RECIBO (COM Nº DA OP)
  // ============================================================================
  const renderReciboLayout = (op: OP) => (
    <div className="border-2 border-black p-8 md:p-12 rounded-xl bg-white w-full max-w-4xl mx-auto text-black shadow-none print:border-none">
      <div className="flex justify-between items-center border-b-2 border-black pb-6 mb-8">
        <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} className="print:grayscale" />
        <div className="text-right">
          <h1 className="text-3xl font-black uppercase tracking-wider">RECIBO</h1>
          <p className="text-lg font-bold text-gray-700">
            Nº da OP: <span className="text-black">#{op.numero_op}</span>
            <span className="text-sm font-normal ml-2">/ OS: {op.os_numero || 'S/N'}</span>
          </p>
        </div>
      </div>

      <div className="bg-gray-100 border border-gray-400 p-5 rounded-lg flex justify-between items-center mb-10 print:bg-gray-100">
        <span className="text-sm font-bold uppercase tracking-widest text-gray-600">Valor Deste Recibo</span>
        <span className="text-4xl font-black">{formatarMoeda(op.total_geral)}</span>
      </div>

      <div className="text-lg leading-relaxed mb-10 text-justify">
        <p className="mb-4">
          Recebi(emos) da empresa <strong>RENTECH LOCADORA E SERVIÇOS</strong>, a importância supramencionada de <strong>{formatarMoeda(op.total_geral)}</strong>.
        </p>
        <p>
          Pagamento referente à prestação de serviços de <strong>{op.natureza_pagamento}</strong>, vinculados ao projeto/evento <strong>{op.os_cliente || 'N/A'}</strong>.
        </p>
      </div>

      <div className="mb-16">
        <h4 className="font-black uppercase tracking-widest text-xs mb-3 border-b border-gray-400 pb-2">Detalhamento dos Serviços</h4>
        <table className="w-full text-sm text-left border-collapse">
          <thead>
            <tr className="border-b-2 border-black font-bold">
              <th className="py-3">Descrição do Serviço / Item</th>
              <th className="py-3 text-center">Qtd</th>
              <th className="py-3 text-right">V. Unitário</th>
              <th className="py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {op.itens?.map((it, idx) => (
              <tr key={idx} className="border-b border-gray-300">
                <td className="py-3 uppercase">{it.descricao}</td>
                <td className="py-3 text-center">{it.qtd}</td>
                <td className="py-3 text-right">{formatarMoeda(it.valor_unitario)}</td>
                <td className="py-3 text-right font-bold">{formatarMoeda(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-20 pt-8 flex flex-col items-center justify-center border-t-2 border-black w-3/4 mx-auto">
        <strong className="text-xl uppercase tracking-wider">{op.empresa_recebedora}</strong>
        <p className="text-base mt-1">CPF/CNPJ: {op.cnpj_cpf_recebedora || '__________________________________'}</p>
      </div>

      <div className="text-center mt-12 text-base font-medium">
        São Paulo, ______ de __________________________ de 20____.
      </div>
    </div>
  );

  return (
    <>
      {/* Interface Admin (Escondida na hora de imprimir) */}
      <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16 print:hidden">
        <Analytics />

        {/* Hub Topo */}
        <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
          <p className="text-[#0369A1] font-medium text-sm">
            💳 <strong>Olá, {perfil.nome || 'Equipe Financeira'}</strong>. Bem-vindo ao painel financeiro de aprovação de OPs.
          </p>
          <div className="flex gap-2">
            <button
              onClick={sincronizarContasPagar}
              disabled={sincronizandoContasPagar}
              title="Puxa contas a pagar quitadas, parceiros e colaboradores direto do PrimeStart — atualiza a base usada pra vincular o fornecedor ao enviar uma OP"
              className="text-[10px] md:text-xs font-black bg-white hover:bg-emerald-50 border border-emerald-200 text-emerald-700 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
            >
              {sincronizandoContasPagar ? '🔄 Sincronizando...' : '🔄 Sincronizar Contas a Pagar'}
            </button>
            <button
              onClick={conciliarPagamentos}
              disabled={conciliando}
              title='Busca contas a pagar já quitadas com "OP: número" ou "#número" na descrição e baixa as OPs correspondentes'
              className="text-[10px] md:text-xs font-black bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
            >
              {conciliando ? 'Conciliando...' : '🔗 Conciliar Contas Pagas'}
            </button>
            <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
              ⬅ VOLTAR AO FINANCEIRO
            </button>
          </div>
        </div>

        {/* Métrica Dash */}
        <div className="p-4 md:px-8 pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 flex-shrink-0">
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-[#336699]">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Total Geral Visualizado</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">{formatarMoeda(metricas.tGeral)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-amber-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Total Pendente</h3>
            <p className="text-2xl font-black text-amber-500 mt-1">{formatarMoeda(metricas.tPendente)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-green-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Total Pago</h3>
            <p className="text-2xl font-black text-green-600 mt-1">{formatarMoeda(metricas.tPago)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-[#0C1D4D]">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Quantidade de OPs</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">{metricas.qtd} <span className="text-sm font-semibold text-[#94A3B8]">registros</span></p>
          </div>
        </div>

        {/* Filtros */}
        <div className="px-4 md:px-8 py-2 flex-shrink-0">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] flex flex-col lg:flex-row gap-3 items-center">
            <div className="flex-1 w-full">
              <input type="text" placeholder="🔍 Busca livre (Nº OP, OS, Cliente, Evento, Período, etc)..." className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#0A2A4A] focus:border-[#336699] outline-none transition-all" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>

            <div className="w-full lg:w-auto flex relative shadow-sm rounded-lg">
              <select className="p-2.5 border-y border-l border-[#CBD5E1] rounded-l-lg text-xs font-bold text-[#0C1D4D] outline-none focus:border-[#336699] bg-[#F8FAFC] cursor-pointer" value={tipoFiltroData} onChange={(e) => { setTipoFiltroData(e.target.value as 'DIA' | 'MES' | 'ANO'); setFiltroData(''); }}>
                <option value="DIA">Por Dia</option>
                <option value="MES">Por Mês</option>
                <option value="ANO">Por Ano</option>
              </select>
              {tipoFiltroData === 'DIA' && <input type="date" className="w-full lg:w-36 p-2.5 border border-[#CBD5E1] rounded-r-lg text-sm font-semibold text-[#0A2A4A] outline-none" value={filtroData} onChange={(e) => setFiltroData(e.target.value)} />}
              {tipoFiltroData === 'MES' && <input type="month" className="w-full lg:w-36 p-2.5 border border-[#CBD5E1] rounded-r-lg text-sm font-semibold text-[#0A2A4A] outline-none" value={filtroData} onChange={(e) => setFiltroData(e.target.value)} />}
              {tipoFiltroData === 'ANO' && (
                <select className="w-full lg:w-36 p-2.5 border border-[#CBD5E1] rounded-r-lg text-sm font-semibold text-[#64748B] outline-none cursor-pointer" value={filtroData} onChange={(e) => setFiltroData(e.target.value)}>
                  <option value="">Ano...</option>
                  {anosDisponiveis.map(ano => <option key={ano} value={ano}>{ano}</option>)}
                </select>
              )}
            </div>

            <div className="w-full lg:w-48">
              <select className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#64748B]" value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)}>
                <option value="">👤 Solicitantes</option>
                {responsaveisUnicos.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="w-full lg:w-48">
              <select className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#64748B]" value={filtroFavorecido} onChange={(e) => setFiltroFavorecido(e.target.value)}>
                <option value="">🏢 Favorecidos</option>
                {favorecidosUnicos.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <div className="w-full lg:w-48">
              <select className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#64748B]" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
                <option value="">🏷️ Status</option>
                {statusUnicos.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {temFiltroAtivo && (
              <button onClick={limparFiltros} className="w-full lg:w-auto px-4 py-2.5 bg-red-50 text-red-500 border border-red-200 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors flex-shrink-0 shadow-sm">
                ✕ Limpar
              </button>
            )}
          </div>
        </div>

        {/* Tabela de Dados */}
        <div className="px-4 md:px-8 pb-8 flex-grow overflow-hidden flex flex-col mt-2">
          <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
            <table className="w-full text-left border-collapse min-w-[1000px]">
              <thead className="bg-[#F8FAFC] sticky top-0 z-10 shadow-sm">
                <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] w-20">Data OP</th>
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] w-16">Nº OP</th>
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] min-w-[120px] max-w-[135px]">OS / Evento / Período</th>
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] w-28">Solicitante</th>
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] min-w-[100px] max-w-[115px]">Cliente</th>
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] min-w-[130px] max-w-[150px]">Descrição Resumida</th>
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] min-w-[110px] max-w-[130px]">Favorecido</th>
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] w-24">Valor Total</th>
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] w-20">Vencimento</th>
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] w-20">Status</th>
                  <th className="p-2.5 border-b-2 border-[#E2E8F0] w-32 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
                {loading ? (
                  <tr><td colSpan={11} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Carregando registros do banco de dados...</td></tr>
                ) : opsFiltradas.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Nenhuma Ordem de Pagamento encontrada.</td></tr>
                ) : (
                  opsFiltradas.map((op) => {
                    const statusAtual = op.status;
                    return (
                      <tr key={op.id} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="p-2.5 font-semibold text-[#94A3B8] whitespace-nowrap">{formatarData(op.data_criacao)}</td>
                        <td className="p-2.5 font-black text-[#0C1D4D]">#{op.numero_op}</td>
                        <td className="p-2.5">
                          <div className="whitespace-nowrap mb-1">
                            <span className="bg-[#E0F2FE] text-[#0369A1] font-bold px-2 py-1 rounded-md text-xs mr-1.5 inline-block">{op.os_numero || 'S/N'}</span>
                            {op.file_url && <a href={op.file_url} target="_blank" rel="noreferrer" className="text-base hover:scale-110 transition-transform inline-block" title="Ver Comprovante">📎</a>}
                          </div>
                          <div className="text-xs text-[#64748B] font-semibold truncate max-w-[120px]" title={op.os_evento}>{op.os_evento || '—'}</div>
                          <div className="text-xs text-[#94A3B8] truncate max-w-[120px]" title={op.os_periodo}>{op.os_periodo || '—'}</div>
                        </td>
                        <td className="p-2.5 font-bold text-[#336699] truncate max-w-[110px]" title={op.responsavel_nome}>{op.responsavel_nome}</td>
                        <td className="p-2.5 font-bold truncate max-w-[115px]" title={op.os_cliente}>{op.os_cliente}</td>
                        <td className="p-2.5">
                          <div className="truncate max-w-[150px] font-semibold text-[#64748B] mb-1">
                            {op.itens && op.itens.length > 0 ? op.itens[0].descricao : 'Sem descrição'}
                          </div>
                          <button onClick={() => setModalDetalhes({ open: true, op })} className="text-[9px] font-black uppercase tracking-wider text-[#336699] hover:underline">
                            Ver Detalhes ({op.itens?.length || 0})
                          </button>
                        </td>
                        <td className="p-2.5 font-bold truncate max-w-[130px]" title={op.empresa_recebedora}>{op.empresa_recebedora}</td>
                        <td className="p-2.5 font-black text-[#0C1D4D] whitespace-nowrap">{formatarMoeda(op.total_geral)}</td>
                        <td className="p-2.5 font-bold text-red-500 whitespace-nowrap">{formatarData(op.data_vencimento)}</td>
                        <td className="p-2.5">
                          <span className={`px-2 py-1 rounded-full text-[9px] font-black tracking-wider whitespace-nowrap ${statusAtual.includes('ASSINADO') ? 'bg-purple-100 text-purple-700 border border-purple-200' : statusAtual === 'PAGO' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                            {statusAtual}
                          </span>
                        </td>

                        {/* Ações Inteligentes e Modulares — ícones lado a lado em vez de
                            botões de texto empilhados, pra caber sem estourar a largura */}
                        <td className="p-2.5">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {statusAtual !== 'PENDENTE' ? (
                              <span title="Pago" className="w-8 h-8 flex items-center justify-center bg-green-50 text-green-600 rounded shrink-0">✅</span>
                            ) : (
                              <button onClick={() => confirmarBaixa(op.id, op.os_numero)} title="Baixar OP" className="w-8 h-8 flex items-center justify-center bg-green-600 hover:bg-green-500 text-white rounded transition-colors shadow-sm shrink-0">
                                ✅
                              </button>
                            )}

                            <button onClick={() => setModalRecibo({ open: true, op })} title="Gerar Recibo" className="w-8 h-8 flex items-center justify-center bg-white hover:bg-gray-50 border border-[#CBD5E1] text-[#0C1D4D] rounded transition-colors shadow-sm shrink-0">
                              📄
                            </button>

                            <BotaoLinkAssinatura opId={op.id} />

                            {op.recibo_url && (
                              <a href={op.recibo_url} target="_blank" rel="noreferrer" title="Ver Assinatura" className="w-8 h-8 flex items-center justify-center bg-purple-100 hover:bg-purple-200 border border-purple-300 text-purple-700 rounded transition-colors shadow-sm shrink-0">
                                👁️
                              </a>
                            )}

                            <button onClick={() => dispararReenvio(op)} title="Reenviar" className="w-8 h-8 flex items-center justify-center bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-600 rounded transition-colors shrink-0">
                              🔄
                            </button>

                            {op.p2s_conta_pagar_oid ? (
                              <span title="Já enviado pro PrimeStart" className="w-8 h-8 flex items-center justify-center bg-blue-50 text-blue-600 rounded shrink-0">🏦</span>
                            ) : (
                              <button onClick={() => enviarParaPrimeStart(op)} title="Enviar pro PrimeStart (cria Conta a Pagar)" className="w-8 h-8 flex items-center justify-center bg-white hover:bg-blue-50 border border-[#CBD5E1] text-[#0C1D4D] rounded transition-colors shadow-sm shrink-0">
                                🏦
                              </button>
                            )}
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

        {/* Modal: Detalhes dos Itens */}
        {modalDetalhes.open && modalDetalhes.op && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white">
                <h3 className="font-black uppercase tracking-wider text-sm">Detalhes da OP: #{modalDetalhes.op.numero_op} - OS: {modalDetalhes.op.os_numero}</h3>
                <button onClick={() => setModalDetalhes({ open: false, op: null })} className="text-white hover:text-red-400 text-2xl leading-none">&times;</button>
              </div>
              <div className="p-6 overflow-y-auto">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6 bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0]">
                  <div><span className="block text-[10px] uppercase text-[#64748B] font-bold">Natureza</span><strong className="text-xs">{modalDetalhes.op.natureza_pagamento}</strong></div>
                  <div><span className="block text-[10px] uppercase text-[#64748B] font-bold">Favorecido</span><strong className="text-xs truncate block" title={modalDetalhes.op.empresa_recebedora}>{modalDetalhes.op.empresa_recebedora}</strong></div>
                  <div><span className="block text-[10px] uppercase text-[#64748B] font-bold">Pagamento</span><strong className="text-xs">{modalDetalhes.op.tipo_pagamento}</strong></div>
                </div>
                <h4 className="text-xs font-black uppercase text-[#0C1D4D] tracking-widest mb-3 border-b border-[#E2E8F0] pb-2">Itens Solicitados</h4>
                <div className="space-y-2">
                  {modalDetalhes.op.itens?.map((it, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-white border border-[#E2E8F0] p-3 rounded-lg text-xs">
                      <span className="flex-grow font-semibold text-[#0A2A4A] uppercase">{it.descricao} <span className="text-[#94A3B8] font-normal">(x{it.qtd})</span></span>
                      <strong className="w-24 text-right text-[#336699]">{formatarMoeda(it.total)}</strong>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-[#F8FAFC] p-5 border-t border-[#E2E8F0] flex justify-between items-center">
                <span className="text-xs font-bold text-[#64748B] uppercase">Valor Total a Pagar</span>
                <span className="text-2xl font-black text-[#0C1D4D]">{formatarMoeda(modalDetalhes.op.total_geral)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Preview do Recibo */}
        {modalRecibo.open && modalRecibo.op && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className="bg-gray-100 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh]">
              <div className="bg-[#0C1D4D] p-4 flex justify-between items-center text-white flex-shrink-0">
                <h3 className="font-black uppercase tracking-wider text-sm">📄 Gerador de Recibo de Pagamento</h3>
                <div className="flex gap-3">
                  <button onClick={() => window.print()} className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest flex items-center gap-2">
                    🖨️ Imprimir Recibo
                  </button>
                  <button onClick={() => setModalRecibo({ open: false, op: null })} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest">
                    Fechar
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto flex justify-center bg-gray-200">
                <div className="bg-white shadow-xl">
                  {renderReciboLayout(modalRecibo.op)}
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogOP dialog={dialog} onClose={() => setDialog(d => ({ ...d, open: false }))} />
      </div>

      {/* Visão de Impressão (Fica ativa estritamente na folha do papel) */}
      {modalRecibo.open && modalRecibo.op && (
        <div className="hidden print:block bg-white w-full h-full text-black font-sans">
          {renderReciboLayout(modalRecibo.op)}
        </div>
      )}
    </>
  );
}
