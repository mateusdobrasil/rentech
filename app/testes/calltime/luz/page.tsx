"use client";

// ============================================================================
// CALL TIME — Fase 4: o grid de luz
//
// Irmã da tela do LED em /testes/calltime/video: mesmo relógio, mesma vistoria,
// mesmo placar. O que muda é o ofício — aqui o inimigo é o endereço DMX, e a
// régua de segurança é o cabo de aço, que reprova a partida quando falta.
//
// Toda a regra vive em app/jogo/luz/motor.ts — esta tela é só interação.
// ============================================================================

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import BackButton from '../../BackButton';
import { useSom } from '../../useSom';
import { CORES_CIRCUITO, CORES_UNIVERSO } from '../../../jogo/cores';
import {
  lerRanking, gravarMarca, entraNoRanking, posicaoDe as posicaoNoRanking,
  limparApelido, APELIDO_MAX,
} from '../../../jogo/ranking';
import {
  APLICACOES,
  ATRASO_TOLERADO,
  CANAIS_POR_UNIVERSO,
  CUSTO,
  CUSTO_CONSULTA_OS,
  ENERGIA,
  MULT_NO_AR,
  PECAS,
  PECAS_POR_LINHA,
  POSICOES_MAX,
  TALHAS_KG,
  VARAS,
  aplicarImprevisto,
  cargaPorPonto,
  caboAcoEm,
  conferirLeitura,
  contaOS,
  contarPeca,
  criarPartida,
  custoFechamento,
  custoPendurar,
  deveDispararImprevisto,
  finalizar,
  fmtKw,
  folga,
  icar as icarGrid,
  indice,
  janelaDe,
  licaoDmx,
  licaoEnergia,
  limparAtribuicaoEm,
  atribuirEm,
  pecasDoImprevisto,
  pecasPenduradas,
  pendurarEm,
  podeRecolherCircuito,
  podeRecolherUniverso,
  pontuar,
  posicaoDe,
  puxarCircuito,
  puxarUniverso,
  recolherCircuito,
  recolherUniverso,
  relogio,
  removerEm,
  respostaOS,
  talhaRecomendada,
  varaDe,
  vistoriar,
  type BriefingLuz,
  type ConferenciaOS,
  type EstadoLuz,
  type Problema,
  type TipoPeca,
} from '../../../jogo/luz/motor';

type Camada = 'grid' | 'dmx' | 'energia';
type Vista = 'palco' | 'planta';
type Fase = 'os' | 'jogando' | 'vistoria' | 'placar';
type Toast = { id: number; texto: string; tom: 'custo' | 'penal' | 'ok' };

const Grid3D = dynamic(() => import('../../../jogo/luz/Grid3D'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <span className="text-[10px] font-black uppercase tracking-widest text-white/30">Montando o galpão…</span>
    </div>
  ),
});

const OCIO_MS = 120_000;
const BEAT_ABERTURA_MS = 2_600;
const BEAT_PROBLEMA_MS = 3_800;
/** Passagem limpa na luz: um ciclo inteiro da cena, com o botão de pular à mão. */
const BEAT_LIMPO_MS = 20_000;

/** Posições entre duas garras da MESMA vara: o traço não pula de vara. */
function posicoesDoTraco(a: number, b: number): number[] {
  if (varaDe(a) !== varaDe(b)) return [a];
  const vara = varaDe(a);
  const p0 = Math.min(posicaoDe(a), posicaoDe(b));
  const p1 = Math.max(posicaoDe(a), posicaoDe(b));
  const fora: number[] = [];
  for (let p = p0; p <= p1; p++) fora.push(indice(vara, p));
  return fora;
}

// O sorteio da obra usa Math.random: renderizar no servidor daria uma obra no
// servidor e outra no navegador. Então o jogo só aparece depois de montar.
const assinarNada = () => () => {};
const noNavegador = () => true;
const noServidor = () => false;

