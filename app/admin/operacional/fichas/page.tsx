"use client";

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { sincronizarFichasReservaP2sAction } from './actions';
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
interface FichaReserva {
  numero: string;
  data_emissao: string | null;
  status: string;
  cliente: string;
  evento_feira: string | null;
  data_inicial: string | null;
  data_final: string | null;
  valor_final: number | null;
  vendedor: string | null;
  endereco_estande: string | null;
  valor_itens: number | null;
  observacao_contrato: string | null;
  data_entrega: string | null;
  data_entrega_agenda: string | null;
  campo_adicional_4: string | null;
  campo_adicional_5: string | null;
  campo_adicional_6: string | null;
  campo_adicional_7: string | null;
  campo_adicional_8: string | null;
  campo_adicional_9: string | null;
  campo_adicional_10: string | null;
  acompanha_preco_tabela: boolean;
  bonificacao: boolean;
  status_faturamento: string | null;
  faturamento_suspenso: boolean;
  observacoes: string | null;
  justificativa_suspensao: string | null;
  faturamento_antecipado: boolean;
  centro: string | null;
  itens: string | null;
  endereco_entrega: string | null;
}

type CampoFicha = keyof FichaReserva;
type TipoCampo = 'texto' | 'data' | 'bool' | 'numero';

interface LinhaProcessada {
  linha: number;
  dados: FichaReserva;
  erros: string[];
}

// Mapeia o cabeçalho (já normalizado, sem acento e em minúsculas) da planilha
// "Fichas de Reserva" exportada do sistema para os campos da tabela fichas_reserva.
// data_entrega_agenda NÃO entra aqui: é calculado a partir de data_entrega, não vem direto de coluna.
const MAPA_COLUNAS: Record<string, CampoFicha> = {
  'numero': 'numero',
  'data de emissao': 'data_emissao',
  'status': 'status',
  'cliente': 'cliente',
  'evento/feira associada (se houver)': 'evento_feira',
  'data inicial': 'data_inicial',
  'data final': 'data_final',
  'valor final da ficha': 'valor_final',
  'vendedor / representante': 'vendedor',
  'campo adicional 3': 'endereco_estande',
  'valor total dos itens (diarias)': 'valor_itens',
  'observacao em contrato': 'observacao_contrato',
  'data de entrega': 'data_entrega',
  'campo adicional 4': 'campo_adicional_4',
  'campo adicional 5': 'campo_adicional_5',
  'campo adicional 6': 'campo_adicional_6',
  'campo adicional 7': 'campo_adicional_7',
  'campo adicional 8': 'campo_adicional_8',
  'campo adicional 9': 'campo_adicional_9',
  'campo adicional 10': 'campo_adicional_10',
  'acompanhando preco de tabela?': 'acompanha_preco_tabela',
  'bonificacao': 'bonificacao',
  'status do ultimo faturamento': 'status_faturamento',
  'faturamento suspenso': 'faturamento_suspenso',
  'observacoes': 'observacoes',
  'justificativa da suspensao': 'justificativa_suspensao',
  'tem faturamento antecipado': 'faturamento_antecipado',
  'centro': 'centro',
  'itens': 'itens',
  'end. entrega': 'endereco_entrega',
};

const TIPO_CAMPO: Record<CampoFicha, TipoCampo> = {
  numero: 'texto', data_emissao: 'data', status: 'texto', cliente: 'texto', evento_feira: 'texto',
  data_inicial: 'data', data_final: 'data', valor_final: 'numero', vendedor: 'texto',
  endereco_estande: 'texto', valor_itens: 'numero', observacao_contrato: 'texto',
  data_entrega: 'texto', data_entrega_agenda: 'data',
  campo_adicional_4: 'texto', campo_adicional_5: 'texto', campo_adicional_6: 'texto',
  campo_adicional_7: 'texto', campo_adicional_8: 'texto', campo_adicional_9: 'texto', campo_adicional_10: 'texto',
  acompanha_preco_tabela: 'bool', bonificacao: 'bool', status_faturamento: 'texto',
  faturamento_suspenso: 'bool', observacoes: 'texto', justificativa_suspensao: 'texto',
  faturamento_antecipado: 'bool', centro: 'texto', itens: 'texto', endereco_entrega: 'texto',
};

