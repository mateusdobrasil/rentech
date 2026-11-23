"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  contextoNovaFichaAction, carregarFichaAction, salvarFichaAction, mudarStatusFichaAction, duplicarFichaAction,
  aprovarDescontoFichaAction, excluirFichaAction,
  precificarFichaAction, verificarDisponibilidadeFichaAction,
  buscarClientesFichaAction, buscarEventosFichaAction, buscarProdutosFichaAction,
  type StatusFicha, type TipoItem, type AcaoStatus, type DadosFicha,
} from '../actions';
import type { Modalidade, OrigemPreco } from '../../../../lib/locacao/precificacao';
import type { LinhaDisponibilidade } from '../../../../lib/locacao/disponibilidade';
import type { AcessoTela } from '../../../../lib/locacao/acessoFichas';
import { pctLocacaoAplicada, type RegraComissao } from '../../../../lib/comercial/regraComissao';
import { usePageAccess } from '../../../../components/hooks/usePageAccess';
import { HubErro } from '../../../../components/ui/HubStates';
import CampoBusca, { type OpcaoBusca } from '../../../../components/ui/CampoBusca';
import { useToast, useConfirm, usePrompt } from '../../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../../lib/formatadores';
import { diasInclusivos, dataValida, hojeISO } from '../../../../lib/locacao/datas';
import { STATUS_FICHA, MODALIDADES, numeroFicha } from '../statusFicha';
import PainelProposta from './PainelProposta';
import PainelTitulos from './PainelTitulos';
import PainelContrato from './PainelContrato';
import PainelFichaLocacao from './PainelFichaLocacao';
import PainelSublocacoes from './PainelSublocacoes';
import FormSublocacao, { type InicialSublocacao } from '../../sublocacoes/FormSublocacao';
import { calcularLed, resumoLed, type EspecLed } from '../../../../lib/locacao/ledTecnico';
import { FORMAS_PAGAMENTO, ROTULO_FORMA_PAGAMENTO } from '../../../../lib/locacao/textosPadrao';
import { rotuloStatusP2s } from '../../../../lib/locacao/statusP2s';

// Editor da Ficha de Reserva própria (orçamento → reserva), 2026-11-16.
// /admin/locacoes/reservas/nova cria; /admin/locacoes/reservas/<id> edita.
// Permissão: a mesma linha de /admin/locacoes/reservas.

interface EmpresaOpcao { id: number; nome: string; validadeDias?: number }
interface ItemUI {
  chave: string;
  id: number | null;
  tipo: TipoItem;
  produto_id: number | null;
  produto_codigo: string | null;
  unidade: string | null;
  controle: string | null;
  descricao: string;
  quantidade: string;
  dias: string;            // vazio = acompanha os dias da ficha
  valor_unitario: string;
  desconto: string;
  origem: OrigemPreco | null;
  preco_manual: boolean;
  semPreco: string | null; // motivo quando a tabela não precifica
  observacoes: string;
  led: EspecLed | null;     // painel de LED: ficha técnica do produto
  led_largura: string;      // medida pedida (m)
  led_altura: string;
}
interface Cabecalho {
  empresa_id: number;
  modalidade: Modalidade;
  contato_nome: string; contato_telefone: string; contato_email: string;
  vendedor_id: number | null;
  vendedor_nome: string;
  local_entrega: string; endereco_estande: string;
  data_saida: string; data_montagem: string; data_inicio: string; data_fim: string; data_desmontagem: string; data_retorno: string;
  dias_cobrados: string;
  validade_orcamento: string;
  condicao_pagamento: string;
  forma_pagamento: string;
  observacoes: string; observacoes_internas: string;
  desconto: string;
}

const ROTA = '/admin/locacoes/reservas';
const EDITAVEIS: StatusFicha[] = ['ORCAMENTO', 'ENVIADO', 'APROVADO', 'RESERVADA'];
const ROTULO_TIPO: Record<TipoItem, string> = { EQUIPAMENTO: 'Equipamento', KIT: 'Kit', SERVICO: 'Serviço', FRETE: 'Frete', OUTRO: 'Outro' };

// Equipamento/kit (e item do P2S ligado a produto) → Equipamentos; serviço, frete e "outro" livre → Serviços / Extras
const secaoItem = (i: { tipo: TipoItem; produto_id: number | null }): 'EQUIP' | 'SERV' =>
  i.tipo === 'EQUIPAMENTO' || i.tipo === 'KIT' || (i.tipo === 'OUTRO' && !!i.produto_id) ? 'EQUIP' : 'SERV';

let seqChave = 0;
const novaChave = () => `i${Date.now().toString(36)}${(seqChave++).toString(36)}`;

