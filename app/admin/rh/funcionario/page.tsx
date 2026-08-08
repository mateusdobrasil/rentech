//app\admin\rh\funcionario\page.tsx

"use client";
 
import { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { salvarColaboradorAction, atribuirEmpresaEmMassaAction } from '../actions/actions-folha';
import { uploadFotoFuncionarioAction, urlFotoFuncionarioAction } from '../actions/actions-documentos-func';

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
  if (p.includes('GESTOR')) return 'GESTORES';
  return 'USUARIO';
};

// Utilitários
const formatarMesAnoBR = (mesAnoIso: string) => {
  if (!mesAnoIso) return '';
  const [ano, mes] = mesAnoIso.split('-');
  return `${mes}/${ano}`;
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
  nome_completo: string; cargo: string; departamento: string; empresa_id: number | null; tipo_contrato: string; ativo: boolean;
  recebe_transporte: boolean; valor_transporte: number;
  recebe_refeicao: boolean; valor_refeicao: number;
  salario_folha: number; salario_contrato: number;
  valor_diaria: number; valor_adiantamento: number;
  data_admissao: string | null; data_desligamento: string | null;
  data_nascimento: string | null; cpf: string | null; celular: string | null; email: string | null;
  ponto_whatsapp_ativo: boolean;
  pode_dirigir: boolean;
  banco_codigo: string | null; banco_agencia: string | null; banco_conta: string | null; banco_tipo: string | null;
  pix_tipo: string | null; pix_chave: string | null;
  recebe_fechamento: boolean | null; recebe_holerite: boolean | null;

  // Definições de registro
  pis: string | null; matricula_esocial: string | null; foto_path: string | null;

  // Dados pessoais
  aposentado: boolean | null; pais_nascimento: string | null; cidade_nascimento: string | null;
  estado_civil: string | null; genero: string | null; nome_mae: string | null; nome_pai: string | null;
  etnia: string | null; escolaridade: string | null;

  // Contato e endereço
  telefone_alternativo: string | null; email_alternativo: string | null;
  cep: string | null; cidade: string | null; endereco: string | null; numero: string | null;
  complemento: string | null; bairro: string | null;

  // Informações especiais
  deficiencia_fisica: boolean | null; deficiencia_mental: boolean | null; deficiencia_auditiva: boolean | null;
  deficiencia_intelectual: boolean | null; deficiencia_visual: boolean | null;
  reabilitado_readaptado: boolean | null; notas_especiais: string | null;

  // Trabalhador estrangeiro
  estrangeiro: boolean | null; casado_com_brasileiro: boolean | null; filhos_brasileiros: boolean | null;
  data_chegada_estrangeiro: string | null; tipo_visto_estrangeiro: string | null;
  cep_estrangeiro: string | null; pais_estrangeiro: string | null; cidade_estrangeiro: string | null;
  endereco_estrangeiro: string | null; numero_estrangeiro: string | null;
  complemento_estrangeiro: string | null; bairro_estrangeiro: string | null;
}