const ROTULO_CAMPO: Record<CampoFicha, string> = {
  numero: 'Número', data_emissao: 'Data de Emissão', status: 'Status', cliente: 'Cliente', evento_feira: 'Evento/Feira',
  data_inicial: 'Data Inicial', data_final: 'Data Final', valor_final: 'Valor Final da Ficha', vendedor: 'Vendedor',
  endereco_estande: 'Endereço do Estande', valor_itens: 'Valor Total dos Itens', observacao_contrato: 'Observação em Contrato',
  data_entrega: 'Data de Entrega', data_entrega_agenda: 'Data de Entrega (Agenda)',
  campo_adicional_4: 'Campo Adicional 4', campo_adicional_5: 'Campo Adicional 5', campo_adicional_6: 'Campo Adicional 6',
  campo_adicional_7: 'Campo Adicional 7', campo_adicional_8: 'Campo Adicional 8', campo_adicional_9: 'Campo Adicional 9', campo_adicional_10: 'Campo Adicional 10',
  acompanha_preco_tabela: 'Acompanha Preço de Tabela', bonificacao: 'Bonificação', status_faturamento: 'Status do Último Faturamento',
  faturamento_suspenso: 'Faturamento Suspenso', observacoes: 'Observações', justificativa_suspensao: 'Justificativa da Suspensão',
  faturamento_antecipado: 'Tem Faturamento Antecipado', centro: 'Centro', itens: 'Itens', endereco_entrega: 'Endereço de Entrega',
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
// que o CSV exportado traria: datas como "DD/MM/AAAA" e valores decimais no padrão BR
// (vírgula decimal) — é o que paraDataISO/paraNumero abaixo já sabem interpretar. Não dá pra
// confiar no texto formatado pela própria célula (SheetJS despreza o dateNF em alguns casos e
// pode devolver datas em formato americano), então convertemos a partir do valor cru.
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

// O sistema de origem prefixa alguns campos de texto com um apóstrofo (força célula
// como texto no Excel) — ex: número "'026995" ou data de entrega "'31/07 MANHÃ".
const limparApostrofoInicial = (v?: string): string => (v ?? '').trim().replace(/^'/, '');

const paraBool = (v?: string): boolean => (v ?? '').trim().toLowerCase() === 'sim';

const paraDataISO = (v?: string): { iso: string | null; erro?: string } => {
  const t = (v ?? '').trim();
  if (t === '') return { iso: null };
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { iso: null, erro: `data inválida "${t}" (use DD/MM/AAAA)` };
  const [, dd, mm, yyyy] = m;
  return { iso: `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` };
};

// "Valor Final da Ficha" / "Valor Total dos Itens" vêm no formato BR: "." separa milhar, "," separa decimal.
const paraNumero = (v?: string): { valor: number | null; erro?: string } => {
  const t = (v ?? '').trim();
  if (t === '') return { valor: null };
  const semMilhar = t.replace(/\./g, '').replace(',', '.');
  const n = Number(semMilhar);
  if (Number.isNaN(n)) return { valor: null, erro: `valor inválido "${t}"` };
  return { valor: n };
};

const MESES_PT: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

// "Data de Entrega" é texto livre no sistema de origem (ex: "'31/07 MANHÃ", "25 DE AGO",
// endereços com telefone). Aqui tentamos capturar uma data aproximada só para alimentar
// a futura agenda/calendário operacional — quando não dá para reconhecer o padrão, fica
// null e o texto original continua disponível em data_entrega para leitura manual.
const extrairDataEntregaAgenda = (bruto: string, anoRef: string | null): string | null => {
  const semAspa = limparApostrofoInicial(bruto);
  if (!semAspa) return null;
  const semAcento = semAspa.normalize('NFD').replace(/[̀-ͯ]/g, '');

  const m1 = semAcento.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m1) {
    const [, dd, mm, aaaa] = m1;
    const ano = aaaa ? (aaaa.length === 2 ? `20${aaaa}` : aaaa) : anoRef;
    if (!ano) return null;
    return `${ano}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  const m2 = semAcento.match(/^(\d{1,2})\s+de\s+([a-z]{3,})/i);
  if (m2 && anoRef) {
    const [, dd, mesTexto] = m2;
    const mes = MESES_PT[mesTexto.slice(0, 3).toLowerCase()];
    if (mes) return `${anoRef}-${String(mes).padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  return null;
};

// Localiza a linha de cabeçalho (pula o título e linhas em branco do arquivo exportado)
// e devolve o índice de cada coluna reconhecida mapeada para o campo da tabela.
function localizarCabecalho(linhas: string[][]): { indiceLinha: number; colunas: Map<number, CampoFicha> } | null {
  for (let i = 0; i < Math.min(linhas.length, 20); i++) {
    const normalizadas = linhas[i].map(normalizarCabecalho);
    if (normalizadas.includes('numero') && normalizadas.includes('cliente')) {
      const colunas = new Map<number, CampoFicha>();
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
    return { processadas: [], erroGeral: 'Não foi possível localizar o cabeçalho (colunas "Número" e "Cliente") no arquivo.' };
  }

  const processadas: LinhaProcessada[] = [];
  for (let i = cabecalho.indiceLinha + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    const vazia = linha.every(c => (c ?? '').trim() === '');
    if (vazia) continue;

    const erros: string[] = [];
    const dados: Partial<FichaReserva> = {};

    const dadosGravaveis = dados as Record<CampoFicha, string | number | boolean | null>;
    cabecalho.colunas.forEach((campo, idx) => {
      const bruto = linha[idx] ?? '';
      const tipo = TIPO_CAMPO[campo];
      if (tipo === 'texto') {
        dadosGravaveis[campo] = (campo === 'numero' || campo === 'data_entrega')
          ? limpo(limparApostrofoInicial(bruto))
          : limpo(bruto);
      } else if (tipo === 'bool') {
        dadosGravaveis[campo] = paraBool(bruto);
      } else if (tipo === 'numero') {
        const { valor, erro } = paraNumero(bruto);
        if (erro) erros.push(`${ROTULO_CAMPO[campo]}: ${erro}`);
        dadosGravaveis[campo] = valor;
      } else {
        const { iso, erro } = paraDataISO(bruto);
        if (erro) erros.push(`${ROTULO_CAMPO[campo]}: ${erro}`);
        dadosGravaveis[campo] = iso;
      }
    });

    const anoRef = (dados.data_inicial || dados.data_final || '')?.slice(0, 4) || null;
    dados.data_entrega_agenda = extrairDataEntregaAgenda(dados.data_entrega || '', anoRef);

    if (!dados.numero) erros.push('Número é obrigatório');
    if (!dados.cliente) erros.push('Cliente é obrigatório');
    if (!dados.status) erros.push('Status é obrigatório');

    processadas.push({ linha: i + 1, dados: dados as FichaReserva, erros });
  }

  return { processadas };
}

// Colunas exibidas no grid de consulta (subconjunto leve — sem itens/observações longas)
interface FichaGrid {
  id: string;
  numero: string;
  cliente: string;
  evento_feira: string | null;
  status: string;
  data_inicial: string | null;
  data_final: string | null;
  data_entrega_agenda: string | null;
  valor_final: number | null;
  vendedor: string | null;
}

const STATUS_DISPONIVEIS = [
  'Enviado - Aguardando Retorno',
  'Em Preparação',
  'Aprovado - Aguardando Saída',
  'Em Locação',
  'Finalizado / Devolvido',
  'Reprovado',
  'Cancelado',
];

const TAMANHO_PAGINA = 50;

// Status considerados "encerrados" — fichas que não precisam mais ficar na base operacional
const STATUS_PARA_LIMPAR = ['Reprovado', 'Finalizado / Devolvido', 'Cancelado'];

const formatarDataBR = (iso: string | null): string => {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
};

const formatarMoeda = (valor: number | null): string =>
  valor != null ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';

// ============================================================================
// COMPONENTE
// ============================================================================
export default function ImportadorFichasReserva() {
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

  const [fichasGrid, setFichasGrid] = useState<FichaGrid[]>([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridErro, setGridErro] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [pagina, setPagina] = useState(0);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [refreshGrid, setRefreshGrid] = useState(0);

  const [modalLimpar, setModalLimpar] = useState<{ open: boolean; contando: boolean; total: number | null; excluindo: boolean }>({
    open: false, contando: false, total: null, excluindo: false,
  });

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
        .from('fichas_reserva')
        .select('id, numero, cliente, evento_feira, status, data_inicial, data_final, data_entrega_agenda, valor_final, vendedor', { count: 'exact' })
        .order('numero', { ascending: false })
        .range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);

      if (filtroStatus) query = query.eq('status', filtroStatus);
      if (filtroTexto.trim()) {
        const termo = `%${filtroTexto.trim()}%`;
        query = query.or(`numero.ilike.${termo},cliente.ilike.${termo},evento_feira.ilike.${termo}`);
      }

      const { data, error, count } = await query;
      if (error) {
        setGridErro(error.message);
        setFichasGrid([]);
      } else {
        setFichasGrid(data || []);
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

    // upsert por "numero": ficha nova é inserida, ficha já existente é atualizada
    // (permite reimportar a mesma planilha exportada periodicamente sem duplicar nem travar).
    const registros = validas.map(l => ({ ...l.dados, updated_at: new Date().toISOString() }));
    const TAMANHO_LOTE = 500;
    let processados = 0;
    let erroLote = '';

    for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
      const lote = registros.slice(i, i + TAMANHO_LOTE);
      const { error } = await supabase.from('fichas_reserva').upsert(lote, { onConflict: 'numero' });
      if (error) { erroLote = error.message; break; }
      processados += lote.length;
    }

    if (erroLote) {
      setFeedback({ show: true, tipo: 'error', msg: `Importação interrompida após ${processados} registro(s): ${erroLote}` });
    } else {
      await registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'IMPORTOU/ATUALIZOU FICHAS DE RESERVA VIA CSV',
        setor: 'OPERACIONAL',
        equipamento_nome: `${processados} registro(s) — ${nomeArquivo}`,
      });
      setFeedback({ show: true, tipo: 'success', msg: `${processados} ficha(s) processada(s) (inserida(s) ou atualizada(s)) com sucesso.` });
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
      const res = await sincronizarFichasReservaP2sAction();
      if (!res.ok) {
        setFeedback({ show: true, tipo: 'error', msg: `Falha ao sincronizar com o PrimeStart: ${res.erro}` });
        return;
      }
      await registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'SINCRONIZOU FICHAS DE RESERVA VIA API (P2S)',
        setor: 'OPERACIONAL',
        equipamento_nome: `${res.info.processados} registro(s)`,
      });
      setFeedback({ show: true, tipo: 'success', msg: `${res.info.processados} ficha(s) sincronizada(s) direto do PrimeStart (últimos 90 dias, ${res.info.totalEncontradas} encontrada(s) no total).` });
      setPagina(0);
      setRefreshGrid(v => v + 1);
    } finally {
      setSincronizando(false);
    }
  };

  const abrirModalLimpar = async () => {
    setModalLimpar({ open: true, contando: true, total: null, excluindo: false });
    const { count, error } = await supabase
      .from('fichas_reserva')
      .select('id', { count: 'exact', head: true })
      .in('status', STATUS_PARA_LIMPAR);
    setModalLimpar({ open: true, contando: false, total: error ? 0 : (count || 0), excluindo: false });
  };

  const confirmarLimpeza = async () => {
    setModalLimpar(prev => ({ ...prev, excluindo: true }));

    const { error, count } = await supabase
      .from('fichas_reserva')
      .delete({ count: 'exact' })
      .in('status', STATUS_PARA_LIMPAR);

    if (error) {
      setFeedback({ show: true, tipo: 'error', msg: `Falha ao limpar fichas: ${error.message}` });
    } else {
      await registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'LIMPOU FICHAS DE RESERVA (REPROVADO / FINALIZADO / CANCELADO)',
        setor: 'OPERACIONAL',
        equipamento_nome: `${count ?? 0} registro(s) excluído(s)`,
      });
      setFeedback({ show: true, tipo: 'success', msg: `${count ?? 0} ficha(s) removida(s) com sucesso.` });
      setPagina(0);
      setRefreshGrid(v => v + 1);
    }

    setModalLimpar({ open: false, contando: false, total: null, excluindo: false });
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar as Fichas de Reserva.</p>
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
          📥 <strong>Olá, {usuarioAtual}</strong>. Importe as fichas de reserva a partir de uma planilha CSV.
        </p>
        <button onClick={() => router.push('/admin/operacional')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Sincronizar via API</h2>
            <p className="text-xs text-[#64748B] mb-4">
              Puxa direto do PrimeStart (produção) as fichas de reserva emitidas nos últimos 90 dias — sem precisar exportar e subir planilha. Atenção: os campos Data de Entrega e Status ainda não têm equivalente confirmado na API, então ficam em branco / com o código cru (EN, EP, RE, CA, A, E, X, SB) em vez do rótulo em português nas fichas sincronizadas por aqui.
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
              Arquivo CSV (separado por ponto e vírgula) ou Excel (.xls/.xlsx), com as colunas Número, Status, Cliente, Evento/Feira Associada, Data Inicial/Final e demais campos da ficha de reserva.
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
                      <th className="p-2">Número</th>
                      <th className="p-2">Cliente</th>
                      <th className="p-2">Evento/Feira</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Data Inicial</th>
                      <th className="p-2">Data Final</th>
                      <th className="p-2">Valor Final</th>
                      <th className="p-2">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasProcessadas.map((l, idx) => (
                      <tr key={idx} className={`border-t border-[#E2E8F0] ${l.erros.length > 0 ? 'bg-red-50' : ''}`}>
                        <td className="p-2 text-[#94A3B8]">{l.linha}</td>
                        <td className="p-2 font-bold">{l.dados.numero || '—'}</td>
                        <td className="p-2">{l.dados.cliente || '—'}</td>
                        <td className="p-2">{l.dados.evento_feira || '—'}</td>
                        <td className="p-2">{l.dados.status || '—'}</td>
                        <td className="p-2">{l.dados.data_inicial || '—'}</td>
                        <td className="p-2">{l.dados.data_final || '—'}</td>
                        <td className="p-2">{l.dados.valor_final != null ? l.dados.valor_final.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td>
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
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Fichas Cadastradas</h2>
              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                <span className="text-xs font-black uppercase tracking-wider text-[#64748B]">
                  {totalRegistros} registro(s)
                </span>
                <button
                  onClick={abrirModalLimpar}
                  className="text-xs font-black uppercase tracking-wider bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-100 transition-colors"
                >
                  🗑️ Limpar Fichas
                </button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <input
                type="text"
                value={filtroTexto}
                onChange={(e) => { setFiltroTexto(e.target.value); setPagina(0); }}
                placeholder="Buscar por número, cliente ou evento/feira..."
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

            <div className="overflow-x-auto border border-[#E2E8F0] rounded-xl relative min-h-[120px]">
              {gridLoading && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                  <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                </div>
              )}
              <table className="w-full text-xs">
                <thead className="bg-[#F0F4F8] sticky top-0">
                  <tr className="text-left text-[#64748B] uppercase tracking-wider font-black">
                    <th className="p-2">Número</th>
                    <th className="p-2">Cliente</th>
                    <th className="p-2">Evento/Feira</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Data Inicial</th>
                    <th className="p-2">Data Final</th>
                    <th className="p-2">Entrega</th>
                    <th className="p-2">Vendedor</th>
                    <th className="p-2">Valor Final</th>
                  </tr>
                </thead>
                <tbody>
                  {fichasGrid.length === 0 && !gridLoading ? (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">
                        Nenhuma ficha encontrada.
                      </td>
                    </tr>
                  ) : (
                    fichasGrid.map((f) => (
                      <tr key={f.id} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC]">
                        <td className="p-2 font-bold">{f.numero}</td>
                        <td className="p-2">{f.cliente}</td>
                        <td className="p-2">{f.evento_feira || '—'}</td>
                        <td className="p-2">{f.status}</td>
                        <td className="p-2">{formatarDataBR(f.data_inicial)}</td>
                        <td className="p-2">{formatarDataBR(f.data_final)}</td>
                        <td className="p-2">{formatarDataBR(f.data_entrega_agenda)}</td>
                        <td className="p-2">{f.vendedor || '—'}</td>
                        <td className="p-2">{formatarMoeda(f.valor_final)}</td>
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

      {modalLimpar.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-red-600 p-5 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-wider text-sm">🗑️ Limpar Fichas</h3>
              <button
                onClick={() => setModalLimpar({ open: false, contando: false, total: null, excluindo: false })}
                disabled={modalLimpar.excluindo}
                className="text-white hover:text-red-200 text-2xl leading-none disabled:opacity-50"
              >
                &times;
              </button>
            </div>

            <div className="p-6">
              {modalLimpar.contando ? (
                <div className="flex items-center gap-3 text-sm text-[#64748B]">
                  <div className="w-5 h-5 border-4 border-[#E2E8F0] border-t-red-500 rounded-full animate-spin"></div>
                  Contando registros...
                </div>
              ) : (
                <>
                  <p className="text-sm text-[#334155] mb-2">
                    Esta ação vai <strong>excluir permanentemente</strong> do banco de dados todas as fichas com status:
                  </p>
                  <ul className="text-xs font-bold text-[#64748B] uppercase mb-4 space-y-1">
                    {STATUS_PARA_LIMPAR.map(s => <li key={s}>• {s}</li>)}
                  </ul>
                  <p className="text-sm font-black text-red-600">
                    {modalLimpar.total} ficha(s) serão excluída(s).
                  </p>
                </>
              )}
            </div>

            <div className="p-5 border-t border-[#E2E8F0] flex flex-wrap justify-end gap-3">
              <button
                onClick={() => setModalLimpar({ open: false, contando: false, total: null, excluindo: false })}
                disabled={modalLimpar.excluindo}
                className="px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] hover:bg-[#E2E8F0] transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarLimpeza}
                disabled={modalLimpar.contando || modalLimpar.excluindo || !modalLimpar.total}
                className="px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {modalLimpar.excluindo ? 'Excluindo...' : 'Confirmar Exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