function lerValor(s: string): number | null {
  const t = (s || '').replace(/\s|R\$/g, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : NaN;
}
const mostrar = (n: number | null | undefined, casas = 2) =>
  n === null || n === undefined ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const mostrarQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const somarDiasISO = (iso: string, d: number) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

function descreverOrigem(o: OrigemPreco | null): string {
  if (!o) return '';
  const tab = `${o.tabela_nome}`;
  if (o.modalidade === 'MENSAL') return `${tab}: ${o.meses} mês(es) × ${formatarMoeda(o.valor_mensal || 0)}`;
  let s = `${tab}: ${o.faixa_dias} × ${formatarMoeda(o.valor_diaria_faixa || 0)}`;
  if (o.dias_extra) s += ` + ${o.dias_extra} × ${formatarMoeda(o.valor_diaria_extra || 0)}${o.extra_pela_faixa ? ' (diária da faixa)' : ''}`;
  return s;
}

const cabecalhoVazio = (empresaId: number, vendedor: string, vendedorId: number | null = null, validadeDias = 7): Cabecalho => ({
  empresa_id: empresaId, modalidade: 'DIARIA', contato_nome: '', contato_telefone: '', contato_email: '', vendedor_id: vendedorId, vendedor_nome: vendedor,
  local_entrega: '', endereco_estande: '', data_saida: '', data_montagem: '', data_inicio: '', data_fim: '', data_desmontagem: '', data_retorno: '',
  dias_cobrados: '', validade_orcamento: somarDiasISO(hojeISO(), validadeDias), condicao_pagamento: '', forma_pagamento: '', observacoes: '', observacoes_internas: '', desconto: '',
});

// Grid de gabinetes do painel de LED (prévia na ficha; a proposta desenha o mesmo).
function GradeLed({ colunas, linhas }: { colunas: number; linhas: number }) {
  const maxW = 220, maxH = 90;
  const lado = Math.max(2, Math.min(maxW / colunas, maxH / linhas));
  const w = colunas * lado, h = linhas * lado;
  return (
    <div className="flex-shrink-0">
      <svg width={w + 22} height={h + 16} className="block">
        <rect x={1} y={1} width={w} height={h} fill="#EEF5FF" stroke="#336699" strokeWidth={1.5} />
        {colunas <= 80 && Array.from({ length: colunas - 1 }, (_, c) => <line key={`c${c}`} x1={1 + (c + 1) * lado} y1={1} x2={1 + (c + 1) * lado} y2={1 + h} stroke="#B8CCE4" strokeWidth={0.6} />)}
        {linhas <= 60 && Array.from({ length: linhas - 1 }, (_, l) => <line key={`l${l}`} x1={1} y1={1 + (l + 1) * lado} x2={1 + w} y2={1 + (l + 1) * lado} stroke="#B8CCE4" strokeWidth={0.6} />)}
        <text x={1 + w / 2} y={h + 13} fontSize={9} textAnchor="middle" fill="#64748B">{colunas}</text>
        <text x={w + 6} y={1 + h / 2 + 3} fontSize={9} fill="#64748B">{linhas}</text>
      </svg>
    </div>
  );
}

export default function EditorFichaPage() {
  const router = useRouter();
  const params = useParams();
  const idParam = String(params?.id || '');
  const ehNova = idParam === 'nova';
  const fichaIdUrl = ehNova ? null : Number(idParam);

  const toast = useToast();
  const confirmar = useConfirm();
  const pedir = usePrompt();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ rota: ROTA });

  const [carregando, setCarregando] = useState(true);
  const [empresas, setEmpresas] = useState<EmpresaOpcao[]>([]);
  const [status, setStatus] = useState<StatusFicha>('ORCAMENTO');
  const [fichaInfo, setFichaInfo] = useState<any>(null);
  const [cab, setCab] = useState<Cabecalho>(cabecalhoVazio(0, ''));
  const [cliente, setCliente] = useState<OpcaoBusca | null>(null);
  const [evento, setEvento] = useState<OpcaoBusca | null>(null);
  const [itens, setItens] = useState<ItemUI[]>([]);
  const [historico, setHistorico] = useState<any[]>([]);
  const [alocacoes, setAlocacoes] = useState<any[]>([]);
  const [tabelas, setTabelas] = useState<{ id: number; nome: string; tipo: string }[]>([]);
  const [disp, setDisp] = useState<{ linhas: LinhaDisponibilidade[]; temFalta: boolean } | null>(null);
  // sublocação (2026-11-20): "Sublocar o que falta" e o painel da OS
  const [sublocar, setSublocar] = useState<InicialSublocacao | null>(null);
  const [versaoSub, setVersaoSub] = useState(0);
  const [verificando, setVerificando] = useState(false);
  const [precificando, setPrecificando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [alterado, setAlterado] = useState(false);
  const [diasManual, setDiasManual] = useState(false);
  const [acesso, setAcesso] = useState<AcessoTela | null>(null);
  const [vendedores, setVendedores] = useState<{ id: number; nome: string }[]>([]);
  const [carteira, setCarteira] = useState<{ vendedor_id: number; nome: string } | null>(null);
  const [descPendente, setDescPendente] = useState(false);
  const [regrasComissao, setRegrasComissao] = useState<Record<number, RegraComissao>>({});

  const doP2s = fichaInfo?.origem === 'P2S';
  const podeAlterar = !!acesso && (ehNova ? acesso.podeCriar : acesso.podeEditar);
  const editavel = EDITAVEIS.includes(status) && !doP2s && podeAlterar;
  const diasEvento = dataValida(cab.data_inicio) && dataValida(cab.data_fim) && cab.data_fim >= cab.data_inicio ? diasInclusivos(cab.data_inicio, cab.data_fim) : null;
  const diasCobrados = Math.max(1, Number(cab.dias_cobrados) || diasEvento || 1);

  // ---------------- carregar ----------------
  const aplicarFicha = (info: any) => {
    const f = info.ficha;
    setEmpresas(info.empresas);
    setAcesso(info.acesso || null);
    setVendedores(info.vendedores || []);
    setCarteira(info.carteira || null);
    setDescPendente(!!info.descontoPendente);
    setRegrasComissao(info.regrasComissao || {});
    setFichaInfo(f);
    setStatus(f.status);
    setCab({
      empresa_id: f.empresa_id, modalidade: f.modalidade,
      contato_nome: f.contato_nome || '', contato_telefone: f.contato_telefone || '', contato_email: f.contato_email || '',
      vendedor_id: f.vendedor_id ?? null, vendedor_nome: f.vendedor_nome || '', local_entrega: f.local_entrega || '', endereco_estande: f.endereco_estande || '',
      data_saida: f.data_saida || '', data_montagem: f.data_montagem || '', data_inicio: f.data_inicio || '', data_fim: f.data_fim || '',
      data_desmontagem: f.data_desmontagem || '', data_retorno: f.data_retorno || '',
      dias_cobrados: f.dias_cobrados ? String(f.dias_cobrados) : '',
      validade_orcamento: f.validade_orcamento || '', condicao_pagamento: f.condicao_pagamento || '', forma_pagamento: f.forma_pagamento || '',
      observacoes: f.observacoes || '', observacoes_internas: f.observacoes_internas || '',
      desconto: Number(f.desconto_valor) ? mostrar(Number(f.desconto_valor)) : '',
    });
    setDiasManual(Boolean(f.dias_cobrados && f.data_inicio && f.data_fim && f.dias_cobrados !== diasInclusivos(f.data_inicio, f.data_fim)));
    setCliente(info.cliente);
    setEvento(info.evento);
    setItens((info.itens || []).map((i: any) => ({
      chave: novaChave(), id: i.id, tipo: i.tipo, produto_id: i.produto_id, produto_codigo: i.produto_codigo, unidade: i.produto_unidade,
      controle: i.produto_controle, descricao: i.descricao, quantidade: mostrarQtd(Number(i.quantidade)),
      dias: i.dias && Number(i.dias) !== (f.dias_cobrados || 0) ? String(i.dias) : '',
      valor_unitario: mostrar(Number(i.valor_unitario)), desconto: Number(i.desconto_valor) ? mostrar(Number(i.desconto_valor)) : '',
      origem: i.origem_preco || null, preco_manual: !!i.preco_manual, semPreco: null, observacoes: i.observacoes || '',
      led: i.led_espec || null, led_largura: i.led_largura_m ? mostrar(Number(i.led_largura_m)) : '', led_altura: i.led_altura_m ? mostrar(Number(i.led_altura_m)) : '',
    })));
    setHistorico(info.historico || []);
    setAlocacoes(info.alocacoes || []);
    setAlterado(false);
  };

  const carregar = async () => {
    setCarregando(true);
    if (ehNova) {
      const r = await contextoNovaFichaAction(accessToken);
      if (!r.ok) { toast(r.erro || 'Erro.', 'error'); setCarregando(false); return; }
      setEmpresas(r.info.empresas);
      setAcesso(r.info.acesso || null);
      setVendedores(r.info.vendedores || []);
      setRegrasComissao(r.info.regrasComissao || {});
      const a = r.info.acesso as AcessoTela | undefined;
      setCab(cabecalhoVazio(r.info.empresas[0]?.id || 0, a?.vendedorNome || r.info.usuario || '', a?.vendedorId ?? null, r.info.empresas[0]?.validadeDias || 7));
    } else {
      const r = await carregarFichaAction(fichaIdUrl!, accessToken);
      if (!r.ok) { toast(r.erro || 'Erro ao carregar a ficha.', 'error'); setCarregando(false); return; }
      aplicarFicha(r.info);
    }
    setCarregando(false);
  };

  useEffect(() => {
    if (!authLoading && !acessoNegado && !erro && accessToken) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, idParam]);

  // aviso ao sair com alteração não salva
  useEffect(() => {
    if (!alterado) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [alterado]);

  const mudarCab = (parcial: Partial<Cabecalho>) => { setCab(c => ({ ...c, ...parcial })); setAlterado(true); };

  // dias cobrados acompanham o evento até o usuário mexer
  useEffect(() => {
    if (!diasManual && diasEvento) setCab(c => (c.dias_cobrados === String(diasEvento) ? c : { ...c, dias_cobrados: String(diasEvento) }));
  }, [diasEvento, diasManual]);

  // ---------------- buscas ----------------
  const buscarClientes = useCallback(async (t: string) => { const r = await buscarClientesFichaAction(t, accessToken); return r.ok ? r.info : []; }, [accessToken]);
  const buscarEventos = useCallback(async (t: string) => { const r = await buscarEventosFichaAction(t, accessToken); return r.ok ? r.info : []; }, [accessToken]);
  const buscarProdutos = useCallback(async (t: string) => {
    const r = await buscarProdutosFichaAction(t, accessToken);
    return r.ok ? (r.info as any[]).map(p => ({
      id: p.id, nome: p.nome_item,
      detalhe: [p.codigo_formatado, p.unidade, p.categoria_nome, p.eh_kit ? 'KIT' : null, p.controle_locacao === 'INDIVIDUAL' ? 'por patrimônio' : null].filter(Boolean).join(' · '),
      extra: p,
    })) : [];
  }, [accessToken]);

  // ---------------- preço ----------------
  const diasDoItem = (i: ItemUI) => Math.max(1, Number(i.dias) || diasCobrados);

  const precificar = async (alvo: ItemUI[], silencioso = false) => {
    const elegiveis = alvo.filter(i => i.produto_id && (i.tipo === 'EQUIPAMENTO' || i.tipo === 'KIT') && !i.preco_manual);
    if (!elegiveis.length) return;
    if (!dataValida(cab.data_inicio)) { if (!silencioso) toast('Informe o início do evento para calcular o preço.', 'info'); return; }
    setPrecificando(true);
    const r = await precificarFichaAction({
      empresa_id: cab.empresa_id, parceiro_id: cliente ? Number(cliente.id) : null, evento_id: evento ? String(evento.id) : null,
      data_inicio: cab.data_inicio, modalidade: cab.modalidade,
      itens: elegiveis.map(i => ({ chave: i.chave, produto_id: i.produto_id!, dias: diasDoItem(i) })),
    }, accessToken);
    setPrecificando(false);
    if (!r.ok) { if (!silencioso) toast(r.erro || 'Erro ao calcular preço.', 'error'); return; }
    setTabelas(r.info.tabelas);
    const precos = r.info.precos as Record<string, { valor_unitario: number | null; origem: OrigemPreco | null; motivo?: string }>;
    setItens(prev => prev.map(i => {
      const p = precos[i.chave];
      if (!p || i.preco_manual) return i;
      return { ...i, valor_unitario: p.valor_unitario === null ? i.valor_unitario : mostrar(p.valor_unitario), origem: p.origem, semPreco: p.valor_unitario === null ? (p.motivo || 'Sem preço na tabela') : null };
    }));
    setAlterado(true);
  };

  // Reprecifica automaticamente quando muda o que afeta o preço
  const chavePreco = `${cab.empresa_id}|${cliente?.id || ''}|${evento?.id || ''}|${cab.data_inicio}|${cab.modalidade}|${diasCobrados}`;
  const ultimaChavePreco = useRef<string | null>(null);
  useEffect(() => {
    if (carregando || !editavel) return;
    if (ultimaChavePreco.current === null) { ultimaChavePreco.current = chavePreco; return; }
    if (ultimaChavePreco.current === chavePreco) return;
    ultimaChavePreco.current = chavePreco;
    const t = setTimeout(() => { precificar(itens, true); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chavePreco, carregando]);

  // ---------------- itens ----------------
  const adicionarProduto = (o: OpcaoBusca) => {
    const p = o.extra as any;
    const novo: ItemUI = {
      chave: novaChave(), id: null, tipo: p.eh_kit ? 'KIT' : 'EQUIPAMENTO', produto_id: p.id, produto_codigo: p.codigo_formatado, unidade: p.unidade,
      controle: p.controle_locacao, descricao: p.nome_item, quantidade: '1', dias: '', valor_unitario: '', desconto: '',
      origem: null, preco_manual: false, semPreco: null, observacoes: '',
      led: p.led || null, led_largura: '', led_altura: '',
    };
    setItens(prev => [...prev, novo]);
    setAlterado(true);
    setDisp(null);
    precificar([novo], true);
  };

  const adicionarLivre = (tipo: TipoItem) => {
    setItens(prev => [...prev, {
      chave: novaChave(), id: null, tipo, produto_id: null, produto_codigo: null, unidade: null, controle: null,
      descricao: tipo === 'FRETE' ? 'Frete' : tipo === 'SERVICO' ? 'Montagem e operação técnica' : '', quantidade: '1', dias: '',
      valor_unitario: '', desconto: '', origem: null, preco_manual: true, semPreco: null, observacoes: '',
      led: null, led_largura: '', led_altura: '',
    }]);
    setAlterado(true);
  };

  const mudarItem = (chave: string, parcial: Partial<ItemUI>, reprecificar = false) => {
    const atual = itens.find(i => i.chave === chave);
    setItens(prev => prev.map(i => (i.chave === chave ? { ...i, ...parcial } : i)));
    setAlterado(true);
    if ('quantidade' in parcial || 'dias' in parcial) setDisp(null);
    if (reprecificar && atual) precificar([{ ...atual, ...parcial }], true);
  };

  // painel de LED: largura × altura (m) → gabinetes inteiros → quantidade = m² real
  const mudarMedidaLed = (i: ItemUI, parcial: { led_largura?: string; led_altura?: string }) => {
    const prox = { ...i, ...parcial };
    const m = prox.led ? calcularLed(prox.led, lerValor(prox.led_largura) || 0, lerValor(prox.led_altura) || 0) : null;
    mudarItem(i.chave, { ...parcial, ...(m ? { quantidade: mostrarQtd(m.m2) } : {}) });
  };

  const removerItem = (chave: string) => { setItens(prev => prev.filter(i => i.chave !== chave)); setAlterado(true); setDisp(null); };
  // move dentro da própria seção (Equipamentos ou Serviços / Extras)
  const moverItem = (chave: string, dir: -1 | 1) => {
    setItens(prev => {
      const idx = prev.findIndex(i => i.chave === chave);
      if (idx < 0) return prev;
      const sec = secaoItem(prev[idx]);
      let alvo = idx + dir;
      while (alvo >= 0 && alvo < prev.length && secaoItem(prev[alvo]) !== sec) alvo += dir;
      if (alvo < 0 || alvo >= prev.length) return prev;
      const c = [...prev]; [c[idx], c[alvo]] = [c[alvo], c[idx]]; return c;
    });
    setAlterado(true);
  };

  // ---------------- totais ----------------
  const totalItem = (i: ItemUI) => {
    const q = lerValor(i.quantidade) || 0, vu = lerValor(i.valor_unitario) || 0, d = lerValor(i.desconto) || 0;
    return [q, vu, d].some(Number.isNaN) ? 0 : Math.round((q * vu - d) * 100) / 100;
  };
  const ehEquip = (t: TipoItem) => t === 'EQUIPAMENTO' || t === 'KIT';
  const totEquip = itens.filter(i => ehEquip(i.tipo)).reduce((s, i) => s + totalItem(i), 0);
  const totServ = itens.filter(i => !ehEquip(i.tipo)).reduce((s, i) => s + totalItem(i), 0);
  const descontoGeral = lerValor(cab.desconto) || 0;
  const totalGeral = totEquip + totServ - (Number.isNaN(descontoGeral) ? 0 : descontoGeral);

  // ---------------- disponibilidade ----------------
  const datasAtuais = () => ({
    data_saida: cab.data_saida || null, data_montagem: cab.data_montagem || null, data_inicio: cab.data_inicio, data_fim: cab.data_fim,
    data_desmontagem: cab.data_desmontagem || null, data_retorno: cab.data_retorno || null,
  });

  const podeSublocarOs = !ehNova && !!fichaIdUrl && !doP2s && !!acesso?.podeEditar && ['ORCAMENTO', 'ENVIADO', 'APROVADO', 'RESERVADA', 'EM_LOCACAO'].includes(status);
  const abrirSublocarFaltas = () => {
    const faltas = (disp?.linhas || []).filter(l => l.falta > 0);
    if (!faltas.length || !fichaIdUrl) return;
    setSublocar({
      empresa_id: cab.empresa_id, ficha_reserva_id: fichaIdUrl, osRotulo: `${numeroFicha(fichaIdUrl)} — ${cliente?.nome || ''}`,
      data_retirada: faltas.map(l => l.periodo.inicio).sort()[0], data_devolucao: faltas.map(l => l.periodo.fim).sort().reverse()[0],
      itens: faltas.map(l => ({ produto_id: l.produto_id, nome: l.nome, codigo: l.codigo, quantidade: String(l.falta).replace('.', ','), valor_unitario: '' })),
    });
  };
  const abrirSublocarAvulsa = () => {
    if (!fichaIdUrl) return;
    setSublocar({ empresa_id: cab.empresa_id, ficha_reserva_id: fichaIdUrl, osRotulo: `${numeroFicha(fichaIdUrl)} — ${cliente?.nome || ''}`, data_retirada: cab.data_saida || cab.data_montagem || cab.data_inicio, data_devolucao: cab.data_retorno || cab.data_desmontagem || cab.data_fim, itens: [] });
  };

  const verificar = async () => {
    const demanda = itens.filter(i => ehEquip(i.tipo) && i.produto_id).map(i => ({ produto_id: i.produto_id!, quantidade: lerValor(i.quantidade) || 0 }));
    if (!demanda.length) return toast('Adicione equipamentos para verificar.', 'info');
    setVerificando(true);
    const r = await verificarDisponibilidadeFichaAction({ ficha_id: fichaIdUrl, empresa_id: cab.empresa_id, datas: datasAtuais(), itens: demanda }, accessToken);
    setVerificando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao verificar.', 'error');
    setDisp(r.info);
    toast(r.info.temFalta ? 'Há falta de equipamento no período.' : 'Tudo disponível no período.', r.info.temFalta ? 'error' : 'success');
  };

  // ---------------- salvar ----------------
  const montarDados = (): DadosFicha | string => {
    if (!cliente) return 'Escolha o cliente.';
    if (!dataValida(cab.data_inicio) || !dataValida(cab.data_fim)) return 'Informe o início e o fim do evento.';
    const desc = lerValor(cab.desconto);
    if (Number.isNaN(desc)) return 'Desconto geral inválido.';
    const itensOut = [];
    for (const i of [...itens.filter(x => secaoItem(x) === 'EQUIP'), ...itens.filter(x => secaoItem(x) === 'SERV')]) {
      const q = lerValor(i.quantidade), vu = lerValor(i.valor_unitario), d = lerValor(i.desconto);
      if (q === null || Number.isNaN(q) || q <= 0) return `Quantidade inválida em "${i.descricao || ROTULO_TIPO[i.tipo]}".`;
      if (Number.isNaN(vu) || Number.isNaN(d)) return `Valor inválido em "${i.descricao || ROTULO_TIPO[i.tipo]}".`;
      if (!i.descricao.trim()) return 'Há item sem descrição.';
      itensOut.push({
        id: i.id, tipo: i.tipo, produto_id: i.produto_id, descricao: i.descricao, quantidade: q, dias: ehEquip(i.tipo) ? diasDoItem(i) : (Number(i.dias) || null),
        valor_unitario: vu || 0, desconto_valor: d || 0, origem_preco: i.preco_manual ? (i.origem ? { ...i.origem, sugerido: true } : null) : i.origem,
        preco_manual: i.preco_manual, observacoes: i.observacoes || null,
        led_largura_m: i.led ? lerValor(i.led_largura) : null, led_altura_m: i.led ? lerValor(i.led_altura) : null,
      });
    }
    return {
      id: fichaIdUrl, empresa_id: cab.empresa_id, modalidade: cab.modalidade, parceiro_id: Number(cliente.id),
      contato_nome: cab.contato_nome, contato_telefone: cab.contato_telefone, contato_email: cab.contato_email,
      evento_id: evento ? String(evento.id) : null, tabela_preco_id: tabelas[0]?.id || fichaInfo?.tabela_preco_id || null,
      vendedor_id: cab.vendedor_id, vendedor_nome: cab.vendedor_nome, local_entrega: cab.local_entrega, endereco_estande: cab.endereco_estande,
      ...datasAtuais(), dias_cobrados: diasCobrados, validade_orcamento: cab.validade_orcamento || null,
      condicao_pagamento: cab.condicao_pagamento, forma_pagamento: cab.forma_pagamento || null, observacoes: cab.observacoes, observacoes_internas: cab.observacoes_internas,
      desconto_valor: desc || 0, itens: itensOut,
    };
  };

  const salvar = async (): Promise<number | null> => {
    const dados = montarDados();
    if (typeof dados === 'string') { toast(dados, 'error'); return null; }
    setSalvando(true);
    const r = await salvarFichaAction(dados, accessToken);
    setSalvando(false);
    if (!r.ok) {
      toast(r.erro || 'Erro ao salvar.', 'error');
      if (r.info?.faltas) setDisp({ linhas: r.info.faltas, temFalta: true });
      return null;
    }
    toast(ehNova ? 'Orçamento criado.' : 'Ficha salva.', 'success');
    if (r.info.aviso) toast(r.info.aviso, 'error');
    setAlterado(false);
    if (ehNova) { router.replace(`${ROTA}/${r.info.id}`); return r.info.id; }
    const rec = await carregarFichaAction(r.info.id, accessToken);
    if (rec.ok) aplicarFicha(rec.info);
    return r.info.id;
  };

  // ---------------- status ----------------
  const executar = async (acao: AcaoStatus) => {
    if (!fichaIdUrl) return;
    let motivo: string | null = null;
    if (acao === 'PERDER' || acao === 'CANCELAR') {
      motivo = await pedir({ title: acao === 'PERDER' ? 'Orçamento perdido' : 'Cancelar ficha', message: acao === 'PERDER' ? 'Por que o orçamento foi perdido? (preço, prazo, falta de equipamento, cliente desistiu…)' : 'Motivo do cancelamento:', placeholder: 'Motivo' });
      if (motivo === null) return;
      if (!motivo.trim()) return toast('Informe o motivo.', 'error');
    } else if (acao === 'RESERVAR') {
      if (!(await confirmar({ title: 'Aprovar e reservar', confirmLabel: 'Reservar', message: 'O cliente aprovou? Os equipamentos serão reservados para o período (incluindo dias de preparo e retorno). Se faltar algo, nada é reservado e a lista de faltas aparece.' }))) return;
    } else if (acao === 'DESFAZER_RESERVA') {
      if (!(await confirmar({ title: 'Desfazer reserva', danger: true, confirmLabel: 'Desfazer', message: 'Os equipamentos voltam a ficar livres e a ficha volta para "Enviado".' }))) return;
    }
    if (alterado) {
      const ok = await confirmar({ title: 'Salvar antes', confirmLabel: 'Salvar e continuar', message: 'Há alterações não salvas. Salvar a ficha antes de continuar?' });
      if (!ok) return;
      const id = await salvar();
      if (!id) return;
    }
    setSalvando(true);
    const r = await mudarStatusFichaAction(fichaIdUrl, acao, motivo, accessToken);
    setSalvando(false);
    if (!r.ok) {
      toast(r.erro || 'Erro.', 'error');
      if (r.info?.faltas?.length) setDisp({ linhas: r.info.faltas, temFalta: true });
      return;
    }
    toast(`Ficha: ${STATUS_FICHA[r.info.status as StatusFicha]?.rotulo || r.info.status}.`, 'success');
    const rec = await carregarFichaAction(fichaIdUrl, accessToken);
    if (rec.ok) aplicarFicha(rec.info);
  };

  const duplicar = async () => {
    if (!fichaIdUrl) return;
    if (!(await confirmar({ title: 'Duplicar ficha', confirmLabel: 'Duplicar', message: 'Cria um orçamento novo com os mesmos dados e itens (sem reserva).' }))) return;
    const r = await duplicarFichaAction(fichaIdUrl, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro ao duplicar.', 'error');
    toast('Orçamento duplicado.', 'success');
    router.push(`${ROTA}/${r.info.id}`);
  };

  const aprovarDesconto = async () => {
    if (!fichaIdUrl) return;
    if (!(await confirmar({ title: 'Aprovar desconto', confirmLabel: 'Aprovar', message: `Aprovar o desconto de ${Number(fichaInfo?.desconto_pct || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% sobre a tabela? Depois disso a ficha pode ser enviada e reservada.` }))) return;
    setSalvando(true);
    const r = await aprovarDescontoFichaAction(fichaIdUrl, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao aprovar.', 'error');
    toast('Desconto aprovado.', 'success');
    const rec = await carregarFichaAction(fichaIdUrl, accessToken);
    if (rec.ok) aplicarFicha(rec.info);
  };

  const excluir = async () => {
    if (!fichaIdUrl) return;
    if (!(await confirmar({ title: 'Excluir ficha', danger: true, confirmLabel: 'Excluir', message: 'Apaga a ficha de vez (itens, histórico e propostas canceladas). Não dá para desfazer. Se ela teve movimento, prefira Cancelar.' }))) return;
    setSalvando(true);
    const r = await excluirFichaAction(fichaIdUrl, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao excluir.', 'error');
    toast('Ficha excluída.', 'success');
    setAlterado(false);
    router.push(ROTA);
  };

  const voltar = async () => {
    if (alterado && !(await confirmar({ title: 'Sair sem salvar', danger: true, confirmLabel: 'Sair', message: 'Há alterações não salvas. Sair mesmo assim?' }))) return;
    router.push(ROTA);
  };

  // reservas por item (peças)
  const alocPorItem = useMemo(() => {
    const m = new Map<number, { qtd: number; pecas: string[] }>();
    for (const a of alocacoes) {
      if (!a.ficha_item_id) continue;
      const x = m.get(a.ficha_item_id) || { qtd: 0, pecas: [] };
      x.qtd += Number(a.quantidade) || 0;
      if (a.patrimonio) x.pecas.push(a.patrimonio);
      m.set(a.ficha_item_id, x);
    }
    return m;
  }, [alocacoes]);
  const faltaPorProduto = useMemo(() => new Map((disp?.linhas || []).map(l => [l.produto_id, l])), [disp]);

  // ============================================================================
  if (authLoading || (carregando && !acessoNegado && !erro)) {
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Orçamentos e Reservas.</p>
          <button onClick={() => router.push('/admin/locacoes')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar ao Hub</button>
        </div>
      </div>
    );
  }
  if (!ehNova && !fichaInfo) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full">
          <p className="text-sm text-gray-500 mb-6">Ficha não encontrada ou sem acesso.</p>
          <button onClick={() => router.push(ROTA)} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full">Voltar</button>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699] disabled:bg-[#F8FAFC] disabled:text-gray-500';
  const labelCls = 'block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1';
  const cardCls = 'bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6';
  const btn = 'px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider disabled:opacity-40';

  // itens divididos em Equipamentos e Serviços / Extras
  const itensEquip = itens.filter(i => secaoItem(i) === 'EQUIP');
  const itensServ = itens.filter(i => secaoItem(i) === 'SERV');
  const linhaItem = (i: ItemUI, idx: number, total: number) => {
    const equip = ehEquip(i.tipo);
    const linhaDisp = i.produto_id ? faltaPorProduto.get(i.produto_id) : undefined;
    const res = i.id ? alocPorItem.get(i.id) : undefined;
    return (
        <tr key={i.chave} className="border-b border-[#F1F5F9] align-top">
          <td className="p-2 whitespace-nowrap">
            {editavel && (
              <span className="flex flex-col text-gray-300">
                <button onClick={() => moverItem(i.chave, -1)} disabled={idx === 0} className="hover:text-gray-600 disabled:opacity-30 leading-none">▲</button>
                <button onClick={() => moverItem(i.chave, 1)} disabled={idx === total - 1} className="hover:text-gray-600 disabled:opacity-30 leading-none">▼</button>
              </span>
            )}
          </td>
          <td className="p-2 min-w-[260px]">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${equip ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{ROTULO_TIPO[i.tipo]}</span>
              {i.controle === 'INDIVIDUAL' && <span className="text-[8px] font-black px-1.5 py-0.5 rounded uppercase bg-slate-100 text-slate-600">patrimônio</span>}
              {i.produto_codigo && <span className="text-[10px] text-gray-400">{i.produto_codigo}{i.unidade ? ` · ${i.unidade}` : ''}</span>}
            </div>
            {equip ? (
              <p className="font-bold text-[#0C1D4D]">{i.descricao}</p>
            ) : (
              <input value={i.descricao} onChange={e => mudarItem(i.chave, { descricao: e.target.value })} disabled={!editavel} placeholder="Descrição"
                className="w-full border border-[#E2E8F0] rounded px-2 py-1 font-bold text-[#0C1D4D] disabled:bg-transparent disabled:border-transparent" />
            )}
            {equip && i.origem && !i.preco_manual && <p className="text-[10px] text-gray-400 mt-0.5">{descreverOrigem(i.origem)}</p>}
            {equip && i.preco_manual && <p className="text-[10px] text-amber-600 font-bold mt-0.5">preço manual{i.origem ? ` · tabela: ${descreverOrigem(i.origem)}` : ''}</p>}
            {equip && i.semPreco && !i.preco_manual && <p className="text-[10px] text-red-500 font-bold mt-0.5">⚠ {i.semPreco} — informe o valor</p>}
            {linhaDisp && (
              <p className={`text-[10px] font-bold mt-0.5 ${linhaDisp.falta > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {linhaDisp.falta > 0 ? `✖ faltam ${mostrarQtd(linhaDisp.falta)} (disponível ${mostrarQtd(linhaDisp.disponivel)} de ${mostrarQtd(linhaDisp.capacidade)})` : `✔ disponível (${mostrarQtd(linhaDisp.disponivel)} livres)`}
              </p>
            )}
            {res && <p className="text-[10px] text-emerald-700 mt-0.5">Reservado: {res.pecas.length ? res.pecas.join(', ') : mostrarQtd(res.qtd)}</p>}
            {i.led && (() => {
              const m = calcularLed(i.led, lerValor(i.led_largura) || 0, lerValor(i.led_altura) || 0);
              return (
                <div className="mt-1.5 bg-blue-50/60 border border-blue-100 rounded-lg p-2">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-[#0C1D4D]">
                    Painel:
                    <input value={i.led_largura} onChange={e => mudarMedidaLed(i, { led_largura: e.target.value })} disabled={!editavel} placeholder="larg." inputMode="decimal" className="w-14 border border-[#CBD5E1] rounded px-1.5 py-0.5 text-right disabled:bg-transparent" />
                    m ×
                    <input value={i.led_altura} onChange={e => mudarMedidaLed(i, { led_altura: e.target.value })} disabled={!editavel} placeholder="alt." inputMode="decimal" className="w-14 border border-[#CBD5E1] rounded px-1.5 py-0.5 text-right disabled:bg-transparent" />
                    m
                  </div>
                  {m ? (
                    <div className="flex flex-col md:flex-row gap-3 mt-1.5 items-start">
                      <GradeLed colunas={m.colunas} linhas={m.linhas} />
                      <div>
                        <p className="text-[10px] text-blue-800">{resumoLed(m)}</p>
                        {i.led.padrao && <p className="text-[10px] text-amber-700 mt-1">Ficha técnica padrão (gabinete 50 × 50 cm{i.led.pitch_mm ? `, P${String(i.led.pitch_mm).replace('.', ',')}` : ''}). Cadastre o painel em Estoque → Equipamentos para peso, consumo e medidas exatas.</p>}
                      </div>
                    </div>
                  ) : <p className="text-[10px] text-gray-400 mt-1">Informe largura × altura: o sistema monta o grid de gabinetes, a quantidade vira os m² e a proposta traz a ficha técnica.</p>}
                </div>
              );
            })()}
          </td>
          <td className="p-1"><input value={i.quantidade} onChange={e => mudarItem(i.chave, { quantidade: e.target.value })} disabled={!editavel} inputMode="decimal" className="w-full border border-[#E2E8F0] rounded px-2 py-1 text-right disabled:bg-transparent disabled:border-transparent" /></td>
          <td className="p-1">
            {equip ? (
              <input value={i.dias} onChange={e => mudarItem(i.chave, { dias: e.target.value.replace(/\D/g, '') }, true)} disabled={!editavel} placeholder={String(diasCobrados)}
                className="w-full border border-[#E2E8F0] rounded px-2 py-1 text-right disabled:bg-transparent disabled:border-transparent" />
            ) : <span className="block text-right text-gray-300 px-2 py-1">—</span>}
          </td>
          <td className="p-1">
            <div className="flex items-center gap-1">
              <input value={i.valor_unitario} onChange={e => mudarItem(i.chave, { valor_unitario: e.target.value, preco_manual: true })} disabled={!editavel} inputMode="decimal"
                className={`w-full border rounded px-2 py-1 text-right disabled:bg-transparent disabled:border-transparent ${i.preco_manual && equip ? 'border-amber-300 bg-amber-50' : 'border-[#E2E8F0]'}`} />
              {equip && i.preco_manual && editavel && (
                <button onClick={() => mudarItem(i.chave, { preco_manual: false }, true)} title="Voltar ao preço da tabela" className="text-[#336699] font-bold text-sm">↺</button>
              )}
            </div>
          </td>
          <td className="p-1"><input value={i.desconto} onChange={e => mudarItem(i.chave, { desconto: e.target.value })} disabled={!editavel} inputMode="decimal" placeholder="—" className="w-full border border-[#E2E8F0] rounded px-2 py-1 text-right disabled:bg-transparent disabled:border-transparent" /></td>
          <td className="p-2 text-right font-black text-[#0C1D4D] whitespace-nowrap">{formatarMoeda(totalItem(i))}</td>
          <td className="p-2">{editavel && <button onClick={() => removerItem(i.chave)} title="Remover" className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>}</td>
        </tr>
    );
  };
  const tabelaItens = (lista: ItemUI[], vazio: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
            <th className="p-2 w-14"></th>
            <th className="p-2">Item</th>
            <th className="p-2 text-right w-20">Qtd</th>
            <th className="p-2 text-right w-16">Dias</th>
            <th className="p-2 text-right w-32">Valor unit.<span className="block text-[8px] normal-case text-gray-400">período todo</span></th>
            <th className="p-2 text-right w-24">Desconto</th>
            <th className="p-2 text-right w-28">Total</th>
            <th className="p-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-gray-400">{vazio}</td></tr>}
          {lista.map((i, idx) => linhaItem(i, idx, lista.length))}
        </tbody>
      </table>
    </div>
  );

  const botoesStatus: { acao: AcaoStatus; rotulo: string; cls: string }[] = [];
  if (!ehNova && !doP2s && acesso) {
    if (status === 'ORCAMENTO') botoesStatus.push({ acao: 'ENVIAR', rotulo: 'Marcar como enviado', cls: 'bg-white border border-[#336699] text-[#336699]' });
    if (['ORCAMENTO', 'ENVIADO', 'APROVADO'].includes(status)) botoesStatus.push({ acao: 'RESERVAR', rotulo: '✔ Aprovar e reservar', cls: 'bg-emerald-600 hover:bg-emerald-700 text-white' });
    if (['ENVIADO', 'APROVADO'].includes(status)) botoesStatus.push({ acao: 'VOLTAR_ORCAMENTO', rotulo: 'Voltar a orçamento', cls: 'bg-white border border-[#CBD5E1] text-gray-600' });
    if (status === 'RESERVADA') botoesStatus.push({ acao: 'DESFAZER_RESERVA', rotulo: 'Desfazer reserva', cls: 'bg-white border border-amber-300 text-amber-700' });
    if (['ORCAMENTO', 'ENVIADO', 'APROVADO'].includes(status)) botoesStatus.push({ acao: 'PERDER', rotulo: 'Perdido', cls: 'bg-white border border-red-200 text-red-600' });
    if (EDITAVEIS.includes(status)) botoesStatus.push({ acao: 'CANCELAR', rotulo: 'Cancelar', cls: 'bg-white border border-red-200 text-red-600' });
    if (['PERDIDO', 'CANCELADA'].includes(status)) botoesStatus.push({ acao: 'REABRIR', rotulo: 'Reabrir', cls: 'bg-white border border-[#336699] text-[#336699]' });
  }
  // permissões do usuário: perder/cancelar = excluir; o resto = editar
  const botoesPermitidos = botoesStatus.filter(b => (b.acao === 'PERDER' || b.acao === 'CANCELAR') ? acesso?.podeExcluir : acesso?.podeEditar);
  const podeExcluirFicha = !ehNova && !doP2s && !!acesso?.podeExcluir && ['ORCAMENTO', 'ENVIADO', 'PERDIDO', 'CANCELADA'].includes(status);

  // estimativa do desconto sobre a tabela (o servidor recalcula ao salvar)
  const referenciaTabela = itens.reduce((s, i) => {
    const q = lerValor(i.quantidade) || 0, vu = lerValor(i.valor_unitario) || 0;
    if ([q, vu].some(Number.isNaN)) return s;
    const ref = ehEquip(i.tipo) && i.origem?.valor_tabela !== undefined ? i.origem.valor_tabela : vu;
    return s + q * ref;
  }, 0);
  const descontoEstimadoPct = referenciaTabela > 0.009 ? Math.max(0, ((referenciaTabela - totalGeral) / referenciaTabela) * 100) : 0;
  const passaLimite = !!acesso && !acesso.podeAprovarDesconto && descontoEstimadoPct > acesso.descontoMaxPct + 0.005;

  // comissão prevista do vendedor da ficha (regra: tabela/prazo padrão = cheia; faixas de desconto e de prazo)
  const regraVend = cab.vendedor_id ? regrasComissao[cab.vendedor_id] : undefined;
  const diasNaoCobrados = diasEvento ? Math.max(0, diasEvento - diasCobrados) : 0;
  const comissaoPrevista = regraVend ? pctLocacaoAplicada(regraVend, descontoEstimadoPct, diasNaoCobrados) : null;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">📝 <strong>Olá, {usuarioAtual}</strong>. {ehNova ? 'Novo orçamento de locação.' : 'Ficha de reserva.'}</p>
        <button onClick={voltar} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">⬅ VOLTAR À LISTA</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* ---------- topo ---------- */}
          <div className={cardCls}>
            <div className="flex flex-col lg:flex-row justify-between items-start gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-tight">{ehNova ? 'Novo orçamento' : doP2s ? `P2S ${fichaInfo.p2s_numero}` : numeroFicha(fichaIdUrl!)}</h1>
                  {doP2s && <span className="text-[10px] font-black px-2.5 py-1 rounded-full uppercase bg-orange-100 text-orange-700">importada do P2S · {rotuloStatusP2s(fichaInfo.p2s_status)}</span>}
                  <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase ${STATUS_FICHA[status]?.cls}`}>{STATUS_FICHA[status]?.rotulo}</span>
                  {alterado && <span className="text-[10px] font-black px-2.5 py-1 rounded-full uppercase bg-amber-100 text-amber-700">não salvo</span>}
                </div>
                {fichaInfo?.motivo_perda && <p className="text-xs text-red-600 mt-1">Motivo: {fichaInfo.motivo_perda}</p>}
                {fichaInfo?.aprovado_em && <p className="text-xs text-gray-500 mt-1">Aprovado em {new Date(fichaInfo.aprovado_em).toLocaleString('pt-BR')} por {fichaInfo.aprovado_por}</p>}
                {doP2s && <p className="text-xs text-orange-700 mt-1">Ficha do PrimeStart, importada só para leitura (o P2S segue oficial). Alterações são feitas lá e chegam na próxima importação{fichaInfo?.p2s_sincronizado_em ? ` — última: ${new Date(fichaInfo.p2s_sincronizado_em).toLocaleString('pt-BR')}` : ''}. Use Duplicar para simular uma cópia aqui.</p>}
                {!editavel && !doP2s && EDITAVEIS.includes(status) && !podeAlterar && <p className="text-xs text-gray-500 mt-1">Só leitura — seu usuário não pode alterar fichas.</p>}
                {!editavel && !doP2s && !EDITAVEIS.includes(status) && <p className="text-xs text-gray-500 mt-1">Ficha {STATUS_FICHA[status]?.rotulo.toLowerCase()} — só leitura{['PERDIDO', 'CANCELADA'].includes(status) ? ' (use Reabrir para editar)' : ''}.</p>}
                {descPendente && (
                  <p className="text-xs text-amber-700 font-bold mt-1">
                    ⏳ Desconto de {Number(fichaInfo?.desconto_pct || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% sobre a tabela aguardando aprovação — não dá para enviar a proposta nem reservar antes.
                  </p>
                )}
                {!descPendente && Number(fichaInfo?.desconto_pct) > 0 && fichaInfo?.desconto_aprovado_por && (
                  <p className="text-[10px] text-gray-500 mt-1">Desconto de {Number(fichaInfo.desconto_aprovado_pct).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% aprovado por {fichaInfo.desconto_aprovado_por}.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {descPendente && acesso?.podeAprovarDesconto && (
                  <button onClick={aprovarDesconto} disabled={salvando || alterado} title={alterado ? 'Salve antes de aprovar' : ''} className={`${btn} bg-amber-500 hover:bg-amber-600 text-white`}>✔ Aprovar desconto</button>
                )}
                {botoesPermitidos.map(b => (
                  <button key={b.acao} onClick={() => executar(b.acao)} disabled={salvando} className={`${btn} ${b.cls}`}>{b.rotulo}</button>
                ))}
                {!ehNova && acesso?.podeCriar && <button onClick={duplicar} disabled={salvando} className={`${btn} bg-white border border-[#CBD5E1] text-gray-600`}>Duplicar</button>}
                {podeExcluirFicha && <button onClick={excluir} disabled={salvando} className={`${btn} bg-white border border-red-300 text-red-700`}>Excluir</button>}
                {editavel && (
                  <button onClick={salvar} disabled={salvando || (!alterado && !ehNova)} className={`${btn} bg-[#0C1D4D] hover:bg-[#284B8C] text-white`}>
                    {salvando ? 'Salvando...' : ehNova ? 'Criar orçamento' : 'Salvar'}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* ---------- cliente / evento ---------- */}
            <div className={`${cardCls} lg:col-span-2 space-y-4`}>
              <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Cliente e evento</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between items-baseline gap-2">
                    <label className={labelCls}>Cliente *</label>
                    {editavel && <a href="/admin/comercial/parceiros?novo=1" target="_blank" rel="noopener" className="text-[10px] font-black uppercase text-[#336699] hover:underline">+ cadastrar cliente novo</a>}
                  </div>
                  <CampoBusca placeholder="Buscar cliente por nome, CNPJ ou CPF..." buscar={buscarClientes} valor={cliente} desabilitado={!editavel}
                    onEscolher={o => {
                      setCliente(o); setAlterado(true);
                      const ex = (o.extra || {}) as any;
                      setCarteira(ex.carteira_vendedor_id ? { vendedor_id: ex.carteira_vendedor_id, nome: ex.carteira_nome || '' } : null);
                      setCab(c => ({
                        ...c, contato_telefone: c.contato_telefone || ex.telefone || '', contato_email: c.contato_email || ex.email || '',
                        // gestão: o vendedor acompanha o dono da carteira do cliente
                        ...(acesso?.escopo === 'TODAS' && ex.carteira_vendedor_id ? { vendedor_id: ex.carteira_vendedor_id, vendedor_nome: ex.carteira_nome || c.vendedor_nome } : {}),
                      }));
                    }}
                    onLimpar={() => { setCliente(null); setCarteira(null); setAlterado(true); }} />
                  {cliente && (
                    <p className="text-[10px] mt-1 text-gray-500">
                      {carteira ? <>Carteira: <strong className="text-[#0C1D4D]">{carteira.nome}</strong></> : <span className="text-amber-600 font-bold">Cliente sem carteira — entra na carteira do vendedor da ficha ao salvar.</span>}
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Evento / Feira</label>
                  <CampoBusca placeholder="Buscar evento (opcional)..." buscar={buscarEventos} valor={evento} desabilitado={!editavel}
                    onEscolher={o => {
                      setEvento(o); setAlterado(true);
                      const ex = (o.extra || {}) as any;
                      setCab(c => ({
                        ...c, data_inicio: c.data_inicio || ex.data_inicial || '', data_fim: c.data_fim || ex.data_final || ex.data_inicial || '',
                        local_entrega: c.local_entrega || ex.local || '',
                      }));
                    }}
                    onLimpar={() => { setEvento(null); setAlterado(true); }} />
                </div>
                <div><label className={labelCls}>Contato</label><input value={cab.contato_nome} onChange={e => mudarCab({ contato_nome: e.target.value })} disabled={!editavel} className={inputCls} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={labelCls}>Telefone</label><input value={cab.contato_telefone} onChange={e => mudarCab({ contato_telefone: e.target.value })} disabled={!editavel} className={inputCls} /></div>
                  <div><label className={labelCls}>E-mail</label><input value={cab.contato_email} onChange={e => mudarCab({ contato_email: e.target.value })} disabled={!editavel} className={inputCls} /></div>
                </div>
                <div><label className={labelCls}>Local de entrega</label><input value={cab.local_entrega} onChange={e => mudarCab({ local_entrega: e.target.value })} disabled={!editavel} className={inputCls} /></div>
                <div><label className={labelCls}>Estande / endereço</label><input value={cab.endereco_estande} onChange={e => mudarCab({ endereco_estande: e.target.value })} disabled={!editavel} className={inputCls} /></div>
              </div>
            </div>

            {/* ---------- comercial ---------- */}
            <div className={`${cardCls} space-y-4`}>
              <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Comercial</h2>
              {empresas.length > 1 ? (
                <div>
                  <label className={labelCls}>Empresa</label>
                  <select value={cab.empresa_id} onChange={e => mudarCab({ empresa_id: Number(e.target.value) })} disabled={!editavel || status === 'RESERVADA'} className={inputCls}>
                    {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                </div>
              ) : (
                <span className={`inline-block text-[10px] font-black px-2.5 py-1 rounded-full uppercase ${corSeloEmpresa(cab.empresa_id)}`}>{empresas[0]?.nome}</span>
              )}
              <div>
                <label className={labelCls}>Modalidade</label>
                <select value={cab.modalidade} onChange={e => mudarCab({ modalidade: e.target.value as Modalidade })} disabled={!editavel} className={inputCls}>
                  {MODALIDADES.map(m => <option key={m.v} value={m.v}>{m.rotulo}</option>)}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">{MODALIDADES.find(m => m.v === cab.modalidade)?.desc}</p>
              </div>
              <div>
                <label className={labelCls}>Vendedor (comissão)</label>
                {acesso?.escopo === 'TODAS' ? (
                  <select value={cab.vendedor_id ?? ''} disabled={!editavel} className={inputCls}
                    onChange={e => { const id = e.target.value ? Number(e.target.value) : null; mudarCab({ vendedor_id: id, vendedor_nome: vendedores.find(v => v.id === id)?.nome || '' }); }}>
                    <option value="">— sem vendedor —</option>
                    {cab.vendedor_id && !vendedores.some(v => v.id === cab.vendedor_id) && <option value={cab.vendedor_id}>{cab.vendedor_nome} (inativo)</option>}
                    {vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
                  </select>
                ) : (
                  <input value={cab.vendedor_nome || acesso?.vendedorNome || ''} disabled className={inputCls} />
                )}
                {carteira && cab.vendedor_id && carteira.vendedor_id !== cab.vendedor_id && <p className="text-[10px] text-amber-600 font-bold mt-1">⚠ O cliente é da carteira de {carteira.nome}.</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={labelCls}>Validade</label><input type="date" value={cab.validade_orcamento} onChange={e => mudarCab({ validade_orcamento: e.target.value })} disabled={!editavel} className={inputCls} /></div>
                <div><label className={labelCls}>Pagamento</label><input value={cab.condicao_pagamento} onChange={e => mudarCab({ condicao_pagamento: e.target.value })} placeholder="Ex.: 14 dias após entrega" disabled={!editavel} className={inputCls} /></div>
              </div>
              <div>
                <label className={labelCls}>Forma de pagamento</label>
                <select value={cab.forma_pagamento} onChange={e => mudarCab({ forma_pagamento: e.target.value })} disabled={!editavel} className={inputCls}>
                  <option value="">—</option>
                  {FORMAS_PAGAMENTO.map(fp => <option key={fp} value={fp}>{ROTULO_FORMA_PAGAMENTO[fp]}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ---------- datas ---------- */}
          <div className={cardCls}>
            <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-4">Datas</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
              {([
                ['data_saida', 'Saída'], ['data_montagem', 'Montagem'], ['data_inicio', 'Início do evento *'], ['data_fim', 'Fim do evento *'],
                ['data_desmontagem', 'Desmontagem'], ['data_retorno', 'Retorno'],
              ] as [keyof Cabecalho, string][]).map(([k, rot]) => (
                <div key={k}>
                  <label className={labelCls}>{rot}</label>
                  <input type="date" value={cab[k] as string} onChange={e => mudarCab({ [k]: e.target.value } as Partial<Cabecalho>)} disabled={!editavel} className={inputCls} />
                </div>
              ))}
              <div>
                <label className={labelCls}>Dias cobrados</label>
                <div className="flex items-center gap-1">
                  <input value={cab.dias_cobrados} onChange={e => { setDiasManual(true); mudarCab({ dias_cobrados: e.target.value.replace(/\D/g, '') }); }} disabled={!editavel} className={inputCls} />
                  {diasManual && diasEvento && editavel && (
                    <button onClick={() => { setDiasManual(false); mudarCab({ dias_cobrados: String(diasEvento) }); }} title={`Voltar para ${diasEvento} dias do evento`} className="text-xs text-[#336699] font-bold px-1">↺</button>
                  )}
                </div>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">
              {diasEvento ? `Evento de ${diasEvento} dia(s).` : 'Informe início e fim do evento.'} O preço conta os dias cobrados; saída/montagem e desmontagem/retorno (mais os dias de preparo/retorno de cada equipamento) só prendem a agenda.
            </p>
          </div>

          {/* ---------- itens ---------- */}
          <div className={cardCls}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
              <div>
                <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Itens</h2>
                {tabelas.length > 0 && <p className="text-[10px] text-gray-500 mt-0.5">Tabelas aplicadas (prioridade): {tabelas.map(t => t.nome).join(' → ')}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => precificar(itens)} disabled={!editavel || precificando || !itens.some(i => ehEquip(i.tipo))} className={`${btn} bg-white border border-[#CBD5E1] text-[#0C1D4D]`}>{precificando ? 'Calculando...' : '↻ Recalcular preços'}</button>
                <button onClick={verificar} disabled={verificando || !itens.some(i => ehEquip(i.tipo))} className={`${btn} bg-white border border-[#336699] text-[#336699]`}>{verificando ? 'Verificando...' : '🔎 Verificar disponibilidade'}</button>
              </div>
            </div>

            {/* EQUIPAMENTOS */}
            <div className="flex justify-between items-center bg-[#0C1D4D] text-white rounded-lg px-3 py-2 mb-1">
              <span className="text-[11px] font-black uppercase tracking-wider">Equipamentos{itensEquip.length ? ` · ${itensEquip.length}` : ''}</span>
              <span className="text-xs font-black">{formatarMoeda(totEquip)}</span>
            </div>
            {tabelaItens(itensEquip, 'Nenhum equipamento ainda — busque abaixo.')}
            {editavel && (
              <div className="mt-2">
                <CampoBusca placeholder="+ Adicionar equipamento ou kit: buscar por nome, código ou categoria..." buscar={buscarProdutos} onEscolher={adicionarProduto} />
              </div>
            )}

            {/* SERVIÇOS / EXTRAS */}
            <div className="flex justify-between items-center bg-amber-600 text-white rounded-lg px-3 py-2 mb-1 mt-6">
              <span className="text-[11px] font-black uppercase tracking-wider">Serviços / Extras{itensServ.length ? ` · ${itensServ.length}` : ''}</span>
              <span className="text-xs font-black">{formatarMoeda(totServ)}</span>
            </div>
            {tabelaItens(itensServ, 'Nenhum serviço ou extra (montagem, operação, frete...).')}
            {editavel && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => adicionarLivre('SERVICO')} className={`${btn} bg-white border border-amber-300 text-amber-800`}>+ Serviço</button>
                <button onClick={() => adicionarLivre('FRETE')} className={`${btn} bg-white border border-amber-300 text-amber-800`}>+ Frete</button>
                <button onClick={() => adicionarLivre('OUTRO')} className={`${btn} bg-white border border-amber-300 text-amber-800`}>+ Outro</button>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <div className="w-full md:w-80 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Equipamentos</span><span className="font-bold">{formatarMoeda(totEquip)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Serviços / frete</span><span className="font-bold">{formatarMoeda(totServ)}</span></div>
                <div className="flex justify-between items-center gap-3">
                  <span className="text-gray-500">Desconto geral</span>
                  <input value={cab.desconto} onChange={e => mudarCab({ desconto: e.target.value })} disabled={!editavel} inputMode="decimal" placeholder="0,00"
                    className="w-28 border border-[#E2E8F0] rounded px-2 py-1 text-right disabled:bg-transparent disabled:border-transparent" />
                </div>
                <div className="flex justify-between border-t border-[#E2E8F0] pt-2 mt-2"><span className="font-black uppercase text-[#0C1D4D]">Total</span><span className="font-black text-xl text-[#0C1D4D]">{formatarMoeda(totalGeral)}</span></div>
                {descontoEstimadoPct > 0.005 && (
                  <div className={`flex justify-between text-[11px] ${passaLimite ? 'text-amber-700 font-bold' : 'text-gray-500'}`}>
                    <span>Desconto sobre a tabela{acesso && !acesso.podeAprovarDesconto ? ` (seu limite: ${acesso.descontoMaxPct.toLocaleString('pt-BR')}%)` : ''}</span>
                    <span>{descontoEstimadoPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span>
                  </div>
                )}
                {passaLimite && <p className="text-[10px] text-amber-700">Acima do seu limite: ao salvar, a ficha fica aguardando aprovação de desconto.</p>}
                {!doP2s && regraVend && comissaoPrevista && (
                  <div className={`mt-2 rounded-lg px-3 py-2 text-[11px] ${comissaoPrevista.pct < regraVend.pct_locacao - 0.0001 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
                    <p className="font-black uppercase text-[10px]">Comissão prevista{cab.vendedor_nome ? ` · ${cab.vendedor_nome}` : ''}</p>
                    <p>Locação <strong>{comissaoPrevista.pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</strong>{comissaoPrevista.pct < regraVend.pct_locacao - 0.0001 ? ` (cheia: ${regraVend.pct_locacao.toLocaleString('pt-BR')}%)` : ''} · serviços {regraVend.pct_servicos.toLocaleString('pt-BR')}%</p>
                    <p className="text-[10px] opacity-80">{comissaoPrevista.motivo}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ---------- disponibilidade ---------- */}
          {disp && (
            <div className={`${cardCls} ${disp.temFalta ? 'border-red-200' : 'border-emerald-200'}`}>
              <div className="flex justify-between items-center mb-3">
                <h2 className={`text-sm font-black uppercase tracking-wider ${disp.temFalta ? 'text-red-600' : 'text-emerald-700'}`}>{disp.temFalta ? '✖ Falta equipamento' : '✔ Tudo disponível'}</h2>
                <div className="flex items-center gap-3">
                  {disp.temFalta && podeSublocarOs && (
                    <button disabled={alterado} title={alterado ? 'Salve a ficha antes' : ''} onClick={abrirSublocarFaltas}
                      className="text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-lg bg-[#0C1D4D] text-white disabled:opacity-40">🤝 Sublocar o que falta</button>
                  )}
                  <button onClick={() => setDisp(null)} className="text-xs text-gray-400 font-bold">fechar</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                      <th className="p-2">Equipamento</th><th className="p-2">Período na agenda</th><th className="p-2 text-right">Precisa</th>
                      <th className="p-2 text-right">Estoque</th><th className="p-2 text-right">Já reservado</th><th className="p-2 text-right">Livre</th>{disp.linhas.some(l => (l.sublocado || 0) > 0) && <th className="p-2 text-right">Sublocado</th>}<th className="p-2 text-right">Falta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disp.linhas.map(l => (
                      <tr key={l.produto_id} className={`border-b border-[#F1F5F9] ${l.falta > 0 ? 'bg-red-50/60' : ''}`}>
                        <td className="p-2">
                          <p className="font-bold text-[#0C1D4D]">{l.nome}</p>
                          <p className="text-[10px] text-gray-400">{[l.codigo, l.controle === 'INDIVIDUAL' ? 'por patrimônio' : 'por quantidade', l.viaKits.length ? `via kit: ${l.viaKits.join(', ')}` : null].filter(Boolean).join(' · ')}</p>
                        </td>
                        <td className="p-2 whitespace-nowrap">{formatarDataBR(l.periodo.inicio)} a {formatarDataBR(l.periodo.fim)}</td>
                        <td className="p-2 text-right font-bold">{mostrarQtd(l.demanda)}</td>
                        <td className="p-2 text-right">{mostrarQtd(l.capacidade)}</td>
                        <td className="p-2 text-right">{mostrarQtd(l.ocupado)}</td>
                        <td className="p-2 text-right font-bold">{mostrarQtd(l.disponivel)}</td>
                        {disp.linhas.some(x => (x.sublocado || 0) > 0) && <td className="p-2 text-right text-blue-700 font-bold">{l.sublocado ? mostrarQtd(l.sublocado) : '—'}</td>}
                        <td className={`p-2 text-right font-black ${l.falta > 0 ? 'text-red-600' : 'text-gray-300'}`}>{l.falta > 0 ? mostrarQtd(l.falta) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-400 mt-3">"Já reservado" é o pico diário de outras fichas reservadas no mesmo período. Estoque: patrimônios ativos (itens por patrimônio) ou saldo menos manutenção (itens por quantidade) — ver Estoque → Equipamentos de Locação.</p>
            </div>
          )}

          {/* ---------- proposta (PDF + Autentique) ---------- */}
          {!ehNova && fichaIdUrl && !doP2s && (
            <PainelProposta
              fichaId={fichaIdUrl} accessToken={accessToken} status={status} alterado={alterado}
              contatoNome={cab.contato_nome} contatoTelefone={cab.contato_telefone} contatoEmail={cab.contato_email}
              clienteNome={cliente?.nome || ''}
              onMudou={async () => { const rec = await carregarFichaAction(fichaIdUrl, accessToken); if (rec.ok) aplicarFicha(rec.info); }}
            />
          )}

          {/* ---------- contrato (Autentique: cliente + locadora) ---------- */}
          {!ehNova && fichaIdUrl && !doP2s && (
            <PainelContrato
              fichaId={fichaIdUrl} accessToken={accessToken} status={status} alterado={alterado} podeEditar={!!acesso?.podeEditar}
              contatoNome={cab.contato_nome} contatoTelefone={cab.contato_telefone} contatoEmail={cab.contato_email}
              clienteNome={cliente?.nome || ''}
              onMudou={async () => { const rec = await carregarFichaAction(fichaIdUrl, accessToken); if (rec.ok) aplicarFicha(rec.info); }}
            />
          )}

          {/* ---------- ficha de locação (saída/devolução + OS assinada) ---------- */}
          {!ehNova && fichaIdUrl && !doP2s && (
            <PainelFichaLocacao fichaId={fichaIdUrl} accessToken={accessToken} status={status} alterado={alterado} podeEditar={!!acesso?.podeEditar}
              dataFim={cab.data_fim} onMudou={async () => { const rec = await carregarFichaAction(fichaIdUrl, accessToken); if (rec.ok) aplicarFicha(rec.info); }} />
          )}

          {/* ---------- sublocação (parceiros) ---------- */}
          {!ehNova && fichaIdUrl && !doP2s && (
            <PainelSublocacoes fichaId={fichaIdUrl} accessToken={accessToken} versao={versaoSub} podeSublocar={podeSublocarOs && !alterado} onSublocar={abrirSublocarAvulsa} />
          )}
          {sublocar && (
            <FormSublocacao aberto onClose={() => setSublocar(null)} accessToken={accessToken} inicial={sublocar} titulo="🤝 Sublocar com parceiro"
              onSalvo={(_, aviso) => {
                setSublocar(null); setVersaoSub(v => v + 1); setDisp(null);
                toast(aviso || (status === 'RESERVADA' || status === 'EM_LOCACAO' ? 'Sublocação salva — a reserva da OS foi refeita contando com o parceiro.' : 'Sublocação salva. Confirmada pelo parceiro, é só clicar em Reservar.'), aviso ? 'info' : 'success');
              }} />
          )}

          {/* ---------- faturamento (títulos a receber) ---------- */}
          {!ehNova && fichaIdUrl && !doP2s && (
            <PainelTitulos fichaId={fichaIdUrl} accessToken={accessToken} statusFicha={status} alterado={alterado} condicao={cab.condicao_pagamento} />
          )}

          {/* ---------- observações ---------- */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className={cardCls}>
              <label className={labelCls}>Observações para o cliente</label>
              <textarea value={cab.observacoes} onChange={e => mudarCab({ observacoes: e.target.value })} disabled={!editavel} rows={4} className={inputCls} placeholder="Aparecem na proposta." />
            </div>
            <div className={cardCls}>
              <label className={labelCls}>Observações internas</label>
              <textarea value={cab.observacoes_internas} onChange={e => mudarCab({ observacoes_internas: e.target.value })} disabled={!editavel} rows={4} className={inputCls} placeholder="Só a equipe vê." />
            </div>
          </div>

          {/* ---------- histórico ---------- */}
          {historico.length > 0 && (
            <div className={cardCls}>
              <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Histórico</h2>
              <ul className="space-y-2">
                {historico.map(h => (
                  <li key={h.id} className="text-xs flex gap-3">
                    <span className="text-gray-400 whitespace-nowrap">{new Date(h.criado_em).toLocaleString('pt-BR')}</span>
                    <span><strong className="text-[#0C1D4D]">{h.usuario}</strong> — {h.detalhe || h.acao}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
