"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { registrarLogAuditoria } from '../../../actions';
import { importarPontoAction, importarAbonosAction, lancarPontoManualAction, abonarDiaManualAction } from '../actions/actions-ponto';
import {
  estatisticasPontoWhatsappAction, listarLedgerPontoWhatsappAction,
  listarSolicitacoesPendentesAction, aprovarSolicitacaoAction, rejeitarSolicitacaoAction,
  listarHistoricoSolicitacoesAction, urlAnexoSolicitacaoAction,
  type EstatisticasPontoWhatsapp, type RegistroLedger, type SolicitacaoPendente, type SolicitacaoHistorico
} from '../actions/actions-ponto-whatsapp';
import SepararHolerites from './SepararHolerites';
import RegistroPontoConsulta from '../../operacional/registro-ponto/RegistroPontoConsulta';
import logoColorido from '../../../../app/imgs/logo.png';

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

interface RegistroDiario {
  id?: string;
  funcionario_nome: string;
  data_registro: string; 
  entrada_1: string | null;
  saida_1: string | null;
  entrada_2: string | null;
  saida_2: string | null;
  minutos_trabalhados: number;
}

interface Abono {
  id?: string;
  funcionario_nome: string;
  data_abono: string; 
  dia_todo: boolean;
  hora_inicio: string | null;
  hora_fim: string | null;
  minutos_abonados: number;
  motivo: string | null;
}

