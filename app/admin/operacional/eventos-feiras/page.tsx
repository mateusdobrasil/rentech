"use client";

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { sincronizarEventosFeirasP2sAction } from './actions';
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
  if (p.includes('GESTOR')) return 'GESTORES';
  return 'USUARIO';
};

// ============================================================================
// TIPOS
// ============================================================================
interface EventoFeira {
  data_inicial: string | null;
  data_final: string | null;
  nome: string;
  tipo_evento: string | null;
  local: string | null;
  status: string | null;
  colaborador_responsavel: string | null;
  promotor: string | null;
  montadora: string | null;
  observacoes: string | null;
}

type CampoEvento = keyof EventoFeira;
type TipoCampo = 'texto' | 'data';

interface LinhaProcessada {
  linha: number;
  dados: EventoFeira;
  erros: string[];
}

// Mapeia o cabeçalho (normalizado, sem acento e em minúsculas) da planilha "Eventos/Feiras"
// para os campos da tabela eventos_feiras. O cabeçalho de "Local" traz um resÃ­duo de macro do
// Excel ("(F2=Ins., F3=Abre)") que faz parte do texto real da coluna — mapeado como está.
const MAPA_COLUNAS: Record<string, CampoEvento> = {
  'data inicial': 'data_inicial',
  'data final': 'data_final',
  'nome': 'nome',
  'tipo de evento': 'tipo_evento',
  'local padrao do evento (se houver): (f2=ins., f3=abre)': 'local',
  'status': 'status',
  'colaborador responsavel': 'colaborador_responsavel',
  'promotor': 'promotor',
  'montadora': 'montadora',
  'observacoes': 'observacoes',
};

const TIPO_CAMPO: Record<CampoEvento, TipoCampo> = {
  data_inicial: 'data', data_final: 'data', nome: 'texto', tipo_evento: 'texto',
  local: 'texto', status: 'texto', colaborador_responsavel: 'texto', promotor: 'texto',
  montadora: 'texto', observacoes: 'texto',
};

