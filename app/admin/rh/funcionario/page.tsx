//app\admin\rh\funcionario\page.tsx

"use client";
 
import { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { salvarColaboradorAction } from '../actions/actions-folha';

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

// Utilitários
const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

const formatarMesAnoBR = (mesAnoIso: string) => {
  if (!mesAnoIso) return '';
  const [ano, mes] = mesAnoIso.split('-');
  return `${mes}/${ano}`;
};

// A RenTech paga a competência no MÊS SEGUINTE. Esta função traduz a
// competência (mês trabalhado) para o mês em que o dinheiro efetivamente sai.
const competenciaParaPagamento = (mesAnoIso: string) => {
  if (!mesAnoIso) return '';
  const [ano, mes] = mesAnoIso.split('-').map(Number);
  const d = new Date(ano, mes, 1); // mes (0-based) + 1 = mês seguinte
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const calcularMesFim = (mesInicio: string, parcelas: number) => {
  if (!mesInicio || parcelas < 1) return mesInicio;
  const [ano, mes] = mesInicio.split('-').map(Number);
  const dataFim = new Date(ano, (mes - 1) + (parcelas - 1), 1);
  return `${dataFim.getFullYear()}-${String(dataFim.getMonth() + 1).padStart(2, '0')}`;
};

// Interfaces
interface RegraContrato {
  nome_regra: string;
  paga_salario_base: boolean;
  calcula_extras_padrao: boolean;
  percentual_extra_semana: number;
  percentual_extra_sabado: number;
  tipo_pagamento_fds: 'HORA_PERCENTUAL' | 'VALOR_DIARIA';
  percentual_extra_dom_fer: number;
  valor_diaria_fds: number;
  desconta_faltas: boolean;
  direito_vr: boolean;
  direito_vt: boolean;
  modalidade_beneficio: 'POR_DIA' | 'VALOR_FECHADO';
  so_documental: boolean;
}

interface FuncionarioFin {
  nome_completo: string; cargo: string; tipo_contrato: string; ativo: boolean;
  recebe_transporte: boolean; valor_transporte: number;
  recebe_refeicao: boolean; valor_refeicao: number;
  salario_folha: number; salario_contrato: number;
  valor_diaria: number; valor_adiantamento: number;
  data_admissao: string | null; data_desligamento: string | null;
  data_nascimento: string | null; cpf: string | null; celular: string | null; email: string | null;
  ponto_whatsapp_ativo: boolean;
  banco_codigo: string | null; banco_agencia: string | null; banco_conta: string | null; banco_tipo: string | null;
  pix_tipo: string | null; pix_chave: string | null;
  recebe_fechamento: boolean | null; recebe_holerite: boolean | null;
}

interface Desconto { id?: string; funcionario_nome?: string; descricao: string; tipo: 'FIXO' | 'PARCELADO'; parcelas: number; mes_inicio: string; mes_fim: string; valor_parcela: number; }
interface Bonus { id?: string; funcionario_nome?: string; descricao: string; recorrencia: 'MENSAL' | 'UNICO'; mes_referencia: string; valor: number; }

export default function FuncionarioPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [emailUsuario, setEmailUsuario] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  const [loading, setLoading] = useState(false);
  const [listaFuncionarios, setListaFuncionarios] = useState<FuncionarioFin[]>([]);
  const [regrasContrato, setRegrasContrato] = useState<Record<string, RegraContrato>>({});
  const [cargosCatalogo, setCargosCatalogo] = useState<string[]>([]);

  const [buscaGrid, setBuscaGrid] = useState('');
  const [filtroContrato, setFiltroContrato] = useState('TODOS');
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<string | null>(null);
  const [fichaExpandida, setFichaExpandida] = useState(false);

  const [mesReferencia, setMesReferencia] = useState(() => {
    const hoje = new Date();
    const comp = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    return `${comp.getFullYear()}-${String(comp.getMonth() + 1).padStart(2, '0')}`;
  });

  const defaultForm: FuncionarioFin = {
    nome_completo: '', cargo: '', tipo_contrato: 'CLT + Contrato', ativo: true,
    recebe_transporte: false, valor_transporte: 0, recebe_refeicao: false, valor_refeicao: 0,
    salario_folha: 0, salario_contrato: 0, valor_diaria: 0, valor_adiantamento: 0,
    data_admissao: null, data_desligamento: null,
    data_nascimento: null, cpf: null, celular: null, email: null,
    ponto_whatsapp_ativo: false,
    banco_codigo: null, banco_agencia: null, banco_conta: null, banco_tipo: null,
    pix_tipo: null, pix_chave: null,
    recebe_fechamento: null, recebe_holerite: null
  };

  const [form, setForm] = useState<FuncionarioFin>(defaultForm);
  const [descontos, setDescontos] = useState<Desconto[]>([]);
  const [bonus, setBonus] = useState<Bonus[]>([]);

  const [snapshotFicha, setSnapshotFicha] = useState('');
  const [mostrarQuitados, setMostrarQuitados] = useState(false);
  const [mostrarBonusEncerrados, setMostrarBonusEncerrados] = useState(false);

  const fichaAtualSerializada = useMemo(
    () => JSON.stringify({ form, descontos, bonus }),
    [form, descontos, bonus]
  );
  const temAlteracoesNaoSalvas = snapshotFicha !== '' && fichaAtualSerializada !== snapshotFicha;

  // Valida a sessão e a permissão (dinâmica, via banco) antes de liberar a página
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
      setUsuarioAtual(perfil.nome || 'Equipe RH');
      setEmailUsuario(perfil.email || session.user.email || '');
      setAuthLoading(false);
      inicializarDados();
    }
    checkAuth();
  }, [router, pathname]);

  useEffect(() => {
    if (funcionarioSelecionado && funcionarioSelecionado !== 'NOVO') {
      carregarDetalhes(funcionarioSelecionado);
    }
  }, [funcionarioSelecionado]);

  const inicializarDados = async () => {
    setLoading(true);

    // Carrega Motor de Regras
    const { data: regrasData } = await supabase.from('folha_parametros').select('*');
    if (regrasData) {
      const mapaRegras: Record<string, RegraContrato> = {};
      regrasData.forEach((r) => {
        mapaRegras[r.nome_regra] = {
          nome_regra: r.nome_regra, paga_salario_base: r.paga_salario_base,
          calcula_extras_padrao: r.calcula_extras_padrao,
          percentual_extra_semana: r.percentual_extra_semana ?? 60,
          percentual_extra_sabado: r.percentual_extra_sabado ?? 60,
          tipo_pagamento_fds: r.tipo_pagamento_fds === 'HORA_100' ? 'HORA_PERCENTUAL' : (r.tipo_pagamento_fds || 'HORA_PERCENTUAL'),
          percentual_extra_dom_fer: r.percentual_extra_dom_fer ?? 100,
          valor_diaria_fds: r.valor_diaria_fds ?? 0, desconta_faltas: r.desconta_faltas,
          direito_vr: r.direito_vr ?? false, direito_vt: r.direito_vt ?? false,
          modalidade_beneficio: r.modalidade_beneficio || 'POR_DIA',
          so_documental: r.so_documental ?? false
        };
      });
      setRegrasContrato(mapaRegras);
    }

    const { data: cargosData } = await supabase.from('folha_cargo').select('nome').order('nome');
    if (cargosData) setCargosCatalogo(cargosData.map(c => c.nome));

    carregarListaFuncionarios();
  };

  const carregarListaFuncionarios = async () => {
    const { data } = await supabase.from('folha_funcionarios').select('*').order('nome_completo');
    if (data) setListaFuncionarios(data);
    setLoading(false);
  };

  const carregarDetalhes = async (nome: string) => {
    setLoading(true);

    const { data: funcData, error: funcError } = await supabase
      .from('folha_funcionarios').select('*').eq('nome_completo', nome).single();
    if (funcError || !funcData) {
      alert(`Não foi possível carregar a ficha de ${nome}: ${funcError?.message || 'registro não encontrado'}`);
      setLoading(false);
      return;
    }
    setForm(funcData);

    const { data: descData } = await supabase.from('folha_descontos').select('*').eq('funcionario_nome', nome);
    setDescontos(descData ? descData.map(d => ({ ...d, tipo: d.tipo || 'PARCELADO' })) : []);

    const { data: bonusData } = await supabase.from('folha_bonus').select('*').eq('funcionario_nome', nome);
    setBonus(bonusData || []);

    setSnapshotFicha(JSON.stringify({
      form: funcData,
      descontos: descData ? descData.map(d => ({ ...d, tipo: d.tipo || 'PARCELADO' })) : [],
      bonus: bonusData || []
    }));

    setLoading(false);
  };

  const prepararNovo = () => {
    setFuncionarioSelecionado('NOVO'); setForm(defaultForm);
    setDescontos([]); setBonus([]);
    setFichaExpandida(true);
  };

  const salvarColaborador = async (): Promise<boolean> => {
    if (!form.nome_completo) { alert("O Nome Completo é obrigatório."); return false; }
    setLoading(true);

    try {
      const res = await salvarColaboradorAction({ form, descontos, bonus, usuarioNome: usuarioAtual });
      if (!res.ok) throw new Error(res.erro);

      alert("Ficha guardada com sucesso!");
      setSnapshotFicha(JSON.stringify({ form, descontos, bonus }));
      carregarListaFuncionarios();
      if (funcionarioSelecionado === 'NOVO') setFuncionarioSelecionado(form.nome_completo);
      return true;
    } catch (e: any) { alert("Erro ao salvar: " + e.message); return false; }
    finally { setLoading(false); }
  };

  const trocarFuncionario = async (nome: string) => {
    if (nome === funcionarioSelecionado) return;

    if (temAlteracoesNaoSalvas) {
      const salvar = confirm(
        `A ficha de ${form.nome_completo || 'este colaborador'} tem alterações não salvas.\n\n` +
        `OK = Salvar antes de trocar\nCancelar = Descartar as alterações`
      );
      if (salvar) {
        const ok = await salvarColaborador();
        if (!ok) return;
      }
    }

    setFuncionarioSelecionado(nome);
  };

  const alternarStatusAtivo = async () => setForm({ ...form, ativo: !form.ativo });

  const addDesconto = () => setDescontos([...descontos, { descricao: '', tipo: 'PARCELADO', parcelas: 1, mes_inicio: mesReferencia, mes_fim: mesReferencia, valor_parcela: 0 }]);
  const addBonus = () => setBonus([...bonus, { descricao: '', recorrencia: 'UNICO', mes_referencia: mesReferencia, valor: 0 }]);
  const removeDesconto = (idx: number) => setDescontos(descontos.filter((_, i) => i !== idx));
  const removeBonus = (idx: number) => setBonus(bonus.filter((_, i) => i !== idx));

  const handleDescontoChange = <K extends keyof Desconto>(idx: number, campo: K, valor: Desconto[K]) => {
    const novosDescontos = [...descontos];
    novosDescontos[idx] = { ...novosDescontos[idx], [campo]: valor };
    if (campo === 'tipo') {
      novosDescontos[idx].mes_fim = valor === 'FIXO' ? '2099-12' : calcularMesFim(novosDescontos[idx].mes_inicio, novosDescontos[idx].parcelas);
    } else if (campo === 'mes_inicio' || campo === 'parcelas') {
      if (novosDescontos[idx].tipo === 'PARCELADO') {
        novosDescontos[idx].mes_fim = calcularMesFim(novosDescontos[idx].mes_inicio, novosDescontos[idx].parcelas || 1);
      }
    }
    setDescontos(novosDescontos);
  };

  const regraAtiva = regrasContrato[form.tipo_contrato] || null;

  const contratosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    listaFuncionarios.forEach(f => { if (f.tipo_contrato) set.add(f.tipo_contrato); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [listaFuncionarios]);

  const funcFiltrados = useMemo(() =>
    listaFuncionarios
      .filter(f => f.nome_completo.toLowerCase().includes(buscaGrid.toLowerCase()))
      .filter(f => filtroContrato === 'TODOS' || f.tipo_contrato === filtroContrato)
      .sort((a, b) => {
        if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
        return a.nome_completo.localeCompare(b.nome_completo);
      }),
    [listaFuncionarios, buscaGrid, filtroContrato]);

  const descontosComIndice = useMemo(() => descontos.map((d, idx) => {
    let quitado = false;
    if (d.tipo === 'PARCELADO' && d.mes_inicio && d.parcelas > 0) {
      const fimReal = calcularMesFim(d.mes_inicio, d.parcelas);
      quitado = mesReferencia > fimReal;
    }
    return { d, idx, quitado };
  }), [descontos, mesReferencia]);
  const qtdQuitados = useMemo(() => descontosComIndice.filter(x => x.quitado).length, [descontosComIndice]);

  const bonusComIndice = useMemo(() => bonus.map((b, idx) => ({
    b, idx,
    encerrado: b.recorrencia === 'UNICO' && !!b.mes_referencia && mesReferencia > b.mes_referencia
  })), [bonus, mesReferencia]);
  const qtdBonusEncerrados = useMemo(() => bonusComIndice.filter(x => x.encerrado).length, [bonusComIndice]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <p className="text-[#64748B] font-bold text-sm uppercase tracking-wider">Validando acesso...</p>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar a Ficha de Funcionários.</p>
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

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm print:hidden">
        <p className="text-[#0369A1] font-medium text-sm">
          🧑 <strong>Dados dos Funcionários.</strong> Todas as informações base dos funcionários são inseridas nessa página.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 flex-grow flex flex-col lg:flex-row gap-6 max-w-[1500px] mx-auto w-full">

        {/* LISTAGEM LATERAL */}
        <aside className="w-full lg:w-80 flex-shrink-0 space-y-4 print:hidden">
          <div className="bg-[#0C1D4D] p-5 rounded-2xl shadow-md text-white">
            <h2 className="font-black uppercase tracking-wider mb-4">Equipe Rentech</h2>
            <input
              type="text" placeholder="Buscar nome..." value={buscaGrid} onChange={e => setBuscaGrid(e.target.value)}
              className="w-full p-2.5 rounded-lg text-sm text-white bg-[#1E3A6E] outline-none font-bold placeholder:text-blue-200"
            />
            <select
              value={filtroContrato} onChange={e => setFiltroContrato(e.target.value)}
              className="w-full mt-3 p-2.5 rounded-lg text-sm text-white bg-[#1E3A6E] outline-none font-bold cursor-pointer"
            >
              <option value="TODOS">Todos os contratos</option>
              {contratosDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {filtroContrato !== 'TODOS' && (
              <p className="text-[10px] text-blue-200 font-bold mt-2 uppercase tracking-wider">
                {funcFiltrados.length} de {listaFuncionarios.length} — filtrado por contrato
              </p>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden max-h-[65vh] overflow-y-auto">
            {funcFiltrados.map((f, i) => (
              <div
                key={i} onClick={() => trocarFuncionario(f.nome_completo)}
                className={`p-4 border-b border-[#E2E8F0] cursor-pointer transition-colors flex justify-between items-center ${funcionarioSelecionado === f.nome_completo ? 'bg-blue-50 border-l-4 border-l-[#336699]' : 'hover:bg-gray-50'}`}
              >
                <div>
                  <strong className={`block text-xs uppercase tracking-wider ${f.ativo ? 'text-[#0C1D4D]' : 'text-gray-400 line-through'}`}>{f.nome_completo}</strong>
                  <span className="text-[10px] text-gray-500 font-medium">{f.cargo || 'Sem função'}</span>
                </div>
                {!f.ativo && <span className="bg-red-100 text-red-700 text-[9px] font-black px-2 py-0.5 rounded">INATIVO</span>}
              </div>
            ))}
          </div>
        </aside>

        {/* CORPO */}
        <main className="flex-grow flex flex-col gap-4">

          <div className="bg-white p-3 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row items-center gap-2 print:hidden">
            <div className="flex bg-[#F1F5F9] p-1 rounded-xl border border-[#E2E8F0] w-full sm:w-auto">
              <span className="flex-1 sm:flex-initial px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg bg-[#0C1D4D] text-white shadow-sm">
                👤 Ficha Individual
              </span>
            </div>
            <button
              onClick={prepararNovo}
              className="w-full sm:w-auto sm:ml-auto bg-blue-500 hover:bg-blue-400 text-white font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm"
            >
              + Novo Colaborador
            </button>
          </div>

          {!funcionarioSelecionado ? (
            <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl h-full flex items-center justify-center text-gray-400 font-bold uppercase tracking-wider print:hidden p-20">
              Selecione um colaborador no menu lateral
            </div>
          ) : (
            <div className="flex flex-col gap-6 print:hidden pb-20">
              <div className="grid grid-cols-1 xl:grid-cols-1 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4 h-fit">
                  <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-2">
                    <button onClick={() => setFichaExpandida(!fichaExpandida)} className="flex items-center gap-2 text-left group">
                      <span className="text-[#336699] font-black text-lg transition-transform" style={{ transform: fichaExpandida ? 'rotate(90deg)' : 'none' }}>▸</span>
                      <div>
                        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider group-hover:text-[#336699] transition-colors">{form.nome_completo || 'Novo Colaborador'}</h3>
                        {!fichaExpandida && <span className="text-[10px] text-gray-400 font-bold uppercase">{form.cargo || 'sem cargo'} • {form.tipo_contrato} • clique para editar dados</span>}
                      </div>
                    </button>
                    <button onClick={alternarStatusAtivo} className={`text-[10px] px-3 py-1 rounded font-black uppercase tracking-wider transition-colors flex-shrink-0 ${form.ativo ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                      {form.ativo ? 'SUSPENDER' : 'REATIVAR'}
                    </button>
                  </div>

                  {fichaExpandida && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nome Completo</label>
                        <input type="text" value={form.nome_completo} onChange={e => setForm({...form, nome_completo: e.target.value.toUpperCase()})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-gray-50 uppercase" />
                    </div>

                    <div className="col-span-2 grid grid-cols-2 gap-4 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
                      <div className="col-span-2 text-[10px] font-black text-indigo-600 uppercase tracking-wider">Dados Pessoais (para assinatura digital)</div>
                      <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">CPF</label><input type="text" value={form.cpf || ''} onChange={e => setForm({...form, cpf: e.target.value || null})} placeholder="000.000.000-00" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                      <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Data de Nascimento</label><input type="date" value={form.data_nascimento || ''} onChange={e => setForm({...form, data_nascimento: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                      <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Celular (WhatsApp)</label><input type="tel" value={form.celular || ''} onChange={e => setForm({...form, celular: e.target.value || null})} placeholder="(11) 90000-0000" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                      <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">E-mail</label><input type="email" value={form.email || ''} onChange={e => setForm({...form, email: e.target.value || null})} placeholder="nome@email.com" className="w-full p-2 border border-gray-300 rounded text-sm lowercase" /></div>
                      <div className="col-span-2 flex items-center gap-2 bg-white p-2.5 rounded-lg border border-indigo-100">
                        <input type="checkbox" id="ponto_whatsapp_ativo" checked={form.ponto_whatsapp_ativo} onChange={e => setForm({...form, ponto_whatsapp_ativo: e.target.checked})} className="w-4 h-4" />
                        <label htmlFor="ponto_whatsapp_ativo" className="text-[11px] font-bold text-gray-600 uppercase">📲 Bate ponto pelo WhatsApp (usa o Celular acima)</label>
                      </div>

                      <div className="col-span-2 text-[10px] font-black text-indigo-600 uppercase tracking-wider mt-2">Dados Bancários (para pagamento)</div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Chave PIX</label>
                        <div className="flex gap-1">
                          <select value={form.pix_tipo || ''} onChange={e => setForm({...form, pix_tipo: e.target.value || null})} className="p-2 border border-gray-300 rounded text-xs font-bold bg-white">
                            <option value="">Tipo</option>
                            <option value="CPF">CPF</option>
                            <option value="EMAIL">E-mail</option>
                            <option value="TELEFONE">Telefone</option>
                            <option value="ALEATORIA">Aleatória</option>
                          </select>
                          <input type="text" value={form.pix_chave || ''} onChange={e => setForm({...form, pix_chave: e.target.value || null})} placeholder="chave pix" className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tipo de conta</label>
                        <select value={form.banco_tipo || ''} onChange={e => setForm({...form, banco_tipo: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
                          <option value="">— Selecione —</option>
                          <option value="CORRENTE">Corrente</option>
                          <option value="POUPANCA">Poupança</option>
                        </select>
                      </div>
                      <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Banco (código)</label><input type="text" value={form.banco_codigo || ''} onChange={e => setForm({...form, banco_codigo: e.target.value || null})} placeholder="341" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Agência</label><input type="text" value={form.banco_agencia || ''} onChange={e => setForm({...form, banco_agencia: e.target.value || null})} placeholder="0000" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                        <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Conta</label><input type="text" value={form.banco_conta || ''} onChange={e => setForm({...form, banco_conta: e.target.value || null})} placeholder="00000-0" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                      </div>
                      <div className="col-span-2 text-[10px] text-gray-400 font-medium">💡 PIX tem prioridade no pagamento. Se não houver PIX, usa a conta bancária.</div>

                      <div className="col-span-2 text-[10px] font-black text-indigo-600 uppercase tracking-wider mt-2">O que este funcionário recebe</div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Recebe fechamento (nossa folha)</label>
                        <select value={form.recebe_fechamento === null ? 'HERDA' : form.recebe_fechamento ? 'SIM' : 'NAO'}
                          onChange={e => setForm({...form, recebe_fechamento: e.target.value === 'HERDA' ? null : e.target.value === 'SIM'})}
                          className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
                          <option value="HERDA">↑ Herda (cargo/contrato)</option>
                          <option value="SIM">✓ Sim, recebe</option>
                          <option value="NAO">✕ Não recebe</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Recebe holerite (contabilidade)</label>
                        <select value={form.recebe_holerite === null ? 'HERDA' : form.recebe_holerite ? 'SIM' : 'NAO'}
                          onChange={e => setForm({...form, recebe_holerite: e.target.value === 'HERDA' ? null : e.target.value === 'SIM'})}
                          className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
                          <option value="HERDA">↑ Herda (cargo/contrato)</option>
                          <option value="SIM">✓ Sim, recebe</option>
                          <option value="NAO">✕ Não recebe</option>
                        </select>
                      </div>
                      <div className="col-span-2 text-[10px] text-gray-400 font-medium">💡 "Herda" segue a regra do cargo, e se o cargo não definir, a do contrato. Marque Sim/Não só para exceções deste funcionário.</div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cargo</label>
                      <select value={form.cargo} onChange={e => setForm({...form, cargo: e.target.value})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white uppercase text-[#0C1D4D]">
                        <option value="">— Selecione —</option>
                        {form.cargo && !cargosCatalogo.includes(form.cargo) && <option value={form.cargo}>{form.cargo} (fora do catálogo)</option>}
                        {cargosCatalogo.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tipo de Regra de Contrato</label>
                      <select value={form.tipo_contrato} onChange={e => setForm({...form, tipo_contrato: e.target.value})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white uppercase text-[#0C1D4D]">
                        {Object.keys(regrasContrato).map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>

                    <div className="col-span-2 grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Data de Admissão</label>
                        <input type="date" value={form.data_admissao || ''} onChange={e => setForm({...form, data_admissao: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Data de Desligamento</label>
                        <input type="date" value={form.data_desligamento || ''} onChange={e => setForm({...form, data_desligamento: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-red-600" />
                        {form.data_desligamento && <p className="text-[9px] font-bold text-red-500 mt-0.5 uppercase">Faltas não contam após esta data</p>}
                      </div>
                    </div>

                    <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Salário Folha</label><input type="number" step="0.01" value={form.salario_folha} onChange={e => setForm({...form, salario_folha: Number(e.target.value)})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-[#0C1D4D]" /></div>
                    <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Salário Contrato Total</label><input type="number" step="0.01" value={form.salario_contrato} onChange={e => setForm({...form, salario_contrato: Number(e.target.value)})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-[#16A34A]" /></div>

                    {regraAtiva && (regraAtiva.direito_vr || regraAtiva.direito_vt) ? (
                      <div className="col-span-2 bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-black text-[#336699] uppercase tracking-wider">Benefícios (VR / VT)</span>
                          <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                            {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' ? 'Valor Fechado (÷30)' : 'Por Dia'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          {regraAtiva.direito_vr && (
                            <div>
                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                                {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' ? 'VR — Valor do Mês' : 'VR — Diária'}
                              </label>
                              <input type="number" step="0.01" value={form.valor_refeicao} onChange={e => setForm({...form, valor_refeicao: Number(e.target.value)})} className="w-full p-2 border border-blue-200 rounded text-sm" />
                              {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' && form.valor_refeicao > 0 && (
                                <p className="text-[9px] font-bold text-blue-600 mt-0.5 uppercase">Diária: {formatCurrency(form.valor_refeicao / 30)}</p>
                              )}
                            </div>
                          )}
                          {regraAtiva.direito_vt && (
                            <div>
                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                                {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' ? 'VT — Valor do Mês' : 'VT — Diária'}
                              </label>
                              <input type="number" step="0.01" value={form.valor_transporte} onChange={e => setForm({...form, valor_transporte: Number(e.target.value)})} className="w-full p-2 border border-blue-200 rounded text-sm" />
                              {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' && form.valor_transporte > 0 && (
                                <p className="text-[9px] font-bold text-blue-600 mt-0.5 uppercase">Diária: {formatCurrency(form.valor_transporte / 30)}</p>
                              )}
                            </div>
                          )}
                        </div>
                        <p className="text-[9px] text-blue-500 font-medium mt-2 uppercase">Os valores são gerados por dia trabalhado conforme a jornada. Configure o direito e a modalidade no Motor de Regras.</p>
                      </div>
                    ) : (
                      <div className="col-span-2 bg-gray-50 p-3 rounded-lg border border-gray-200 text-[10px] font-bold text-gray-400 uppercase text-center">
                        Este contrato ({form.tipo_contrato}) não dá direito a VR/VT. Ajuste no Motor de Regras se necessário.
                      </div>
                    )}
                    <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Adiantamento (Dia 20)</label><input type="number" step="0.01" value={form.valor_adiantamento} onChange={e => setForm({...form, valor_adiantamento: Number(e.target.value)})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-red-600" /></div>
                  </div>
                  )}
                </div>
              </div>

              {/* BÔNUS E DESCONTOS */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-green-200">
                  <div className="flex justify-between items-center border-b border-green-100 pb-2 mb-4">
                    <h3 className="font-black text-[#16A34A] uppercase tracking-wider">Bônus e Prêmios</h3>
                    <button onClick={addBonus} className="text-[10px] bg-green-100 text-green-700 font-black px-3 py-1.5 rounded uppercase tracking-wider">+ ADICIONAR</button>
                  </div>
                  <p className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 uppercase">ℹ️ As datas são a COMPETÊNCIA (mês trabalhado). O pagamento sai sempre no mês seguinte.</p>
                  <div className="space-y-3">
                    {bonusComIndice
                      .filter(({ encerrado }) => mostrarBonusEncerrados || !encerrado)
                      .map(({ b, idx, encerrado }) => (
                      <div key={idx} className={`p-3 border rounded-lg grid grid-cols-2 gap-2 relative group ${encerrado ? 'bg-gray-100 border-gray-200' : 'bg-green-50/30 border-green-100'}`}>
                        {!encerrado && <button onClick={() => removeBonus(idx)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 font-bold opacity-0 group-hover:opacity-100">X</button>}
                        <div className="col-span-2 flex items-center justify-between gap-2">
                          <input type="text" placeholder="Descrição" value={b.descricao} disabled={encerrado} onChange={e => { const n = [...bonus]; n[idx].descricao = e.target.value; setBonus(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs uppercase disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" />
                          {encerrado && <span className="text-[9px] bg-gray-300 text-gray-600 px-2 py-0.5 rounded font-black uppercase whitespace-nowrap">🔒 Pago</span>}
                        </div>
                        <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Valor R$</label><input type="number" step="0.01" value={b.valor} disabled={encerrado} onChange={e => { const n = [...bonus]; n[idx].valor = Number(e.target.value); setBonus(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs text-[#16A34A] font-bold disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" /></div>
                        <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Recorrência</label><select value={b.recorrencia} disabled={encerrado} onChange={e => { const n = [...bonus]; n[idx].recorrencia = e.target.value as 'MENSAL'|'UNICO'; setBonus(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs bg-white disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"><option value="UNICO">Única Vez</option><option value="MENSAL">Fixo (Mensal)</option></select></div>
                        {b.recorrencia === 'UNICO' && <div className="col-span-2"><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Competência do Bônus</label><input type="month" value={b.mes_referencia} disabled={encerrado} onChange={e => { const n = [...bonus]; n[idx].mes_referencia = e.target.value; setBonus(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" />{b.mes_referencia && <p className="text-[9px] font-bold text-emerald-600 mt-0.5 uppercase">💵 Sai no pagamento de {competenciaParaPagamento(b.mes_referencia)}</p>}</div>}
                      </div>
                    ))}

                    {bonus.length === 0 && (
                      <p className="text-[11px] text-gray-400 font-medium text-center py-2 uppercase">Nenhum bônus lançado</p>
                    )}
                  </div>

                  {qtdBonusEncerrados > 0 && (
                    <button
                      onClick={() => setMostrarBonusEncerrados(!mostrarBonusEncerrados)}
                      className="w-full mt-3 text-[10px] font-black uppercase tracking-wider text-gray-500 hover:text-[#0C1D4D] bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg py-2 transition-colors"
                    >
                      {mostrarBonusEncerrados
                        ? `▲ Ocultar ${qtdBonusEncerrados} bônus já pago(s)`
                        : `▼ Ver ${qtdBonusEncerrados} bônus já pago(s)`}
                    </button>
                  )}
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border border-red-200">
                  <div className="flex justify-between items-center border-b border-red-100 pb-2 mb-4">
                    <h3 className="font-black text-red-600 uppercase tracking-wider">Débitos e Descontos</h3>
                    <button onClick={addDesconto} className="text-[10px] bg-red-100 text-red-700 font-black px-3 py-1.5 rounded uppercase tracking-wider">+ ADICIONAR</button>
                  </div>
                  <p className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 uppercase">ℹ️ A "Competência 1ª Parcela" é o mês trabalhado. O desconto sai no pagamento do mês seguinte.</p>
                  <div className="space-y-3">
                    {descontosComIndice
                      .filter(({ quitado }) => mostrarQuitados || !quitado)
                      .map(({ d, idx, quitado }) => {
                      return (
                      <div key={idx} className={`p-3 border rounded-lg grid grid-cols-2 gap-2 relative group ${quitado ? 'bg-gray-100 border-gray-200' : 'bg-red-50/30 border-red-100'}`}>
                        {!quitado && <button onClick={() => removeDesconto(idx)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 font-bold opacity-0 group-hover:opacity-100">X</button>}
                        <div className="col-span-2 flex items-center justify-between gap-2">
                          <input type="text" placeholder="Descrição do Desconto" value={d.descricao} disabled={quitado} onChange={e => handleDescontoChange(idx, 'descricao', e.target.value)} className="w-full p-1.5 border border-gray-200 rounded text-xs uppercase disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" />
                          {quitado && <span className="text-[9px] bg-gray-300 text-gray-600 px-2 py-0.5 rounded font-black uppercase whitespace-nowrap">🔒 Quitado</span>}
                        </div>
                        <div><input type="number" step="0.01" placeholder="Valor R$" value={d.valor_parcela} disabled={quitado} onChange={e => handleDescontoChange(idx, 'valor_parcela', Number(e.target.value))} className="w-full p-1.5 border border-gray-200 rounded text-xs text-red-600 font-bold disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" /></div>
                        <div>
                          <select value={d.tipo} disabled={quitado} onChange={e => handleDescontoChange(idx, 'tipo', e.target.value as Desconto['tipo'])} className="w-full p-1.5 border border-gray-200 rounded text-xs bg-white disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed">
                            <option value="PARCELADO">Parcelado</option>
                            <option value="FIXO">Fixo (Mensal)</option>
                          </select>
                        </div>
                        <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Competência 1ª Parcela</label><input type="month" value={d.mes_inicio} disabled={quitado} onChange={e => handleDescontoChange(idx, 'mes_inicio', e.target.value)} className="w-full p-1.5 border border-gray-200 rounded text-xs disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" /></div>

                        {d.tipo === 'PARCELADO' ? (
                          <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Qtd Parcelas</label><input type="number" placeholder="Qtd Parc." value={d.parcelas} disabled={quitado} onChange={e => handleDescontoChange(idx, 'parcelas', Number(e.target.value))} className="w-full p-1.5 border border-gray-200 rounded text-xs disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" /></div>
                        ) : (
                          <div className="flex items-end"><div className="w-full p-1.5 bg-gray-100 text-gray-500 rounded text-[10px] text-center font-bold">FIXO CONTÍNUO</div></div>
                        )}

                        {d.tipo === 'PARCELADO' && d.mes_inicio && (
                          <div className="col-span-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                            <p className="text-[9px] font-black text-emerald-700 uppercase leading-tight">
                              💵 1ª parcela paga em {competenciaParaPagamento(d.mes_inicio)}
                              {d.mes_fim && ` • última em ${competenciaParaPagamento(d.mes_fim)}`}
                            </p>
                            {quitado && <p className="text-[9px] font-bold text-gray-500 uppercase mt-0.5">Encerrada, bloqueada para edição</p>}
                          </div>
                        )}
                      </div>
                      );
                    })}

                    {descontos.length === 0 && (
                      <p className="text-[11px] text-gray-400 font-medium text-center py-2 uppercase">Nenhum desconto lançado</p>
                    )}
                    {descontos.length > 0 && qtdQuitados === descontos.length && !mostrarQuitados && (
                      <p className="text-[11px] text-gray-400 font-medium text-center py-2 uppercase">Todos os descontos deste colaborador já estão quitados</p>
                    )}
                  </div>

                  {qtdQuitados > 0 && (
                    <button
                      onClick={() => setMostrarQuitados(!mostrarQuitados)}
                      className="w-full mt-3 text-[10px] font-black uppercase tracking-wider text-gray-500 hover:text-[#0C1D4D] bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg py-2 transition-colors"
                    >
                      {mostrarQuitados
                        ? `▲ Ocultar ${qtdQuitados} desconto(s) quitado(s)`
                        : `▼ Ver ${qtdQuitados} desconto(s) quitado(s)`}
                    </button>
                  )}
                </div>
              </div>

              <div className="w-full mt-4">
                <button onClick={salvarColaborador} disabled={loading} className={`w-full font-black uppercase tracking-widest text-sm py-4 rounded-xl shadow-md transition-all active:scale-[0.99] disabled:opacity-50 ${temAlteracoesNaoSalvas ? 'bg-[#16A34A] hover:bg-[#15803D] text-white' : 'bg-[#0C1D4D] hover:bg-[#284B8C] text-white'}`}>
                  {loading ? '⏳ Gravando...' : temAlteracoesNaoSalvas ? '💾 Gravar Alterações' : '💾 Gravar Ficha'}
                </button>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}