export default function CallTimeLuz() {
  const montadoNoCliente = useSyncExternalStore(assinarNada, noNavegador, noServidor);
  const [estado, setEstado] = useState<EstadoLuz>(criarPartida);
  const [fase, setFase] = useState<Fase>('os');
  const [camada, setCamada] = useState<Camada>('grid');
  // Começa na planta: é nela que se trabalha. O palco entra no fechamento,
  // quando a câmera assume e mostra o que a montagem virou.
  const [vista, setVista] = useState<Vista>('planta');
  const [ferramenta, setFerramenta] = useState<string>('moving');
  const [selecao, setSelecao] = useState<{ a: number; b: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [imprevisto, setImprevisto] = useState(false);
  const [passo, setPasso] = useState(-1);
  const [apelido, setApelido] = useState('');
  const [gravado, setGravado] = useState(false);
  const [osCanais, setOsCanais] = useState('');
  const [osUniversos, setOsUniversos] = useState('');
  const [conferencia, setConferencia] = useState<ConferenciaOS | null>(null);

  const ancora = useRef<number | null>(null);
  const selecaoRef = useRef<{ a: number; b: number } | null>(null);
  const toastId = useRef(0);
  const { iniciar, tocar } = useSom();

  const janela = janelaDe(estado);
  const emJogo = fase === 'jogando' || fase === 'os';

  // --- feedback -------------------------------------------------------------
  const toast = useCallback((texto: string, tom: Toast['tom'] = 'custo') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, texto, tom }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  /** Toda mudança passa por aqui, e é aqui que o cliente liga pedindo mais. */
  const aplicar = useCallback((fn: (e: EstadoLuz) => EstadoLuz) => {
    setEstado((anterior) => {
      const proximo = fn(anterior);
      if (deveDispararImprevisto(proximo)) {
        setImprevisto(true);
        return aplicarImprevisto(proximo);
      }
      return proximo;
    });
  }, []);

  // --- pintura na grade -----------------------------------------------------
  const universosPuxados = estado.universosPuxados;
  const circuitosPuxados = estado.circuitosPuxados;

  const aplicarEm = useCallback((alvos: number[]) => {
    if (camada !== 'grid' && ferramenta !== 'limpar') {
      const limite = camada === 'dmx' ? universosPuxados : circuitosPuxados;
      if (Number(ferramenta) > limite) {
        toast(camada === 'dmx' ? 'Nenhuma linha DMX puxada ainda' : 'Nenhum circuito puxado ainda');
        return;
      }
    }

    aplicar((e) => {
      if (e.finalizado) return e;
      if (camada === 'dmx' || camada === 'energia') {
        const campo = camada === 'dmx' ? 'universo' : 'circuito';
        return ferramenta === 'limpar'
          ? limparAtribuicaoEm(e, alvos, campo)
          : atribuirEm(e, alvos, campo, Number(ferramenta));
      }
      if (ferramenta === 'cabo') return caboAcoEm(e, alvos);
      if (ferramenta === 'remover') return removerEm(e, alvos);
      return pendurarEm(e, alvos, ferramenta as TipoPeca);
    });
  }, [aplicar, camada, ferramenta, universosPuxados, circuitosPuxados, toast]);

  const pintar = useCallback((i: number) => {
    if (ancora.current === null) { aplicarEm([i]); return; }
    const s = { a: ancora.current, b: i };
    const atual = selecaoRef.current;
    if (atual && atual.a === s.a && atual.b === s.b) return;
    selecaoRef.current = s;
    setSelecao(s);
  }, [aplicarEm]);

  /** Hit-test manual: pointerenter não dispara durante arrasto por toque. */
  const pintarNoPonto = useCallback((x: number, y: number) => {
    const alvo = document.elementFromPoint(x, y) as HTMLElement | null;
    const attr = alvo?.dataset?.idx;
    if (attr !== undefined) pintar(Number(attr));
  }, [pintar]);

  useEffect(() => {
    const soltar = () => {
      ancora.current = null;
      const s = selecaoRef.current;
      if (!s) return;
      selecaoRef.current = null;
      setSelecao(null);
      aplicarEm(posicoesDoTraco(s.a, s.b));
    };
    const cancelar = () => {
      ancora.current = null;
      selecaoRef.current = null;
      setSelecao(null);
    };
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', cancelar);
    return () => {
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', cancelar);
    };
  }, [aplicarEm]);

  // --- ações ----------------------------------------------------------------
  const escolherTalha = (kg: number) => {
    iniciar(); tocar('clique', 500);
    aplicar((e) => ({ ...e, talhaKg: kg }));
  };

  const icar = () => {
    if (estado.icado || estado.talhaKg === null) return;
    iniciar(); tocar('vitoria');
    toast(`Grid içado · −${CUSTO.icar} min`, 'ok');
    aplicar(icarGrid);
  };

  const puxarLinha = (tipo: 'dmx' | 'energia') => {
    iniciar(); tocar('clique', 450);
    const n = (tipo === 'dmx' ? estado.universosPuxados : estado.circuitosPuxados) + 1;
    setFerramenta(String(n));
    aplicar(tipo === 'dmx' ? puxarUniverso : puxarCircuito);
  };

  const recolherLinha = (tipo: 'dmx' | 'energia') => {
    const pode = tipo === 'dmx' ? podeRecolherUniverso(estado) : podeRecolherCircuito(estado);
    if (!pode) return;
    iniciar(); tocar('clique', 300);
    const n = tipo === 'dmx' ? estado.universosPuxados : estado.circuitosPuxados;
    if (ferramenta === String(n)) setFerramenta(n > 1 ? String(n - 1) : 'limpar');
    aplicar(tipo === 'dmx' ? recolherUniverso : recolherCircuito);
  };

  const fechar = () => {
    iniciar(); tocar('sucesso', 600);
    setEstado((e) => (e.finalizado ? e : finalizar(e)));
    setVista('palco');   // a vistoria acontece no 3D, não na planta
    setCamada('grid');   // e mostra o grid como ele ficou, não o mapa de DMX
    setPasso(-1);
    setFase('vistoria');
  };

  const reiniciar = useCallback(() => {
    setEstado(criarPartida());
    setFase('os');
    setCamada('grid');
    setVista('planta');
    setFerramenta('moving');
    setToasts([]);
    setImprevisto(false);
    setPasso(-1);
    setApelido('');
    setGravado(false);
    setOsCanais('');
    setOsUniversos('');
    setConferencia(null);
  }, []);

  /**
   * Leitura da OS. Acertar de primeira vale bônus; errar custa uma ligação
   * para o escritório. Nunca trava a partida: o objetivo é a pessoa sair
   * sabendo fazer a conta.
   */
  const confirmarLeitura = () => {
    iniciar();
    const c = conferirLeitura(estado.briefing, osCanais, osUniversos);
    const certo = c.canaisOk && c.universosOk;
    setConferencia(c);

    if (certo) {
      tocar('vitoria');
      setEstado((e) => ({
        ...e,
        leitura: { ...e.leitura, resolvida: true, dePrimeira: e.leitura.tentativas === 0 },
      }));
      setFase('jogando');
      return;
    }

    tocar('erro');
    setEstado((e) => {
      const tentativas = e.leitura.tentativas + 1;
      const custo = CUSTO_CONSULTA_OS[Math.min(tentativas - 1, CUSTO_CONSULTA_OS.length - 1)];
      toast(`Ligação para o escritório · −${custo} min`, 'penal');
      return { ...e, gastos: e.gastos + custo, leitura: { ...e.leitura, tentativas } };
    });
  };

  const liberarSemAcertar = () => {
    const certo = respostaOS(estado.briefing);
    setOsCanais(String(certo.canais));
    setOsUniversos(String(certo.universos));
    setEstado((e) => ({ ...e, leitura: { ...e.leitura, resolvida: true } }));
    setFase('jogando');
  };

  // --- vistoria e placar ----------------------------------------------------
  const vistoria = fase === 'vistoria' || fase === 'placar' ? vistoriar(estado) : null;
  const problemas: Problema[] = vistoria?.problemas ?? [];
  const placar = vistoria ? pontuar(estado, vistoria) : null;
  const gridLimpo = estado.finalizado && problemas.length === 0;
  const focoAtual = fase === 'vistoria' && passo >= 0 ? problemas[passo] ?? null : null;

  useEffect(() => {
    if (fase !== 'vistoria') return;
    const duracao = gridLimpo ? BEAT_LIMPO_MS : passo < 0 ? BEAT_ABERTURA_MS : BEAT_PROBLEMA_MS;
    const id = setTimeout(() => {
      if (passo + 1 >= problemas.length) setFase('placar');
      else setPasso(passo + 1);
    }, duracao);
    return () => clearTimeout(id);
  }, [fase, passo, problemas.length, gridLimpo]);

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const rearmar = () => {
      clearTimeout(id);
      id = setTimeout(reiniciar, OCIO_MS);
    };
    rearmar();
    window.addEventListener('pointerdown', rearmar);
    window.addEventListener('keydown', rearmar);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', rearmar);
      window.removeEventListener('keydown', rearmar);
    };
  }, [reiniciar]);

  const ranking = fase === 'placar' ? lerRanking('luz') : [];
  const podeGravar = placar !== null && !placar.reprovado && entraNoRanking(placar.total, 'luz');

  const registrarMarca = () => {
    if (!placar || !limparApelido(apelido)) return;
    gravarMarca(apelido, placar.total, 'luz');
    setGravado(true);
    tocar('vitoria');
  };

  // --- leitura de tela ------------------------------------------------------
  const selecionadas = new Set(selecao ? posicoesDoTraco(selecao.a, selecao.b) : []);
  const carga = cargaPorPonto(estado);
  const talhaMin = talhaRecomendada(carga);
  const movings = contarPeca(estado, 'moving');
  const pars = contarPeca(estado, 'par');
  const semCabo = estado.celulas.filter((c) => c.peca && !c.caboAco).length;

  const etapas = [
    { nome: 'Peças', ok: pecasPenduradas(estado) >= estado.movings + estado.pars, ativa: camada === 'grid' },
    { nome: 'Cabo de aço', ok: pecasPenduradas(estado) > 0 && semCabo === 0, ativa: ferramenta === 'cabo' },
    { nome: 'Içar', ok: estado.icado, ativa: !estado.icado && semCabo === 0 && pecasPenduradas(estado) > 0 },
    { nome: 'DMX', ok: estado.universosPuxados > 0 && estado.celulas.every((c) => !c.peca || c.universo !== null), ativa: camada === 'dmx' },
    { nome: 'Energia', ok: estado.circuitosPuxados > 0 && estado.celulas.every((c) => !c.peca || c.circuito !== null), ativa: camada === 'energia' },
  ];

  const corCelula = (i: number) => {
    const c = estado.celulas[i];
    if (!c.peca) return 'rgba(255,255,255,0.045)';
    if (camada === 'dmx') return c.universo === null ? '#1E2A40' : CORES_UNIVERSO[(c.universo - 1) % CORES_UNIVERSO.length];
    if (camada === 'energia') return c.circuito === null ? '#1E2A40' : CORES_CIRCUITO[(c.circuito - 1) % CORES_CIRCUITO.length];
    if (!c.caboAco) return '#7F1D1D';
    if (c.noAr) return '#8A5A22';
    return c.peca === 'moving' ? '#4E93D8' : '#E0912F';
  };

  const rotuloCelula = (i: number) => {
    const c = estado.celulas[i];
    if (!c.peca) return '';
    if (camada === 'dmx') return c.universo ?? '';
    if (camada === 'energia') return c.circuito ?? '';
    return c.peca === 'moving' ? 'M' : 'P';
  };

  if (!montadoNoCliente) {
    return (
      <div className="min-h-[calc(100vh-5rem)] bg-black flex items-center justify-center">
        <span className="text-[10px] font-black uppercase tracking-widest text-white/30">Preparando a obra…</span>
      </div>
    );
  }

  return (
    <>
      <BackButton href="/testes/calltime" />

      <div className="min-h-[calc(100vh-5rem)] bg-black text-white">

        {/* ---------------- cabeçalho ---------------- */}
        <div className="border-b border-[#284B8C]/25 bg-[#0C1D4D]/20 px-4 py-3 sticky top-20 z-40 backdrop-blur">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <h1 className="text-lg font-black uppercase tracking-wider">
                Call Time <span className="text-[#336699]">· Luz</span>
              </h1>
              <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-white/35">
                Grid de luz cênica
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-2xl font-black tabular-nums leading-none">
                  {relogio(estado.gastos, janela)}
                </div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-white/40 tabular-nums">
                  {folga(estado)} min de folga
                </div>
              </div>
              <button
                onClick={reiniciar}
                className="px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest bg-black/40 border border-[#284B8C]/40 text-white/60 hover:text-white transition-colors"
              >
                Nova obra
              </button>
            </div>
          </div>

          <div className="max-w-6xl mx-auto mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wider">
            <span className="text-white/35 tabular-nums">OS {estado.briefing.os}</span>
            <span className="px-2 py-0.5 rounded bg-[#336699]/25 border border-[#336699]/50 text-white font-black">
              {APLICACOES[estado.briefing.aplicacao].rotulo}
            </span>
            <span className="text-white/50">{estado.briefing.evento}</span>
          </div>

          {emJogo && (
            <div className="max-w-6xl mx-auto mt-2.5 flex items-center gap-1">
              {etapas.map((et, k) => (
                <div key={et.nome} className="flex items-center gap-1 flex-1 min-w-0">
                  <div className={`flex-1 min-w-0 px-2 py-1 rounded text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-center truncate border transition-colors ${
                    et.ok
                      ? 'border-[#336699]/60 bg-[#336699]/25 text-white'
                      : et.ativa
                        ? 'border-amber-400/70 bg-amber-400/10 text-amber-300'
                        : 'border-white/10 bg-white/[0.03] text-white/30'
                  }`}>
                    {et.ok ? '✓ ' : ''}{et.nome}
                  </div>
                  {k < etapas.length - 1 && <span className="text-white/15 text-[9px] shrink-0">›</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`max-w-6xl mx-auto px-4 py-6 grid gap-6 items-start ${emJogo ? 'lg:grid-cols-[1fr_20rem]' : 'grid-cols-1'}`}>

          {/* ---------------- o grid ---------------- */}
          <div className="flex flex-col gap-3">

            {emJogo && (
              <div className="flex gap-1.5 flex-wrap">
                {([['grid', 'Grid'], ['dmx', 'DMX'], ['energia', 'Energia']] as const).map(([id, rotulo]) => (
                  <button
                    key={id}
                    onClick={() => {
                      setCamada(id);
                      setFerramenta(id === 'grid' ? 'moving' : '1');
                    }}
                    className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
                      camada === id ? 'bg-[#336699] text-white' : 'bg-[#0C1D4D]/30 text-white/50 border border-[#284B8C]/30 hover:text-white'
                    }`}
                  >
                    {rotulo}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-3">
                  <span className="hidden sm:flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-white/40 tabular-nums">
                    <span>{movings} M · {pars} P</span>
                    <span className="text-white/20">·</span>
                    <span>{carga} kg/ponto</span>
                  </span>
                  <div className="flex rounded-lg overflow-hidden border border-[#284B8C]/40">
                    {([['palco', 'Palco'], ['planta', 'Planta']] as const).map(([id, rotulo]) => (
                      <button
                        key={id}
                        onClick={() => setVista(id)}
                        className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                          vista === id ? 'bg-[#336699] text-white' : 'bg-black/40 text-white/45 hover:text-white'
                        }`}
                      >
                        {rotulo}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {vista === 'palco' && (
              <div className={`rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/15 overflow-hidden ${
                emJogo ? 'h-[52vh] min-h-[22rem]' : 'h-[68vh] min-h-[26rem]'
              }`}>
                <Grid3D
                  estado={estado}
                  camada={camada}
                  onPintar={(i) => { if (emJogo) aplicarEm([i]); }}
                  vistoriando={!emJogo}
                  foco={focoAtual}
                  orbitar={gridLimpo && fase === 'vistoria'}
                  festa={gridLimpo && !emJogo}
                  selecionadas={selecionadas}
                />
              </div>
            )}

            {/* planta: as duas varas, garra por garra */}
            {vista === 'planta' && (
              <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/15 p-3 sm:p-4 flex flex-col gap-4 select-none">
                {VARAS.map((vara, v) => (
                  <div key={vara.id} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-[#4E93D8]">{vara.rotulo}</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-white/35">
                        {PECAS[vara.peca].rotulo} · {PECAS[vara.peca].canais} canais · {PECAS[vara.peca].watts} W
                      </span>
                    </div>
                    <div
                      className="grid gap-[3px]"
                      style={{ gridTemplateColumns: `repeat(${POSICOES_MAX}, minmax(0, 1fr))` }}
                      onPointerMove={(ev) => { if (ancora.current !== null) pintarNoPonto(ev.clientX, ev.clientY); }}
                    >
                      {Array.from({ length: POSICOES_MAX }, (_, p) => {
                        const i = indice(v, p);
                        const c = estado.celulas[i];
                        return (
                          <button
                            key={i}
                            data-idx={i}
                            disabled={!emJogo}
                            onPointerDown={(ev) => {
                              if (!emJogo) return;
                              ev.preventDefault();
                              ancora.current = i;
                              selecaoRef.current = { a: i, b: i };
                              setSelecao({ a: i, b: i });
                            }}
                            className={`aspect-square rounded-[3px] border transition-colors ${
                              selecionadas.has(i) ? 'border-white' : 'border-black/40'
                            } ${c.peca && !c.caboAco ? 'animate-pulse' : ''}`}
                            style={{ background: corCelula(i) }}
                            title={`${vara.rotulo} · garra ${p + 1}`}
                          >
                            <span className="text-[8px] font-black text-black/60 tabular-nums">{rotuloCelula(i)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-white/35 leading-snug">
                  Arraste ao longo da vara para trabalhar várias garras de uma vez. O traço não pula de vara.
                </p>
              </div>
            )}

            {/* ferramentas */}
            {emJogo && (
              <div className="flex flex-wrap gap-1.5">
                {camada === 'grid' && (
                  <>
                    <BotaoFerramenta ativo={ferramenta === 'moving'} onClick={() => setFerramenta('moving')} cor="#4E93D8">
                      Moving · −{custoPendurar('moving', estado.icado)} min
                    </BotaoFerramenta>
                    <BotaoFerramenta ativo={ferramenta === 'par'} onClick={() => setFerramenta('par')} cor="#E0912F">
                      Par LED · −{custoPendurar('par', estado.icado)} min
                    </BotaoFerramenta>
                    <BotaoFerramenta ativo={ferramenta === 'cabo'} onClick={() => setFerramenta('cabo')} cor="#3E9E8F">
                      Cabo de aço · −{CUSTO.caboAco} min
                    </BotaoFerramenta>
                    <BotaoFerramenta ativo={ferramenta === 'remover'} onClick={() => setFerramenta('remover')} cor="#DC2626">
                      Remover · −{CUSTO.remover} min
                    </BotaoFerramenta>
                  </>
                )}

                {camada !== 'grid' && (
                  <>
                    {Array.from({ length: camada === 'dmx' ? estado.universosPuxados : estado.circuitosPuxados }, (_, k) => {
                      const n = k + 1;
                      const cores = camada === 'dmx' ? CORES_UNIVERSO : CORES_CIRCUITO;
                      return (
                        <BotaoFerramenta
                          key={n}
                          ativo={ferramenta === String(n)}
                          onClick={() => setFerramenta(String(n))}
                          cor={cores[k % cores.length]}
                        >
                          {camada === 'dmx' ? 'U' : 'C'}{n}
                        </BotaoFerramenta>
                      );
                    })}
                    <button
                      onClick={() => puxarLinha(camada === 'dmx' ? 'dmx' : 'energia')}
                      className="px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border border-dashed border-[#336699]/70 text-[#4E93D8] hover:bg-[#0C1D4D]/60 hover:text-white transition-all"
                    >
                      {camada === 'dmx'
                        ? `+ Linha DMX · ${CUSTO.puxarUniverso} min`
                        : `+ Circuito · ${ENERGIA.porCircuito} min`}
                    </button>
                    {(camada === 'dmx' ? estado.universosPuxados : estado.circuitosPuxados) > 0 && (
                      <button
                        onClick={() => recolherLinha(camada === 'dmx' ? 'dmx' : 'energia')}
                        disabled={camada === 'dmx' ? !podeRecolherUniverso(estado) : !podeRecolherCircuito(estado)}
                        className="px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border border-dashed border-white/20 text-white/50 hover:text-white hover:border-white/40 transition-all disabled:opacity-30"
                      >
                        − Recolher {camada === 'dmx' ? 'U' : 'C'}{camada === 'dmx' ? estado.universosPuxados : estado.circuitosPuxados}
                      </button>
                    )}
                    <BotaoFerramenta ativo={ferramenta === 'limpar'} onClick={() => setFerramenta('limpar')} cor="#64748B">
                      Limpar
                    </BotaoFerramenta>
                  </>
                )}
              </div>
            )}

            {emJogo && (
              <p className="text-xs text-white/45 leading-relaxed max-w-[60ch]">
                {camada === 'grid' && (
                  estado.icado
                    ? `O grid já subiu. Peça pendurada agora custa ${MULT_NO_AR}× o tempo — é escada, plataforma e risco. E peça sem cabo de aço reprova a partida, sem discussão.`
                    : 'Pendure as peças com o truss ainda no chão: par na frontal, moving no contra. Cabo de aço em toda peça pendurada, sem exceção.'
                )}
                {camada === 'dmx' && `Um universo tem ${CANAIS_POR_UNIVERSO} canais e a linha aguenta ${PECAS_POR_LINHA} aparelhos. Quantas linhas puxar é conta sua: moving come ${PECAS.moving.canais} canais, par LED come ${PECAS.par.canais}. O que não couber fica mudo na passagem.`}
                {camada === 'energia' && `A tomada do local é de ${estado.briefing.tomadaA} A em 220 V. Moving puxa ${PECAS.moving.watts} W e par LED, ${PECAS.par.watts} W — e disjuntor não trabalha no limite. Cada circuito é um lance de cabo de ${ENERGIA.porCircuito} min, usado ou não.`}
              </p>
            )}
          </div>

          {/* ---------------- painel de ações ---------------- */}
          {emJogo && (
            <aside className="flex flex-col gap-3">
              {estado.leitura.resolvida && <CartaoOS estado={estado} portaAbre={relogio(janela, janela)} />}

              {/* içamento */}
              <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-3">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Içamento</h2>

                <div className="flex justify-between items-baseline text-xs">
                  <span className="text-white/50 font-bold uppercase tracking-wider">Carga por ponto</span>
                  <span className="font-black tabular-nums">{carga} kg</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">Talha</span>
                  <div className="grid grid-cols-4 gap-1">
                    {TALHAS_KG.map((kg) => (
                      <button
                        key={kg}
                        disabled={estado.icado}
                        onClick={() => escolherTalha(kg)}
                        className={`py-2 rounded text-[10px] font-black tabular-nums transition-all disabled:opacity-40 ${
                          estado.talhaKg === kg ? 'bg-[#336699] text-white' : 'bg-black/40 text-white/50 border border-[#284B8C]/30 hover:text-white'
                        }`}
                      >
                        {kg}
                      </button>
                    ))}
                  </div>
                  {estado.talhaKg !== null && estado.talhaKg < talhaMin && (
                    <p className="text-[10px] font-bold text-red-400 leading-snug">
                      Abaixo da carga. Içar assim é reprovação direta.
                    </p>
                  )}
                </div>

                {semCabo > 0 && (
                  <p className="text-[10px] font-bold text-red-300 leading-snug">
                    {semCabo} {semCabo === 1 ? 'peça sem cabo de aço' : 'peças sem cabo de aço'}.
                  </p>
                )}

                <button
                  onClick={icar}
                  disabled={estado.icado || estado.talhaKg === null}
                  className="py-3 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40 bg-[#336699] text-white hover:bg-[#3d7bb5] active:scale-[0.98]"
                >
                  {estado.icado ? '✓ Grid içado' : `Içar grid · −${CUSTO.icar} min`}
                </button>
              </div>

              {/* suprimento */}
              <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-2">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Suprimento</h2>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border p-2.5 flex flex-col gap-0.5 border-[#284B8C]/30 bg-black/30">
                    <span className="text-[9px] font-black uppercase tracking-wider text-white/40">Linhas DMX</span>
                    <span className="text-lg font-black tabular-nums leading-none text-white">{estado.universosPuxados}</span>
                    <span className="text-[9px] font-bold text-white/35 leading-tight">puxadas do rack</span>
                  </div>
                  <div className="rounded-lg border p-2.5 flex flex-col gap-0.5 border-[#284B8C]/30 bg-black/30">
                    <span className="text-[9px] font-black uppercase tracking-wider text-white/40">Circuitos</span>
                    <span className="text-lg font-black tabular-nums leading-none text-white">{estado.circuitosPuxados}</span>
                    <span className="text-[9px] font-bold text-white/35 leading-tight">tomada {estado.briefing.tomadaA} A</span>
                  </div>
                </div>
                <p className="text-[10px] text-white/35 leading-snug">
                  Linha DMX e circuito se puxam nas abas DMX e Energia.
                </p>
              </div>

              <button
                onClick={fechar}
                disabled={fase === 'os'}
                className="py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-40 bg-white text-black hover:bg-white/90 active:scale-[0.98]"
              >
                Fechar o grid e focar
                <span className="block text-[9px] font-bold text-black/50 tracking-normal normal-case mt-0.5">
                  DMX e energia pelas linhas puxadas · foco e cenas −{custoFechamento(estado)} min no total
                </span>
              </button>
            </aside>
          )}
        </div>
      </div>

      {/* ---------------- avisos ---------------- */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] flex flex-col items-center gap-1.5 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border backdrop-blur ${
              t.tom === 'penal' ? 'border-red-500/60 bg-red-950/80 text-red-100'
                : t.tom === 'ok' ? 'border-[#336699]/60 bg-[#0C1D4D]/85 text-white'
                : 'border-amber-500/50 bg-amber-950/80 text-amber-100'
            }`}
          >
            {t.texto}
          </div>
        ))}
      </div>

      {/* ---------------- ordem de serviço ---------------- */}
      {fase === 'os' && (
        <ModalOS
          estado={estado}
          canais={osCanais}
          universos={osUniversos}
          conferencia={conferencia}
          onCanais={setOsCanais}
          onUniversos={setOsUniversos}
          onConfirmar={confirmarLeitura}
          onDesistir={liberarSemAcertar}
        />
      )}

      {/* ---------------- o cliente ligou ---------------- */}
      {imprevisto && (
        <div data-abaixo-do-header className="fixed inset-x-0 bottom-0 top-20 z-[92] bg-black/85 backdrop-blur flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-amber-500/50 bg-amber-950/20 p-6 flex flex-col gap-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
              {relogio(estado.gastos, janela)} · Rádio do produtor
            </span>
            <p className="text-xl font-black text-white leading-tight">
              O cliente pediu mais {pecasDoImprevisto(estado).quantas} {PECAS[pecasDoImprevisto(estado).tipo].curto.toLowerCase()}
              {pecasDoImprevisto(estado).quantas === 1 ? '' : 's'} no grid.
            </p>
            <p className="text-sm text-amber-100/80 leading-relaxed">
              São {estado.movings} movings e {estado.pars} pars agora. Refaça a conta: mais peça é mais canal, mais aparelho na linha e mais carga no circuito.
            </p>
            <button
              onClick={() => setImprevisto(false)}
              className="py-3 rounded-lg bg-amber-500 text-black text-[11px] font-black uppercase tracking-widest hover:bg-amber-400 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* ---------------- vistoria ---------------- */}
      {fase === 'vistoria' && vistoria && (
        <div className="fixed inset-x-0 bottom-0 z-[85] p-4 sm:p-6 pointer-events-none">
          <div className="max-w-3xl mx-auto flex flex-col gap-3">
            {problemas.length > 0 && (
              <div className="flex gap-1.5 justify-center">
                {problemas.map((p, k) => (
                  <span
                    key={k}
                    className={`h-1 rounded-full transition-all duration-500 ${
                      k === passo ? 'w-8 bg-white' : k < passo ? 'w-4 bg-white/40' : 'w-4 bg-white/15'
                    }`}
                  />
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-[#284B8C]/40 bg-black/85 backdrop-blur px-5 py-4 sm:px-7 sm:py-5 flex flex-col gap-2 pointer-events-auto">
              <span className="text-[10px] font-black uppercase tracking-widest text-[#336699]">
                {relogio(janela, janela)} · Passagem de luz
              </span>

              {passo < 0 && !gridLimpo && (
                <p className="text-lg sm:text-2xl font-black text-white leading-tight">
                  Casa aberta em minutos. Vamos ver o que ficou para trás.
                </p>
              )}
              {passo < 0 && gridLimpo && (
                <p className="text-lg sm:text-2xl font-black text-[#4E93D8] leading-tight">
                  Grid completo, cabo de aço em tudo, todo mundo respondendo à mesa. Montagem limpa.
                </p>
              )}
              {passo >= 0 && problemas[passo] && (
                <>
                  <p className="text-base sm:text-xl font-bold text-white leading-snug">{problemas[passo].texto}</p>
                  {problemas[passo].minutos ? (
                    <span className="text-xs font-black uppercase tracking-widest text-amber-400">
                      −{problemas[passo].minutos} min
                    </span>
                  ) : problemas[passo].tipo === 'reprovacao' ? (
                    <span className="text-xs font-black uppercase tracking-widest text-red-400">Reprovação</span>
                  ) : null}
                </>
              )}

              <button
                onClick={() => setFase('placar')}
                className="self-end text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-colors mt-1"
              >
                Pular para o placar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- placar ---------------- */}
      {fase === 'placar' && vistoria && placar && (
        <div data-abaixo-do-header className="fixed inset-x-0 bottom-0 top-20 z-[95] bg-black/92 backdrop-blur overflow-y-auto">
          <div className="min-h-full flex items-center justify-center p-6">
            <div className="max-w-lg w-full flex flex-col gap-5 py-8">

              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#336699]">
                  {relogio(janela, janela)} · Resultado
                </span>
                <h2 className={`text-4xl font-black leading-none ${placar.reprovado ? 'text-red-400' : 'text-white'}`}>
                  {placar.reprovado ? 'Reprovado' : 'Grid entregue'}
                </h2>
              </div>

              {placar.reprovado ? (
                <p className="text-sm text-red-200/80 leading-relaxed">
                  Falha de segurança ou de entrega zera a partida, independente do tempo. Cabo de aço não é apontamento de minutos — é a montagem que não podia ter sido entregue assim.
                </p>
              ) : (
                <div className="flex items-baseline gap-3">
                  <span className="text-6xl font-black tabular-nums text-white">{placar.total}</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">pontos</span>
                </div>
              )}

              {!placar.reprovado && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Linha rotulo={`Folga · ${placar.folgaMin} min`} valor={placar.daFolga} />
                  <Linha rotulo={`Qualidade · ${vistoria.qualidade}`} valor={placar.daQualidade} />
                  <Linha rotulo="Sem retrabalho" valor={placar.semRetrabalho} />
                  <Linha rotulo="Leitura de primeira" valor={placar.daLeitura} />
                </div>
              )}

              <LicaoDmx estado={estado} />
              <LicaoEnergia estado={estado} />

              {problemas.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Apontamentos</span>
                  {problemas.map((p, k) => (
                    <div
                      key={k}
                      className={`rounded-lg border px-3 py-2 text-xs leading-snug ${
                        p.tipo === 'reprovacao' ? 'border-red-500/50 bg-red-950/30 text-red-100'
                          : p.tipo === 'tempo' ? 'border-amber-500/40 bg-amber-950/20 text-amber-100'
                          : 'border-[#284B8C]/40 bg-[#0C1D4D]/25 text-white/75'
                      }`}
                    >
                      {p.texto}
                      {p.minutos ? <strong className="block mt-1 font-black">−{p.minutos} min</strong> : null}
                    </div>
                  ))}
                </div>
              )}

              {/* ranking do dia */}
              {podeGravar && !gravado && (
                <div className="rounded-xl border border-[#336699]/50 bg-[#0C1D4D]/30 p-4 flex flex-col gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#4E93D8]">
                    {placar.total} pontos · {posicaoNoRanking(placar.total, 'luz')}º lugar hoje
                  </span>
                  <div className="flex gap-2">
                    <input
                      value={apelido}
                      onChange={(ev) => setApelido(limparApelido(ev.target.value))}
                      maxLength={APELIDO_MAX}
                      placeholder="Seu apelido"
                      className="flex-1 px-3 py-2 rounded-lg bg-black/50 border border-[#284B8C]/40 text-sm font-bold text-white placeholder:text-white/25 outline-none focus:border-[#336699]"
                    />
                    <button
                      onClick={registrarMarca}
                      className="px-4 py-2 rounded-lg bg-[#336699] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[#3d7bb5] transition-colors"
                    >
                      Entrar
                    </button>
                  </div>
                </div>
              )}

              {ranking.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Melhores de hoje · luz</span>
                  {ranking.map((m, k) => (
                    <div key={`${m.apelido}-${m.quando}`} className="flex items-baseline justify-between text-xs font-bold tabular-nums text-white/70">
                      <span>{k + 1}. {m.apelido}</span>
                      <span>{m.pontos}</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={reiniciar}
                className="py-4 rounded-xl bg-white text-black text-xs font-black uppercase tracking-widest hover:bg-white/90 transition-colors"
              >
                Jogar de novo
              </button>
              <Link
                href="/testes/calltime"
                className="py-3 rounded-xl border border-[#284B8C]/40 text-white/60 text-[11px] font-black uppercase tracking-widest text-center hover:text-white hover:border-[#336699] transition-colors"
              >
                Voltar aos postos
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pedaços de tela
// ---------------------------------------------------------------------------

function BotaoFerramenta({ ativo, onClick, cor, children }: {
  ativo: boolean;
  onClick: () => void;
  cor: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all border ${
        ativo ? 'text-black' : 'text-white/70 hover:text-white bg-black/40'
      }`}
      style={{ background: ativo ? cor : undefined, borderColor: cor }}
    >
      {children}
    </button>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex items-baseline justify-between rounded-lg border border-[#284B8C]/30 bg-[#0C1D4D]/20 px-3 py-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-white/45">{rotulo}</span>
      <span className="font-black tabular-nums text-white">{valor}</span>
    </div>
  );
}

function CampoOS({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-[#284B8C]/25 pb-1">
      <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">{rotulo}</span>
      <span className="text-xs font-black tabular-nums text-white text-right">{children}</span>
    </div>
  );
}

/** O cartão fixo com a obra, para não precisar decorar o que a OS pediu. */
function CartaoOS({ estado, portaAbre }: { estado: EstadoLuz; portaAbre: string }) {
  const b = estado.briefing;
  const cresceu = estado.movings !== b.movings || estado.pars !== b.pars;

  return (
    <div className="rounded-xl border border-[#284B8C]/30 bg-black/40 p-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-[#336699]">OS {b.os}</span>
        {cresceu && <span className="text-[9px] font-black uppercase tracking-wider text-amber-400">alterada</span>}
      </div>
      <CampoOS rotulo="Movings (contra)">
        {estado.movings}
        {cresceu && estado.movings !== b.movings && (
          <span className="block text-[10px] font-bold text-amber-400">eram {b.movings}</span>
        )}
      </CampoOS>
      <CampoOS rotulo="Pars (frontal)">
        {estado.pars}
        {cresceu && estado.pars !== b.pars && (
          <span className="block text-[10px] font-bold text-amber-400">eram {b.pars}</span>
        )}
      </CampoOS>
      <CampoOS rotulo="Tomada do local">{b.tomadaA} A · 220 V</CampoOS>
      <CampoOS rotulo="Porta abre">{portaAbre}</CampoOS>
    </div>
  );
}

/**
 * A ordem de serviço. O técnico só encosta no truss depois de dizer quantos
 * canais a obra ocupa e quantas linhas DMX ela pede — que é a conta que
 * decide a montagem inteira.
 */
function ModalOS({
  estado, canais, universos, conferencia, onCanais, onUniversos, onConfirmar, onDesistir,
}: {
  estado: EstadoLuz;
  canais: string;
  universos: string;
  conferencia: ConferenciaOS | null;
  onCanais: (v: string) => void;
  onUniversos: (v: string) => void;
  onConfirmar: () => void;
  onDesistir: () => void;
}) {
  const b: BriefingLuz = estado.briefing;
  const tentativas = estado.leitura.tentativas;

  return (
    <div data-abaixo-do-header className="fixed inset-x-0 bottom-0 top-20 z-[95] bg-black/92 backdrop-blur overflow-y-auto">
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="max-w-md w-full flex flex-col gap-4 py-8">

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#336699]">
              14:00 · Ordem de serviço {b.os}
            </span>
            <h2 className="text-3xl font-black leading-none text-white">{b.evento}</h2>
            <p className="text-xs text-white/50 leading-relaxed mt-1">
              {APLICACOES[b.aplicacao].descricao}
            </p>
          </div>

          <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-2">
            <CampoOS rotulo="Movings no contra">{b.movings}</CampoOS>
            <CampoOS rotulo="Pars na frontal">{b.pars}</CampoOS>
            <CampoOS rotulo="Tomada do local">{b.tomadaA} A · 220 V</CampoOS>
            <CampoOS rotulo="Porta abre">{relogio(b.janelaMin, b.janelaMin)}</CampoOS>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-white/50">
              Antes de subir: a conta do endereçamento
            </span>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Canais DMX ocupados</span>
              <input
                value={canais}
                onChange={(ev) => onCanais(ev.target.value)}
                inputMode="numeric"
                placeholder="0"
                className={`px-3 py-2.5 rounded-lg bg-black/50 border text-sm font-black tabular-nums text-white outline-none ${
                  conferencia && !conferencia.canaisOk ? 'border-red-500/60' : 'border-[#284B8C]/40 focus:border-[#336699]'
                }`}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Linhas DMX (universos)</span>
              <input
                value={universos}
                onChange={(ev) => onUniversos(ev.target.value)}
                inputMode="numeric"
                placeholder="0"
                className={`px-3 py-2.5 rounded-lg bg-black/50 border text-sm font-black tabular-nums text-white outline-none ${
                  conferencia && !conferencia.universosOk ? 'border-red-500/60' : 'border-[#284B8C]/40 focus:border-[#336699]'
                }`}
              />
            </label>
          </div>

          {tentativas === 1 && (
            <p className="text-xs text-amber-200/80 leading-relaxed">
              O escritório respondeu: moving ocupa {PECAS.moving.canais} canais e par LED, {PECAS.par.canais}. Um universo tem {CANAIS_POR_UNIVERSO} canais — e uma linha aguenta {PECAS_POR_LINHA} aparelhos.
            </p>
          )}

          {tentativas >= 2 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">A conta</span>
              {contaOS(b).map((linha) => (
                <span key={linha} className="text-xs font-bold tabular-nums text-amber-100/90">{linha}</span>
              ))}
            </div>
          )}

          <button
            onClick={onConfirmar}
            className="py-4 rounded-xl bg-white text-black text-xs font-black uppercase tracking-widest hover:bg-white/90 transition-colors"
          >
            Conferir e liberar a montagem
          </button>

          {tentativas >= 2 && (
            <button
              onClick={onDesistir}
              className="text-[10px] font-black uppercase tracking-widest text-white/35 hover:text-white transition-colors"
            >
              Entrar na obra com a conta pronta
            </button>
          )}

          <p className="text-[10px] text-white/30 leading-snug">
            Acertar de primeira vale bônus no placar. Cada ligação para o escritório custa {CUSTO_CONSULTA_OS[0]} e depois {CUSTO_CONSULTA_OS[1]} min do relógio.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Durante o jogo as linhas não mostram lotação; o placar mostra a conta. */
function LicaoDmx({ estado }: { estado: EstadoLuz }) {
  const l = licaoDmx(estado);
  if (l.puxados === 0) return null;
  const limpo = l.mudas === 0 && l.minutos === l.minutosIdeal;

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${
      limpo ? 'border-[#336699]/50 bg-[#0C1D4D]/30' : 'border-amber-500/40 bg-amber-950/20'
    }`}>
      <span className={`text-[10px] font-black uppercase tracking-widest ${limpo ? 'text-[#4E93D8]' : 'text-amber-400'}`}>
        DMX · {l.minutos} min{limpo ? ', o mínimo possível' : ` — dava para fazer em ${l.minutosIdeal}`}
      </span>
      <p className="text-xs text-white/75 leading-relaxed tabular-nums">{l.conta}.</p>
      <p className="text-xs text-white/75 leading-relaxed tabular-nums">
        {l.minimo} {l.minimo === 1 ? 'linha bastava' : 'linhas bastavam'}, e você puxou {l.puxados}.
      </p>
      <div className="flex flex-wrap gap-1">
        {l.linhas.map((u) => (
          <span
            key={u.universo}
            className={`px-2 py-0.5 rounded text-[10px] font-black tabular-nums border ${
              u.situacao === 'estourada' ? 'border-red-500/60 bg-red-950/40 text-red-200'
                : u.situacao === 'sobra' ? 'border-amber-500/40 bg-amber-950/30 text-amber-100'
                : 'border-[#336699]/60 bg-[#0C1D4D]/50 text-white'
            }`}
          >
            U{u.universo} · {u.pecas} peças · {u.canais} ch
          </span>
        ))}
      </div>
      {l.mudas > 0 && (
        <p className="text-[10px] text-red-200/80 leading-snug">
          {l.mudas} {l.mudas === 1 ? 'peça ficou' : 'peças ficaram'} sem resposta na mesa.
        </p>
      )}
    </div>
  );
}

function LicaoEnergia({ estado }: { estado: EstadoLuz }) {
  const l = licaoEnergia(estado);
  if (l.puxados === 0) return null;
  const limpo = l.linhas.every((c) => c.situacao !== 'estourada') && l.minutos === l.minutosIdeal;

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${
      limpo ? 'border-[#336699]/50 bg-[#0C1D4D]/30' : 'border-amber-500/40 bg-amber-950/20'
    }`}>
      <span className={`text-[10px] font-black uppercase tracking-widest ${limpo ? 'text-[#4E93D8]' : 'text-amber-400'}`}>
        Energia · {l.minutos} min{limpo ? ', o mínimo possível' : ` — dava para fazer em ${l.minutosIdeal}`}
      </span>
      <p className="text-xs text-white/75 leading-relaxed tabular-nums">{l.conta}.</p>
      <p className="text-xs text-white/75 leading-relaxed tabular-nums">
        {l.minimo} {l.minimo === 1 ? 'circuito bastava' : 'circuitos bastavam'}, e você puxou {l.puxados}.
      </p>
      <div className="flex flex-wrap gap-1">
        {l.linhas.map((c) => (
          <span
            key={c.circuito}
            className={`px-2 py-0.5 rounded text-[10px] font-black tabular-nums border ${
              c.situacao === 'estourada' ? 'border-red-500/60 bg-red-950/40 text-red-200'
                : c.situacao === 'sobra' ? 'border-amber-500/40 bg-amber-950/30 text-amber-100'
                : 'border-[#336699]/60 bg-[#0C1D4D]/50 text-white'
            }`}
          >
            C{c.circuito} · {c.pecas} peças · {fmtKw(c.watts)}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-white/40 leading-snug">
        A tomada de {estado.briefing.tomadaA} A trabalha até {fmtKw(l.wattsUtil)} por circuito. Atraso acima de {ATRASO_TOLERADO} min reprova a obra.
      </p>
    </div>
  );
}