// ============================================================================
// PARSER DE CSV (separador ";", com suporte a campos entre aspas e quebras de linha internas)
// ============================================================================
function parseCSV(texto: string): string[][] {
  const semBom = texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto;
  const linhas: string[][] = [];
  let linhaAtual: string[] = [];
  let campo = '';
  let entreAspas = false;

  for (let i = 0; i < semBom.length; i++) {
    const c = semBom[i];
    if (entreAspas) {
      if (c === '"') {
        if (semBom[i + 1] === '"') { campo += '"'; i++; } else { entreAspas = false; }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === ';') {
      linhaAtual.push(campo); campo = '';
    } else if (c === '\r') {
      // ignora, a quebra real vem no \n
    } else if (c === '\n') {
      linhaAtual.push(campo); linhas.push(linhaAtual); linhaAtual = []; campo = '';
    } else {
      campo += c;
    }
  }
  if (campo.length > 0 || linhaAtual.length > 0) { linhaAtual.push(campo); linhas.push(linhaAtual); }
  return linhas;
}

// Converte o valor bruto de uma célula (número, data ou texto) para o mesmo formato de texto
// que o CSV exportado traria: datas como "DD/MM/AAAA". Não dá pra confiar no texto formatado
// pela própria célula (o SheetJS às vezes devolve datas em formato americano), então convertemos
// a partir do valor cru.
function celulaParaTexto(celula: unknown): string {
  if (celula instanceof Date) {
    // O SheetJS entrega datas de célula (cellDates: true) como um Date "ancorado em UTC" —
    // usar getDate()/getMonth() locais aqui causaria erro de 1 dia em fusos negativos (ex: -03:00).
    const dd = String(celula.getUTCDate()).padStart(2, '0');
    const mm = String(celula.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${celula.getUTCFullYear()}`;
  }
  if (typeof celula === 'number') {
    return celula.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return (celula ?? '').toString();
}

// Lê a primeira aba de um arquivo .xls/.xlsx e devolve no mesmo formato do parseCSV
// (array de linhas de texto), reaproveitando toda a lógica de mapeamento de colunas abaixo.
function planilhaParaLinhas(buffer: ArrayBuffer): string[][] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const primeiraAba = workbook.Sheets[workbook.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(primeiraAba, { header: 1, raw: true, defval: '' });
  return linhas.map(linha => linha.map(celulaParaTexto));
}

const normalizarCabecalho = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

const limpo = (v?: string): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

// Planilha de eventos tem datas corrompidas por um bug de exportação do Excel
// (viram uma sequência de "#############"). Em vez de barrar a linha, gravamos null
// e mantemos nome/local, que continuam úteis para o cadastro do evento.
const paraDataISOTolerante = (v?: string): string | null => {
  const t = (v ?? '').trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
};

// Localiza a linha de cabeçalho (pula o título e linhas em branco do arquivo exportado)
// e devolve o índice de cada coluna reconhecida mapeada para o campo da tabela.
function localizarCabecalho(linhas: string[][]): { indiceLinha: number; colunas: Map<number, CampoEvento> } | null {
  for (let i = 0; i < Math.min(linhas.length, 20); i++) {
    const normalizadas = linhas[i].map(normalizarCabecalho);
    if (normalizadas.includes('nome') && normalizadas.includes('data inicial')) {
      const colunas = new Map<number, CampoEvento>();
      normalizadas.forEach((cabecalho, idx) => {
        const campo = MAPA_COLUNAS[cabecalho];
        if (campo) colunas.set(idx, campo);
      });
      return { indiceLinha: i, colunas };
    }
  }
  return null;
}

function processarLinhas(linhas: string[][]): { processadas: LinhaProcessada[]; erroGeral?: string } {
  const cabecalho = localizarCabecalho(linhas);
  if (!cabecalho) {
    return { processadas: [], erroGeral: 'Não foi possível localizar o cabeçalho (colunas "Nome" e "Data Inicial") no arquivo.' };
  }

  const processadas: LinhaProcessada[] = [];
  for (let i = cabecalho.indiceLinha + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    const vazia = linha.every(c => (c ?? '').trim() === '');
    if (vazia) continue;

    const erros: string[] = [];
    const dados: Partial<EventoFeira> = {};

    const dadosGravaveis = dados as Record<CampoEvento, string | null>;
    cabecalho.colunas.forEach((campo, idx) => {
      const bruto = linha[idx] ?? '';
      const tipo = TIPO_CAMPO[campo];
      dadosGravaveis[campo] = tipo === 'texto' ? limpo(bruto) : paraDataISOTolerante(bruto);
    });

    if (!dados.nome) erros.push('Nome é obrigatório');

    processadas.push({ linha: i + 1, dados: dados as EventoFeira, erros });
  }

  return { processadas };
}

// Colunas exibidas no grid de consulta
interface EventoGrid {
  id: string;
  data_inicial: string | null;
  data_final: string | null;
  nome: string;
  local: string | null;
  status: string | null;
  colaborador_responsavel: string | null;
}

const STATUS_DISPONIVEIS = ['Futuro', 'Em Execução', 'Finalizado'];

const TAMANHO_PAGINA = 50;

const formatarDataBR = (iso: string | null): string => {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
};

// ============================================================================
// COMPONENTE
// ============================================================================
export default function ImportadorEventosFeiras() {
  const router = useRouter();
  const pathname = usePathname();

  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [usuarioAtual, setUsuarioAtual] = useState('');

  const [nomeArquivo, setNomeArquivo] = useState('');
  const [linhasProcessadas, setLinhasProcessadas] = useState<LinhaProcessada[]>([]);
  const [erroArquivo, setErroArquivo] = useState('');
  const [importando, setImportando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; tipo: 'success' | 'error' }>({ show: false, msg: '', tipo: 'success' });

  const [eventosGrid, setEventosGrid] = useState<EventoGrid[]>([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridErro, setGridErro] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [pagina, setPagina] = useState(0);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [refreshGrid, setRefreshGrid] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios').select('*').eq('id', session.user.id).single();

      if (perfilError || !perfil) { router.push('/login'); return; }

      const { data: rotaPermissao } = await supabase
        .from('folha_paginas_permissoes').select('permissoes_permitidas').eq('endereco_route', pathname).single();

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true); setAuthLoading(false); return;
      }

      setUsuarioAtual(perfil.nome || 'Usuário');
      setAuthLoading(false);
    })();
  }, [router, pathname]);

  useEffect(() => {
    if (authLoading || acessoNegado) return;

    const handle = setTimeout(async () => {
      setGridLoading(true);
      setGridErro('');

      let query = supabase
        .from('eventos_feiras')
        .select('id, data_inicial, data_final, nome, local, status, colaborador_responsavel', { count: 'exact' })
        .order('data_inicial', { ascending: false, nullsFirst: false })
        .range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);

      if (filtroStatus) query = query.eq('status', filtroStatus);
      if (filtroTexto.trim()) {
        const termo = `%${filtroTexto.trim()}%`;
        query = query.or(`nome.ilike.${termo},local.ilike.${termo}`);
      }

      const { data, error, count } = await query;
      if (error) {
        setGridErro(error.message);
        setEventosGrid([]);
      } else {
        setEventosGrid(data || []);
        setTotalRegistros(count || 0);
      }
      setGridLoading(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [authLoading, acessoNegado, pagina, filtroStatus, filtroTexto, refreshGrid]);

  const handleArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;

    setErroArquivo('');
    setLinhasProcessadas([]);
    setFeedback({ show: false, msg: '', tipo: 'success' });
    setNomeArquivo(arquivo.name);

    const nomeMin = arquivo.name.toLowerCase();
    const ehPlanilhaExcel = nomeMin.endsWith('.xls') || nomeMin.endsWith('.xlsx');

    const reader = new FileReader();
    reader.onload = () => {
      const linhas = ehPlanilhaExcel
        ? planilhaParaLinhas(reader.result as ArrayBuffer)
        : parseCSV(reader.result as string);
      const { processadas, erroGeral } = processarLinhas(linhas);
      if (erroGeral) { setErroArquivo(erroGeral); return; }
      setLinhasProcessadas(processadas);
    };
    reader.onerror = () => setErroArquivo('Não foi possível ler o arquivo.');
    if (ehPlanilhaExcel) {
      reader.readAsArrayBuffer(arquivo);
    } else {
      reader.readAsText(arquivo, 'utf-8');
    }
  };

  const validas = linhasProcessadas.filter(l => l.erros.length === 0);
  const invalidas = linhasProcessadas.filter(l => l.erros.length > 0);

  const importar = async () => {
    if (validas.length === 0) return;
    setImportando(true);
    setFeedback({ show: false, msg: '', tipo: 'success' });

    // upsert por (nome, data_inicial) — permite reimportar a mesma planilha sem duplicar.
    // A planilha traz linhas com nome+data_inicial repetidos (digitação duplicada, "CANCELADO" etc);
    // o Postgres rejeita um upsert que tente atualizar a mesma linha duas vezes no mesmo lote, então
    // deduplicamos aqui antes de enviar (mantendo a última ocorrência de cada par).
    const registrosBrutos = validas.map(l => ({ ...l.dados, updated_at: new Date().toISOString() }));
    const dedupPorChave = new Map<string, (typeof registrosBrutos)[number]>();
    registrosBrutos.forEach((r, idx) => {
      const chave = r.data_inicial ? `${r.nome}||${r.data_inicial}` : `__sem_data__${idx}`;
      dedupPorChave.set(chave, r);
    });
    const registros = Array.from(dedupPorChave.values());
    const TAMANHO_LOTE = 500;
    let processados = 0;
    let erroLote = '';

    for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
      const lote = registros.slice(i, i + TAMANHO_LOTE);
      const { error } = await supabase.from('eventos_feiras').upsert(lote, { onConflict: 'nome,data_inicial' });
      if (error) { erroLote = error.message; break; }
      processados += lote.length;
    }

    if (erroLote) {
      setFeedback({ show: true, tipo: 'error', msg: `Importação interrompida após ${processados} registro(s): ${erroLote}` });
    } else {
      await registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'IMPORTOU/ATUALIZOU EVENTOS/FEIRAS VIA CSV',
        setor: 'OPERACIONAL',
        equipamento_nome: `${processados} registro(s) — ${nomeArquivo}`,
      });
      const duplicatasRemovidas = registrosBrutos.length - registros.length;
      const sufixoDuplicatas = duplicatasRemovidas > 0 ? ` (${duplicatasRemovidas} duplicata(s) de nome+data ignorada(s))` : '';
      setFeedback({ show: true, tipo: 'success', msg: `${processados} evento(s) processado(s) (inserido(s) ou atualizado(s)) com sucesso.${sufixoDuplicatas}` });
      setLinhasProcessadas([]);
      setNomeArquivo('');
      setPagina(0);
      setRefreshGrid(v => v + 1);
    }
    setImportando(false);
  };

  const sincronizarViaApi = async () => {
    setSincronizando(true);
    setFeedback({ show: false, msg: '', tipo: 'success' });
    try {
      const res = await sincronizarEventosFeirasP2sAction();
      if (!res.ok) {
        setFeedback({ show: true, tipo: 'error', msg: `Falha ao sincronizar com o PrimeStart: ${res.erro}` });
        return;
      }
      await registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'SINCRONIZOU EVENTOS/FEIRAS VIA API (P2S)',
        setor: 'OPERACIONAL',
        equipamento_nome: `${res.info.processados} registro(s)`,
      });
      setFeedback({ show: true, tipo: 'success', msg: `${res.info.processados} evento(s) sincronizado(s) direto do PrimeStart (${res.info.totalEncontradas} encontrado(s) no total).` });
      setPagina(0);
      setRefreshGrid(v => v + 1);
    } finally {
      setSincronizando(false);
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Eventos/Feiras.</p>
          <button onClick={() => router.push('/admin/operacional')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          📥 <strong>Olá, {usuarioAtual}</strong>. Importe o cadastro de eventos/feiras (com local) a partir de uma planilha CSV.
        </p>
        <button onClick={() => router.push('/admin/operacional')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Sincronizar via API</h2>
            <p className="text-xs text-[#64748B] mb-4">
              Puxa direto do PrimeStart (produção) os eventos/feiras com data inicial a partir de 60 dias atrás (mais todos os futuros) — sem precisar exportar e subir planilha. O status (Futuro/Em Execução/Finalizado) é calculado a partir das datas, já que o PrimeStart não expõe essa classificação pronta.
            </p>
            <button
              onClick={sincronizarViaApi}
              disabled={sincronizando}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider transition-colors"
            >
              {sincronizando ? 'Sincronizando...' : '🔄 Sincronizar agora'}
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Importar planilha</h2>
            <p className="text-xs text-[#64748B] mb-4">
              Arquivo CSV (separado por ponto e vírgula) ou Excel (.xls/.xlsx), com as colunas Data Inicial, Data Final, Nome, Tipo de Evento, Local Padrão, Status e demais campos do evento.
            </p>
            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={handleArquivo}
              className="block w-full text-sm text-[#64748B] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-black file:uppercase file:tracking-wider file:bg-[#336699] file:text-white hover:file:bg-[#284B8C] file:cursor-pointer cursor-pointer"
            />
            {erroArquivo && (
              <p className="mt-3 text-sm font-bold text-red-600">⚠ {erroArquivo}</p>
            )}
          </div>

          {feedback.show && (
            <div className={`p-4 rounded-xl border font-bold text-sm ${feedback.tipo === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {feedback.tipo === 'success' ? '✅' : '⚠'} {feedback.msg}
            </div>
          )}

          {linhasProcessadas.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">
                  Pré-visualização — {nomeArquivo}
                </h2>
                <div className="flex gap-2 text-xs font-black uppercase tracking-wider">
                  <span className="px-3 py-1.5 rounded-lg bg-green-100 text-green-700 border border-green-300">{validas.length} válida(s)</span>
                  {invalidas.length > 0 && (
                    <span className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 border border-red-300">{invalidas.length} com erro</span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto max-h-96 border border-[#E2E8F0] rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-[#F0F4F8] sticky top-0">
                    <tr className="text-left text-[#64748B] uppercase tracking-wider font-black">
                      <th className="p-2">Linha</th>
                      <th className="p-2">Nome</th>
                      <th className="p-2">Data Inicial</th>
                      <th className="p-2">Data Final</th>
                      <th className="p-2">Local</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasProcessadas.map((l, idx) => (
                      <tr key={idx} className={`border-t border-[#E2E8F0] ${l.erros.length > 0 ? 'bg-red-50' : ''}`}>
                        <td className="p-2 text-[#94A3B8]">{l.linha}</td>
                        <td className="p-2 font-bold">{l.dados.nome || '—'}</td>
                        <td className="p-2">{l.dados.data_inicial || '—'}</td>
                        <td className="p-2">{l.dados.data_final || '—'}</td>
                        <td className="p-2">{l.dados.local || '—'}</td>
                        <td className="p-2">{l.dados.status || '—'}</td>
                        <td className="p-2">
                          {l.erros.length === 0
                            ? <span className="text-green-600 font-bold">OK</span>
                            : <span className="text-red-600 font-bold">{l.erros.join('; ')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={importar}
                disabled={validas.length === 0 || importando}
                className="mt-4 w-full md:w-auto bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importando ? 'Importando...' : `Importar ${validas.length} registro(s) válido(s)`}
              </button>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Eventos Cadastrados</h2>
              <span className="text-xs font-black uppercase tracking-wider text-[#64748B]">
                {totalRegistros} registro(s)
              </span>
            </div>

            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <input
                type="text"
                value={filtroTexto}
                onChange={(e) => { setFiltroTexto(e.target.value); setPagina(0); }}
                placeholder="Buscar por nome do evento ou local..."
                className="flex-1 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
              />
              <select
                value={filtroStatus}
                onChange={(e) => { setFiltroStatus(e.target.value); setPagina(0); }}
                className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
              >
                <option value="">Todos os status</option>
                {STATUS_DISPONIVEIS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {gridErro && (
              <p className="mb-3 text-sm font-bold text-red-600">⚠ {gridErro}</p>
            )}

            <div className="overflow-x-auto max-h-96 border border-[#E2E8F0] rounded-xl relative min-h-[120px]">
              {gridLoading && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                  <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                </div>
              )}
              <table className="w-full text-xs">
                <thead className="bg-[#F0F4F8] sticky top-0">
                  <tr className="text-left text-[#64748B] uppercase tracking-wider font-black">
                    <th className="p-2">Nome</th>
                    <th className="p-2">Data Inicial</th>
                    <th className="p-2">Data Final</th>
                    <th className="p-2">Local</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Responsável</th>
                  </tr>
                </thead>
                <tbody>
                  {eventosGrid.length === 0 && !gridLoading ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">
                        Nenhum evento encontrado.
                      </td>
                    </tr>
                  ) : (
                    eventosGrid.map((ev) => (
                      <tr key={ev.id} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC]">
                        <td className="p-2 font-bold">{ev.nome}</td>
                        <td className="p-2">{formatarDataBR(ev.data_inicial)}</td>
                        <td className="p-2">{formatarDataBR(ev.data_final)}</td>
                        <td className="p-2">{ev.local || '—'}</td>
                        <td className="p-2">{ev.status || '—'}</td>
                        <td className="p-2">{ev.colaborador_responsavel || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap justify-between items-center gap-2 mt-4">
              <button
                onClick={() => setPagina(p => Math.max(0, p - 1))}
                disabled={pagina === 0 || gridLoading}
                className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors"
              >
                ⬅ Anterior
              </button>
              <span className="text-xs font-bold text-[#64748B]">
                Página {totalRegistros === 0 ? 0 : pagina + 1} de {Math.max(1, Math.ceil(totalRegistros / TAMANHO_PAGINA))}
              </span>
              <button
                onClick={() => setPagina(p => p + 1)}
                disabled={(pagina + 1) * TAMANHO_PAGINA >= totalRegistros || gridLoading}
                className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors"
              >
                Próxima ➡
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