interface Dependente { id?: string; funcionario_nome?: string; tipo_dependente: string; nome_completo: string; cpf: string; data_nascimento: string; }
interface Movimentacao { id?: string; funcionario_nome?: string; motivo: 'ADMISSAO' | 'ALTERACAO_CARGO' | 'DEMISSAO'; cargo: string; data_movimentacao: string; }

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
  const [departamentosCatalogo, setDepartamentosCatalogo] = useState<string[]>([]);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);

  const [buscaGrid, setBuscaGrid] = useState('');
  const [filtroContrato, setFiltroContrato] = useState('TODOS');
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>('TODAS');
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null); // null = sem restrição (ex: ADMINISTRADOR)
  const [modoAtribuicaoMassa, setModoAtribuicaoMassa] = useState(false);
  const [selecionadosMassa, setSelecionadosMassa] = useState<Set<string>>(new Set());
  const [empresaMassa, setEmpresaMassa] = useState<string>('');
  const [aplicandoMassa, setAplicandoMassa] = useState(false);
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<string | null>(null);
  const [abaAtiva, setAbaAtiva] = useState<'ESSENCIAL' | 'COMPLETO'>('ESSENCIAL');

  const defaultForm: FuncionarioFin = {
    nome_completo: '', cargo: '', departamento: '', empresa_id: null, tipo_contrato: 'CLT + Contrato', ativo: true,
    recebe_transporte: false, valor_transporte: 0, recebe_refeicao: false, valor_refeicao: 0,
    salario_folha: 0, salario_contrato: 0, valor_diaria: 0, valor_adiantamento: 0,
    data_admissao: null, data_desligamento: null,
    data_nascimento: null, cpf: null, celular: null, email: null,
    ponto_whatsapp_ativo: false,
    pode_dirigir: false,
    banco_codigo: null, banco_agencia: null, banco_conta: null, banco_tipo: null,
    pix_tipo: null, pix_chave: null,
    recebe_fechamento: null, recebe_holerite: null,

    pis: null, matricula_esocial: null, foto_path: null,

    aposentado: null, pais_nascimento: null, cidade_nascimento: null,
    estado_civil: null, genero: null, nome_mae: null, nome_pai: null,
    etnia: null, escolaridade: null,

    telefone_alternativo: null, email_alternativo: null,
    cep: null, cidade: null, endereco: null, numero: null,
    complemento: null, bairro: null,

    deficiencia_fisica: null, deficiencia_mental: null, deficiencia_auditiva: null,
    deficiencia_intelectual: null, deficiencia_visual: null,
    reabilitado_readaptado: null, notas_especiais: null,

    estrangeiro: null, casado_com_brasileiro: null, filhos_brasileiros: null,
    data_chegada_estrangeiro: null, tipo_visto_estrangeiro: null,
    cep_estrangeiro: null, pais_estrangeiro: null, cidade_estrangeiro: null,
    endereco_estrangeiro: null, numero_estrangeiro: null,
    complemento_estrangeiro: null, bairro_estrangeiro: null
  };

  const [form, setForm] = useState<FuncionarioFin>(defaultForm);
  const [dependentes, setDependentes] = useState<Dependente[]>([]);
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([]);

  const [snapshotFicha, setSnapshotFicha] = useState('');
  const [fotoPreviewUrl, setFotoPreviewUrl] = useState('');
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  const fichaAtualSerializada = useMemo(
    () => JSON.stringify({ form, dependentes, movimentacoes }),
    [form, dependentes, movimentacoes]
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

      // Restrição por empresa: ADMINISTRADOR vê todas; os demais setores só
      // veem funcionários das empresas às quais estão vinculados em
      // perfis_usuarios_empresas (ver /admin/parametros/permissoes → Colaboradores).
      if (permissaoNormalizada !== 'ADMINISTRADOR') {
        const { data: vinculos } = await supabase
          .from('perfis_usuarios_empresas').select('empresa_id').eq('perfil_id', session.user.id);
        setEmpresasPermitidas((vinculos || []).map(v => v.empresa_id));
      } else {
        setEmpresasPermitidas(null);
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

    const { data: departamentosData } = await supabase.from('folha_departamento').select('nome').order('nome');
    if (departamentosData) setDepartamentosCatalogo(departamentosData.map(d => d.nome));

    const { data: empresasData } = await supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome');
    if (empresasData) setEmpresasCatalogo(empresasData);

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
    // departamento é coluna nova — funcionários cadastrados antes dela têm
    // null no banco, e um <select> controlado não aceita value={null}.
    setForm({ ...funcData, cargo: funcData.cargo || '', departamento: funcData.departamento || '' });

    setFotoPreviewUrl('');
    if (funcData.foto_path) {
      const fotoRes = await urlFotoFuncionarioAction({ fotoPath: funcData.foto_path });
      if (fotoRes.ok) setFotoPreviewUrl(fotoRes.info.url);
    }

    const { data: depData } = await supabase.from('folha_dependentes').select('*').eq('funcionario_nome', nome);
    setDependentes(depData || []);

    const { data: movData } = await supabase.from('folha_movimentacoes').select('*').eq('funcionario_nome', nome);
    setMovimentacoes(movData || []);

    setSnapshotFicha(JSON.stringify({
      form: funcData,
      dependentes: depData || [],
      movimentacoes: movData || []
    }));

    setLoading(false);
  };

  const prepararNovo = () => {
    setFuncionarioSelecionado('NOVO'); setForm(defaultForm);
    setDependentes([]); setMovimentacoes([]);
    setFotoPreviewUrl('');
    setAbaAtiva('ESSENCIAL');
  };

  const handleFotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    if (!form.nome_completo || funcionarioSelecionado === 'NOVO') { alert('Grave a ficha do colaborador antes de enviar a foto.'); return; }

    setEnviandoFoto(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(arquivo);
      });

      const res = await uploadFotoFuncionarioAction({
        funcionarioNome: form.nome_completo,
        arquivoBase64: base64,
        nomeArquivo: arquivo.name,
        tipoMime: arquivo.type,
      });
      if (!res.ok) throw new Error(res.erro);

      setForm(f => ({ ...f, foto_path: res.info.path }));
      const fotoRes = await urlFotoFuncionarioAction({ fotoPath: res.info.path });
      if (fotoRes.ok) setFotoPreviewUrl(fotoRes.info.url);
    } catch (e: any) {
      alert('Erro ao enviar foto: ' + e.message);
    } finally {
      setEnviandoFoto(false);
    }
  };

  const salvarColaborador = async (): Promise<boolean> => {
    if (!form.nome_completo) { alert("O Nome Completo é obrigatório."); return false; }
    if (!form.empresa_id) { alert("Selecione a Empresa do colaborador."); return false; }
    setLoading(true);

    try {
      const res = await salvarColaboradorAction({ form, dependentes, movimentacoes, usuarioNome: usuarioAtual });
      if (!res.ok) throw new Error(res.erro);

      alert("Ficha guardada com sucesso!");
      setSnapshotFicha(JSON.stringify({ form, dependentes, movimentacoes }));
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

  const addDependente = () => setDependentes([...dependentes, { tipo_dependente: '', nome_completo: '', cpf: '', data_nascimento: '' }]);
  const removeDependente = (idx: number) => setDependentes(dependentes.filter((_, i) => i !== idx));

  const addMovimentacao = () => setMovimentacoes([...movimentacoes, { motivo: 'ADMISSAO', cargo: form.cargo, data_movimentacao: '' }]);
  const removeMovimentacao = (idx: number) => setMovimentacoes(movimentacoes.filter((_, i) => i !== idx));

  const contratosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    listaFuncionarios.forEach(f => { if (f.tipo_contrato) set.add(f.tipo_contrato); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [listaFuncionarios]);

  // Restrição por empresa: null = sem restrição (ADMINISTRADOR); array = só
  // enxerga funcionários dessas empresas (ver checkAuth acima).
  const funcVisiveis = useMemo(() =>
    empresasPermitidas === null
      ? listaFuncionarios
      : listaFuncionarios.filter(f => f.empresa_id != null && empresasPermitidas.includes(f.empresa_id)),
    [listaFuncionarios, empresasPermitidas]);

  const empresasCatalogoVisivel = useMemo(() =>
    empresasPermitidas === null
      ? empresasCatalogo
      : empresasCatalogo.filter(e => empresasPermitidas.includes(e.id)),
    [empresasCatalogo, empresasPermitidas]);

  const semEmpresaDefinida = useMemo(() => funcVisiveis.filter(f => !f.empresa_id), [funcVisiveis]);

  const funcFiltrados = useMemo(() =>
    funcVisiveis
      .filter(f => f.nome_completo.toLowerCase().includes(buscaGrid.toLowerCase()))
      .filter(f => filtroContrato === 'TODOS' || f.tipo_contrato === filtroContrato)
      .filter(f => filtroEmpresa === 'TODAS' || String(f.empresa_id) === filtroEmpresa)
      .sort((a, b) => {
        if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
        return a.nome_completo.localeCompare(b.nome_completo);
      }),
    [funcVisiveis, buscaGrid, filtroContrato, filtroEmpresa]);

  const alternarSelecaoMassa = (nome: string) => {
    setSelecionadosMassa(prev => {
      const novo = new Set(prev);
      if (novo.has(nome)) novo.delete(nome); else novo.add(nome);
      return novo;
    });
  };

  const aplicarEmpresaEmMassa = async () => {
    if (!empresaMassa || selecionadosMassa.size === 0) return;
    setAplicandoMassa(true);
    try {
      const res = await atribuirEmpresaEmMassaAction({
        nomesFuncionarios: Array.from(selecionadosMassa),
        empresaId: Number(empresaMassa),
        usuarioNome: usuarioAtual,
      });
      if (!res.ok) throw new Error(res.erro);
      alert(`Empresa atribuída a ${selecionadosMassa.size} funcionário(s).`);
      setSelecionadosMassa(new Set());
      setEmpresaMassa('');
      setModoAtribuicaoMassa(false);
      carregarListaFuncionarios();
    } catch (e: any) {
      alert('Erro ao atribuir empresa em massa: ' + e.message);
    } finally {
      setAplicandoMassa(false);
    }
  };

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
            <select
              value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}
              className="w-full mt-2 p-2.5 rounded-lg text-sm text-white bg-[#1E3A6E] outline-none font-bold cursor-pointer"
            >
              <option value="TODAS">Todas as empresas</option>
              {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            {(filtroContrato !== 'TODOS' || filtroEmpresa !== 'TODAS') && (
              <p className="text-[10px] text-blue-200 font-bold mt-2 uppercase tracking-wider">
                {funcFiltrados.length} de {funcVisiveis.length} — filtrado
              </p>
            )}
          </div>

          {semEmpresaDefinida.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <p className="text-[11px] font-black text-amber-700 uppercase tracking-wider">
                ⚠️ {semEmpresaDefinida.length} funcionário(s) sem empresa definida
              </p>
              {!modoAtribuicaoMassa ? (
                <button onClick={() => setModoAtribuicaoMassa(true)} className="w-full bg-amber-600 text-white font-black text-[10px] uppercase tracking-wider py-2 rounded-lg hover:bg-amber-700 transition-colors">
                  Atribuir empresa em massa
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-amber-700 font-bold">Marque abaixo quem pertence à mesma empresa e escolha qual.</p>
                  <select value={empresaMassa} onChange={e => setEmpresaMassa(e.target.value)} className="w-full p-2 rounded-lg text-xs font-bold border border-amber-300">
                    <option value="">— Escolha a empresa —</option>
                    {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={() => { setModoAtribuicaoMassa(false); setSelecionadosMassa(new Set()); setEmpresaMassa(''); }} className="flex-1 bg-white border border-amber-300 text-amber-700 font-black text-[10px] uppercase py-2 rounded-lg">
                      Cancelar
                    </button>
                    <button onClick={aplicarEmpresaEmMassa} disabled={aplicandoMassa || !empresaMassa || selecionadosMassa.size === 0} className="flex-1 bg-amber-600 text-white font-black text-[10px] uppercase py-2 rounded-lg disabled:opacity-50">
                      {aplicandoMassa ? '...' : `Aplicar a ${selecionadosMassa.size}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden max-h-[65vh] overflow-y-auto overscroll-contain">
            {(modoAtribuicaoMassa ? funcFiltrados.filter(f => !f.empresa_id) : funcFiltrados).map((f, i) => (
              <div
                key={i} onClick={() => modoAtribuicaoMassa ? alternarSelecaoMassa(f.nome_completo) : trocarFuncionario(f.nome_completo)}
                className={`p-4 border-b border-[#E2E8F0] cursor-pointer transition-colors flex justify-between items-center ${modoAtribuicaoMassa ? (selecionadosMassa.has(f.nome_completo) ? 'bg-amber-50 border-l-4 border-l-amber-500' : 'hover:bg-gray-50') : (funcionarioSelecionado === f.nome_completo ? 'bg-blue-50 border-l-4 border-l-[#336699]' : 'hover:bg-gray-50')}`}
              >
                <div className="flex items-center gap-2">
                  {modoAtribuicaoMassa && (
                    <input type="checkbox" checked={selecionadosMassa.has(f.nome_completo)} onChange={() => alternarSelecaoMassa(f.nome_completo)} className="w-4 h-4 accent-amber-600" onClick={e => e.stopPropagation()} />
                  )}
                  <div>
                    <strong className={`block text-xs uppercase tracking-wider ${f.ativo ? 'text-[#0C1D4D]' : 'text-gray-400 line-through'}`}>{f.nome_completo}</strong>
                    <span className="text-[10px] text-gray-500 font-medium">{f.cargo || 'Sem função'}</span>
                  </div>
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
              <button
                onClick={() => setAbaAtiva('ESSENCIAL')}
                className={`flex-1 sm:flex-initial px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-colors shadow-sm ${abaAtiva === 'ESSENCIAL' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:text-[#0C1D4D]'}`}
              >
                👤 Ficha Individual
              </button>
              <button
                onClick={() => setAbaAtiva('COMPLETO')}
                className={`flex-1 sm:flex-initial px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-colors shadow-sm ${abaAtiva === 'COMPLETO' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:text-[#0C1D4D]'}`}
              >
                📋 Dados Completos
              </button>
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
            <div className="flex flex-col gap-6 print:hidden pb-20 max-h-[65vh] overflow-y-auto overscroll-contain pr-1">
            {abaAtiva === 'ESSENCIAL' && (
            <>
              <div className="grid grid-cols-1 xl:grid-cols-1 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4 h-fit">
                  <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-2">
                    <div className="flex items-center gap-3">
                      <label className="relative w-14 h-14 rounded-full flex-shrink-0 cursor-pointer group" title="Alterar foto (usada no Crachá do Portal)">
                        {fotoPreviewUrl ? (
                          <img src={fotoPreviewUrl} alt="Foto" className="w-14 h-14 rounded-full object-cover border border-[#E2E8F0]" />
                        ) : (
                          <div className="w-14 h-14 rounded-full bg-[#F0F4F8] border border-[#E2E8F0] flex items-center justify-center text-[9px] text-gray-400 font-bold uppercase text-center leading-tight">Foto 3x4</div>
                        )}
                        <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[9px] font-black uppercase">
                          {enviandoFoto ? '...' : 'Editar'}
                        </span>
                        <input type="file" accept="image/*" onChange={handleFotoChange} disabled={enviandoFoto} className="hidden" />
                      </label>
                      <div>
                        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider">{form.nome_completo || 'Novo Colaborador'}</h3>
                        <span className="text-[10px] text-gray-400 font-bold uppercase">{form.cargo || 'sem cargo'} • {form.tipo_contrato}</span>
                      </div>
                    </div>
                    <button onClick={alternarStatusAtivo} className={`text-[10px] px-3 py-1 rounded font-black uppercase tracking-wider transition-colors flex-shrink-0 ${form.ativo ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                      {form.ativo ? 'SUSPENDER' : 'REATIVAR'}
                    </button>
                  </div>

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
                      <div className="col-span-2 flex items-center gap-2 bg-white p-2.5 rounded-lg border border-indigo-100">
                        <input type="checkbox" id="pode_dirigir" checked={form.pode_dirigir} onChange={e => setForm({...form, pode_dirigir: e.target.checked})} className="w-4 h-4" />
                        <label htmlFor="pode_dirigir" className="text-[11px] font-bold text-gray-600 uppercase">🚗 Pode dirigir veículos da frota (libera o Checklist de Veículos no Portal)</label>
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
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Departamento</label>
                      <select value={form.departamento} onChange={e => setForm({...form, departamento: e.target.value})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white uppercase text-[#0C1D4D]">
                        <option value="">— Selecione —</option>
                        {form.departamento && !departamentosCatalogo.includes(form.departamento) && <option value={form.departamento}>{form.departamento} (fora do catálogo)</option>}
                        {departamentosCatalogo.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Empresa</label>
                      <select value={form.empresa_id ?? ''} onChange={e => setForm({...form, empresa_id: e.target.value ? Number(e.target.value) : null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white uppercase text-[#0C1D4D]">
                        <option value="">— Selecione —</option>
                        {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
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

                    <div className="col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between gap-3">
                      <p className="text-[10px] font-bold text-amber-700 uppercase">💡 Salário, Benefícios (VR/VT) e Adiantamento agora são editados na página Holerite (acesso restrito a Financeiro/RH).</p>
                      <button type="button" onClick={() => router.push('/admin/rh/holerite')} className="flex-shrink-0 text-[10px] font-black bg-white hover:bg-amber-100 border border-amber-300 text-amber-700 px-3 py-2 rounded-lg transition-colors uppercase tracking-wider">
                        Ir para Holerite →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
            )}

            {abaAtiva === 'COMPLETO' && (
              <DadosCompletos
                form={form} setForm={setForm}
                dependentes={dependentes} addDependente={addDependente} removeDependente={removeDependente} setDependentes={setDependentes}
                movimentacoes={movimentacoes} addMovimentacao={addMovimentacao} removeMovimentacao={removeMovimentacao} setMovimentacoes={setMovimentacoes}
                cargosCatalogo={cargosCatalogo}
              />
            )}

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

// ============================================================================
// ABA "DADOS COMPLETOS" — cadastro estendido (eSocial, endereço, dependentes, etc.)
// ============================================================================
function DadosCompletos({
  form, setForm,
  dependentes, addDependente, removeDependente, setDependentes,
  movimentacoes, addMovimentacao, removeMovimentacao, setMovimentacoes,
  cargosCatalogo
}: {
  form: FuncionarioFin; setForm: (f: FuncionarioFin) => void;
  dependentes: Dependente[]; addDependente: () => void; removeDependente: (idx: number) => void; setDependentes: (d: Dependente[]) => void;
  movimentacoes: Movimentacao[]; addMovimentacao: () => void; removeMovimentacao: (idx: number) => void; setMovimentacoes: (m: Movimentacao[]) => void;
  cargosCatalogo: string[];
}) {
  const handleDependenteChange = <K extends keyof Dependente>(idx: number, campo: K, valor: Dependente[K]) => {
    const novos = [...dependentes];
    novos[idx] = { ...novos[idx], [campo]: valor };
    setDependentes(novos);
  };

  const handleMovimentacaoChange = <K extends keyof Movimentacao>(idx: number, campo: K, valor: Movimentacao[K]) => {
    const novas = [...movimentacoes];
    novas[idx] = { ...novas[idx], [campo]: valor };
    setMovimentacoes(novas);
  };

  return (
    <>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider">{form.nome_completo || 'Novo Colaborador'}</h3>
        <span className="text-[10px] text-gray-400 font-bold uppercase">{form.cargo || 'sem cargo'} • {form.tipo_contrato}</span>
      </div>

      {/* DEFINIÇÕES DE REGISTRO */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4">
        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider border-b border-[#E2E8F0] pb-2">Definições de Registro</h3>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">PIS</label><input type="text" value={form.pis || ''} onChange={e => setForm({...form, pis: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Matrícula eSocial</label><input type="text" value={form.matricula_esocial || ''} onChange={e => setForm({...form, matricula_esocial: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
        </div>
      </div>

      {/* DADOS PESSOAIS */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4">
        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider border-b border-[#E2E8F0] pb-2">Dados Pessoais</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 flex items-center gap-2 bg-indigo-50 p-2.5 rounded-lg border border-indigo-100">
            <input type="checkbox" id="aposentado" checked={!!form.aposentado} onChange={e => setForm({...form, aposentado: e.target.checked})} className="w-4 h-4" />
            <label htmlFor="aposentado" className="text-[11px] font-bold text-gray-600 uppercase">É aposentado?</label>
          </div>
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">País de Nascimento</label><input type="text" value={form.pais_nascimento || ''} onChange={e => setForm({...form, pais_nascimento: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cidade de Nascimento</label><input type="text" value={form.cidade_nascimento || ''} onChange={e => setForm({...form, cidade_nascimento: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Estado Civil</label>
            <select value={form.estado_civil || ''} onChange={e => setForm({...form, estado_civil: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
              <option value="">— Selecione —</option>
              <option value="SOLTEIRO">Solteiro(a)</option>
              <option value="CASADO">Casado(a)</option>
              <option value="UNIAO_ESTAVEL">União Estável</option>
              <option value="DIVORCIADO">Divorciado(a)</option>
              <option value="VIUVO">Viúvo(a)</option>
              <option value="SEPARADO">Separado(a)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Gênero</label>
            <select value={form.genero || ''} onChange={e => setForm({...form, genero: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
              <option value="">— Selecione —</option>
              <option value="MASCULINO">Masculino</option>
              <option value="FEMININO">Feminino</option>
              <option value="OUTRO">Outro</option>
              <option value="PREFIRO_NAO_INFORMAR">Prefiro não informar</option>
            </select>
          </div>
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nome da Mãe</label><input type="text" value={form.nome_mae || ''} onChange={e => setForm({...form, nome_mae: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nome do Pai</label><input type="text" value={form.nome_pai || ''} onChange={e => setForm({...form, nome_pai: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Etnia</label>
            <select value={form.etnia || ''} onChange={e => setForm({...form, etnia: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
              <option value="">— Selecione —</option>
              <option value="BRANCA">Branca</option>
              <option value="PRETA">Preta</option>
              <option value="PARDA">Parda</option>
              <option value="AMARELA">Amarela</option>
              <option value="INDIGENA">Indígena</option>
              <option value="NAO_INFORMADA">Não informada</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Escolaridade</label>
            <select value={form.escolaridade || ''} onChange={e => setForm({...form, escolaridade: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
              <option value="">— Selecione —</option>
              <option value="ANALFABETO">Analfabeto</option>
              <option value="FUNDAMENTAL_INCOMPLETO">Fundamental Incompleto</option>
              <option value="FUNDAMENTAL_COMPLETO">Fundamental Completo</option>
              <option value="MEDIO_INCOMPLETO">Médio Incompleto</option>
              <option value="MEDIO_COMPLETO">Médio Completo</option>
              <option value="SUPERIOR_INCOMPLETO">Superior Incompleto</option>
              <option value="SUPERIOR_COMPLETO">Superior Completo</option>
              <option value="POS_GRADUACAO">Pós-Graduação</option>
              <option value="MESTRADO">Mestrado</option>
              <option value="DOUTORADO">Doutorado</option>
            </select>
          </div>
        </div>
      </div>

      {/* CONTATO E ENDEREÇO */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4">
        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider border-b border-[#E2E8F0] pb-2">Contato e Endereço</h3>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Telefone Alternativo</label><input type="tel" value={form.telefone_alternativo || ''} onChange={e => setForm({...form, telefone_alternativo: e.target.value || null})} placeholder="(11) 90000-0000" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">E-mail Alternativo</label><input type="email" value={form.email_alternativo || ''} onChange={e => setForm({...form, email_alternativo: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm lowercase" /></div>
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">CEP</label><input type="text" value={form.cep || ''} onChange={e => setForm({...form, cep: e.target.value || null})} placeholder="00000-000" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cidade</label><input type="text" value={form.cidade || ''} onChange={e => setForm({...form, cidade: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Endereço</label><input type="text" value={form.endereco || ''} onChange={e => setForm({...form, endereco: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Número</label><input type="text" value={form.numero || ''} onChange={e => setForm({...form, numero: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Complemento</label><input type="text" value={form.complemento || ''} onChange={e => setForm({...form, complemento: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Bairro</label><input type="text" value={form.bairro || ''} onChange={e => setForm({...form, bairro: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
        </div>
      </div>

      {/* DEPENDENTES E HISTÓRICO DE MOVIMENTAÇÃO */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-purple-200">
          <div className="flex justify-between items-center border-b border-purple-100 pb-2 mb-4">
            <h3 className="font-black text-purple-700 uppercase tracking-wider">Dependentes</h3>
            <button onClick={addDependente} className="text-[10px] bg-purple-100 text-purple-700 font-black px-3 py-1.5 rounded uppercase tracking-wider">+ ADICIONAR</button>
          </div>
          <div className="space-y-3">
            {dependentes.map((d, idx) => (
              <div key={idx} className="p-3 border rounded-lg grid grid-cols-2 gap-2 relative group bg-purple-50/30 border-purple-100">
                <button onClick={() => removeDependente(idx)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 font-bold opacity-0 group-hover:opacity-100">X</button>
                <div>
                  <label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Tipo</label>
                  <select value={d.tipo_dependente} onChange={e => handleDependenteChange(idx, 'tipo_dependente', e.target.value)} className="w-full p-1.5 border border-gray-200 rounded text-xs bg-white">
                    <option value="">— Selecione —</option>
                    <option value="CONJUGE">Cônjuge</option>
                    <option value="FILHO">Filho</option>
                    <option value="FILHA">Filha</option>
                    <option value="ENTEADO">Enteado(a)</option>
                    <option value="PAI">Pai</option>
                    <option value="MAE">Mãe</option>
                    <option value="IRMAO">Irmão(ã)</option>
                    <option value="OUTROS">Outros</option>
                  </select>
                </div>
                <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Data de Nascimento</label><input type="date" value={d.data_nascimento} onChange={e => handleDependenteChange(idx, 'data_nascimento', e.target.value)} className="w-full p-1.5 border border-gray-200 rounded text-xs" /></div>
                <div className="col-span-2"><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Nome Completo</label><input type="text" value={d.nome_completo} onChange={e => handleDependenteChange(idx, 'nome_completo', e.target.value.toUpperCase())} className="w-full p-1.5 border border-gray-200 rounded text-xs uppercase" /></div>
                <div className="col-span-2"><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">CPF</label><input type="text" value={d.cpf} onChange={e => handleDependenteChange(idx, 'cpf', e.target.value)} placeholder="000.000.000-00" className="w-full p-1.5 border border-gray-200 rounded text-xs" /></div>
              </div>
            ))}
            {dependentes.length === 0 && (
              <p className="text-[11px] text-gray-400 font-medium text-center py-2 uppercase">Nenhum dependente cadastrado</p>
            )}
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-blue-200">
          <div className="flex justify-between items-center border-b border-blue-100 pb-2 mb-4">
            <h3 className="font-black text-[#336699] uppercase tracking-wider">Dados da Empresa (Movimentação)</h3>
            <button onClick={addMovimentacao} className="text-[10px] bg-blue-100 text-blue-700 font-black px-3 py-1.5 rounded uppercase tracking-wider">+ ADICIONAR</button>
          </div>
          <div className="space-y-3">
            {movimentacoes.map((m, idx) => (
              <div key={idx} className="p-3 border rounded-lg grid grid-cols-2 gap-2 relative group bg-blue-50/30 border-blue-100">
                <button onClick={() => removeMovimentacao(idx)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 font-bold opacity-0 group-hover:opacity-100">X</button>
                <div>
                  <label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Motivo</label>
                  <select value={m.motivo} onChange={e => handleMovimentacaoChange(idx, 'motivo', e.target.value as Movimentacao['motivo'])} className="w-full p-1.5 border border-gray-200 rounded text-xs bg-white">
                    <option value="ADMISSAO">Admissão</option>
                    <option value="ALTERACAO_CARGO">Alteração de Cargo</option>
                    <option value="DEMISSAO">Demissão</option>
                  </select>
                </div>
                <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Data da Movimentação</label><input type="date" value={m.data_movimentacao} onChange={e => handleMovimentacaoChange(idx, 'data_movimentacao', e.target.value)} className="w-full p-1.5 border border-gray-200 rounded text-xs" /></div>
                <div className="col-span-2">
                  <label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Cargo</label>
                  <select value={m.cargo} onChange={e => handleMovimentacaoChange(idx, 'cargo', e.target.value)} className="w-full p-1.5 border border-gray-200 rounded text-xs bg-white uppercase">
                    <option value="">— Selecione —</option>
                    {m.cargo && !cargosCatalogo.includes(m.cargo) && <option value={m.cargo}>{m.cargo} (fora do catálogo)</option>}
                    {cargosCatalogo.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            ))}
            {movimentacoes.length === 0 && (
              <p className="text-[11px] text-gray-400 font-medium text-center py-2 uppercase">Nenhuma movimentação registrada</p>
            )}
          </div>
        </div>
      </div>

      {/* INFORMAÇÕES ESPECIAIS */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4">
        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider border-b border-[#E2E8F0] pb-2">Informações Especiais</h3>
        <div className="grid grid-cols-2 gap-3">
          {([
            ['deficiencia_fisica', 'Possui deficiência física?'],
            ['deficiencia_mental', 'Possui deficiência mental?'],
            ['deficiencia_auditiva', 'Possui deficiência auditiva?'],
            ['deficiencia_intelectual', 'Possui deficiência intelectual?'],
            ['deficiencia_visual', 'Possui deficiência visual?'],
            ['reabilitado_readaptado', 'É reabilitado ou readaptado?'],
          ] as [keyof FuncionarioFin, string][]).map(([campo, rotulo]) => (
            <div key={campo} className="flex items-center gap-2 bg-amber-50 p-2.5 rounded-lg border border-amber-100">
              <input type="checkbox" id={campo} checked={!!form[campo]} onChange={e => setForm({...form, [campo]: e.target.checked})} className="w-4 h-4" />
              <label htmlFor={campo} className="text-[11px] font-bold text-gray-600 uppercase">{rotulo}</label>
            </div>
          ))}
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Notas</label>
          <textarea value={form.notas_especiais || ''} onChange={e => setForm({...form, notas_especiais: e.target.value || null})} rows={3} className="w-full p-2 border border-gray-300 rounded text-sm" />
        </div>
      </div>

      {/* TRABALHADOR ESTRANGEIRO */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4">
        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider border-b border-[#E2E8F0] pb-2">Trabalhador Estrangeiro</h3>
        <div className="flex items-center gap-2 bg-cyan-50 p-2.5 rounded-lg border border-cyan-100">
          <input type="checkbox" id="estrangeiro" checked={!!form.estrangeiro} onChange={e => setForm({...form, estrangeiro: e.target.checked})} className="w-4 h-4" />
          <label htmlFor="estrangeiro" className="text-[11px] font-bold text-gray-600 uppercase">É estrangeiro?</label>
        </div>

        {form.estrangeiro && (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2 bg-cyan-50/50 p-2.5 rounded-lg border border-cyan-100">
              <input type="checkbox" id="casado_com_brasileiro" checked={!!form.casado_com_brasileiro} onChange={e => setForm({...form, casado_com_brasileiro: e.target.checked})} className="w-4 h-4" />
              <label htmlFor="casado_com_brasileiro" className="text-[11px] font-bold text-gray-600 uppercase">É casado com brasileiro(a)?</label>
            </div>
            <div className="flex items-center gap-2 bg-cyan-50/50 p-2.5 rounded-lg border border-cyan-100">
              <input type="checkbox" id="filhos_brasileiros" checked={!!form.filhos_brasileiros} onChange={e => setForm({...form, filhos_brasileiros: e.target.checked})} className="w-4 h-4" />
              <label htmlFor="filhos_brasileiros" className="text-[11px] font-bold text-gray-600 uppercase">Tem filhos brasileiros?</label>
            </div>
            <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Data de Chegada</label><input type="date" value={form.data_chegada_estrangeiro || ''} onChange={e => setForm({...form, data_chegada_estrangeiro: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tipo de Visto</label>
              <select value={form.tipo_visto_estrangeiro || ''} onChange={e => setForm({...form, tipo_visto_estrangeiro: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
                <option value="">— Selecione —</option>
                <option value="PERMANENTE">Permanente</option>
                <option value="TEMPORARIO">Temporário</option>
                <option value="DIPLOMATICO">Diplomático</option>
                <option value="CORTESIA">Cortesia</option>
                <option value="OFICIAL">Oficial</option>
                <option value="OUTRO">Outro</option>
              </select>
            </div>
            <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">CEP</label><input type="text" value={form.cep_estrangeiro || ''} onChange={e => setForm({...form, cep_estrangeiro: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
            <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">País</label><input type="text" value={form.pais_estrangeiro || ''} onChange={e => setForm({...form, pais_estrangeiro: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
            <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cidade</label><input type="text" value={form.cidade_estrangeiro || ''} onChange={e => setForm({...form, cidade_estrangeiro: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
            <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Endereço</label><input type="text" value={form.endereco_estrangeiro || ''} onChange={e => setForm({...form, endereco_estrangeiro: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
            <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Número</label><input type="text" value={form.numero_estrangeiro || ''} onChange={e => setForm({...form, numero_estrangeiro: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
            <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Complemento</label><input type="text" value={form.complemento_estrangeiro || ''} onChange={e => setForm({...form, complemento_estrangeiro: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
            <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Bairro</label><input type="text" value={form.bairro_estrangeiro || ''} onChange={e => setForm({...form, bairro_estrangeiro: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
          </div>
        )}
      </div>
    </>
  );
}