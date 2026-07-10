"use client";

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import {
  salvarFeriadoAction, excluirFeriadoAction,
  adicionarCatalogoAction, removerCatalogoAction, atualizarFontesCargoAction,
  salvarRegraAction, excluirRegraAction
} from '../actions/actions-parametros';

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

interface RegraRH {
  id?: string;
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
  recebe_holerite_contabilidade: boolean;
  so_documental: boolean;
  recebe_fechamento: boolean;
  recebe_holerite: boolean;
}

interface ItemCatalogo { id: number; nome: string; recebe_fechamento?: boolean | null; recebe_holerite?: boolean | null; }
interface Feriado { id: number; data_feriado: string; descricao: string | null; }

export default function ParametrosRH() {
  const router = useRouter();
  const pathname = usePathname();
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [emailUsuario, setEmailUsuario] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

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
      setUsuarioAtual(perfil.nome || 'Equipe RH');
      setEmailUsuario(perfil.email || session.user.email || '');
      setAuthLoading(false);
    }

    checkAuth();
  }, [router, pathname]);

  const [regras, setRegras] = useState<RegraRH[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletando, setDeletando] = useState<string | null>(null);

  // Aba ativa: motor de regras, catálogos ou feriados
  const [abaAtiva, setAbaAtiva] = useState<'regras' | 'padroes' | 'feriados'>('regras');

  // Catálogos de padronização (folha_cargo e folha_tipocontrato)
  const [cargos, setCargos] = useState<ItemCatalogo[]>([]);
  const [tiposContrato, setTiposContrato] = useState<ItemCatalogo[]>([]);
  const [novoCargo, setNovoCargo] = useState('');
  const [novoTipoContrato, setNovoTipoContrato] = useState('');
  const [salvandoCatalogo, setSalvandoCatalogo] = useState(false);

  // Feriados (folha_feriados)
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [novoFeriado, setNovoFeriado] = useState<{ data_feriado: string; descricao: string }>({ data_feriado: '', descricao: '' });
  const [feriadoEditando, setFeriadoEditando] = useState<Feriado | null>(null);
  const [salvandoFeriado, setSalvandoFeriado] = useState(false);

  // Guarda o nome da regra no momento em que foi aberta para edição.
  // É o que permite detectar (e executar) um renomear de verdade.
  const [nomeOriginal, setNomeOriginal] = useState<string | null>(null);
  
  const formPadrao: RegraRH = {
    nome_regra: '', 
    paga_salario_base: true, 
    calcula_extras_padrao: true,
    percentual_extra_semana: 60,
    percentual_extra_sabado: 60,
    tipo_pagamento_fds: 'HORA_PERCENTUAL', 
    percentual_extra_dom_fer: 100, 
    valor_diaria_fds: 0, 
    desconta_faltas: true,
    direito_vr: false,
    direito_vt: false,
    modalidade_beneficio: 'POR_DIA',
    recebe_holerite_contabilidade: true,
    so_documental: false,
    recebe_fechamento: true,
    recebe_holerite: true
  };
  
  const [form, setForm] = useState<RegraRH>(formPadrao);

  useEffect(() => {
    if (!authLoading && !acessoNegado) { carregarRegras(); carregarCatalogos(); carregarFeriados(); }
  }, [authLoading, acessoNegado]);

  // ==========================================================================
  // FERIADOS (folha_feriados): listagem, adição, edição e exclusão
  // ==========================================================================
  const carregarFeriados = async () => {
    const { data, error } = await supabase.from('folha_feriados').select('*').order('data_feriado');
    if (error) {
      alert('Erro ao carregar os feriados: ' + error.message);
      return;
    }
    setFeriados(data || []);
  };

  const formatarDataBR = (dataIso: string) => dataIso ? dataIso.split('-').reverse().join('/') : '';

  const diaSemanaFeriado = (dataIso: string) => {
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    return ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][new Date(ano, mes - 1, dia).getDay()];
  };

  const adicionarFeriado = async () => {
    if (!novoFeriado.data_feriado) return alert('Informe a data do feriado.');

    setSalvandoFeriado(true);
    try {
      const res = await salvarFeriadoAction({
        data_feriado: novoFeriado.data_feriado,
        descricao: novoFeriado.descricao
      });
      if (!res.ok) throw new Error(res.erro);
      setNovoFeriado({ data_feriado: '', descricao: '' });
      carregarFeriados();
    } catch (e: any) {
      alert('Erro ao adicionar feriado: ' + e.message);
    } finally {
      setSalvandoFeriado(false);
    }
  };

  const salvarEdicaoFeriado = async () => {
    if (!feriadoEditando) return;
    if (!feriadoEditando.data_feriado) return alert('Informe a data do feriado.');

    setSalvandoFeriado(true);
    try {
      const res = await salvarFeriadoAction({
        id: feriadoEditando.id,
        data_feriado: feriadoEditando.data_feriado,
        descricao: feriadoEditando.descricao || ''
      });
      if (!res.ok) throw new Error(res.erro);
      setFeriadoEditando(null);
      carregarFeriados();
    } catch (e: any) {
      alert('Erro ao salvar feriado: ' + e.message);
    } finally {
      setSalvandoFeriado(false);
    }
  };

  const excluirFeriado = async (f: Feriado) => {
    if (!confirm(
      `Excluir o feriado ${formatarDataBR(f.data_feriado)}${f.descricao ? ` (${f.descricao})` : ''}?\n\n` +
      `Atenção: espelhos de ponto e holerites EM ABERTO deste dia serão recalculados como dia útil. Folhas já fechadas não mudam.`
    )) return;

    setSalvandoFeriado(true);
    try {
      const res = await excluirFeriadoAction(f.id);
      if (!res.ok) throw new Error(res.erro);
      carregarFeriados();
    } catch (e: any) {
      alert('Erro ao excluir feriado: ' + e.message);
    } finally {
      setSalvandoFeriado(false);
    }
  };

  const carregarCatalogos = async () => {
    const [{ data: cargosData, error: cargosError }, { data: tiposData, error: tiposError }] = await Promise.all([
      supabase.from('folha_cargo').select('*').order('nome'),
      supabase.from('folha_tipocontrato').select('*').order('nome')
    ]);
    if (cargosError || tiposError) {
      alert('Erro ao carregar os catálogos: ' + (cargosError?.message || tiposError?.message));
      return;
    }
    setCargos(cargosData || []);
    setTiposContrato(tiposData || []);
  };

  // ==========================================================================
  // CATÁLOGOS DE PADRONIZAÇÃO: cargos e tipos de contrato
  // ==========================================================================
  // Atualiza os interruptores de fontes (3 estados) de um cargo, otimista na UI
  const atualizarFontesCargo = async (cargo: ItemCatalogo, campo: 'fechamento' | 'holerite', valor: string) => {
    const novoValor = valor === 'HERDA' ? null : valor === 'SIM';
    const atualizado = {
      ...cargo,
      recebe_fechamento: campo === 'fechamento' ? novoValor : (cargo.recebe_fechamento ?? null),
      recebe_holerite: campo === 'holerite' ? novoValor : (cargo.recebe_holerite ?? null)
    };
    setCargos(prev => prev.map(c => c.id === cargo.id ? atualizado : c));
    const res = await atualizarFontesCargoAction({
      cargoId: cargo.id,
      recebeFechamento: atualizado.recebe_fechamento ?? null,
      recebeHolerite: atualizado.recebe_holerite ?? null
    });
    if (!res.ok) { alert('Erro ao salvar: ' + res.erro); carregarCatalogos(); }
  };

  const adicionarCatalogo = async (tabela: 'folha_cargo' | 'folha_tipocontrato', nome: string) => {
    const nomeNormalizado = nome.toUpperCase().trim();
    if (!nomeNormalizado) return alert('Digite um nome antes de adicionar.');

    setSalvandoCatalogo(true);
    try {
      const res = await adicionarCatalogoAction({ tabela, nome: nomeNormalizado });
      if (!res.ok) throw new Error(res.erro);
      if (tabela === 'folha_cargo') setNovoCargo('');
      else setNovoTipoContrato('');
      carregarCatalogos();
    } catch (e: any) {
      alert('Erro ao adicionar: ' + e.message);
    } finally {
      setSalvandoCatalogo(false);
    }
  };

  const removerCatalogo = async (tabela: 'folha_cargo' | 'folha_tipocontrato', item: ItemCatalogo) => {
    // Só pede confirmação para cargos que não estão em uso; a verificação de
    // vínculo é feita dentro da action (e retorna a lista de quem usa).
    if (tabela === 'folha_tipocontrato' && !confirm(`Excluir "${item.nome}" do catálogo?`)) return;
    if (tabela === 'folha_cargo' && !confirm(`Excluir "${item.nome}" do catálogo? (Só é possível se nenhum funcionário o utiliza.)`)) return;

    setSalvandoCatalogo(true);
    try {
      const res = await removerCatalogoAction({ tabela, id: item.id, nome: item.nome });
      if (!res.ok) throw new Error(res.erro);
      carregarCatalogos();
    } catch (e: any) {
      alert('Erro ao excluir: ' + e.message);
    } finally {
      setSalvandoCatalogo(false);
    }
  };

  const carregarRegras = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('folha_parametros').select('*').order('nome_regra');
    if (error) {
      alert('Erro ao carregar as regras: ' + error.message);
    } else if (data) {
      setRegras(data.map(r => ({
        ...r,
        percentual_extra_semana: r.percentual_extra_semana ?? 60,
        percentual_extra_sabado: r.percentual_extra_sabado ?? 60,
        percentual_extra_dom_fer: r.percentual_extra_dom_fer ?? 100,
        tipo_pagamento_fds: r.tipo_pagamento_fds === 'HORA_100' ? 'HORA_PERCENTUAL' : r.tipo_pagamento_fds,
        direito_vr: r.direito_vr ?? false,
        direito_vt: r.direito_vt ?? false,
        modalidade_beneficio: r.modalidade_beneficio || 'POR_DIA',
        recebe_holerite_contabilidade: r.recebe_holerite_contabilidade ?? true,
        so_documental: r.so_documental ?? false,
        recebe_fechamento: r.recebe_fechamento ?? true,
        recebe_holerite: r.recebe_holerite ?? true
      })));
    }
    setLoading(false);
  };

  const abrirParaEdicao = (r: RegraRH) => {
    setForm(r);
    setNomeOriginal(r.nome_regra);
  };

  const prepararNovo = () => {
    setForm(formPadrao);
    setNomeOriginal(null);
  };

  // ==========================================================================
  // VALIDAÇÃO: evita que erro de digitação vire folha de pagamento errada
  // ==========================================================================
  const validarRegra = (r: RegraRH): string | null => {
    if (!r.nome_regra) return 'O nome da regra é obrigatório.';
    if (!r.calcula_extras_padrao) return null; // Contrato fechado: extras não se aplicam
    if (r.tipo_pagamento_fds === 'VALOR_DIARIA') {
      // Modelo por diária: percentuais não se aplicam, só o valor da diária importa
      if (!r.valor_diaria_fds || r.valor_diaria_fds <= 0) {
        return 'Para remuneração por diária fechada, informe um valor de diária maior que zero.';
      }
      return null;
    }
    if (r.percentual_extra_semana < 0 || r.percentual_extra_sabado < 0 || r.percentual_extra_dom_fer < 0) {
      return 'Os percentuais de hora extra não podem ser negativos.';
    }
    if (r.percentual_extra_semana > 300 || r.percentual_extra_sabado > 300 || r.percentual_extra_dom_fer > 300) {
      return 'Percentual acima de 300% — confira se o valor foi digitado corretamente.';
    }
    return null;
  };

  const salvarRegra = async () => {
    // Normaliza o nome: o CSS "uppercase" é só visual, o banco grava o que foi digitado.
    // Sem isso, "clt" e "CLT" viram duas regras diferentes de aparência idêntica.
    const nomeNormalizado = form.nome_regra.toUpperCase().trim();
    const payload: RegraRH = { ...form, nome_regra: nomeNormalizado };
    delete payload.id;

    const erroValidacao = validarRegra(payload);
    if (erroValidacao) return alert(erroValidacao);

    setLoading(true);
    try {
      const res = await salvarRegraAction({ regra: payload, nomeOriginal });
      if (!res.ok) throw new Error(res.erro);

      if (res.info?.renomeada) {
        alert(`Regra renomeada de "${res.info.nomeAntigo}" para "${res.info.nomeNovo}". ${res.info.migrados} funcionário(s) migrado(s) junto.`);
      } else {
        alert('Parâmetro salvo com sucesso!');
      }

      carregarRegras();
      setForm(formPadrao);
      setNomeOriginal(null);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================================================
  // EXCLUSÃO PROTEGIDA: regra em uso não pode ser apagada (verificado na action)
  // ==========================================================================
  const deletarRegra = async (nome: string) => {
    if (!confirm(`Tem certeza que deseja excluir o modelo ${nome}?\n\nSó será excluído se nenhum funcionário estiver vinculado a ele.`)) return;

    setDeletando(nome);
    try {
      const res = await excluirRegraAction(nome);
      if (!res.ok) throw new Error(res.erro);

      if (nomeOriginal === nome) {
        setForm(formPadrao);
        setNomeOriginal(null);
      }
      carregarRegras();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDeletando(null);
    }
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar os Parâmetros da Folha.</p>
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

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          ⚙️ <strong>Motor de Regras</strong>. Defina as porcentagens de horas extras e diretrizes de cálculo.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1200px] mx-auto w-full">
        <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm mb-6">
          <button onClick={() => setAbaAtiva('regras')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${abaAtiva === 'regras' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
            ⚙️ Motor de Regras
          </button>
          <button onClick={() => setAbaAtiva('padroes')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${abaAtiva === 'padroes' ? 'bg-[#336699] text-white shadow-sm' : 'text-[#64748B] hover:text-[#336699]'}`}>
            📋 Cargos e Tipos de Contrato
          </button>
          <button onClick={() => setAbaAtiva('feriados')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${abaAtiva === 'feriados' ? 'bg-amber-600 text-white shadow-sm' : 'text-[#64748B] hover:text-amber-600'}`}>
            📅 Feriados
          </button>
        </div>
      </div>

      {abaAtiva === 'feriados' && (
        <div className="p-4 md:px-8 pb-8 flex-grow max-w-[900px] mx-auto w-full">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
            <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider border-b-2 border-[#E2E8F0] pb-3 mb-2">Feriados</h2>
            <p className="text-xs text-[#64748B] mb-5">
              Dias cadastrados aqui contam como <strong>carga zero</strong>: horas trabalhadas neles pagam extra de dom/feriado (ou diária), e não geram falta. Espelho de ponto e holerites em aberto recalculam automaticamente.
            </p>

            {/* ADICIONAR */}
            <div className="flex flex-col sm:flex-row gap-2 mb-6 bg-amber-50 border border-amber-200 p-4 rounded-xl">
              <div className="flex-shrink-0">
                <label className="block text-[10px] font-bold text-amber-700 uppercase mb-1">Data</label>
                <input type="date" value={novoFeriado.data_feriado} onChange={e => setNovoFeriado({ ...novoFeriado, data_feriado: e.target.value })} className="p-2.5 border border-amber-300 rounded-lg text-sm font-bold bg-white" />
              </div>
              <div className="flex-grow">
                <label className="block text-[10px] font-bold text-amber-700 uppercase mb-1">Descrição</label>
                <input
                  type="text" value={novoFeriado.descricao}
                  onChange={e => setNovoFeriado({ ...novoFeriado, descricao: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') adicionarFeriado(); }}
                  placeholder="Ex: NATAL, ANIVERSÁRIO DA CIDADE..."
                  className="w-full p-2.5 border border-amber-300 rounded-lg text-sm font-bold uppercase bg-white"
                />
              </div>
              <div className="flex items-end">
                <button onClick={adicionarFeriado} disabled={salvandoFeriado} className="bg-amber-600 text-white font-black text-xs uppercase px-6 py-3 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 w-full sm:w-auto">
                  + Adicionar
                </button>
              </div>
            </div>

            {/* LISTAGEM COM EDIÇÃO */}
            <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
              {feriados.length === 0 ? (
                <p className="p-8 text-center text-xs text-gray-400 font-bold uppercase">Nenhum feriado cadastrado</p>
              ) : feriados.map(f => (
                feriadoEditando?.id === f.id ? (
                  <div key={f.id} className="p-3 border-b border-[#E2E8F0] bg-blue-50 flex flex-col sm:flex-row gap-2 items-center">
                    <input type="date" value={feriadoEditando.data_feriado} onChange={e => setFeriadoEditando({ ...feriadoEditando, data_feriado: e.target.value })} className="p-2 border border-blue-300 rounded-lg text-sm font-bold bg-white" />
                    <input
                      type="text" value={feriadoEditando.descricao || ''}
                      onChange={e => setFeriadoEditando({ ...feriadoEditando, descricao: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') salvarEdicaoFeriado(); }}
                      placeholder="Descrição"
                      className="flex-grow p-2 border border-blue-300 rounded-lg text-sm font-bold uppercase bg-white w-full"
                    />
                    <div className="flex gap-2">
                      <button onClick={salvarEdicaoFeriado} disabled={salvandoFeriado} className="bg-[#16A34A] text-white font-black text-[10px] uppercase px-4 py-2 rounded-lg hover:bg-[#15803D] disabled:opacity-50">Salvar</button>
                      <button onClick={() => setFeriadoEditando(null)} className="bg-gray-200 text-gray-600 font-black text-[10px] uppercase px-4 py-2 rounded-lg hover:bg-gray-300">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div key={f.id} className="p-3 border-b border-[#E2E8F0] flex justify-between items-center hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="font-black text-[#0C1D4D] text-sm">{formatarDataBR(f.data_feriado)}</span>
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-black uppercase">{diaSemanaFeriado(f.data_feriado)}</span>
                      <span className="text-xs font-bold text-gray-600 uppercase">{f.descricao || '—'}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setFeriadoEditando(f)} disabled={salvandoFeriado} className="text-[#336699] font-bold text-xs hover:bg-blue-50 px-3 py-1 rounded disabled:opacity-40">✏️ Editar</button>
                      <button onClick={() => excluirFeriado(f)} disabled={salvandoFeriado} className="text-red-500 font-bold text-xs hover:bg-red-50 px-2 py-1 rounded disabled:opacity-40">X</button>
                    </div>
                  </div>
                )
              ))}
            </div>
          </div>
        </div>
      )}

      {abaAtiva === 'padroes' && (
        <div className="p-4 md:px-8 pb-8 flex-grow max-w-[1200px] mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* CATÁLOGO DE CARGOS */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] h-fit">
            <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider border-b-2 border-[#E2E8F0] pb-3 mb-4">Cargos</h2>
            <p className="text-xs text-[#64748B] mb-4">Lista padrão de cargos. A ficha do colaborador seleciona daqui, evitando o mesmo cargo grafado de formas diferentes.</p>
            <div className="flex gap-2 mb-4">
              <input
                type="text" value={novoCargo} onChange={e => setNovoCargo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') adicionarCatalogo('folha_cargo', novoCargo); }}
                placeholder="Ex: MOTORISTA, AUXILIAR..."
                className="flex-grow p-2.5 border border-gray-300 rounded-lg text-sm font-bold uppercase bg-gray-50"
              />
              <button onClick={() => adicionarCatalogo('folha_cargo', novoCargo)} disabled={salvandoCatalogo} className="bg-[#0C1D4D] text-white font-black text-xs uppercase px-5 rounded-lg hover:bg-[#284B8C] transition-colors disabled:opacity-50">
                + Add
              </button>
            </div>
            <div className="border border-[#E2E8F0] rounded-xl overflow-hidden max-h-[45vh] overflow-y-auto">
              {cargos.length === 0 ? (
                <p className="p-6 text-center text-xs text-gray-400 font-bold uppercase">Nenhum cargo cadastrado</p>
              ) : cargos.map(c => (
                <div key={c.id} className="p-3 border-b border-[#E2E8F0] hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-black text-[#0C1D4D] text-sm uppercase">{c.nome}</span>
                    <button onClick={() => removerCatalogo('folha_cargo', c)} disabled={salvandoCatalogo} className="text-red-500 font-bold text-xs hover:bg-red-50 px-2 py-1 rounded disabled:opacity-40">X</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Fechamento</label>
                      <select
                        value={c.recebe_fechamento === null || c.recebe_fechamento === undefined ? 'HERDA' : c.recebe_fechamento ? 'SIM' : 'NAO'}
                        onChange={e => atualizarFontesCargo(c, 'fechamento', e.target.value)}
                        className="w-full p-1.5 border border-gray-300 rounded text-[11px] font-bold bg-white">
                        <option value="HERDA">↑ Herda contrato</option>
                        <option value="SIM">✓ Recebe</option>
                        <option value="NAO">✕ Não recebe</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Holerite</label>
                      <select
                        value={c.recebe_holerite === null || c.recebe_holerite === undefined ? 'HERDA' : c.recebe_holerite ? 'SIM' : 'NAO'}
                        onChange={e => atualizarFontesCargo(c, 'holerite', e.target.value)}
                        className="w-full p-1.5 border border-gray-300 rounded text-[11px] font-bold bg-white">
                        <option value="HERDA">↑ Herda contrato</option>
                        <option value="SIM">✓ Recebe</option>
                        <option value="NAO">✕ Não recebe</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CATÁLOGO DE TIPOS DE CONTRATO */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] h-fit">
            <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider border-b-2 border-[#E2E8F0] pb-3 mb-4">Tipos de Contrato</h2>
            <p className="text-xs text-[#64748B] mb-4">Nomenclatura padrão dos contratos (Ex: CLT, PJ, TEMPORÁRIO). Ao criar um modelo no Motor de Regras, o nome é sugerido a partir desta lista.</p>
            <div className="flex gap-2 mb-4">
              <input
                type="text" value={novoTipoContrato} onChange={e => setNovoTipoContrato(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') adicionarCatalogo('folha_tipocontrato', novoTipoContrato); }}
                placeholder="Ex: CLT, PJ, TEMPORÁRIO..."
                className="flex-grow p-2.5 border border-gray-300 rounded-lg text-sm font-bold uppercase bg-gray-50"
              />
              <button onClick={() => adicionarCatalogo('folha_tipocontrato', novoTipoContrato)} disabled={salvandoCatalogo} className="bg-[#336699] text-white font-black text-xs uppercase px-5 rounded-lg hover:bg-[#284B8C] transition-colors disabled:opacity-50">
                + Add
              </button>
            </div>
            <div className="border border-[#E2E8F0] rounded-xl overflow-hidden max-h-[45vh] overflow-y-auto">
              {tiposContrato.length === 0 ? (
                <p className="p-6 text-center text-xs text-gray-400 font-bold uppercase">Nenhum tipo cadastrado</p>
              ) : tiposContrato.map(t => (
                <div key={t.id} className="p-3 border-b border-[#E2E8F0] flex justify-between items-center hover:bg-gray-50 transition-colors">
                  <div>
                    <span className="font-black text-[#0C1D4D] text-sm uppercase">{t.nome}</span>
                    {regras.some(r => r.nome_regra === t.nome) ? (
                      <span className="ml-2 text-[9px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-black uppercase">Regra criada</span>
                    ) : (
                      <span className="ml-2 text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-black uppercase">Sem regra no motor</span>
                    )}
                  </div>
                  <button onClick={() => removerCatalogo('folha_tipocontrato', t)} disabled={salvandoCatalogo} className="text-red-500 font-bold text-xs hover:bg-red-50 px-2 py-1 rounded disabled:opacity-40">X</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {abaAtiva === 'regras' && (
      <div className="p-4 md:px-8 flex-grow flex flex-col lg:flex-row gap-6 max-w-[1200px] mx-auto w-full">
        
        {/* LISTA DE REGRAS */}
        <aside className="w-full lg:w-1/3 flex-shrink-0 space-y-4">
          <div className="bg-[#0C1D4D] p-5 rounded-2xl shadow-md text-white">
            <h2 className="font-black uppercase tracking-wider mb-2">Contratos Ativos</h2>
            <p className="text-xs text-blue-200 mb-4">Clique para editar ou crie um novo.</p>
            <button onClick={prepararNovo} className="w-full bg-blue-500 hover:bg-blue-400 text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl transition-all shadow-sm">
              + NOVO MODELO
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            {regras.map((r) => (
              <div key={r.nome_regra} className="p-4 border-b border-[#E2E8F0] hover:bg-gray-50 flex justify-between items-center transition-colors">
                <button onClick={() => abrirParaEdicao(r)} className="text-left font-black text-[#0C1D4D] uppercase text-sm w-full">
                  {r.nome_regra}
                </button>
                <button
                  onClick={() => deletarRegra(r.nome_regra)}
                  disabled={deletando !== null}
                  className="text-red-500 font-bold text-xs hover:bg-red-50 px-2 py-1 rounded disabled:opacity-40"
                >
                  {deletando === r.nome_regra ? '...' : 'X'}
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* EDITOR DE REGRAS */}
        <main className="flex-grow bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-[#E2E8F0] h-fit">
          <h2 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider border-b-2 border-[#E2E8F0] pb-4 mb-6">
            {nomeOriginal ? `Editando: ${nomeOriginal}` : 'Novo Modelo de Contrato'}
          </h2>

          <div className="space-y-6">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nome do Modelo (sugerido do catálogo de Tipos de Contrato)</label>
              <input type="text" list="tipos-contrato-catalogo" value={form.nome_regra} onChange={e => setForm({...form, nome_regra: e.target.value})} className="w-full p-3 border border-gray-300 rounded-lg text-sm font-black bg-gray-50 uppercase" />
              <datalist id="tipos-contrato-catalogo">
                {tiposContrato.map(t => <option key={t.id} value={t.nome} />)}
              </datalist>
              {nomeOriginal && form.nome_regra.toUpperCase().trim() !== nomeOriginal && (
                <p className="text-[10px] font-bold text-amber-600 mt-1 uppercase">
                  ⚠ Ao salvar, a regra será renomeada e todos os funcionários vinculados serão migrados para o novo nome.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-gray-200 p-4 rounded-xl bg-gray-50/50">
                <label className="flex items-center gap-3 font-bold text-sm text-[#0C1D4D] cursor-pointer">
                  <input type="checkbox" checked={form.paga_salario_base} onChange={e => setForm({...form, paga_salario_base: e.target.checked})} className="w-4 h-4 accent-[#336699]" />
                  Exibir Salário Base no Holerite?
                </label>
              </div>

              <div className="border border-gray-200 p-4 rounded-xl bg-gray-50/50">
                <label className="flex items-center gap-3 font-bold text-sm text-[#0C1D4D] cursor-pointer">
                  <input type="checkbox" checked={form.desconta_faltas} onChange={e => setForm({...form, desconta_faltas: e.target.checked})} className="w-4 h-4 accent-[#336699]" />
                  Habilitar Desconto de Faltas?
                </label>
              </div>

              <div className="border-2 border-blue-200 p-4 rounded-xl bg-blue-50/40">
                <p className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">O que este contrato recebe (padrão)</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 font-bold text-sm text-[#0C1D4D] cursor-pointer bg-white p-2.5 rounded-lg border border-gray-200">
                    <input type="checkbox" checked={form.recebe_fechamento} onChange={e => setForm({...form, recebe_fechamento: e.target.checked})} className="w-4 h-4 accent-[#336699]" />
                    Recebe fechamento (nossa folha)
                  </label>
                  <label className="flex items-center gap-2 font-bold text-sm text-[#0C1D4D] cursor-pointer bg-white p-2.5 rounded-lg border border-gray-200">
                    <input type="checkbox" checked={form.recebe_holerite} onChange={e => setForm({...form, recebe_holerite: e.target.checked})} className="w-4 h-4 accent-indigo-600" />
                    Recebe holerite (contabilidade)
                  </label>
                </div>
                <p className="text-[9px] font-bold text-gray-400 mt-2 uppercase">Padrão do contrato para pagamentos. O cargo e a ficha do funcionário podem sobrescrever isso.</p>
              </div>

              <div className={`border-2 p-4 rounded-xl ${form.so_documental ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-gray-50/50'}`}>
                <label className="flex items-center gap-3 font-bold text-sm text-[#0C1D4D] cursor-pointer">
                  <input type="checkbox" checked={form.so_documental} onChange={e => setForm({...form, so_documental: e.target.checked})} className="w-4 h-4 accent-indigo-600" />
                  Contrato só documental (não gera cálculo)?
                </label>
                {form.so_documental
                  ? <p className="text-[9px] font-bold text-indigo-600 mt-1 uppercase">Não entra na folha/cálculo. Serve só para guardar dados e enviar holerites da contabilidade para assinatura.</p>
                  : <p className="text-[9px] font-bold text-gray-400 mt-1 uppercase">Marque para contratos que só recebem holerite da contabilidade, sem cálculo no sistema</p>}
              </div>

              <div className="border border-gray-200 p-4 rounded-xl bg-gray-50/50">
                <label className="flex items-center gap-3 font-bold text-sm text-[#0C1D4D] cursor-pointer">
                  <input type="checkbox" checked={form.recebe_holerite_contabilidade} onChange={e => setForm({...form, recebe_holerite_contabilidade: e.target.checked})} className="w-4 h-4 accent-[#336699]" />
                  Recebe holerite da contabilidade?
                </label>
                <p className="text-[9px] font-bold text-gray-400 mt-1 uppercase">Se marcado, entra na separação dos PDFs de adiantamento e pagamento</p>
              </div>

              <div className={`border p-4 rounded-xl ${form.calcula_extras_padrao ? 'border-gray-200 bg-gray-50/50' : 'border-red-200 bg-red-50'}`}>
                <label className="flex items-center gap-3 font-bold text-sm text-[#0C1D4D] cursor-pointer">
                  <input type="checkbox" checked={form.calcula_extras_padrao} onChange={e => setForm({...form, calcula_extras_padrao: e.target.checked})} className="w-4 h-4 accent-[#336699]" />
                  Calcula Horas Extras?
                </label>
                {!form.calcula_extras_padrao && <p className="text-[9px] font-bold text-red-600 mt-1 uppercase">Contrato fechado: nenhuma hora extra ou diária será paga</p>}
              </div>
            </div>

            {/* BENEFÍCIOS VR / VT */}
            <div className="border-2 border-teal-200 bg-teal-50/40 p-5 rounded-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-teal-800 uppercase tracking-wider text-sm">Benefícios — Vale Refeição e Transporte</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <label className="flex items-center gap-3 font-bold text-sm text-[#0C1D4D] cursor-pointer border border-teal-200 bg-white p-3 rounded-lg">
                  <input type="checkbox" checked={form.direito_vr} onChange={e => setForm({...form, direito_vr: e.target.checked})} className="w-4 h-4 accent-teal-600" />
                  Direito a VR (refeição)?
                </label>
                <label className="flex items-center gap-3 font-bold text-sm text-[#0C1D4D] cursor-pointer border border-teal-200 bg-white p-3 rounded-lg">
                  <input type="checkbox" checked={form.direito_vt} onChange={e => setForm({...form, direito_vt: e.target.checked})} className="w-4 h-4 accent-teal-600" />
                  Direito a VT (transporte)?
                </label>
                <div className="border border-teal-200 bg-white p-3 rounded-lg">
                  <label className="block text-[10px] font-black text-teal-700 uppercase mb-1">Modalidade do valor</label>
                  <select value={form.modalidade_beneficio} onChange={e => setForm({...form, modalidade_beneficio: e.target.value as RegraRH['modalidade_beneficio']})} disabled={!form.direito_vr && !form.direito_vt} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white disabled:opacity-50">
                    <option value="POR_DIA">Por Dia (lança a diária)</option>
                    <option value="VALOR_FECHADO">Valor Fechado (lança o mês, ÷30)</option>
                  </select>
                </div>
              </div>
              {(form.direito_vr || form.direito_vt) && (
                <div className="bg-white border border-teal-100 rounded-lg p-3 text-[11px] text-teal-800 font-medium leading-relaxed">
                  <strong className="uppercase text-[10px] block mb-1">Como os benefícios são gerados (automático pelo ponto):</strong>
                  • <strong>Dia de semana:</strong> só gera 1 VR (janta) quando o extra passa de 3h.<br/>
                  • <strong>Sáb/Dom/Feriado até 8h:</strong> 1 VT + 1 VR (almoço).<br/>
                  • <strong>Sáb/Dom/Feriado acima de 8h:</strong> 1 VT + 2 VR (almoço + janta).<br/>
                  • Dia útil normal (8h) não gera benefício. Faltou = não gera (desconto automático).<br/>
                  {form.modalidade_beneficio === 'VALOR_FECHADO' && <span className="text-teal-600">• Modalidade fechada: a diária de cada evento = valor lançado na ficha ÷ 30.</span>}
                </div>
              )}
            </div>

            {!form.calcula_extras_padrao ? (
              <div className="border-2 border-dashed border-gray-300 p-6 rounded-xl text-center">
                <p className="text-sm font-black text-gray-400 uppercase tracking-wider">Contrato Fechado</p>
                <p className="text-xs text-gray-400 mt-1">Este modelo paga apenas o valor acordado. Horas além da jornada e trabalho em fins de semana ou feriados não geram pagamento adicional.</p>
              </div>
            ) : (
            <>
            {/* CONFIGURAÇÃO DE HORAS EXTRAS: SEMANA, SÁBADO E DOMINGO/FERIADO */}
            <div className={`border p-5 rounded-xl space-y-4 ${form.tipo_pagamento_fds === 'VALOR_DIARIA' ? 'border-gray-200 bg-gray-100/70' : 'border-gray-200 bg-gray-50/50'}`}>
              <div className="flex justify-between items-center border-b border-gray-200 pb-2 flex-wrap gap-2">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs">Horas Extras Padrão</h3>
                {form.tipo_pagamento_fds === 'VALOR_DIARIA' && (
                  <span className="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-black uppercase">Inativo: modelo por diária não paga hora extra</span>
                )}
              </div>
              
              <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${form.tipo_pagamento_fds === 'VALOR_DIARIA' ? 'opacity-40' : ''}`}>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Extra Semana (Seg a Sex %)</label>
                  <input type="number" min="0" disabled={form.tipo_pagamento_fds === 'VALOR_DIARIA'} value={form.percentual_extra_semana} onChange={e => setForm({...form, percentual_extra_semana: Number(e.target.value)})} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-black text-[#0C1D4D] disabled:cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Extra Sábado (%)</label>
                  <input type="number" min="0" disabled={form.tipo_pagamento_fds === 'VALOR_DIARIA'} value={form.percentual_extra_sabado} onChange={e => setForm({...form, percentual_extra_sabado: Number(e.target.value)})} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-black text-amber-600 disabled:cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Extra Domingo/Feriado (%)</label>
                  <input type="number" min="0" disabled={form.tipo_pagamento_fds === 'VALOR_DIARIA'} value={form.percentual_extra_dom_fer} onChange={e => setForm({...form, percentual_extra_dom_fer: Number(e.target.value)})} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-black text-red-700 disabled:cursor-not-allowed" />
                </div>
              </div>
            </div>

            {/* TIPO DE REMUNERAÇÃO PARA DOMINGOS E FERIADOS */}
            <div className="border border-amber-200 p-5 rounded-xl bg-amber-50">
              <h3 className="font-black text-amber-700 uppercase tracking-wider text-xs mb-3">Remuneração de Domingos e Feriados</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-amber-700 uppercase mb-1">Tipo de Remuneração</label>
                  <select value={form.tipo_pagamento_fds} onChange={e => setForm({...form, tipo_pagamento_fds: e.target.value as RegraRH['tipo_pagamento_fds']})} className="w-full p-2.5 border border-amber-300 rounded-lg text-sm bg-white font-bold text-[#0C1D4D]">
                    <option value="HORA_PERCENTUAL">Hora Extra (calculada pelo ponto)</option>
                    <option value="VALOR_DIARIA">Valor Fechado (Diária de Viagem/Apoio)</option>
                  </select>
                </div>
                
                {form.tipo_pagamento_fds === 'HORA_PERCENTUAL' ? (
                  <div className="flex items-end">
                    <p className="text-[10px] font-bold text-amber-700 uppercase leading-relaxed p-2.5 bg-white border border-amber-200 rounded-lg w-full">
                      ✔ As horas de dom/fer serão calculadas pelas batidas registradas no banco de dados, com o percentual definido em Horas Extras Padrão.
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-bold text-amber-700 uppercase mb-1">Valor da Diária Fechada (R$)</label>
                    <input type="number" step="0.01" min="0" value={form.valor_diaria_fds} onChange={e => setForm({...form, valor_diaria_fds: Number(e.target.value)})} className="w-full p-2.5 border border-amber-300 rounded-lg text-sm font-black text-amber-700 bg-white" />
                    <p className="text-[9px] font-bold text-amber-600 mt-1 uppercase">Cada dia trabalhado em dom/fer/sáb paga uma diária deste valor.</p>
                  </div>
                )}
              </div>
            </div>
            </>
            )}

            <button onClick={salvarRegra} disabled={loading} className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-sm py-4 rounded-xl shadow-md transition-all mt-4">
              {loading ? 'A SALVAR...' : '💾 GRAVAR PARÂMETRO NO MOTOR'}
            </button>
          </div>
        </main>

      </div>
      )}
    </div>
  );
}