export default function GestaoDePonto() {
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abonoFileInputRef = useRef<HTMLInputElement>(null);

  const [registros, setRegistros] = useState<RegistroDiario[]>([]);
  const [abonos, setAbonos] = useState<Abono[]>([]);
  const [feriadosGlobais, setFeriadosGlobais] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const [abaPrincipal, setAbaPrincipal] = useState<'gestao' | 'registro_diario' | 'gestao_abonos' | 'inconsistencia_ponto'>('gestao');
  // Batidas ímpares/incompletas do mês (mesma regra usada para travar o
  // fechamento da folha em /admin/rh/holerite) — só é preenchido quando o RH
  // clica em "Verificar Inconsistência", não é automático.
  const [inconsistencias, setInconsistencias] = useState<RegistroDiario[] | null>(null);
  // Faltas do mês (dia útil sem batida e sem abono), calculada junto com as
  // inconsistências ao clicar em "Verificar Inconsistência".
  const [faltasEncontradas, setFaltasEncontradas] = useState<{ funcionario_nome: string; data: string }[] | null>(null);
  const [filtroFuncionarioPendencia, setFiltroFuncionarioPendencia] = useState('');
  const [viewMode, setViewMode] = useState<'resumo' | 'espelho' | 'espelho_todos' | 'separar_holerites' | 'ponto_whatsapp'>('resumo');
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState('');
  const [estatisticasWhatsapp, setEstatisticasWhatsapp] = useState<EstatisticasPontoWhatsapp | null>(null);
  const [ledgerWhatsapp, setLedgerWhatsapp] = useState<RegistroLedger[]>([]);
  const [carregandoLedger, setCarregandoLedger] = useState(false);
  const [abaWhatsapp, setAbaWhatsapp] = useState<'ledger' | 'solicitacoes' | 'historico'>('ledger');
  const [solicitacoesPendentes, setSolicitacoesPendentes] = useState<SolicitacaoPendente[]>([]);
  const [carregandoSolicitacoes, setCarregandoSolicitacoes] = useState(false);
  const [processandoSolicitacaoId, setProcessandoSolicitacaoId] = useState<number | null>(null);
  const [historicoSolicitacoes, setHistoricoSolicitacoes] = useState<SolicitacaoHistorico[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  // Batida via WhatsApp usa a data real do dia (não a competência de folha),
  // então tem seletor de mês próprio — por padrão o mês corrente, não o
  // anterior usado no restante da tela para o fechamento de folha.
  const [mesAnoWhatsapp, setMesAnoWhatsapp] = useState(() => {
    const hoje = new Date();
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  });
  const [abonosConsolidado, setAbonosConsolidado] = useState(false);
  const [elegiveisContabilidade, setElegiveisContabilidade] = useState<{ nome_completo: string; tipo_contrato: string }[]>([]);

  // Lançamento manual de ponto pelo RH (sem depender de CSV ou WhatsApp)
  const [listaFuncionariosAtivos, setListaFuncionariosAtivos] = useState<string[]>([]);
  // Mesmos funcionários, com admissão/desligamento — usado só para calcular
  // faltas do mês (mesma regra de apurarPonto() em /admin/rh/holerite).
  const [funcionariosAtivosDetalhe, setFuncionariosAtivosDetalhe] = useState<{ nome_completo: string; data_admissao: string | null; data_desligamento: string | null }[]>([]);
  const [manualFuncionario, setManualFuncionario] = useState('');
  const [manualData, setManualData] = useState('');
  const [manualE1, setManualE1] = useState('');
  const [manualS1, setManualS1] = useState('');
  const [manualE2, setManualE2] = useState('');
  const [manualS2, setManualS2] = useState('');
  const [lancandoManual, setLancandoManual] = useState(false);
  // Ponto já lançado nesse dia, consultado ao vivo ao escolher funcionário +
  // data — evita que o RH sobreponha uma batida sem perceber.
  const [registroExistente, setRegistroExistente] = useState<{ origem: string; entrada_1: string | null; saida_1: string | null; entrada_2: string | null; saida_2: string | null } | null | undefined>(undefined);
  const [verificandoExistente, setVerificandoExistente] = useState(false);

  // Abonar dia (RH abona um dia inteiro direto por aqui)
  const [abonoFuncionario, setAbonoFuncionario] = useState('');
  const [abonoData, setAbonoData] = useState('');
  const [abonoMotivo, setAbonoMotivo] = useState('');
  const [abonando, setAbonando] = useState(false);
  const [abonoExistente, setAbonoExistente] = useState<{ origem: string; motivo: string | null } | null | undefined>(undefined);
  const [verificandoAbonoExistente, setVerificandoAbonoExistente] = useState(false);

  const [mesAnoSelecionado, setMesAnoSelecionado] = useState(() => {
    // Competência = mês anterior ao corrente (o mês corrente é o de pagamento)
    const hoje = new Date();
    const comp = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    return `${comp.getFullYear()}-${String(comp.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => {
    if (!authLoading && !acessoNegado) carregarAcessoEDados();
  }, [mesAnoSelecionado, authLoading, acessoNegado]);

  // O resultado da verificação de inconsistência é para o mês em que foi
  // gerado — muda o mês, o resultado anterior fica obsoleto.
  useEffect(() => { setInconsistencias(null); setFaltasEncontradas(null); setFiltroFuncionarioPendencia(''); }, [mesAnoSelecionado]);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    supabase.from('folha_funcionarios').select('nome_completo, data_admissao, data_desligamento').eq('ativo', true).order('nome_completo')
      .then(({ data }) => {
        setListaFuncionariosAtivos((data || []).map(f => f.nome_completo));
        setFuncionariosAtivosDetalhe(data || []);
      });
  }, [authLoading, acessoNegado]);

  const verificarRegistroExistente = async (funcionario: string, data: string) => {
    setVerificandoExistente(true);
    const { data: reg } = await supabase.from('folha_ponto_diaria')
      .select('origem, entrada_1, saida_1, entrada_2, saida_2')
      .eq('funcionario_nome', funcionario)
      .eq('data_registro', data)
      .maybeSingle();
    setRegistroExistente(reg || null);
    setManualE1(reg?.entrada_1 || '');
    setManualS1(reg?.saida_1 || '');
    setManualE2(reg?.entrada_2 || '');
    setManualS2(reg?.saida_2 || '');
    setVerificandoExistente(false);
  };

  // Sempre que o RH escolhe funcionário + data, busca ao vivo se já existe
  // ponto lançado nesse dia — pré-preenche os campos com o que já está
  // gravado, pra ele nunca sobrepor uma batida sem ver o que tinha antes.
  useEffect(() => {
    if (!manualFuncionario || !manualData) {
      setRegistroExistente(undefined);
      return;
    }
    verificarRegistroExistente(manualFuncionario, manualData);
  }, [manualFuncionario, manualData]);

  const verificarAbonoExistente = async (funcionario: string, data: string) => {
    setVerificandoAbonoExistente(true);
    const { data: reg } = await supabase.from('folha_ponto_abono')
      .select('origem, motivo')
      .eq('funcionario_nome', funcionario)
      .eq('data_abono', data)
      .maybeSingle();
    setAbonoExistente(reg || null);
    setAbonoMotivo(reg?.motivo || '');
    setVerificandoAbonoExistente(false);
  };

  // Mesma lógica do lançamento manual de ponto: ao escolher funcionário + data,
  // busca ao vivo se já existe abono nesse dia pra nunca sobrepor sem ver.
  useEffect(() => {
    if (!abonoFuncionario || !abonoData) {
      setAbonoExistente(undefined);
      return;
    }
    verificarAbonoExistente(abonoFuncionario, abonoData);
  }, [abonoFuncionario, abonoData]);

  const carregarAcessoEDados = async (mesAnoAlvo?: string) => {
    setLoading(true);

    // Busca Feriados Dinâmicos do Banco
    const { data: fData } = await supabase.from('folha_feriados').select('data_feriado');
    const feriadosList = fData ? fData.map(f => f.data_feriado) : [];
    setFeriadosGlobais(feriadosList);

    const mesAno = mesAnoAlvo || mesAnoSelecionado;
    const [ano, mes] = mesAno.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
    const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;

    // Busca Abonos do Mês
    const { data: abonosData } = await supabase
      .from('folha_ponto_abono')
      .select('id, funcionario_nome, data_abono, dia_todo, hora_inicio, hora_fim, minutos_abonados, motivo')
      .gte('data_abono', dataInicio)
      .lte('data_abono', dataFim);
    if (abonosData) setAbonos(abonosData);

    const { data } = await supabase
      .from('folha_ponto_diaria')
      .select('id, funcionario_nome, data_registro, entrada_1, saida_1, entrada_2, saida_2, minutos_trabalhados')
      .gte('data_registro', dataInicio)
      .lte('data_registro', dataFim)
      .order('data_registro', { ascending: true });
    
    if (data) setRegistros(data);

    // Funcionários elegíveis à separação de holerite (contrato com a flag ligada),
    // em ordem alfabética — base da pré-associação por ordem.
    const { data: regrasData } = await supabase
      .from('folha_parametros')
      .select('nome_regra, recebe_holerite_contabilidade');
    const contratosComHolerite = new Set(
      (regrasData || []).filter(r => r.recebe_holerite_contabilidade !== false).map(r => r.nome_regra)
    );
    const { data: funcData } = await supabase
      .from('folha_funcionarios')
      .select('nome_completo, tipo_contrato')
      .eq('ativo', true)
      .order('nome_completo');
    const elegiveis = (funcData || [])
      .filter(f => contratosComHolerite.has(f.tipo_contrato))
      .map(f => ({ nome_completo: f.nome_completo, tipo_contrato: f.tipo_contrato }));
    setElegiveisContabilidade(elegiveis);

    setLoading(false);
  };

  // Estatísticas de Ponto via WhatsApp têm seletor de mês próprio
  // (mesAnoWhatsapp), independente da competência de folha da tela.
  useEffect(() => {
    if (authLoading || acessoNegado) return;
    estatisticasPontoWhatsappAction(mesAnoWhatsapp).then(res => {
      if (res.ok) setEstatisticasWhatsapp(res.info || null);
    });
  }, [mesAnoWhatsapp, authLoading, acessoNegado]);

  const timeToMinutes = (timeStr: string | null) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
  };

  const minutesToTimeStr = (totalMins: number) => {
    const isNegative = totalMins < 0;
    const absMins = Math.abs(totalMins);
    const h = Math.floor(absMins / 60);
    const m = absMins % 60;
    return `${isNegative ? '-' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const getDiaSemana = (dataIso: string) => {
    const partes = dataIso.split('-');
    return new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10)).getDay();
  };

  // Dia não útil (sábado, domingo ou feriado) tem carga horária zero:
  // abono nesses dias não gera crédito de horas.
  const isDiaNaoUtil = (dataIso: string, feriados: string[]) => {
    const diaSemana = getDiaSemana(dataIso);
    return diaSemana === 0 || diaSemana === 6 || feriados.includes(dataIso);
  };

  const minutosAbonadosEfetivos = (abono: { minutos_abonados: number } | undefined, dataIso: string) => {
    if (!abono) return 0;
    return isDiaNaoUtil(dataIso, feriadosGlobais) ? 0 : abono.minutos_abonados;
  };

  // Parser de CSV que respeita aspas, campos vazios, vírgulas e
  // quebras de linha dentro de campos (ex.: observações longas do Pontomais)
  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (inQuotes && text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(cell.trim()); cell = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && text[i + 1] === '\n') i++;
        row.push(cell.trim()); cell = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else {
        cell += char;
      }
    }
    row.push(cell.trim());
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n');
        
        const startIndex = lines.findIndex(l => l.includes('Nome') && l.includes('Data') && l.includes('Hora'));
        if (startIndex === -1) throw new Error('Formato de CSV inválido. Certifique-se de ser a exportação do Pontomais.');

        const mapaPonto: Record<string, string[]> = {};
        let anoRef = '';
        let mesRef = '';

        for (let i = startIndex + 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const match = line.match(/^([^,]+),"[^,]+,\s*([^"]+)",([0-9:]+)/);
          if (match) {
            const nome = match[1].trim();
            const dataBr = match[2].trim(); 
            const hora = match[3].trim(); 

            const [dia, mes, ano] = dataBr.split('/');
            const dataIso = `${ano}-${mes}-${dia}`;
            
            if (!anoRef) { anoRef = ano; mesRef = mes; }

            const key = `${nome}|${dataIso}`;
            if (!mapaPonto[key]) mapaPonto[key] = [];
            mapaPonto[key].push(hora);
          }
        }

        const registrosProcessados: Omit<RegistroDiario, 'id'>[] = [];
        const nomesNoCsv = new Set<string>();

        Object.keys(mapaPonto).forEach(key => {
          const [nome, dataRegistro] = key.split('|');
          const batidas = mapaPonto[key].sort(); 

          nomesNoCsv.add(nome);

          const e1 = batidas[0] || null;
          const s1 = batidas[1] || null;
          const e2 = batidas[2] || null;
          const s2 = batidas[3] || null;

          let minutosTrabalhados = 0;

          if (e1 && s1 && !e2 && !s2) {
            let mins = timeToMinutes(s1) - timeToMinutes(e1);
            if (mins >= 360) mins = mins - 60; 
            minutosTrabalhados = mins;
          } else {
            if (e1 && s1) minutosTrabalhados += (timeToMinutes(s1) - timeToMinutes(e1));
            if (e2 && s2) minutosTrabalhados += (timeToMinutes(s2) - timeToMinutes(e2));
          }

          registrosProcessados.push({
            funcionario_nome: nome, data_registro: dataRegistro,
            entrada_1: e1, saida_1: s1, entrada_2: e2, saida_2: s2,
            minutos_trabalhados: minutosTrabalhados
          });
        });

        const res = await importarPontoAction({
          registros: registrosProcessados,
          nomes: Array.from(nomesNoCsv),
          anoRef, mesRef,
          usuarioNome: usuarioAtual,
          nomeArquivo: file.name
        });
        if (!res.ok) throw new Error(res.erro);

        alert(`Sucesso! ${res.info?.gravados ?? registrosProcessados.length} dias de trabalho importados.${res.info?.aviso ? `\n\n⚠️ ${res.info.aviso}` : ''}`);

        const mesIdentificado = `${anoRef}-${mesRef}`;
        setMesAnoSelecionado(mesIdentificado);
        carregarAcessoEDados(mesIdentificado);
        setViewMode('resumo');

      } catch (error: any) { alert(error.message); } 
      finally { setIsProcessing(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
    };
    reader.readAsText(file);
  };

  const handleAbonoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCsv(text);

        // Localiza a linha de cabeçalho (o relatório do Pontomais tem linhas extras antes)
        const headerIndex = rows.findIndex(r =>
          r[0] === 'Nome' && r[1] === 'Data' && (r[2] || '').startsWith('Dia todo')
        );
        if (headerIndex === -1) {
          throw new Error('Formato de CSV de abono inválido. Certifique-se de ser a exportação do Pontomais.');
        }

        const abonosProcessados: Omit<Abono, 'id'>[] = [];
        const nomesNoCsv = new Set<string>();
        let anoRef = '';
        let mesRef = '';

        for (let i = headerIndex + 1; i < rows.length; i++) {
          const columns = rows[i];
          if (columns.length < 13) continue;

          const nome = columns[0];
          const dataCompleta = columns[1];      // "Ter, 02/06/2026"
          const diaTodo = columns[2] === 'Sim';
          const horaInicio = columns[3] || null;
          const horaFim = columns[4] || null;
          const status = columns[6];
          const motivo = columns[11] || null;

          // Só importa abonos aprovados
          if (status !== 'Aprovada') continue;

          const dataBrMatch = dataCompleta.match(/(\d{2}\/\d{2}\/\d{4})/);
          if (!nome || !dataBrMatch) continue;

          const [dia, mes, ano] = dataBrMatch[0].split('/');
          const dataAbono = `${ano}-${mes}-${dia}`;

          if (!anoRef) { anoRef = ano; mesRef = mes; }
          nomesNoCsv.add(nome);

          let minutosAbonados = 0;
          if (diaTodo) {
            minutosAbonados = 480; // 8 horas (jornada padrão)
          } else if (horaInicio && horaFim) {
            minutosAbonados = timeToMinutes(horaFim) - timeToMinutes(horaInicio);
          }

          abonosProcessados.push({
            funcionario_nome: nome,
            data_abono: dataAbono,
            dia_todo: diaTodo,
            hora_inicio: horaInicio,
            hora_fim: horaFim,
            minutos_abonados: minutosAbonados,
            motivo: motivo
          });
        }

        if (abonosProcessados.length === 0) {
          throw new Error('Nenhum registro de abono válido encontrado no arquivo.');
        }

        const res = await importarAbonosAction({
          abonos: abonosProcessados,
          nomes: Array.from(nomesNoCsv),
          anoRef, mesRef,
          usuarioNome: usuarioAtual,
          nomeArquivo: file.name
        });
        if (!res.ok) throw new Error(res.erro);

        alert(`Sucesso! ${res.info?.gravados ?? abonosProcessados.length} registros de abono importados.${res.info?.aviso ? `\n\n⚠️ ${res.info.aviso}` : ''}`);

        const mesIdentificado = `${anoRef}-${mesRef}`;
        setMesAnoSelecionado(mesIdentificado);
        carregarAcessoEDados(mesIdentificado);
        setViewMode('resumo');

      } catch (error: any) { alert(`Erro ao processar arquivo de abonos: ${error.message}`); }
      finally { setIsProcessing(false); if (abonoFileInputRef.current) abonoFileInputRef.current.value = ''; }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleLancarPontoManual = async () => {
    if (!manualFuncionario) { alert('Selecione o funcionário.'); return; }
    if (!manualData) { alert('Selecione a data.'); return; }
    if (!manualE1 && !manualS1 && !manualE2 && !manualS2) { alert('Informe ao menos a Entrada e a Saída.'); return; }

    const resumoBatidas = (manualE2 || manualS2)
      ? `Entrada ${manualE1 || '--:--'} · Saída Almoço ${manualS1 || '--:--'} · Retorno Almoço ${manualE2 || '--:--'} · Saída ${manualS2 || '--:--'}`
      : `Entrada ${manualE1 || '--:--'} · Saída ${manualS1 || '--:--'}`;

    const sobrepondoWhatsapp = registroExistente?.origem === 'WHATSAPP';

    if (sobrepondoWhatsapp) {
      // O ledger via WhatsApp em si nunca é apagado (fica intacto para
      // auditoria) — esta ação só corrige o retrato do dia usado no
      // cálculo da folha, então pede uma confirmação à parte, mais explícita.
      if (!confirm(
        `⚠ Este dia tem batida confirmada via WhatsApp (ledger legal, nunca é apagado).\n\n` +
        `Você está corrigindo apenas a versão usada no CÁLCULO DA FOLHA de ${manualFuncionario} em ${manualData.split('-').reverse().join('/')} — por exemplo, para remover uma batida a mais feita sem querer.\n\n` +
        `O ledger original do WhatsApp permanece intacto para auditoria. Deseja continuar?`
      )) return;
    }

    const avisoSobreposicao = registroExistente
      ? `\n\n⚠ Já existe ponto lançado nesse dia (origem: ${registroExistente.origem}) — os valores acima vão SUBSTITUIR o que está gravado.`
      : '';

    if (!confirm(
      `Lançar ponto de ${manualFuncionario} em ${manualData.split('-').reverse().join('/')}?\n\n${resumoBatidas}${avisoSobreposicao}`
    )) return;

    setLancandoManual(true);
    try {
      const res = await lancarPontoManualAction({
        funcionarioNome: manualFuncionario,
        dataRegistro: manualData,
        entrada1: manualE1 || null,
        saida1: manualS1 || null,
        entrada2: manualE2 || null,
        saida2: manualS2 || null,
        usuarioNome: usuarioAtual,
        confirmarSobreposicaoWhatsapp: sobrepondoWhatsapp
      });
      if (!res.ok) throw new Error(res.erro);

      alert(sobrepondoWhatsapp
        ? 'Ponto corrigido! O ledger original do WhatsApp continua intacto para auditoria — só o valor usado na folha foi ajustado.'
        : 'Ponto lançado com sucesso!');
      await verificarRegistroExistente(manualFuncionario, manualData);
      setMesAnoSelecionado(manualData.slice(0, 7));
      carregarAcessoEDados(manualData.slice(0, 7));
    } catch (e: any) {
      alert('Erro ao lançar o ponto: ' + e.message);
    } finally {
      setLancandoManual(false);
    }
  };

  const handleAbonarDia = async () => {
    if (!abonoFuncionario) { alert('Selecione o funcionário.'); return; }
    if (!abonoData) { alert('Selecione a data.'); return; }
    if (!abonoMotivo.trim()) { alert('Informe o motivo do abono.'); return; }

    const sobrepondoWhatsapp = abonoExistente?.origem === 'WHATSAPP';

    if (sobrepondoWhatsapp) {
      if (!confirm(
        `⚠ Este dia tem abono confirmado via WhatsApp.\n\n` +
        `Você está corrigindo o abono de ${abonoFuncionario} em ${abonoData.split('-').reverse().join('/')}. Deseja continuar?`
      )) return;
    }

    const avisoSobreposicao = abonoExistente
      ? `\n\n⚠ Já existe abono lançado nesse dia (origem: ${abonoExistente.origem}) — vai SUBSTITUIR o que está gravado.`
      : '';

    if (!confirm(
      `Abonar o dia de ${abonoFuncionario} em ${abonoData.split('-').reverse().join('/')}?\n\nMotivo: ${abonoMotivo}${avisoSobreposicao}`
    )) return;

    setAbonando(true);
    try {
      const res = await abonarDiaManualAction({
        funcionarioNome: abonoFuncionario,
        dataAbono: abonoData,
        motivo: abonoMotivo,
        usuarioNome: usuarioAtual,
        confirmarSobreposicaoWhatsapp: sobrepondoWhatsapp
      });
      if (!res.ok) throw new Error(res.erro);

      alert('Dia abonado com sucesso!');
      await verificarAbonoExistente(abonoFuncionario, abonoData);
      setMesAnoSelecionado(abonoData.slice(0, 7));
      carregarAcessoEDados(abonoData.slice(0, 7));
    } catch (e: any) {
      alert('Erro ao abonar o dia: ' + e.message);
    } finally {
      setAbonando(false);
    }
  };

  const resumoGeral = useMemo(() => {
    const mapa: Record<string, { nome: string; totalMins: number; extraSemMins: number; extraSabMins: number; extraDomMins: number }> = {};
    
    const todosOsNomes = [...new Set([...registros.map(r => r.funcionario_nome), ...abonos.map(a => a.funcionario_nome)])];

    todosOsNomes.forEach(nome => {
        mapa[nome] = { nome, totalMins: 0, extraSemMins: 0, extraSabMins: 0, extraDomMins: 0 };
    });

    const dadosCombinados: Record<string, { trabalhados: number, abonados: number, data: string }> = {};

    registros.forEach(r => {
        const key = `${r.funcionario_nome}|${r.data_registro}`;
        if (!dadosCombinados[key]) dadosCombinados[key] = { trabalhados: 0, abonados: 0, data: r.data_registro };
        dadosCombinados[key].trabalhados = r.minutos_trabalhados;
    });

    abonos.forEach(a => {
        const key = `${a.funcionario_nome}|${a.data_abono}`;
        if (!dadosCombinados[key]) dadosCombinados[key] = { trabalhados: 0, abonados: 0, data: a.data_abono };
        dadosCombinados[key].abonados = a.minutos_abonados;
    });

    Object.entries(dadosCombinados).forEach(([key, val]) => {
        const [nome, dataRegistro] = key.split('|');
        if (!mapa[nome]) return;

        const diaSemana = getDiaSemana(dataRegistro);
        const isFeriado = feriadosGlobais.includes(dataRegistro);
        const is100 = diaSemana === 0 || diaSemana === 6 || isFeriado;

        // Em dia não útil a carga é zero, então abono não gera crédito de horas
        const abonadosEfetivos = is100 ? 0 : val.abonados;

        const minutosTotaisDoDia = val.trabalhados + abonadosEfetivos;
        mapa[nome].totalMins += minutosTotaisDoDia;

        const cargaHorariaMinutos = is100 ? 0 : 480;
        const saldoDiarioMins = minutosTotaisDoDia - cargaHorariaMinutos;

        if (saldoDiarioMins > 0) {
            if (isFeriado || diaSemana === 0) { 
                mapa[nome].extraDomMins += saldoDiarioMins;
            } else if (diaSemana === 6) { 
                mapa[nome].extraSabMins += saldoDiarioMins;
            } else { 
                mapa[nome].extraSemMins += saldoDiarioMins;
            }
        }
    });

    return Object.values(mapa).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [registros, abonos, feriadosGlobais]);

  const funcionariosUnicos = useMemo(() => [...new Set([...registros.map(r => r.funcionario_nome), ...abonos.map(a => a.funcionario_nome)])].sort(), [registros, abonos]);

  // Abonos do mês ordenados por nome e depois por data
  const abonosOrdenados = useMemo(() => {
    return [...abonos].sort((a, b) =>
      a.funcionario_nome.localeCompare(b.funcionario_nome) || a.data_abono.localeCompare(b.data_abono)
    );
  }, [abonos]);

  // Consolidado de abonos por funcionário: nº de dias, minutos totais e parciais
  const abonosPorFuncionario = useMemo(() => {
    const mapa: Record<string, { nome: string; qtd: number; totalMins: number; qtdDiaTodo: number; qtdParcial: number }> = {};
    abonos.forEach(a => {
      if (!mapa[a.funcionario_nome]) mapa[a.funcionario_nome] = { nome: a.funcionario_nome, qtd: 0, totalMins: 0, qtdDiaTodo: 0, qtdParcial: 0 };
      mapa[a.funcionario_nome].qtd += 1;
      mapa[a.funcionario_nome].totalMins += a.minutos_abonados;
      if (a.dia_todo) mapa[a.funcionario_nome].qtdDiaTodo += 1;
      else mapa[a.funcionario_nome].qtdParcial += 1;
    });
    return Object.values(mapa).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [abonos]);

  const totalAbonosMin = useMemo(() => abonos.reduce((acc, a) => acc + a.minutos_abonados, 0), [abonos]);

  // Um dia só é considerado OK se tiver ENTRADA+SAÍDA, ou ENTRADA+SAÍDA
  // ALMOÇO+RETORNO ALMOÇO+SAÍDA. Qualquer combinação parcial (batida ímpar —
  // ex.: só entrada, ou 3 das 4 batidas) é inconsistente. Mesma regra usada
  // para travar o fechamento da folha em /admin/rh/holerite.
  const diaComBatidasOk = (r: RegistroDiario): boolean => {
    const { entrada_1: e1, saida_1: s1, entrada_2: e2, saida_2: s2 } = r;
    if (!e1 && !s1 && !e2 && !s2) return true;
    if (e1 && s1 && !e2 && !s2) return true;
    if (e1 && s1 && e2 && s2) return true;
    return false;
  };

  // Faltas: dia útil (não sáb/dom/feriado) dentro do mês selecionado, até
  // hoje, dentro do período de contrato do funcionário (admissão/desligamento),
  // sem nenhuma batida trabalhada e sem abono. Mesma regra de apurarPonto()
  // em /admin/rh/holerite — só considera funcionários que já têm ao menos um
  // registro/abono no mês (evita marcar falta em massa quando o CSV do mês
  // ainda nem foi importado).
  const calcularFaltasDoMes = (): { funcionario_nome: string; data: string }[] => {
    const mapaDias: Record<string, { trabalhados: number; abonados: number }> = {};
    registros.forEach(r => {
      const key = `${r.funcionario_nome}|${r.data_registro}`;
      mapaDias[key] = { trabalhados: r.minutos_trabalhados, abonados: mapaDias[key]?.abonados || 0 };
    });
    abonos.forEach(a => {
      const key = `${a.funcionario_nome}|${a.data_abono}`;
      mapaDias[key] = { trabalhados: mapaDias[key]?.trabalhados || 0, abonados: a.minutos_abonados };
    });

    const nomesComRegistroNoMes = new Set([
      ...registros.map(r => r.funcionario_nome),
      ...abonos.map(a => a.funcionario_nome)
    ]);

    const [ano, mes] = mesAnoSelecionado.split('-').map(Number);
    const diasNoMes = new Date(ano, mes, 0).getDate();
    const hoje = new Date(); hoje.setHours(23, 59, 59, 999);

    const faltas: { funcionario_nome: string; data: string }[] = [];

    funcionariosAtivosDetalhe.forEach(f => {
      if (!nomesComRegistroNoMes.has(f.nome_completo)) return;

      for (let d = 1; d <= diasNoMes; d++) {
        const dataObj = new Date(ano, mes - 1, d);
        if (dataObj > hoje) break;
        const dataIso = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        if (f.data_admissao && dataIso < f.data_admissao) continue;
        if (f.data_desligamento && dataIso > f.data_desligamento) continue;

        const diaSemana = dataObj.getDay();
        if (diaSemana === 0 || diaSemana === 6 || feriadosGlobais.includes(dataIso)) continue;

        const reg = mapaDias[`${f.nome_completo}|${dataIso}`];
        const presente = reg && (reg.trabalhados > 0 || reg.abonados > 0);
        if (!presente) faltas.push({ funcionario_nome: f.nome_completo, data: dataIso });
      }
    });

    return faltas.sort((a, b) => a.funcionario_nome.localeCompare(b.funcionario_nome) || a.data.localeCompare(b.data));
  };

  const verificarInconsistenciasPonto = () => {
    const problemas = registros
      .filter(r => !diaComBatidasOk(r))
      .sort((a, b) => a.funcionario_nome.localeCompare(b.funcionario_nome) || a.data_registro.localeCompare(b.data_registro));
    setInconsistencias(problemas);
    setFaltasEncontradas(calcularFaltasDoMes());
  };

  // Clicar numa linha de pendência (ponto ímpar ou falta) preenche o
  // funcionário + data nos dois quadros ao lado (Lançar Ponto Manual e
  // Abonar Dia) — o RH decide ali qual ação faz sentido para o caso.
  const selecionarPendencia = (nome: string, data: string) => {
    setManualFuncionario(nome);
    setManualData(data);
    setAbonoFuncionario(nome);
    setAbonoData(data);
  };

  // Nomes disponíveis pro filtro: só quem aparece nas pendências apuradas.
  const nomesComPendencia = useMemo(() => {
    const nomes = new Set([
      ...(inconsistencias || []).map(r => r.funcionario_nome),
      ...(faltasEncontradas || []).map(f => f.funcionario_nome)
    ]);
    return [...nomes].sort();
  }, [inconsistencias, faltasEncontradas]);

  const inconsistenciasFiltradas = useMemo(
    () => (inconsistencias || []).filter(r => !filtroFuncionarioPendencia || r.funcionario_nome === filtroFuncionarioPendencia),
    [inconsistencias, filtroFuncionarioPendencia]
  );
  const faltasFiltradas = useMemo(
    () => (faltasEncontradas || []).filter(f => !filtroFuncionarioPendencia || f.funcionario_nome === filtroFuncionarioPendencia),
    [faltasEncontradas, filtroFuncionarioPendencia]
  );

  const abrirEspelhoUnico = (nome: string) => { setFuncionarioSelecionado(nome); setViewMode('espelho'); };
  const abrirTodosEspelhos = () => setViewMode('espelho_todos');
  const voltarResumo = () => { setViewMode('resumo'); setFuncionarioSelecionado(''); };

  const carregarLedgerWhatsapp = async (mesAnoAlvo?: string) => {
    setCarregandoLedger(true);
    const res = await listarLedgerPontoWhatsappAction(mesAnoAlvo || mesAnoWhatsapp);
    if (res.ok) setLedgerWhatsapp(res.info || []);
    setCarregandoLedger(false);
  };

  const abrirLedgerWhatsapp = () => {
    setViewMode('ponto_whatsapp');
    setAbaWhatsapp('ledger');
    carregarLedgerWhatsapp();
  };

  const carregarSolicitacoesPendentes = async () => {
    setCarregandoSolicitacoes(true);
    const res = await listarSolicitacoesPendentesAction();
    if (res.ok) setSolicitacoesPendentes(res.info || []);
    setCarregandoSolicitacoes(false);
  };

  const abrirSolicitacoesPendentes = () => {
    setViewMode('ponto_whatsapp');
    setAbaWhatsapp('solicitacoes');
    carregarSolicitacoesPendentes();
  };

  const aprovarSolicitacao = async (id: number) => {
    if (!confirm('Aprovar esta solicitação? Isso já grava o ajuste/abono e avisa o funcionário pelo WhatsApp.')) return;
    setProcessandoSolicitacaoId(id);
    const res = await aprovarSolicitacaoAction({ id, aprovadorNome: usuarioAtual });
    setProcessandoSolicitacaoId(null);
    if (!res.ok) { alert(res.erro); return; }
    await Promise.all([carregarSolicitacoesPendentes(), carregarAcessoEDados(), carregarHistoricoSolicitacoes()]);
  };

  const rejeitarSolicitacao = async (id: number) => {
    const motivo = prompt('Motivo da rejeição (o funcionário verá esta mensagem):');
    if (!motivo?.trim()) return;
    setProcessandoSolicitacaoId(id);
    const res = await rejeitarSolicitacaoAction({ id, aprovadorNome: usuarioAtual, motivoRejeicao: motivo.trim() });
    setProcessandoSolicitacaoId(null);
    if (!res.ok) { alert(res.erro); return; }
    await Promise.all([carregarSolicitacoesPendentes(), carregarHistoricoSolicitacoes()]);
  };

  const carregarHistoricoSolicitacoes = async () => {
    setCarregandoHistorico(true);
    const res = await listarHistoricoSolicitacoesAction();
    if (res.ok) setHistoricoSolicitacoes(res.info || []);
    setCarregandoHistorico(false);
  };

  const abrirHistoricoSolicitacoes = () => {
    setViewMode('ponto_whatsapp');
    setAbaWhatsapp('historico');
    carregarHistoricoSolicitacoes();
  };

  const verAnexoSolicitacao = async (id: number) => {
    const res = await urlAnexoSolicitacaoAction({ id });
    if (!res.ok || !res.info) { alert(res.erro || 'Não foi possível abrir o anexo.'); return; }
    window.open(res.info.url, '_blank');
  };

  const RenderEspelho = ({ nome, registrosFunc }: { nome: string, registrosFunc: RegistroDiario[] }) => {
    const [ano, mes] = mesAnoSelecionado.split('-').map(Number);
    const diasNoMes = new Date(ano, mes, 0).getDate();

    const todosOsDiasDoMes = Array.from({ length: diasNoMes }, (_, i) => {
        const dia = i + 1;
        const data = new Date(ano, mes - 1, dia);
        const dataIso = data.toISOString().split('T')[0];
        
        const registroDoDia = registrosFunc.find(r => r.data_registro === dataIso);
        const abonoDoDia = abonos.find(a => a.funcionario_nome === nome && a.data_abono === dataIso);

        return { data, dataIso, registroDoDia, abonoDoDia };
    });

    const calcularTotaisFuncionario = (dias: typeof todosOsDiasDoMes) => {
        let totalTrabalhado = 0;
        let totalExtra = 0;
        
        dias.forEach(({ registroDoDia, abonoDoDia, dataIso }) => {
            const minutosTrabalhados = registroDoDia?.minutos_trabalhados || 0;
            const minutosAbonados = minutosAbonadosEfetivos(abonoDoDia, dataIso);
            const minutosTotaisDoDia = minutosTrabalhados + minutosAbonados;

            totalTrabalhado += minutosTotaisDoDia;

            const diaSemana = getDiaSemana(dataIso);
            const isFeriado = feriadosGlobais.includes(dataIso);
            const is100 = diaSemana === 0 || diaSemana === 6 || isFeriado;
            
            const cargaHorariaMinutos = is100 ? 0 : 480;
            totalExtra += (minutosTotaisDoDia - cargaHorariaMinutos);
        });
        
        return {
            trabalhadoStr: minutesToTimeStr(totalTrabalhado),
            extraStr: minutesToTimeStr(totalExtra),
            isExtraPositivo: totalExtra >= 0
        };
    };

    const totais = calcularTotaisFuncionario(todosOsDiasDoMes);
    
    return (
      <main className="espelho-doc bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-6 lg:p-10 print:border-none print:shadow-none print:p-0 print:mb-0 mb-8" style={{ pageBreakAfter: 'always' }}>
        <div className="flex justify-between items-end border-b-2 border-black pb-4 mb-6">
          <div className="hidden print:block mb-2"><Image src={logoColorido} alt="Rentech" width={180} height={55} /></div>
          <div className="text-left print:text-right w-full">
            <h2 className="text-2xl font-black text-black uppercase tracking-tight">Espelho de Ponto Eletrônico</h2>
            <div className="mt-2 text-sm text-gray-700 space-y-0.5">
              <p><strong>Colaborador:</strong> {nome}</p>
              <p><strong>Competência:</strong> {mesAnoSelecionado.split('-').reverse().join('/')}</p>
              <p><strong>Jornada Padrão:</strong> 08:00h (Segunda a Sexta)</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-center border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-y-2 border-black text-xs uppercase font-black tracking-wider text-[#0C1D4D] print:text-black">
                <th className="p-3 text-left">Data do Registro</th>
                <th className="p-3">Entrada 1</th>
                <th className="p-3">Saída 1</th>
                <th className="p-3">Entrada 2</th>
                <th className="p-3">Saída 2</th>
                <th className="p-3 bg-blue-50 print:bg-transparent">H. Trabalhadas</th>
                <th className="p-3 bg-slate-50 print:bg-transparent">Saldo Diário</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] border-b-2 border-black font-medium">
              {todosOsDiasDoMes.map(({ dataIso, registroDoDia, abonoDoDia }, idx) => {
                const dataFormatada = dataIso.split('-').reverse().join('/');
                const diaSemana = getDiaSemana(dataIso);
                const isFeriado = feriadosGlobais.includes(dataIso);
                const is100 = diaSemana === 0 || diaSemana === 6 || isFeriado;

                const minutosTrabalhados = registroDoDia?.minutos_trabalhados || 0;
                const minutosAbonados = minutosAbonadosEfetivos(abonoDoDia, dataIso);
                const minutosTotaisDoDia = minutosTrabalhados + minutosAbonados;

                const e1 = registroDoDia?.entrada_1;
                const s1 = registroDoDia?.saida_1;
                const e2 = registroDoDia?.entrada_2;
                const s2 = registroDoDia?.saida_2;

                const erroBatida = (e1 && !s1) || (!e2 && s2) || (e2 && !s2);
                
                const cargaMins = is100 ? 0 : 480;
                const saldoDiarioCalculado = minutosTotaisDoDia - cargaMins;
                
                const diaSemTrabalho = minutosTotaisDoDia === 0 && !is100;

                return (
                  <tr key={idx} className={`hover:bg-[#F8FAFC] transition-colors ${erroBatida ? 'bg-red-50' : ''} ${diaSemTrabalho ? 'text-gray-400' : ''}`}>
                    <td className="p-3 text-left font-bold flex gap-2 items-center flex-wrap">
                      {dataFormatada} 
                      {is100 && minutosTotaisDoDia > 0 && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-black uppercase print:hidden">{isFeriado ? 'FERIADO' : '100% EXTRA'}</span>}
                      {abonoDoDia && !is100 && <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-black uppercase print:hidden">{abonoDoDia.dia_todo ? 'ABONO TOTAL' : 'ABONO PARCIAL'}</span>}
                      {abonoDoDia && is100 && <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-black uppercase print:hidden">ABONO (DIA NÃO ÚTIL)</span>}
                    </td>
                    <td className="p-3">{e1 || '--:--'}</td>
                    <td className="p-3">{s1 || '--:--'}</td>
                    <td className="p-3">{e2 || '--:--'}</td>
                    <td className="p-3">{s2 || '--:--'}</td>
                    <td className="p-3 font-bold bg-blue-50/50 print:bg-transparent text-[#336699] print:text-black">
                      {minutesToTimeStr(minutosTotaisDoDia)}
                    </td>
                    <td className={`p-3 font-black bg-slate-50/50 print:bg-transparent ${saldoDiarioCalculado >= 0 ? 'text-[#16A34A]' : 'text-red-500'} print:text-black`}>
                      {saldoDiarioCalculado !== 0 || minutosTotaisDoDia > 0 ? minutesToTimeStr(saldoDiarioCalculado) : '--:--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-8 print:mt-4 flex justify-end">
            <table className="w-full max-w-sm border-2 border-black text-sm">
              <tbody>
                <tr className="border-b border-gray-300">
                  <td className="p-3 font-bold bg-gray-100 w-2/3">Total de Horas Trabalhadas</td>
                  <td className="p-3 font-black text-right">{totais.trabalhadoStr}</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold bg-gray-100">Saldo Mensal Total</td>
                  <td className="p-3 font-black text-right">{totais.extraStr}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="assinatura-espelho mt-24 pt-8 border-t-2 border-black flex flex-col items-center justify-center w-2/3 mx-auto hidden print:flex">
            <strong className="text-base uppercase tracking-wider">{nome}</strong>
            <p className="text-xs mt-1 text-gray-600">Assinatura do Colaborador</p>
            <div className="mt-6 text-xs text-gray-500">São Paulo, ____ de ____________________ de 20____.</div>
          </div>
        </div>
      </main>
    );
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Controle de Ponto.</p>
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

      {/* Impressão: cada espelho em uma única página A4 */}
      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          .espelho-doc {
            page-break-after: always;
            break-inside: avoid;
          }
          .espelho-doc:last-child { page-break-after: auto; }
          /* Compacta a tabela de dias para caber o mês inteiro em uma página */
          .espelho-doc table td,
          .espelho-doc table th { padding: 1.5px 6px !important; font-size: 10px !important; line-height: 1.15 !important; }
          .espelho-doc h2 { font-size: 18px !important; }
          .espelho-doc .assinatura-espelho { margin-top: 32px !important; padding-top: 16px !important; }
        }
      `}</style>
      
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm print:hidden">
        <p className="text-[#0369A1] font-medium text-sm">
          ⏱️ <strong>Controle de Ponto e Horas Extras</strong>. Feriados e sábados parametrizados via banco de dados.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="px-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full print:hidden">
        <div className="inline-flex bg-[#F1F5F9] p-1 rounded-lg border border-[#E2E8F0]">
          <button onClick={() => setAbaPrincipal('gestao')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-md transition-all ${abaPrincipal === 'gestao' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
            📊 Gestão de Ponto
          </button>
          <button onClick={() => setAbaPrincipal('registro_diario')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-md transition-all ${abaPrincipal === 'registro_diario' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
            🕒 Registro de Ponto (Dia a Dia)
          </button>
          <button onClick={() => setAbaPrincipal('gestao_abonos')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-md transition-all ${abaPrincipal === 'gestao_abonos' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
            🗓️ Gestão de Abonos
          </button>
          <button onClick={() => setAbaPrincipal('inconsistencia_ponto')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-md transition-all ${abaPrincipal === 'inconsistencia_ponto' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
            ⚠️ Inconsistência no Ponto
          </button>
        </div>
      </div>

      <div className="p-4 md:px-8 pt-6 flex-grow flex flex-col max-w-[1400px] mx-auto w-full">

        {abaPrincipal === 'registro_diario' && <RegistroPontoConsulta />}

        {abaPrincipal === 'gestao' && (
        <>
        {viewMode === 'resumo' && (
          <div className="flex flex-col lg:flex-row gap-6">
            <aside className="w-full lg:w-80 flex-shrink-0 space-y-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider mb-2 border-b border-[#E2E8F0] pb-2">1. Selecionar Mês</h3>
                <input type="month" value={mesAnoSelecionado} onChange={(e) => setMesAnoSelecionado(e.target.value)} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold outline-none focus:border-[#336699] bg-[#F8FAFC]" />
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider mb-2 border-b border-[#E2E8F0] pb-2">2. Ponto via WhatsApp</h3>
                <p className="text-xs text-[#64748B] mb-4">Batidas confirmadas pelo funcionário direto no WhatsApp — ledger imutável, com numeração sequencial (NSR).</p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-emerald-100 text-emerald-700">{estatisticasWhatsapp?.funcionariosHabilitados ?? '…'} habilitados</span>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-700">{estatisticasWhatsapp?.batidasHoje ?? '…'} batidas hoje</span>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-gray-100 text-gray-600">{estatisticasWhatsapp?.batidasMes ?? '…'} no mês</span>
                </div>
                <div className="flex flex-col gap-2">
                  <button onClick={abrirLedgerWhatsapp} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-xs py-4 rounded-xl transition-colors flex items-center justify-center gap-2">
                    📲 VER LEDGER DO MÊS
                  </button>
                  <button onClick={abrirSolicitacoesPendentes} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black uppercase tracking-widest text-xs py-4 rounded-xl transition-colors flex items-center justify-center gap-2">
                    🔔 SOLICITAÇÕES PENDENTES
                    {!!estatisticasWhatsapp?.solicitacoesPendentes && (
                      <span className="bg-white/25 px-2 py-0.5 rounded-full text-[10px]">{estatisticasWhatsapp.solicitacoesPendentes}</span>
                    )}
                  </button>
                  <button onClick={abrirHistoricoSolicitacoes} className="w-full bg-white border-2 border-[#0C1D4D] text-[#0C1D4D] hover:bg-[#0C1D4D] hover:text-white font-black uppercase tracking-widest text-xs py-4 rounded-xl transition-colors flex items-center justify-center gap-2">
                    📜 HISTÓRICO DE SOLICITAÇÕES
                  </button>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider mb-2 border-b border-[#E2E8F0] pb-2">3. Holerites da Contabilidade</h3>
                <p className="text-xs text-[#64748B] mb-4">Importar e separar por funcionário os PDFs de adiantamento e pagamento, para anexar à assinatura.</p>
                <button onClick={() => setViewMode('separar_holerites')} className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-xs py-4 rounded-xl transition-colors flex items-center justify-center gap-2">
                  📄 SEPARAR HOLERITES
                  <span className="bg-white/25 px-2 py-0.5 rounded-full text-[10px]">{elegiveisContabilidade.length}</span>
                </button>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider mb-2 border-b border-[#E2E8F0] pb-2">4. Importar Dados</h3>
                <p className="text-xs text-[#64748B] mb-4">Carregue os CSVs para reescrever as batidas e abonos do mês.</p>
                <div className="flex flex-col space-y-2">
                  <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="w-full border-2 border-dashed border-[#336699] text-[#336699] font-black uppercase tracking-widest text-xs py-4 rounded-xl hover:bg-blue-50 transition-colors disabled:opacity-50">
                    {isProcessing ? '⏳ Processando...' : '📥 PONTO (BATIDAS)'}
                  </button>
                  <input type="file" accept=".csv" className="hidden" ref={abonoFileInputRef} onChange={handleAbonoUpload} />
                  <button onClick={() => abonoFileInputRef.current?.click()} disabled={isProcessing} className="w-full border-2 border-dashed border-green-600 text-green-600 font-black uppercase tracking-widest text-xs py-4 rounded-xl hover:bg-green-50 transition-colors disabled:opacity-50">
                    {isProcessing ? '⏳ Processando...' : '➕ ABONOS (AUSÊNCIAS)'}
                  </button>
                </div>
              </div>
            </aside>

            <main className="flex-grow bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col h-fit">
              <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                  <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Consolidado da Equipe</h2>
                  <p className="text-sm text-[#64748B]">Mês de Competência: {mesAnoSelecionado.split('-').reverse().join('/')}</p>
                </div>
                {resumoGeral.length > 0 && (
                  <button onClick={abrirTodosEspelhos} className="bg-[#16A34A] text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-[#15803D] transition-all shadow-md">
                    🖨️ IMPRIMIR TODOS (LOTE)
                  </button>
                )}
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-white border-b-2 border-[#E2E8F0]">
                    <tr className="text-[9px] xl:text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                      <th className="p-4">Colaborador</th>
                      <th className="p-4 text-center">Horas Mês</th>
                      <th className="p-4 text-center text-[#336699]">Extras (Seg-Sex)</th>
                      <th className="p-4 text-center text-amber-600">Extras 100% (Sáb)</th>
                      <th className="p-4 text-center text-red-600">Extras 100% (Dom/Fer)</th>
                      <th className="p-4 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {loading ? (
                      <tr><td colSpan={6} className="p-8 text-center text-[#94A3B8] font-bold">Carregando base de dados...</td></tr>
                    ) : resumoGeral.length === 0 ? (
                      <tr><td colSpan={6} className="p-8 text-center text-[#94A3B8] font-bold border-2 border-dashed border-gray-200 rounded-lg m-4 block w-auto">Nenhum registro encontrado para este mês.</td></tr>
                    ) : (
                      resumoGeral.map((item, idx) => (
                        <tr key={idx} className="hover:bg-[#F8FAFC] transition-colors">
                          <td className="p-4 font-black text-[#0C1D4D]">{item.nome}</td>
                          <td className="p-4 text-center font-bold">{minutesToTimeStr(item.totalMins)}</td>
                          <td className="p-4 text-center font-bold text-[#336699]">{minutesToTimeStr(item.extraSemMins)}</td>
                          <td className="p-4 text-center font-bold text-amber-600">{minutesToTimeStr(item.extraSabMins)}</td>
                          <td className="p-4 text-center font-bold text-red-600">{minutesToTimeStr(item.extraDomMins)}</td>
                          <td className="p-4 text-right">
                            <button onClick={() => abrirEspelhoUnico(item.nome)} className="bg-[#0C1D4D] text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-[#284B8C] transition-all shadow-sm">
                              📄 Detalhes
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </main>
          </div>
        )}

        {viewMode === 'espelho' && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center print:hidden">
              <button onClick={voltarResumo} className="text-[#64748B] font-bold text-sm hover:text-[#0C1D4D] transition-colors flex items-center gap-2">⬅ Voltar ao Resumo</button>
              <button onClick={() => window.print()} className="bg-[#336699] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-[#284B8C] transition-all">
                🖨️ IMPRIMIR DOCUMENTO
              </button>
            </div>
            <RenderEspelho nome={funcionarioSelecionado} registrosFunc={registros.filter(r => r.funcionario_nome === funcionarioSelecionado)} />
          </div>
        )}

        {viewMode === 'espelho_todos' && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center print:hidden mb-4 bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm">
              <button onClick={voltarResumo} className="text-[#64748B] font-bold text-sm hover:text-[#0C1D4D] transition-colors flex items-center gap-2">⬅ Voltar ao Resumo</button>
              <div className="flex items-center gap-4">
                <span className="text-sm font-bold text-[#336699]">Serão geradas {funcionariosUnicos.length} páginas.</span>
                <button onClick={() => window.print()} className="bg-[#16A34A] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-[#15803D] transition-all animate-pulse">
                  🖨️ INICIAR IMPRESSÃO EM LOTE
                </button>
              </div>
            </div>
            
            {funcionariosUnicos.map(nome => (
              <RenderEspelho key={nome} nome={nome} registrosFunc={registros.filter(r => r.funcionario_nome === nome)} />
            ))}
          </div>
        )}

        {viewMode === 'separar_holerites' && (
          <SepararHolerites
            mesReferencia={mesAnoSelecionado}
            usuarioAtual={usuarioAtual}
            elegiveis={elegiveisContabilidade}
            onFechar={voltarResumo}
          />
        )}

        {viewMode === 'ponto_whatsapp' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3 bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm">
              <button onClick={voltarResumo} className="text-[#64748B] font-bold text-sm hover:text-[#0C1D4D] transition-colors flex items-center gap-2">⬅ Voltar ao Resumo</button>
              <div className="flex items-center gap-2">
                {abaWhatsapp === 'ledger' && (
                  <input
                    type="month"
                    value={mesAnoWhatsapp}
                    onChange={(e) => { setMesAnoWhatsapp(e.target.value); carregarLedgerWhatsapp(e.target.value); }}
                    className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC]"
                  />
                )}
                <div className="flex bg-[#F1F5F9] p-1 rounded-lg border border-[#E2E8F0]">
                  <button onClick={() => setAbaWhatsapp('ledger')} className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-md transition-all ${abaWhatsapp === 'ledger' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>📲 Ledger</button>
                  <button onClick={() => setAbaWhatsapp('solicitacoes')} className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-md transition-all ${abaWhatsapp === 'solicitacoes' ? 'bg-amber-500 text-white shadow-sm' : 'text-[#64748B] hover:text-amber-600'}`}>
                    🔔 Solicitações
                    {solicitacoesPendentes.length > 0 && <span className="ml-1.5 bg-white/25 px-1.5 py-0.5 rounded-full text-[9px]">{solicitacoesPendentes.length}</span>}
                  </button>
                  <button onClick={() => setAbaWhatsapp('historico')} className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-md transition-all ${abaWhatsapp === 'historico' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>📜 Histórico</button>
                </div>
              </div>
            </div>

            {abaWhatsapp === 'ledger' && (
              <main className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col">
                <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Ledger de Ponto via WhatsApp</h2>
                  <p className="text-sm text-[#64748B]">Registro append-only (imutável) das batidas confirmadas pelo funcionário. NSR e hash calculados no banco no momento da gravação.</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-white border-b-2 border-[#E2E8F0]">
                      <tr className="text-[9px] xl:text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                        <th className="p-4">NSR</th>
                        <th className="p-4">Colaborador</th>
                        <th className="p-4">Data</th>
                        <th className="p-4">Tipo de Batida</th>
                        <th className="p-4">Horário</th>
                        <th className="p-4">Hash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {carregandoLedger ? (
                        <tr><td colSpan={6} className="p-8 text-center text-[#94A3B8] font-bold">Carregando ledger...</td></tr>
                      ) : ledgerWhatsapp.length === 0 ? (
                        <tr><td colSpan={6} className="p-8 text-center text-[#94A3B8] font-bold">Nenhuma batida via WhatsApp neste mês.</td></tr>
                      ) : (
                        ledgerWhatsapp.map((r) => (
                          <tr key={r.nsr} className="hover:bg-[#F8FAFC] transition-colors">
                            <td className="p-4 font-mono font-bold text-[#0C1D4D]">{r.nsr}</td>
                            <td className="p-4 font-black text-[#0C1D4D]">{r.funcionario_nome}</td>
                            <td className="p-4">{r.data_referencia.split('-').reverse().join('/')}</td>
                            <td className="p-4">{r.tipo_batida.replace('_', ' ')}</td>
                            <td className="p-4 font-bold">{new Date(r.data_hora_batida).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}</td>
                            <td className="p-4 font-mono text-[10px] text-gray-400">{r.hash_registro.slice(0, 16)}…</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </main>
            )}

            {abaWhatsapp === 'solicitacoes' && (
              <main className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col">
                <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Solicitações Pendentes</h2>
                  <p className="text-sm text-[#64748B]">Justificativas de batida esquecida e abonos de dia todo pedidos pelo funcionário via WhatsApp. Aprovar grava o ajuste/abono; nada disso é automático.</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-white border-b-2 border-[#E2E8F0]">
                      <tr className="text-[9px] xl:text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                        <th className="p-4">Colaborador</th>
                        <th className="p-4">Tipo</th>
                        <th className="p-4">Data</th>
                        <th className="p-4">Detalhe</th>
                        <th className="p-4">Motivo</th>
                        <th className="p-4">Anexo</th>
                        <th className="p-4 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {carregandoSolicitacoes ? (
                        <tr><td colSpan={7} className="p-8 text-center text-[#94A3B8] font-bold">Carregando solicitações...</td></tr>
                      ) : solicitacoesPendentes.length === 0 ? (
                        <tr><td colSpan={7} className="p-8 text-center text-[#94A3B8] font-bold">Nenhuma solicitação pendente.</td></tr>
                      ) : (
                        solicitacoesPendentes.map((s) => (
                          <tr key={s.id} className="hover:bg-[#F8FAFC] transition-colors">
                            <td className="p-4 font-black text-[#0C1D4D]">{s.funcionario_nome}</td>
                            <td className="p-4">
                              {s.tipo === 'JUSTIFICATIVA_BATIDA'
                                ? <span className="text-[9px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-black uppercase">Justificativa</span>
                                : <span className="text-[9px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-black uppercase">Abono (dia todo)</span>}
                            </td>
                            <td className="p-4 font-bold">{s.data_referencia.split('-').reverse().join('/')}</td>
                            <td className="p-4 text-xs">{s.tipo === 'JUSTIFICATIVA_BATIDA' ? `${(s.tipo_batida || '').replace('_', ' ')} às ${s.horario_solicitado}` : '—'}</td>
                            <td className="p-4 text-xs text-gray-600">{s.motivo}</td>
                            <td className="p-4 text-xs">
                              {s.anexo_nome
                                ? <button onClick={() => verAnexoSolicitacao(s.id)} className="text-[#336699] hover:underline font-bold">📎 Ver anexo</button>
                                : '—'}
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex gap-2 justify-end">
                                <button disabled={processandoSolicitacaoId === s.id} onClick={() => aprovarSolicitacao(s.id)} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors">✓ Aprovar</button>
                                <button disabled={processandoSolicitacaoId === s.id} onClick={() => rejeitarSolicitacao(s.id)} className="bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors">✕ Rejeitar</button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </main>
            )}

            {abaWhatsapp === 'historico' && (
              <main className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col">
                <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Histórico de Solicitações</h2>
                  <p className="text-sm text-[#64748B]">Todas as justificativas e abonos pedidos via WhatsApp, aprovados ou não — nada é apagado, só muda de status.</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-white border-b-2 border-[#E2E8F0]">
                      <tr className="text-[9px] xl:text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                        <th className="p-4">Colaborador</th>
                        <th className="p-4">Tipo</th>
                        <th className="p-4">Data</th>
                        <th className="p-4">Motivo</th>
                        <th className="p-4">Anexo</th>
                        <th className="p-4">Status</th>
                        <th className="p-4">Analisado por</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {carregandoHistorico ? (
                        <tr><td colSpan={7} className="p-8 text-center text-[#94A3B8] font-bold">Carregando histórico...</td></tr>
                      ) : historicoSolicitacoes.length === 0 ? (
                        <tr><td colSpan={7} className="p-8 text-center text-[#94A3B8] font-bold">Nenhuma solicitação registrada ainda.</td></tr>
                      ) : (
                        historicoSolicitacoes.map((s) => (
                          <tr key={s.id} className="hover:bg-[#F8FAFC] transition-colors">
                            <td className="p-4 font-black text-[#0C1D4D]">{s.funcionario_nome}</td>
                            <td className="p-4">
                              {s.tipo === 'JUSTIFICATIVA_BATIDA'
                                ? <span className="text-[9px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-black uppercase">Justificativa</span>
                                : <span className="text-[9px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-black uppercase">Abono</span>}
                            </td>
                            <td className="p-4 font-bold">{s.data_referencia.split('-').reverse().join('/')}</td>
                            <td className="p-4 text-xs text-gray-600">{s.motivo}</td>
                            <td className="p-4 text-xs">
                              {s.anexo_nome
                                ? <button onClick={() => verAnexoSolicitacao(s.id)} className="text-[#336699] hover:underline font-bold">📎 Ver</button>
                                : '—'}
                            </td>
                            <td className="p-4">
                              {s.status === 'PENDENTE' && <span className="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-black uppercase">Pendente</span>}
                              {s.status === 'APROVADA' && <span className="text-[9px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-black uppercase">Aprovada</span>}
                              {s.status === 'REJEITADA' && (
                                <span className="text-[9px] bg-red-100 text-red-600 px-2 py-0.5 rounded font-black uppercase" title={s.motivo_rejeicao || ''}>Rejeitada</span>
                              )}
                            </td>
                            <td className="p-4 text-xs text-gray-500">{s.resolvido_por || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </main>
            )}
          </div>
        )}
        </>
        )}

        {abaPrincipal === 'gestao_abonos' && (
          <div className="flex flex-col gap-4">
            <main className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                  <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">
                    {abonosConsolidado ? 'Abonos — Consolidado por Equipe' : 'Abonos — Lançamentos do Mês'}
                  </h2>
                  <p className="text-sm text-[#64748B]">Competência: {mesAnoSelecionado.split('-').reverse().join('/')} • {abonos.length} lançamento(s) • Total abonado: {minutesToTimeStr(totalAbonosMin)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <input type="month" value={mesAnoSelecionado} onChange={(e) => setMesAnoSelecionado(e.target.value)} className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC]" />
                  <div className="flex bg-[#F1F5F9] p-1 rounded-lg border border-[#E2E8F0]">
                    <button onClick={() => setAbonosConsolidado(false)} className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-md transition-all ${!abonosConsolidado ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>📋 Lançamentos</button>
                    <button onClick={() => setAbonosConsolidado(true)} className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-md transition-all ${abonosConsolidado ? 'bg-[#16A34A] text-white shadow-sm' : 'text-[#64748B] hover:text-[#16A34A]'}`}>👥 Consolidado por Equipe</button>
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="p-12 text-center text-[#94A3B8] font-bold">Carregando abonos...</div>
              ) : abonos.length === 0 ? (
                <div className="p-12 text-center text-[#94A3B8] font-bold">
                  Nenhum abono lançado para este mês. Importe o CSV de abonos na aba Gestão de Ponto.
                </div>
              ) : !abonosConsolidado ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-white border-b-2 border-[#E2E8F0]">
                      <tr className="text-[9px] xl:text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                        <th className="p-4">Colaborador</th>
                        <th className="p-4">Data</th>
                        <th className="p-4 text-center">Tipo</th>
                        <th className="p-4 text-center">Período</th>
                        <th className="p-4 text-center">Tempo Abonado</th>
                        <th className="p-4">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {abonosOrdenados.map((a, idx) => {
                        const diaNaoUtil = isDiaNaoUtil(a.data_abono, feriadosGlobais);
                        return (
                          <tr key={a.id || idx} className="hover:bg-[#F8FAFC] transition-colors">
                            <td className="p-4 font-black text-[#0C1D4D]">{a.funcionario_nome}</td>
                            <td className="p-4 font-bold">{a.data_abono.split('-').reverse().join('/')}</td>
                            <td className="p-4 text-center">
                              {a.dia_todo
                                ? <span className="text-[9px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-black uppercase">Dia Todo</span>
                                : <span className="text-[9px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-black uppercase">Parcial</span>}
                            </td>
                            <td className="p-4 text-center text-xs font-medium text-gray-600">
                              {a.dia_todo ? '—' : `${a.hora_inicio || '--:--'} às ${a.hora_fim || '--:--'}`}
                            </td>
                            <td className="p-4 text-center font-bold">
                              {diaNaoUtil
                                ? <span className="text-gray-400" title="Dia não útil: abono não gera crédito de horas">{minutesToTimeStr(a.minutos_abonados)} *</span>
                                : minutesToTimeStr(a.minutos_abonados)}
                            </td>
                            <td className="p-4 text-xs font-medium text-gray-600">{a.motivo || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="p-4 text-[10px] text-gray-400 font-medium">* Abono em dia não útil (sábado, domingo ou feriado): registrado, mas não gera crédito de horas no cálculo.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-white border-b-2 border-[#E2E8F0]">
                      <tr className="text-[9px] xl:text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                        <th className="p-4">Colaborador</th>
                        <th className="p-4 text-center">Total de Abonos</th>
                        <th className="p-4 text-center text-green-700">Dias Inteiros</th>
                        <th className="p-4 text-center text-blue-700">Parciais</th>
                        <th className="p-4 text-center">Tempo Total Abonado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {abonosPorFuncionario.map((item, idx) => (
                        <tr key={idx} className="hover:bg-[#F8FAFC] transition-colors">
                          <td className="p-4 font-black text-[#0C1D4D]">{item.nome}</td>
                          <td className="p-4 text-center font-bold">{item.qtd}</td>
                          <td className="p-4 text-center font-bold text-green-700">{item.qtdDiaTodo}</td>
                          <td className="p-4 text-center font-bold text-blue-700">{item.qtdParcial}</td>
                          <td className="p-4 text-center font-black">{minutesToTimeStr(item.totalMins)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[#0C1D4D] bg-[#F8FAFC] font-black text-[#0C1D4D]">
                        <td className="p-4 uppercase text-xs tracking-wider">Total da Equipe</td>
                        <td className="p-4 text-center">{abonos.length}</td>
                        <td className="p-4 text-center text-green-700">{abonosPorFuncionario.reduce((s, i) => s + i.qtdDiaTodo, 0)}</td>
                        <td className="p-4 text-center text-blue-700">{abonosPorFuncionario.reduce((s, i) => s + i.qtdParcial, 0)}</td>
                        <td className="p-4 text-center">{minutesToTimeStr(totalAbonosMin)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </main>
          </div>
        )}

        {abaPrincipal === 'inconsistencia_ponto' && (
          <div className="flex flex-col lg:flex-row gap-6">
            <aside className="w-full lg:w-80 flex-shrink-0 space-y-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider mb-2 border-b border-[#E2E8F0] pb-2">Lançar Ponto Manual</h3>
                <p className="text-xs text-[#64748B] mb-4">O RH pode lançar a batida de um dia direto por aqui, sem depender do CSV ou do WhatsApp.</p>
                <div className="flex flex-col gap-2">
                  <select value={manualFuncionario} onChange={e => setManualFuncionario(e.target.value)} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]">
                    <option value="">Selecione o funcionário...</option>
                    {listaFuncionariosAtivos.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <input type="date" value={manualData} onChange={e => setManualData(e.target.value)} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]" />

                  {verificandoExistente && (
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">🔎 Verificando batidas já lançadas...</p>
                  )}
                  {!verificandoExistente && registroExistente === null && manualFuncionario && manualData && (
                    <p className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 uppercase">✅ Nenhum ponto lançado neste dia ainda.</p>
                  )}
                  {!verificandoExistente && registroExistente && registroExistente.origem === 'WHATSAPP' && (
                    <p className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 uppercase">⚠ Batida confirmada via WhatsApp (ledger legal, nunca é apagado). Editar aqui corrige só a versão usada no cálculo da folha — ex: remover uma batida a mais feita sem querer.</p>
                  )}
                  {!verificandoExistente && registroExistente && registroExistente.origem !== 'WHATSAPP' && (
                    <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 uppercase">⚠ Já existe ponto lançado nesse dia (origem: {registroExistente.origem}). Campos pré-preenchidos abaixo — editar e salvar SUBSTITUI a batida atual.</p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] font-black text-gray-500 uppercase mb-1">Entrada</label>
                      <input type="time" value={manualE1} onChange={e => setManualE1(e.target.value)} className="w-full p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-gray-500 uppercase mb-1">Saída{(manualE2 || manualS2) ? ' (Almoço)' : ''}</label>
                      <input type="time" value={manualS1} onChange={e => setManualS1(e.target.value)} className="w-full p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-gray-500 uppercase mb-1">Retorno Almoço</label>
                      <input type="time" value={manualE2} onChange={e => setManualE2(e.target.value)} className="w-full p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-gray-500 uppercase mb-1">Saída</label>
                      <input type="time" value={manualS2} onChange={e => setManualS2(e.target.value)} className="w-full p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold" />
                    </div>
                  </div>
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Deixe Retorno/Saída em branco para lançar só Entrada + Saída.</p>
                  <button onClick={handleLancarPontoManual} disabled={lancandoManual} className="w-full bg-[#336699] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-xs py-4 rounded-xl transition-colors disabled:opacity-50">
                    {lancandoManual ? '⏳ Lançando...' : registroExistente ? '💾 SUBSTITUIR PONTO' : '💾 LANÇAR PONTO'}
                  </button>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider mb-2 border-b border-[#E2E8F0] pb-2">Abonar Dia</h3>
                <p className="text-xs text-[#64748B] mb-4">O RH pode abonar um dia inteiro de um funcionário direto por aqui.</p>
                <div className="flex flex-col gap-2">
                  <select value={abonoFuncionario} onChange={e => setAbonoFuncionario(e.target.value)} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]">
                    <option value="">Selecione o funcionário...</option>
                    {listaFuncionariosAtivos.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <input type="date" value={abonoData} onChange={e => setAbonoData(e.target.value)} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]" />

                  {verificandoAbonoExistente && (
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">🔎 Verificando abonos já lançados...</p>
                  )}
                  {!verificandoAbonoExistente && abonoExistente === null && abonoFuncionario && abonoData && (
                    <p className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 uppercase">✅ Nenhum abono lançado neste dia ainda.</p>
                  )}
                  {!verificandoAbonoExistente && abonoExistente && abonoExistente.origem === 'WHATSAPP' && (
                    <p className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 uppercase">⚠ Abono confirmado via WhatsApp. Editar aqui substitui o abono gravado.</p>
                  )}
                  {!verificandoAbonoExistente && abonoExistente && abonoExistente.origem !== 'WHATSAPP' && (
                    <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 uppercase">⚠ Já existe abono nesse dia (origem: {abonoExistente.origem}). Motivo pré-preenchido abaixo — editar e salvar SUBSTITUI o abono atual.</p>
                  )}

                  <div>
                    <label className="block text-[9px] font-black text-gray-500 uppercase mb-1">Motivo</label>
                    <textarea value={abonoMotivo} onChange={e => setAbonoMotivo(e.target.value)} rows={3} placeholder="Ex.: Atestado médico, folga combinada..." className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold resize-none" />
                  </div>
                  <button onClick={handleAbonarDia} disabled={abonando} className="w-full bg-[#336699] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-xs py-4 rounded-xl transition-colors disabled:opacity-50">
                    {abonando ? '⏳ Abonando...' : abonoExistente ? '💾 SUBSTITUIR ABONO' : '💾 ABONAR DIA'}
                  </button>
                </div>
              </div>
            </aside>

            <main className="flex-grow flex flex-col gap-4">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row sm:items-end gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Mês de Competência</label>
                  <input type="month" value={mesAnoSelecionado} onChange={(e) => setMesAnoSelecionado(e.target.value)} className="p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]" />
                </div>
                <button onClick={verificarInconsistenciasPonto} disabled={loading} className="bg-amber-600 hover:bg-amber-700 text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl transition-colors disabled:opacity-50">
                  {loading ? '⏳ Carregando ponto do mês...' : '⚠️ VERIFICAR INCONSISTÊNCIA'}
                </button>
                {(inconsistencias !== null || faltasEncontradas !== null) && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Filtrar por funcionário</label>
                    <select value={filtroFuncionarioPendencia} onChange={e => setFiltroFuncionarioPendencia(e.target.value)} className="p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]">
                      <option value="">Todos ({nomesComPendencia.length})</option>
                      {nomesComPendencia.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {inconsistencias !== null && (
                <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col">
                  <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC]">
                    <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Pontos Ímpar (Batidas Incompletas)</h2>
                    <p className="text-sm text-[#64748B]">Competência: {mesAnoSelecionado.split('-').reverse().join('/')} • {inconsistenciasFiltradas.length} de {inconsistencias.length} dia(s) com inconsistência • clique numa linha pra preencher os quadros ao lado</p>
                  </div>

                  {inconsistenciasFiltradas.length === 0 ? (
                    <div className="p-12 text-center text-[#94A3B8] font-bold">{inconsistencias.length === 0 ? 'Nenhuma inconsistência encontrada — todas as batidas do mês estão completas.' : 'Nenhuma inconsistência para este funcionário.'}</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-white border-b-2 border-[#E2E8F0]">
                          <tr className="text-[9px] xl:text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                            <th className="p-4">Colaborador</th>
                            <th className="p-4">Data</th>
                            <th className="p-4 text-center">Entrada</th>
                            <th className="p-4 text-center">Saída Almoço</th>
                            <th className="p-4 text-center">Retorno Almoço</th>
                            <th className="p-4 text-center">Saída</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0]">
                          {inconsistenciasFiltradas.map((r, idx) => {
                            const selecionada = manualFuncionario === r.funcionario_nome && manualData === r.data_registro;
                            return (
                              <tr
                                key={r.id || idx}
                                onClick={() => selecionarPendencia(r.funcionario_nome, r.data_registro)}
                                className={`cursor-pointer transition-colors ${selecionada ? 'bg-blue-50' : 'hover:bg-[#F8FAFC]'}`}
                                title="Clique para preencher Lançar Ponto Manual / Abonar Dia"
                              >
                                <td className="p-4 font-black text-[#0C1D4D]">{r.funcionario_nome}</td>
                                <td className="p-4 font-bold">{r.data_registro.split('-').reverse().join('/')}</td>
                                <td className={`p-4 text-center font-bold ${!r.entrada_1 ? 'text-red-500' : ''}`}>{r.entrada_1 || '—'}</td>
                                <td className={`p-4 text-center font-bold ${!r.saida_1 ? 'text-red-500' : ''}`}>{r.saida_1 || '—'}</td>
                                <td className={`p-4 text-center font-bold ${!r.entrada_2 ? 'text-red-500' : ''}`}>{r.entrada_2 || '—'}</td>
                                <td className={`p-4 text-center font-bold ${!r.saida_2 ? 'text-red-500' : ''}`}>{r.saida_2 || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {faltasEncontradas !== null && (
                <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col">
                  <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC]">
                    <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Faltas (Dias sem Registro)</h2>
                    <p className="text-sm text-[#64748B]">Competência: {mesAnoSelecionado.split('-').reverse().join('/')} • {faltasFiltradas.length} de {faltasEncontradas.length} falta(s) • clique numa linha pra preencher os quadros ao lado</p>
                  </div>

                  {faltasFiltradas.length === 0 ? (
                    <div className="p-12 text-center text-[#94A3B8] font-bold">{faltasEncontradas.length === 0 ? 'Nenhuma falta encontrada no mês.' : 'Nenhuma falta para este funcionário.'}</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-white border-b-2 border-[#E2E8F0]">
                          <tr className="text-[9px] xl:text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                            <th className="p-4">Colaborador</th>
                            <th className="p-4">Data</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0]">
                          {faltasFiltradas.map((f, idx) => {
                            const selecionada = abonoFuncionario === f.funcionario_nome && abonoData === f.data;
                            return (
                              <tr
                                key={idx}
                                onClick={() => selecionarPendencia(f.funcionario_nome, f.data)}
                                className={`cursor-pointer transition-colors ${selecionada ? 'bg-blue-50' : 'hover:bg-[#F8FAFC]'}`}
                                title="Clique para preencher Lançar Ponto Manual / Abonar Dia"
                              >
                                <td className="p-4 font-black text-[#0C1D4D]">{f.funcionario_nome}</td>
                                <td className="p-4 font-bold text-red-500">{f.data.split('-').reverse().join('/')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </main>
          </div>
        )}

      </div>
    </div>
  );
}