"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  listarAutomacoesAction, alternarStatusAutomacaoAction,
  criarAutomacaoAction, atualizarAutomacaoAction, excluirAutomacaoAction,
  listarFuncionariosParaAutomacaoAction, contarEnviosMesAction, verificarStatusZapiAction,
  FONTES_DADOS_DISPONIVEIS, EVENTOS_SISTEMA_DISPONIVEIS,
  type RotinaAutomacaoDB, type FormAutomacao, type FuncionarioParaAutomacao
} from './actions';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';
import { supabase } from '../../../lib/supabase';
import { ehAdministradorGlobal } from '../../../lib/permissoes';

// Tipos de Automação (RotinaAutomacaoDB vem de ./actions, refletindo a tabela folha_automacoes)

export default function GestaoAgendamentos() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken, permissaoBruta } = usePageAccess({ nomeFallback: 'Gestor' });
  const toast = useToast();

  // Empresa(s) que o usuário pode enxergar (Rentech × AlfaLight) — só quem é
  // literalmente "Administrador" (ehAdministradorGlobal) vê/edita automações
  // de todas; os demais ficam restritos ao vínculo em perfis_usuarios_empresas,
  // igual ao resto do sistema.
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);

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

  // Filtro de exibição dos cards por empresa — trava sozinho se só há uma
  // empresa disponível.
  const [filtroEmpresa, setFiltroEmpresa] = useState<number | null>(null);
  useEffect(() => {
    if (empresasCatalogoVisivel.length === 1) setFiltroEmpresa(empresasCatalogoVisivel[0].id);
  }, [empresasCatalogoVisivel]);

  const [rotinas, setRotinas] = useState<RotinaAutomacaoDB[]>([]);
  const [rotinasLoading, setRotinasLoading] = useState(true);

  // Carrega as automações reais da tabela folha_automacoes
  const carregarRotinas = async () => {
    const res = await listarAutomacoesAction(accessToken);
    if (!res.ok) {
      toast('Erro ao carregar as automações: ' + res.erro, 'error');
    } else {
      setRotinas(res.data || []);
    }
    setRotinasLoading(false);
  };

  useEffect(() => {
    if (accessToken) carregarRotinas();
  }, [accessToken]);

  // Automação sem empresa (null) é "de todas" — continua aparecendo
  // independente do filtro, mesmo critério usado no resto do sistema.
  const rotinasVisiveis = !filtroEmpresa ? rotinas : rotinas.filter(r => r.empresa_id == null || r.empresa_id === filtroEmpresa);

  // Contadores reais de envio (mês corrente) e status ao vivo da Z-API —
  // antes eram números/badge fixos no código.
  const [enviosMes, setEnviosMes] = useState<{ whatsapp: number; email: number } | null>(null);
  const [statusZapi, setStatusZapi] = useState<{ conectado: boolean; detalhe?: string } | null>(null);
  const [statusZapiLoading, setStatusZapiLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    contarEnviosMesAction(accessToken).then(res => { if (res.ok) setEnviosMes(res.data || { whatsapp: 0, email: 0 }); });
    verificarStatusZapiAction(accessToken).then(res => {
      if (res.ok) setStatusZapi(res.data || { conectado: false });
      setStatusZapiLoading(false);
    });
  }, [accessToken]);

  // Funcionários ativos disponíveis para seleção como destinatários (agrupados por cargo,
  // já que não existe uma coluna de "departamento" na tabela de funcionários).
  const [funcionarios, setFuncionarios] = useState<FuncionarioParaAutomacao[]>([]);
  const gruposCargo = funcionarios.reduce<Record<string, FuncionarioParaAutomacao[]>>((acc, f) => {
    const cargo = f.cargo || 'Sem Cargo';
    (acc[cargo] ||= []).push(f);
    return acc;
  }, {});

  // Modal de criação/edição de automação
  const formVazio: FormAutomacao = {
    nome: '', descricao: '', tipo: 'CRON', gatilho: '', canais: [], publico_alvo: '', empresaId: null, destinatarios: [], mensagem: '', horario: '08:00', dias_semana: [1, 2, 3, 4, 5],
    provedor_whatsapp: 'PADRAO', meta_template_nome: '', meta_template_idioma: 'pt_BR', meta_template_variaveis: 'primeiro_nome',
    publico_dinamico: 'PADRAO',
    fonte_dados: null, evento_sistema: null,
  };
  const [modalAutomacao, setModalAutomacao] = useState<{ open: boolean; isNew: boolean; id: number | null; chave?: string; modoTodos: boolean; form: FormAutomacao } | null>(null);
  const [salvandoAutomacao, setSalvandoAutomacao] = useState(false);

  // Recarrega os funcionários disponíveis toda vez que a empresa escolhida no
  // modal muda, pra não deixar marcar gente de outra empresa como destinatário.
  useEffect(() => {
    if (!accessToken || !modalAutomacao?.open) return;
    listarFuncionariosParaAutomacaoAction(modalAutomacao.form.empresaId, accessToken).then(res => {
      if (res.ok) setFuncionarios(res.data || []);
    });
  }, [accessToken, modalAutomacao?.open, modalAutomacao?.form.empresaId]);

  const abrirModalCriar = () => setModalAutomacao({
    open: true, isNew: true, id: null, modoTodos: true,
    form: { ...formVazio, empresaId: empresasCatalogoVisivel.length === 1 ? empresasCatalogoVisivel[0].id : null },
  });

  const abrirModalEditar = (rotina: RotinaAutomacaoDB) => setModalAutomacao({
    open: true,
    isNew: false,
    id: rotina.id,
    chave: rotina.chave,
    modoTodos: (rotina.destinatarios || []).length === 0,
    form: {
      nome: rotina.nome,
      descricao: rotina.descricao || '',
      tipo: rotina.tipo,
      gatilho: rotina.gatilho || '',
      canais: rotina.canais || [],
      publico_alvo: rotina.publico_alvo || '',
      empresaId: rotina.empresa_id,
      destinatarios: rotina.destinatarios || [],
      mensagem: rotina.mensagem || '',
      horario: rotina.horario || '08:00',
      dias_semana: (rotina.dias_semana && rotina.dias_semana.length > 0) ? rotina.dias_semana : [1, 2, 3, 4, 5],
      provedor_whatsapp: rotina.provedor_whatsapp || 'PADRAO',
      meta_template_nome: rotina.meta_template_nome || '',
      meta_template_idioma: rotina.meta_template_idioma || 'pt_BR',
      meta_template_variaveis: (rotina.meta_template_variaveis || ['primeiro_nome']).join(', '),
      publico_dinamico: rotina.publico_dinamico || 'PADRAO',
      fonte_dados: rotina.fonte_dados || null,
      evento_sistema: rotina.evento_sistema || null,
    }
  });

  const alternarDiaSemana = (dia: number) => {
    if (!modalAutomacao) return;
    const jaTem = modalAutomacao.form.dias_semana.includes(dia);
    const dias_semana = jaTem ? modalAutomacao.form.dias_semana.filter(d => d !== dia) : [...modalAutomacao.form.dias_semana, dia];
    setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, dias_semana } });
  };

  const alternarCanalModal = (canal: string) => {
    if (!modalAutomacao) return;
    const jaTem = modalAutomacao.form.canais.includes(canal);
    const canais = jaTem ? modalAutomacao.form.canais.filter(c => c !== canal) : [...modalAutomacao.form.canais, canal];
    setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, canais } });
  };

  const alternarDestinatario = (nome: string) => {
    if (!modalAutomacao) return;
    const jaTem = modalAutomacao.form.destinatarios.includes(nome);
    const destinatarios = jaTem ? modalAutomacao.form.destinatarios.filter(n => n !== nome) : [...modalAutomacao.form.destinatarios, nome];
    setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, destinatarios } });
  };

  const alternarGrupoCargo = (nomesDoGrupo: string[]) => {
    if (!modalAutomacao) return;
    const todosMarcados = nomesDoGrupo.every(n => modalAutomacao.form.destinatarios.includes(n));
    const destinatarios = todosMarcados
      ? modalAutomacao.form.destinatarios.filter(n => !nomesDoGrupo.includes(n))
      : [...new Set([...modalAutomacao.form.destinatarios, ...nomesDoGrupo])];
    setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, destinatarios } });
  };

  const salvarAutomacao = async () => {
    if (!modalAutomacao) return;
    const modoAniversariantes = modalAutomacao.form.publico_dinamico === 'ANIVERSARIANTES_FUNCIONARIOS';
    if (!modoAniversariantes && !modalAutomacao.modoTodos && modalAutomacao.form.destinatarios.length === 0) {
      toast('Selecione ao menos um funcionário, ou marque "Todos os funcionários ativos".', 'error');
      return;
    }

    setSalvandoAutomacao(true);
    const payload: FormAutomacao = {
      ...modalAutomacao.form,
      destinatarios: modoAniversariantes || modalAutomacao.modoTodos ? [] : modalAutomacao.form.destinatarios,
    };
    const res = modalAutomacao.isNew
      ? await criarAutomacaoAction(payload, accessToken)
      : await atualizarAutomacaoAction(modalAutomacao.id!, payload, accessToken);
    setSalvandoAutomacao(false);

    if (!res.ok) {
      toast('Erro ao salvar a automação: ' + res.erro, 'error');
      return;
    }
    setModalAutomacao(null);
    carregarRotinas();
  };

  const excluirAutomacao = async () => {
    if (!modalAutomacao?.id) return;
    if (!confirm(`Excluir a automação "${modalAutomacao.form.nome}"? Isso não pode ser desfeito.`)) return;

    setSalvandoAutomacao(true);
    const res = await excluirAutomacaoAction(modalAutomacao.id, accessToken);
    setSalvandoAutomacao(false);

    if (!res.ok) {
      toast('Erro ao excluir a automação: ' + res.erro, 'error');
      return;
    }
    setModalAutomacao(null);
    carregarRotinas();
  };

  // Função para alternar o status da rotina (Ligar/Desligar).
  // Atualiza otimisticamente e grava em folha_automacoes: é essa coluna `ativo`
  // que o Cron consulta antes de disparar, então isto realmente liga/desliga o envio.
  const toggleStatus = async (id: number, ativoAtual: boolean) => {
    const novoStatus = !ativoAtual;
    setRotinas(prev => prev.map(r => r.id === id ? { ...r, ativo: novoStatus } : r));

    const res = await alternarStatusAutomacaoAction(id, novoStatus, accessToken);
    if (!res.ok) {
      toast('Erro ao atualizar o status: ' + res.erro, 'error');
      setRotinas(prev => prev.map(r => r.id === id ? { ...r, ativo: ativoAtual } : r));
    }
  };

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar os Agendamentos e Disparos.</p>
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

      {/* HEADER TÉCNICO */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          ⚙️ <strong>Central de Automações</strong>. Agendamentos de tempo e gatilhos de sistema.
        </p>
        <button onClick={() => router.push('/admin/parametros')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="flex-grow p-4 md:p-8 max-w-7xl mx-auto w-full space-y-6">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">Agendamentos e Disparos</h1>
            <p className="text-[#64748B] text-sm font-medium mt-1">
              Gerencie lembretes via Z-API (WhatsApp) e e-mails disparados automaticamente.
            </p>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <select
              value={filtroEmpresa ?? ''}
              onChange={(e) => setFiltroEmpresa(e.target.value ? Number(e.target.value) : null)}
              disabled={empresasCatalogoVisivel.length <= 1}
              className="p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#0A2A4A] bg-white disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {empresasCatalogoVisivel.length !== 1 && <option value="">🏭 Todas as empresas</option>}
              {empresasCatalogoVisivel.map((e) => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </select>
            <button onClick={abrirModalCriar} className="flex-1 md:flex-initial bg-[#336699] hover:bg-[#284B8C] text-white px-6 py-3.5 rounded-xl font-black text-xs uppercase tracking-widest transition-colors shadow-md">
              ➕ Criar Nova Automação
            </button>
          </div>
        </div>

        {/* MÉTRICAS RÁPIDAS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] border-l-4 border-l-[#0C1D4D]">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Rotinas Ativas</p>
            <p className="text-2xl font-black text-[#0C1D4D]">{rotinasVisiveis.filter(r => r.ativo).length}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] border-l-4 border-l-[#16A34A]">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">WhatsApp Enviados</p>
            <p className="text-2xl font-black text-[#16A34A]">{enviosMes === null ? '…' : enviosMes.whatsapp} <span className="text-[10px] text-gray-400 font-medium">este mês</span></p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] border-l-4 border-l-[#336699]">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">E-mails Enviados</p>
            <p className="text-2xl font-black text-[#336699]">{enviosMes === null ? '…' : enviosMes.email} <span className="text-[10px] text-gray-400 font-medium">este mês</span></p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] border-l-4 border-l-gray-400">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Status Z-API</p>
            {statusZapiLoading ? (
              <p className="text-sm font-black text-gray-400 mt-2">Verificando...</p>
            ) : (
              <p className={`text-sm font-black mt-2 px-3 py-1 rounded-lg inline-block ${statusZapi?.conectado ? 'text-[#16A34A] bg-green-50' : 'text-red-600 bg-red-50'}`} title={statusZapi?.detalhe}>
                {statusZapi?.conectado ? '✅ Conectado' : '⛔ Desconectado'}
              </p>
            )}
          </div>
        </div>

        {/* GRID DE CARDS DE AUTOMAÇÃO */}
        {rotinasLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
          </div>
        ) : rotinasVisiveis.length === 0 ? (
          <div className="text-center py-16 text-sm text-gray-400 font-medium">
            {rotinas.length === 0
              ? <>Nenhuma automação cadastrada em <code>folha_automacoes</code> ainda.</>
              : 'Nenhuma automação para esta empresa.'}
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pt-4">
          {rotinasVisiveis.map((rotina) => (
            <div key={rotina.id} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col transition-all hover:shadow-md">
              <div className="p-5 flex-grow">
                <div className="flex justify-between items-start mb-4">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${rotina.tipo === 'CRON' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200'}`}>
                    {rotina.tipo === 'CRON' ? '⏱️ Agendamento (Cron)' : '⚡ Evento (Webhook)'}
                  </span>
                  
                  {/* Toggle Switch */}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={rotina.ativo} onChange={() => toggleStatus(rotina.id, rotina.ativo)} />
                    <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#16A34A]"></div>
                  </label>
                </div>

                <h3 className={`text-lg font-black uppercase tracking-tight mb-2 ${rotina.ativo ? 'text-[#0C1D4D]' : 'text-gray-400'}`}>
                  {rotina.nome}
                </h3>
                <p className="text-sm text-[#64748B] font-medium leading-relaxed mb-6">
                  {rotina.descricao}
                </p>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm">🎯</span>
                    <span className="text-xs font-bold text-[#0A2A4A] uppercase tracking-wider">{rotina.publico_alvo}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm">🔄</span>
                    <span className="text-xs font-bold text-[#336699] bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{rotina.gatilho}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm">🏭</span>
                    <span className="text-xs font-bold text-[#0A2A4A] uppercase tracking-wider">
                      {rotina.empresa_id ? (empresasCatalogo.find(e => e.id === rotina.empresa_id)?.nome || 'Empresa removida') : 'Todas as empresas'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-[#F8FAFC] border-t border-[#E2E8F0] p-4 flex justify-between items-center">
                <div className="flex gap-2 flex-wrap">
                  {rotina.canais.includes('WhatsApp') && (
                    <>
                      <span className="bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md border border-emerald-200">
                        WhatsApp
                      </span>
                      <span
                        className="bg-sky-100 text-sky-700 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md border border-sky-200"
                        title="Provedor usado para o disparo por WhatsApp desta automação"
                      >
                        {rotina.provedor_whatsapp === 'ZAPI' ? 'Z-API' : rotina.provedor_whatsapp === 'META' ? 'Meta' : 'Padrão'}
                      </span>
                    </>
                  )}
                  {rotina.canais.includes('E-mail') && (
                    <span className="bg-gray-200 text-gray-700 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md border border-gray-300">
                      E-mail
                    </span>
                  )}
                </div>
                <button onClick={() => abrirModalEditar(rotina)} className="text-[10px] font-black text-[#336699] uppercase tracking-wider hover:underline">
                  Configurar ⚙️
                </button>
              </div>
            </div>
          ))}
        </div>
        )}

      </div>

      {/* MODAL DE CRIAR/EDITAR AUTOMAÇÃO */}
      {modalAutomacao?.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white flex-shrink-0">
              <h3 className="font-black uppercase tracking-wider text-sm">
                {modalAutomacao.isNew ? '➕ Nova Automação' : '⚙️ Configurar Automação'}
              </h3>
              <button onClick={() => setModalAutomacao(null)} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Nome da Automação</label>
                <input
                  type="text"
                  className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-bold text-[#0C1D4D]"
                  value={modalAutomacao.form.nome}
                  onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, nome: e.target.value } })}
                  placeholder="Ex: Cobrança Preventiva (Locação)"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Empresa</label>
                <select
                  className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                  value={modalAutomacao.form.empresaId ?? ''}
                  onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, empresaId: e.target.value ? Number(e.target.value) : null } })}
                  disabled={empresasCatalogoVisivel.length <= 1}
                >
                  {empresasCatalogoVisivel.length !== 1 && <option value="">Todas as empresas</option>}
                  {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
                <p className="text-[10px] text-[#94A3B8] mt-1">
                  Restringe quem recebe (funcionários dessa empresa) e quem pode configurar esta automação. "Todas as empresas" mantém o comportamento de sempre.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Descrição</label>
                <textarea
                  className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm"
                  rows={2}
                  value={modalAutomacao.form.descricao}
                  onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, descricao: e.target.value } })}
                  placeholder="O que esta automação faz?"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Tipo</label>
                <select
                  className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer"
                  value={modalAutomacao.form.tipo}
                  onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, tipo: e.target.value as 'CRON' | 'WEBHOOK' } })}
                >
                  <option value="CRON">⏱️ Agendamento (Cron)</option>
                  <option value="WEBHOOK">⚡ Evento (Webhook)</option>
                </select>
              </div>

              {modalAutomacao.form.tipo === 'CRON' ? (
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Horário do Disparo</label>
                  <input
                    type="time"
                    step={300}
                    className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm mb-3"
                    value={modalAutomacao.form.horario}
                    onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, horario: e.target.value } })}
                  />
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-2">Dias da Semana</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((label, dia) => (
                      <button
                        type="button"
                        key={dia}
                        onClick={() => alternarDiaSemana(dia)}
                        className={`w-11 h-9 rounded-lg text-[10px] font-black uppercase transition-colors ${modalAutomacao.form.dias_semana.includes(dia) ? 'bg-[#336699] text-white' : 'bg-[#F1F5F9] text-[#64748B] border border-[#CBD5E1]'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#94A3B8] mt-1">O motor de Cron verifica os horários a cada 5 minutos.</p>

                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1 mt-3">Fonte de Dados (lista dinâmica)</label>
                  <select
                    className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer"
                    value={modalAutomacao.form.fonte_dados ?? ''}
                    onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, fonte_dados: e.target.value || null } })}
                  >
                    <option value="">Nenhuma (mensagem simples)</option>
                    {FONTES_DADOS_DISPONIVEIS.map(f => <option key={f.valor} value={f.valor}>{f.label}</option>)}
                  </select>
                  <p className="text-[10px] text-[#94A3B8] mt-1">
                    {modalAutomacao.form.fonte_dados
                      ? <>Preenche <code>{'{{lista}}'}</code> e <code>{'{{quantidade}}'}</code> na mensagem automaticamente a cada execução. Se não houver nada a reportar no dia, esta automação não dispara.</>
                      : 'Sem fonte de dados, a mensagem usa só as variáveis do funcionário destinatário (nome) — nenhuma lista é calculada.'}
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Evento do Sistema</label>
                  <select
                    className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer"
                    value={modalAutomacao.form.evento_sistema ?? ''}
                    onChange={e => {
                      const evento = EVENTOS_SISTEMA_DISPONIVEIS.find(ev => ev.valor === e.target.value);
                      setModalAutomacao({
                        ...modalAutomacao,
                        form: { ...modalAutomacao.form, evento_sistema: evento?.valor || null, gatilho: evento?.label || '' },
                      });
                    }}
                  >
                    <option value="">Nenhum (não dispara sozinho)</option>
                    {EVENTOS_SISTEMA_DISPONIVEIS.map(ev => <option key={ev.valor} value={ev.valor}>{ev.label}</option>)}
                  </select>
                  {modalAutomacao.form.evento_sistema ? (
                    <p className="text-[10px] text-[#94A3B8] mt-1">
                      Variáveis disponíveis: {EVENTOS_SISTEMA_DISPONIVEIS.find(ev => ev.valor === modalAutomacao.form.evento_sistema)?.variaveis.map(v => <code key={v} className="mr-1">{`{{${v}}}`}</code>)}
                      {' '}(além de <code>{'{{primeiro_nome}}'}</code>/<code>{'{{nome_completo}}'}</code> do destinatário). Pode haver mais de uma automação para o mesmo evento.
                    </p>
                  ) : (
                    <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1">
                      ⚠️ Sem evento de sistema vinculado — esta automação nunca vai disparar sozinha. Um evento novo, que o sistema ainda não sabe detectar, precisa ser adicionado ao código uma vez.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Mensagem</label>
                <textarea
                  className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-mono"
                  rows={4}
                  value={modalAutomacao.form.mensagem}
                  onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, mensagem: e.target.value } })}
                  placeholder={'Olá, *{{primeiro_nome}}*! Não esqueça de bater o ponto.'}
                />
                <p className="text-[10px] text-[#94A3B8] mt-1">
                  Placeholders disponíveis: <code>{'{{primeiro_nome}}'}</code> e <code>{'{{nome_completo}}'}</code> sempre; mais as variáveis da Fonte de Dados ou do Evento do Sistema escolhidos acima, se houver.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Público-Alvo</label>
                <input
                  type="text"
                  className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm"
                  value={modalAutomacao.form.publico_alvo}
                  onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, publico_alvo: e.target.value } })}
                  placeholder="Ex: Técnicos de Campo"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-2">Canais de Disparo</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs font-bold text-[#0A2A4A] cursor-pointer">
                    <input type="checkbox" checked={modalAutomacao.form.canais.includes('WhatsApp')} onChange={() => alternarCanalModal('WhatsApp')} />
                    WhatsApp
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-[#0A2A4A] cursor-pointer">
                    <input type="checkbox" checked={modalAutomacao.form.canais.includes('E-mail')} onChange={() => alternarCanalModal('E-mail')} />
                    E-mail
                  </label>
                </div>
              </div>

              {modalAutomacao.form.canais.includes('WhatsApp') && (
                <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-2">Provedor WhatsApp</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['PADRAO', 'ZAPI', 'META'] as const).map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, provedor_whatsapp: p } })}
                          className={`p-2 rounded-lg text-[10px] font-black uppercase border-2 ${modalAutomacao.form.provedor_whatsapp === p ? 'border-[#336699] bg-blue-50 text-[#336699]' : 'border-gray-200 text-gray-400'}`}
                        >
                          {p === 'PADRAO' ? 'Padrão do sistema' : p === 'ZAPI' ? 'Z-API' : 'Meta'}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#94A3B8] mt-1">
                      "Padrão" segue o interruptor global de Envio em /admin/integração. Z-API ou Meta forçam esse provedor só para esta automação.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Template da Meta (opcional)</label>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input
                        type="text"
                        className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm"
                        value={modalAutomacao.form.meta_template_nome}
                        onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, meta_template_nome: e.target.value } })}
                        placeholder="Nome do template (ex: lembrete_ponto_entrada)"
                      />
                      <input
                        type="text"
                        className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm"
                        value={modalAutomacao.form.meta_template_idioma}
                        onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, meta_template_idioma: e.target.value } })}
                        placeholder="Idioma (ex: pt_BR)"
                      />
                    </div>
                    <input
                      type="text"
                      className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-mono"
                      value={modalAutomacao.form.meta_template_variaveis}
                      onChange={e => setModalAutomacao({ ...modalAutomacao, form: { ...modalAutomacao.form, meta_template_variaveis: e.target.value } })}
                      placeholder="Variáveis, na ordem do template (ex: primeiro_nome)"
                    />
                    <p className="text-[10px] text-[#94A3B8] mt-1">
                      Só é usado quando o provedor efetivo do disparo (Padrão ou explícito) for a Meta. Sem template configurado, tenta texto livre — só funciona se o destinatário tiver falado com o número nas últimas 24h.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-2">Destinatários do Disparo</label>
                <div className="flex flex-wrap gap-4 mb-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-[#0A2A4A] cursor-pointer">
                    <input
                      type="radio"
                      name="modoDestinatarios"
                      checked={modalAutomacao.modoTodos && modalAutomacao.form.publico_dinamico === 'PADRAO'}
                      onChange={() => setModalAutomacao({ ...modalAutomacao, modoTodos: true, form: { ...modalAutomacao.form, publico_dinamico: 'PADRAO' } })}
                    />
                    Todos os funcionários ativos
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-[#0A2A4A] cursor-pointer">
                    <input
                      type="radio"
                      name="modoDestinatarios"
                      checked={!modalAutomacao.modoTodos && modalAutomacao.form.publico_dinamico === 'PADRAO'}
                      onChange={() => setModalAutomacao({ ...modalAutomacao, modoTodos: false, form: { ...modalAutomacao.form, publico_dinamico: 'PADRAO' } })}
                    />
                    Selecionar funcionários específicos
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-[#0A2A4A] cursor-pointer">
                    <input
                      type="radio"
                      name="modoDestinatarios"
                      checked={modalAutomacao.form.publico_dinamico === 'ANIVERSARIANTES_FUNCIONARIOS'}
                      onChange={() => setModalAutomacao({
                        ...modalAutomacao,
                        modoTodos: true,
                        form: {
                          ...modalAutomacao.form,
                          publico_dinamico: 'ANIVERSARIANTES_FUNCIONARIOS',
                          destinatarios: [],
                          mensagem: modalAutomacao.form.mensagem || '🎉 Feliz aniversário, {{primeiro_nome}}! Toda a equipe Rentech deseja um dia incrível! 🎂',
                        }
                      })}
                    />
                    🎂 Aniversariantes do dia (funcionários)
                  </label>
                </div>

                {modalAutomacao.form.publico_dinamico === 'ANIVERSARIANTES_FUNCIONARIOS' && (
                  <p className="text-[10px] text-[#64748B] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-2 mb-1">
                    Recalculado a cada execução: dispara só para quem faz aniversário no dia, com base na Data de Nascimento cadastrada em RH → Funcionários. Configure o horário/dias abaixo cobrindo todos os 7 dias da semana, já que aniversário não respeita dia útil.
                  </p>
                )}

                {!modalAutomacao.modoTodos && modalAutomacao.form.publico_dinamico === 'PADRAO' && (
                  <div className="border border-[#CBD5E1] rounded-lg max-h-56 overflow-y-auto">
                    {Object.keys(gruposCargo).length === 0 ? (
                      <p className="text-xs text-center text-[#94A3B8] py-4">Nenhum funcionário ativo cadastrado.</p>
                    ) : (
                      Object.entries(gruposCargo).map(([cargo, lista]) => {
                        const nomesDoGrupo = lista.map(f => f.nome_completo);
                        const todosMarcados = nomesDoGrupo.every(n => modalAutomacao.form.destinatarios.includes(n));
                        return (
                          <div key={cargo} className="border-b border-[#E2E8F0] last:border-b-0">
                            <label className="flex items-center gap-2 px-3 py-2 bg-[#F8FAFC] cursor-pointer">
                              <input type="checkbox" checked={todosMarcados} onChange={() => alternarGrupoCargo(nomesDoGrupo)} />
                              <span className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-wider">{cargo} ({lista.length})</span>
                            </label>
                            {lista.map(f => (
                              <label key={f.nome_completo} className="flex items-center gap-2 px-6 py-1.5 cursor-pointer hover:bg-[#F8FAFC]">
                                <input
                                  type="checkbox"
                                  checked={modalAutomacao.form.destinatarios.includes(f.nome_completo)}
                                  onChange={() => alternarDestinatario(f.nome_completo)}
                                />
                                <span className="text-xs font-medium text-[#0A2A4A]">{f.nome_completo}</span>
                              </label>
                            ))}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
                {modalAutomacao.form.publico_dinamico === 'PADRAO' && (
                <p className="text-[10px] text-[#94A3B8] mt-1">
                  {modalAutomacao.modoTodos
                    ? 'Válido apenas para automações que disparam para a equipe interna cadastrada em Funcionários.'
                    : `${modalAutomacao.form.destinatarios.length} funcionário(s) selecionado(s).`}
                </p>
                )}
              </div>

              {!modalAutomacao.isNew && modalAutomacao.chave && (
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3">
                  <p className="text-[10px] font-bold text-[#64748B] uppercase mb-1">Identificador Técnico (chave)</p>
                  <p className="text-xs font-mono text-[#336699]">{modalAutomacao.chave}</p>
                  <p className="text-[10px] text-[#94A3B8] mt-1">Identificador interno estável, usado nos registros de envio e na última execução. Não muda ao editar o nome. Quem liga esta automação ao Cron ou a um evento do sistema são os campos "Fonte de Dados"/"Evento do Sistema" acima, não esta chave.</p>
                </div>
              )}
            </div>

            <div className="border-t border-[#E2E8F0] p-4 flex justify-between items-center flex-shrink-0 bg-[#F8FAFC]">
              {!modalAutomacao.isNew ? (
                <button
                  onClick={excluirAutomacao}
                  disabled={salvandoAutomacao}
                  className="text-[10px] font-black text-red-600 uppercase tracking-wider hover:underline disabled:opacity-50"
                >
                  🗑️ Excluir
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button
                  onClick={() => setModalAutomacao(null)}
                  disabled={salvandoAutomacao}
                  className="px-5 py-2.5 rounded-lg font-black text-xs uppercase tracking-wider text-[#64748B] hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={salvarAutomacao}
                  disabled={salvandoAutomacao}
                  className="bg-[#336699] hover:bg-[#284B8C] text-white px-6 py-2.5 rounded-lg font-black text-xs uppercase tracking-wider transition-colors shadow-md disabled:opacity-50"
                >
                  {salvandoAutomacao ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}