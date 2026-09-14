"use client";

// ============================================================================
// CALL TIME — Fase 4: o PA
//
// Terceira irmã de /testes/calltime/video e /testes/calltime/luz: mesmo relógio, mesma
// vistoria, mesmo placar. O ofício aqui é impedância, cobertura e delay — e a
// regra de ouro da energização, que é o jeito mais rápido de estragar uma
// montagem boa nos últimos trinta segundos.
//
// Toda a regra vive em app/jogo/som/motor.ts.
// ============================================================================

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import BackButton from '../../BackButton';
import { lerTurno, salvarTurno, noTurno, ROTA_SALAO } from '../../../jogo/turno/armazem';
import { registrarPosto } from '../../../jogo/turno/motor';
import { useSom as useSomDaTela } from '../../useSom';
import { CORES_CIRCUITO } from '../../../jogo/cores';
import {
  lerRanking, gravarMarca, entraNoRanking, posicaoDe as posicaoNoRanking,
  limparApelido, APELIDO_MAX,
} from '../../../jogo/ranking';
import {
  AMPLIFICADOR,
  ANGULOS,
  APLICACOES,
  ARRANJOS,
  CAIXAS,
  CUSTO,
  CUSTO_ANGULO_NO_AR,
  CUSTO_CONSULTA_OS,
  EQUIPAMENTOS,
  FILAS,
  MULT_NO_AR,
  ORDEM_LIGA,
  POSICOES_MAX,
  TALHAS_KG,
  TOLERANCIA_GRAUS,
  VELOCIDADE_SOM,
  angularEm,
  atribuirEm,
  caboAcoEm,
  cargaPorPonto,
  coberturaDoLado,
  conferirLeitura,
  contaOS,
  contarNaFila,
  criarPartida,
  custoFechamento,
  custoPendurar,
  escolherArranjo,
  filaDe,
  finalizar,
  folga,
  icar as icarPA,
  indice,
  janelaDe,
  lerNumero,
  licaoAmplificacao,
  licaoCobertura,
  ligar as ligarEquipamento,
  limparCanalEm,
  penduradas,
  pendurarEm,
  podeRecolherCanal,
  pontuar,
  posicaoDe,
  programarDelay,
  puxarCanal,
  recolherCanal,
  relogio,
  removerEm,
  respostaOS,
  talhaRecomendada,
  tipoDaFila,
  vistoriar,
  type Arranjo,
  type BriefingSom,
  type ConferenciaOS,
  type Equipamento,
  type EstadoSom,
  type Problema,
} from '../../../jogo/som/motor';

type Camada = 'pa' | 'cobertura' | 'amplificacao';
type Vista = 'palco' | 'planta';
type Fase = 'os' | 'jogando' | 'vistoria' | 'placar';
type Toast = { id: number; texto: string; tom: 'custo' | 'penal' | 'ok' };

const Som3D = dynamic(() => import('../../../jogo/som/Som3D'), {
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
const BEAT_LIMPO_MS = 5_400;

/** Posições entre dois pontos da MESMA fila: o traço não pula de lado. */
function posicoesDoTraco(a: number, b: number): number[] {
  if (filaDe(a) !== filaDe(b)) return [a];
  const fila = filaDe(a);
  const p0 = Math.min(posicaoDe(a), posicaoDe(b));
  const p1 = Math.max(posicaoDe(a), posicaoDe(b));
  const fora: number[] = [];
  for (let p = p0; p <= p1; p++) fora.push(indice(fila, p));
  return fora;
}

const assinarNada = () => () => {};
const noNavegador = () => true;
const noServidor = () => false;

export default function CallTimeSom() {
  const montadoNoCliente = useSyncExternalStore(assinarNada, noNavegador, noServidor);
  // Dentro de um turno, a obra não é sorteada aqui: ela veio do salão junto
  // com as outras duas, e é ela que o encarregado viu quando dividiu a equipe.
  const [emTurno] = useState(noTurno);
  const [estado, setEstado] = useState<EstadoSom>(() => {
    const turno = noTurno() ? lerTurno() : null;
    return turno ? criarPartida(turno.obras.som) : criarPartida();
  });
  const [fase, setFase] = useState<Fase>('os');
  const [camada, setCamada] = useState<Camada>('pa');
  // Começa na planta: é nela que se trabalha. O palco entra no fechamento,
  // quando a câmera assume e mostra o que a montagem virou.
  const [vista, setVista] = useState<Vista>('planta');
  const [ferramenta, setFerramenta] = useState<string>('caixa');
  const [selecao, setSelecao] = useState<{ a: number; b: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [passo, setPasso] = useState(-1);
  const [apelido, setApelido] = useState('');
  const [gravado, setGravado] = useState(false);
  const [osDelay, setOsDelay] = useState('');
  const [osCanais, setOsCanais] = useState('');
  const [conferencia, setConferencia] = useState<ConferenciaOS | null>(null);
  const [delayDigitado, setDelayDigitado] = useState('');

  const ancora = useRef<number | null>(null);
  const selecaoRef = useRef<{ a: number; b: number } | null>(null);
  const toastId = useRef(0);
  const { iniciar, tocar } = useSomDaTela();

  const janela = janelaDe(estado);
  const emJogo = fase === 'jogando' || fase === 'os';

  const toast = useCallback((texto: string, tom: Toast['tom'] = 'custo') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, texto, tom }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const aplicar = useCallback((fn: (e: EstadoSom) => EstadoSom) => {
    setEstado((anterior) => fn(anterior));
  }, []);

  // --- pintura --------------------------------------------------------------
  const canaisPuxados = estado.canaisPuxados;

  const aplicarEm = useCallback((alvos: number[]) => {
    if (camada === 'amplificacao' && ferramenta !== 'limpar' && Number(ferramenta) > canaisPuxados) {
      toast('Nenhum canal de amplificador puxado ainda');
      return;
    }

    aplicar((e) => {
      if (e.finalizado) return e;
      if (camada === 'amplificacao') {
        return ferramenta === 'limpar'
          ? limparCanalEm(e, alvos)
          : atribuirEm(e, alvos, Number(ferramenta));
      }
      if (camada === 'cobertura') return angularEm(e, alvos, Number(ferramenta));
      if (ferramenta === 'cabo') return caboAcoEm(e, alvos);
      if (ferramenta === 'remover') return removerEm(e, alvos);
      // Na camada do PA, a fila manda: line array nos lados, sub no chão.
      const porFila = new Map<number, number[]>();
      for (const i of alvos) {
        const fila = filaDe(i);
        porFila.set(fila, [...(porFila.get(fila) ?? []), i]);
      }
      let proximo = e;
      for (const [fila, lista] of porFila) {
        proximo = pendurarEm(proximo, lista, ferramenta === 'caixa' ? tipoDaFila(fila) : 'sub');
      }
      return proximo;
    });
  }, [aplicar, camada, ferramenta, canaisPuxados, toast]);

  const pintar = useCallback((i: number) => {
    if (ancora.current === null) { aplicarEm([i]); return; }
    const s = { a: ancora.current, b: i };
    const atual = selecaoRef.current;
    if (atual && atual.a === s.a && atual.b === s.b) return;
    selecaoRef.current = s;
    setSelecao(s);
  }, [aplicarEm]);

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
    toast(`PA içado · −${CUSTO.icar} min`, 'ok');
    aplicar(icarPA);
  };

  const puxar = () => {
    iniciar(); tocar('clique', 450);
    setFerramenta(String(estado.canaisPuxados + 1));
    aplicar(puxarCanal);
  };

  const recolher = () => {
    if (!podeRecolherCanal(estado)) return;
    iniciar(); tocar('clique', 300);
    const n = estado.canaisPuxados;
    if (ferramenta === String(n)) setFerramenta(n > 1 ? String(n - 1) : 'limpar');
    aplicar(recolherCanal);
  };

  const ligar = (equipamento: Equipamento) => {
    if (estado.ligacao.includes(equipamento)) return;
    iniciar();
    const proximo = ORDEM_LIGA[estado.ligacao.length];
    if (equipamento !== proximo) { tocar('erro'); toast(`${EQUIPAMENTOS[equipamento].rotulo} fora de ordem`, 'penal'); }
    else tocar('clique', 600);
    aplicar((e) => ligarEquipamento(e, equipamento));
  };

  const definirArranjo = (arranjo: Arranjo) => {
    iniciar(); tocar('clique', 520);
    aplicar((e) => escolherArranjo(e, arranjo));
  };

  const gravarDelay = (bruto: string) => {
    setDelayDigitado(bruto);
    const ms = lerNumero(bruto);
    aplicar((e) => programarDelay(e, ms === null ? null : Math.round(ms)));
  };

  const fechar = () => {
    iniciar(); tocar('sucesso', 600);
    setEstado((e) => (e.finalizado ? e : finalizar(e)));
    setVista('palco');   // a vistoria acontece no 3D, não na planta
    setCamada('pa');     // e mostra o PA como ele ficou, não o mapa de canais
    setPasso(-1);
    setFase('vistoria');
  };

  const reiniciar = useCallback(() => {
    setEstado(criarPartida());
    setFase('os');
    setCamada('pa');
    setVista('planta');
    setFerramenta('caixa');
    setToasts([]);
    setPasso(-1);
    setApelido('');
    setGravado(false);
    setOsDelay('');
    setOsCanais('');
    setConferencia(null);
    setDelayDigitado('');
  }, []);

  const confirmarLeitura = () => {
    iniciar();
    const c = conferirLeitura(estado.briefing, osDelay, osCanais);
    setConferencia(c);

    if (c.delayOk && c.canaisOk) {
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
    setOsDelay(String(certo.delayMs));
    setOsCanais(String(certo.canais));
    setEstado((e) => ({ ...e, leitura: { ...e.leitura, resolvida: true } }));
    setFase('jogando');
  };

  // --- vistoria e placar ----------------------------------------------------
  const vistoria = fase === 'vistoria' || fase === 'placar' ? vistoriar(estado) : null;
  const problemas: Problema[] = vistoria?.problemas ?? [];
  const placar = vistoria ? pontuar(estado, vistoria) : null;
  const paLimpo = estado.finalizado && problemas.length === 0;
  const focoAtual = fase === 'vistoria' && passo >= 0 ? problemas[passo] ?? null : null;

  // Passagem limpa tem som: é o acorde que se joga no PA quando o sistema
  // sobe inteiro. Toca uma vez, na abertura da vistoria.
  useEffect(() => {
    if (fase === 'vistoria' && paLimpo) tocar('passagem', 392);
  }, [fase, paLimpo, tocar]);

  useEffect(() => {
    if (fase !== 'vistoria') return;
    const duracao = paLimpo ? BEAT_LIMPO_MS : passo < 0 ? BEAT_ABERTURA_MS : BEAT_PROBLEMA_MS;
    const id = setTimeout(() => {
      if (passo + 1 >= problemas.length) setFase('placar');
      else setPasso(passo + 1);
    }, duracao);
    return () => clearTimeout(id);
  }, [fase, passo, problemas.length, paLimpo]);

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

  // O salão espera o resultado deste posto: minutos de verdade (com o que a
  // vistoria cobrou), pontos, carga ligada e se a talha foi usada — a ordem
  // dos içamentos é o que trava o palco lá fora.
  const jaRegistrado = useRef(false);
  useEffect(() => {
    if (!emTurno || fase !== 'placar' || jaRegistrado.current) return;
    if (!vistoria || !placar) return;
    const turno = lerTurno();
    if (!turno) return;
    jaRegistrado.current = true;
    salvarTurno(registrarPosto(turno, {
      posto: 'som',
      minutos: estado.gastos + vistoria.minutosExtras,
      pontos: placar.total,
      qualidade: vistoria.qualidade,
      reprovado: placar.reprovado,
      problemas: vistoria.problemas.map((x) => x.curto),
      watts: estado.celulas.reduce((n, c) => n + (c.caixa && c.canal !== null ? CAIXAS[c.caixa].watts : 0), 0),
      icou: estado.icado,
      montadores: turno.equipe.som,
    }));
  }, [emTurno, fase, vistoria, placar, estado]);

  const ranking = fase === 'placar' ? lerRanking('som') : [];
  const podeGravar = placar !== null && !placar.reprovado && entraNoRanking(placar.total, 'som');

  const registrarMarca = () => {
    if (!placar || !limparApelido(apelido)) return;
    gravarMarca(apelido, placar.total, 'som');
    setGravado(true);
    tocar('vitoria');
  };

  // --- leitura de tela ------------------------------------------------------
  const selecionadas = new Set(selecao ? posicoesDoTraco(selecao.a, selecao.b) : []);
  const carga = cargaPorPonto(estado);
  const talhaMin = talhaRecomendada(carga);
  const semCabo = estado.celulas.filter((c) => c.caixa === 'caixa' && !c.caboAco).length;
  const b = estado.briefing;

  const etapas = [
    { nome: 'Caixas', ok: contarNaFila(estado, 0) >= b.caixasPorLado && contarNaFila(estado, 1) >= b.caixasPorLado, ativa: camada === 'pa' },
    { nome: 'Ângulos', ok: [0, 1].every((f) => coberturaDoLado(estado, f).fecha), ativa: camada === 'cobertura' },
    { nome: 'Cabo de aço', ok: penduradas(estado) > 0 && semCabo === 0, ativa: ferramenta === 'cabo' },
    { nome: 'Içar', ok: estado.icado, ativa: !estado.icado && semCabo === 0 && penduradas(estado) > 0 },
    { nome: 'Amplificação', ok: estado.canaisPuxados > 0 && estado.celulas.every((c) => !c.caixa || c.canal !== null), ativa: camada === 'amplificacao' },
    { nome: 'Ligar', ok: estado.ligacao.length === ORDEM_LIGA.length, ativa: estado.icado },
  ];

  const corCelula = (i: number) => {
    const c = estado.celulas[i];
    if (!c.caixa) return 'rgba(255,255,255,0.045)';
    if (camada === 'amplificacao') return c.canal === null ? '#1E2A40' : CORES_CIRCUITO[(c.canal - 1) % CORES_CIRCUITO.length];
    if (camada === 'cobertura') {
      if (c.caixa !== 'caixa') return '#1E2A40';
      return c.angulo === null ? '#1E2A40' : `hsl(${210 - c.angulo * 22}, 60%, ${38 + c.angulo * 4}%)`;
    }
    if (c.caixa === 'caixa' && !c.caboAco) return '#7F1D1D';
    if (c.noAr) return '#8A5A22';
    return c.caixa === 'sub' ? '#3E4E7A' : '#4E93D8';
  };

  const rotuloCelula = (i: number) => {
    const c = estado.celulas[i];
    if (!c.caixa) return '';
    if (camada === 'amplificacao') return c.canal ?? '';
    if (camada === 'cobertura') return c.caixa === 'caixa' ? (c.angulo === null ? '' : `${c.angulo}`) : '';
    return c.caixa === 'sub' ? 'S' : 'C';
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
                Call Time <span className="text-[#336699]">· Som</span>
              </h1>
              <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-white/35">
                PA e line array
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-2xl font-black tabular-nums leading-none">{relogio(estado.gastos, janela)}</div>
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
            <span className="text-white/35 tabular-nums">OS {b.os}</span>
            <span className="px-2 py-0.5 rounded bg-[#336699]/25 border border-[#336699]/50 text-white font-black">
              {APLICACOES[b.aplicacao].rotulo}
            </span>
            <span className="text-white/50">{b.evento}</span>
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

          <div className="flex flex-col gap-3">
            {emJogo && (
              <div className="flex gap-1.5 flex-wrap">
                {([['pa', 'PA'], ['cobertura', 'Cobertura'], ['amplificacao', 'Amplificação']] as const).map(([id, rotulo]) => (
                  <button
                    key={id}
                    onClick={() => {
                      setCamada(id);
                      setFerramenta(id === 'pa' ? 'caixa' : id === 'cobertura' ? '2' : '1');
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
                    <span>{contarNaFila(estado, 0)}+{contarNaFila(estado, 1)} caixas · {contarNaFila(estado, 2)} subs</span>
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
                <Som3D
                  estado={estado}
                  camada={camada}
                  onPintar={(i) => { if (emJogo) aplicarEm([i]); }}
                  vistoriando={!emJogo}
                  foco={focoAtual}
                  orbitar={paLimpo && fase === 'vistoria'}
                  festa={paLimpo && !emJogo}
                  selecionadas={selecionadas}
                />
              </div>
            )}

            {vista === 'planta' && (
              <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/15 p-3 sm:p-4 flex flex-col gap-4 select-none">
                {FILAS.map((fila, f) => {
                  const cobertura = f < 2 ? coberturaDoLado(estado, f) : null;
                  return (
                    <div key={fila.id} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#4E93D8]">{fila.rotulo}</span>
                        <span className={`text-[9px] font-bold uppercase tracking-wider tabular-nums ${
                          cobertura && cobertura.caixas > 0 && !cobertura.fecha ? 'text-amber-400' : 'text-white/35'
                        }`}>
                          {cobertura
                            ? `${cobertura.soma}° de ${b.coberturaGraus}° · ${CAIXAS.caixa.ohms} Ω por caixa`
                            : `${CAIXAS.sub.rotulo} · ${CAIXAS.sub.ohms} Ω · ${CAIXAS.sub.watts} W`}
                        </span>
                      </div>
                      <div
                        className="grid gap-[3px]"
                        style={{ gridTemplateColumns: `repeat(${POSICOES_MAX}, minmax(0, 1fr))` }}
                        onPointerMove={(ev) => { if (ancora.current !== null) pintarNoPonto(ev.clientX, ev.clientY); }}
                      >
                        {Array.from({ length: POSICOES_MAX }, (_, p) => {
                          const i = indice(f, p);
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
                              } ${c.caixa === 'caixa' && !c.caboAco ? 'animate-pulse' : ''}`}
                              style={{ background: corCelula(i) }}
                              title={`${fila.rotulo} · posição ${p + 1}`}
                            >
                              <span className="text-[8px] font-black text-black/60 tabular-nums">{rotuloCelula(i)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <p className="text-[10px] text-white/35 leading-snug">
                  Nos lados, a posição 1 é a caixa de cima. Arraste para trabalhar várias de uma vez.
                </p>
              </div>
            )}

            {/* ferramentas */}
            {emJogo && (
              <div className="flex flex-wrap gap-1.5">
                {camada === 'pa' && (
                  <>
                    <BotaoFerramenta ativo={ferramenta === 'caixa'} onClick={() => setFerramenta('caixa')} cor="#4E93D8">
                      Caixa · −{custoPendurar('caixa', estado.icado)} min
                    </BotaoFerramenta>
                    <BotaoFerramenta ativo={ferramenta === 'cabo'} onClick={() => setFerramenta('cabo')} cor="#3E9E8F">
                      Cabo de aço · −{CUSTO.caboAco} min
                    </BotaoFerramenta>
                    <BotaoFerramenta ativo={ferramenta === 'remover'} onClick={() => setFerramenta('remover')} cor="#DC2626">
                      Remover · −{CUSTO.remover} min
                    </BotaoFerramenta>
                  </>
                )}

                {camada === 'cobertura' && ANGULOS.map((g) => (
                  <BotaoFerramenta
                    key={g}
                    ativo={ferramenta === String(g)}
                    onClick={() => setFerramenta(String(g))}
                    cor={`hsl(${210 - g * 22}, 60%, ${38 + g * 4}%)`}
                  >
                    {g}°
                  </BotaoFerramenta>
                ))}

                {camada === 'amplificacao' && (
                  <>
                    {Array.from({ length: estado.canaisPuxados }, (_, k) => (
                      <BotaoFerramenta
                        key={k + 1}
                        ativo={ferramenta === String(k + 1)}
                        onClick={() => setFerramenta(String(k + 1))}
                        cor={CORES_CIRCUITO[k % CORES_CIRCUITO.length]}
                      >
                        C{k + 1}
                      </BotaoFerramenta>
                    ))}
                    <button
                      onClick={puxar}
                      className="px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border border-dashed border-[#336699]/70 text-[#4E93D8] hover:bg-[#0C1D4D]/60 hover:text-white transition-all"
                    >
                      + Canal · {AMPLIFICADOR.minutos} min
                    </button>
                    {estado.canaisPuxados > 0 && (
                      <button
                        onClick={recolher}
                        disabled={!podeRecolherCanal(estado)}
                        className="px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border border-dashed border-white/20 text-white/50 hover:text-white hover:border-white/40 transition-all disabled:opacity-30"
                      >
                        − Recolher C{estado.canaisPuxados}
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
              <p className="text-xs text-white/45 leading-relaxed max-w-[62ch]">
                {camada === 'pa' && (
                  estado.icado
                    ? `O PA já subiu. Caixa nova agora custa ${MULT_NO_AR}× o tempo, e caixa voada sem cabo de aço reprova a partida.`
                    : 'Line array se arma no chão e sobe pronto: caixas nos dois lados, subs no piso à frente do palco. Cabo de aço em toda caixa que voa.'
                )}
                {camada === 'cobertura' && `Cada ângulo é a abertura para a caixa seguinte. A soma do lado tem que fechar os ${b.coberturaGraus}° que a plateia pede (tolerância de ${TOLERANCIA_GRAUS}°), e o ângulo abre de cima para baixo: caixa de cima joga longe, caixa de baixo cobre quem está perto. Mexer nisso com o PA no ar custa ${CUSTO_ANGULO_NO_AR} min por caixa.`}
                {camada === 'amplificacao' && `Canal de amplificador não desce de ${AMPLIFICADOR.ohmsMin} Ω. Caixa é de ${CAIXAS.caixa.ohms} Ω e sub é de ${CAIXAS.sub.ohms} Ω — quantas cabem por canal é conta sua. Quem passa disso põe o amplificador em proteção no meio do show.`}
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
                  <p className="text-[10px] font-bold text-red-400 leading-snug">Abaixo da carga. Içar assim é reprovação direta.</p>
                )}
                {semCabo > 0 && (
                  <p className="text-[10px] font-bold text-red-300 leading-snug">
                    {semCabo} {semCabo === 1 ? 'caixa sem cabo de aço' : 'caixas sem cabo de aço'}.
                  </p>
                )}
                <button
                  onClick={icar}
                  disabled={estado.icado || estado.talhaKg === null}
                  className="py-3 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40 bg-[#336699] text-white hover:bg-[#3d7bb5] active:scale-[0.98]"
                >
                  {estado.icado ? '✓ PA içado' : `Içar o PA · −${CUSTO.icar} min`}
                </button>
              </div>

              {/* subs e delay */}
              <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-3">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Ajuste fino</h2>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">Arranjo dos subs</span>
                  <div className="grid grid-cols-2 gap-1">
                    {(Object.keys(ARRANJOS) as Arranjo[]).map((id) => (
                      <button
                        key={id}
                        onClick={() => definirArranjo(id)}
                        className={`py-2 rounded text-[10px] font-black uppercase tracking-wider transition-all ${
                          estado.arranjo === id ? 'bg-[#336699] text-white' : 'bg-black/40 text-white/50 border border-[#284B8C]/30 hover:text-white'
                        }`}
                      >
                        {ARRANJOS[id].rotulo}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] text-white/35 leading-snug">
                    {estado.arranjo ? ARRANJOS[estado.arranjo].descricao : 'Depende de ter microfone aberto no palco.'}
                  </p>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                    Delay da torre · {b.torreM} m
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      value={delayDigitado}
                      onChange={(ev) => gravarDelay(ev.target.value)}
                      inputMode="numeric"
                      placeholder="ms"
                      className="flex-1 px-3 py-2 rounded-lg bg-black/50 border border-[#284B8C]/40 text-sm font-black tabular-nums text-white placeholder:text-white/25 outline-none focus:border-[#336699]"
                    />
                    <span className="text-[10px] font-black uppercase tracking-wider text-white/35">ms</span>
                  </div>
                </label>
              </div>

              {/* energização */}
              <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Energizar</h2>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-white/35 tabular-nums">
                    {estado.ligacao.length}/{ORDEM_LIGA.length}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(Object.keys(EQUIPAMENTOS) as Equipamento[]).map((id) => {
                    const ordem = estado.ligacao.indexOf(id);
                    return (
                      <button
                        key={id}
                        onClick={() => ligar(id)}
                        disabled={ordem >= 0}
                        className={`py-2.5 rounded text-[10px] font-black uppercase tracking-wider transition-all ${
                          ordem >= 0
                            ? 'bg-[#336699] text-white'
                            : 'bg-black/40 text-white/60 border border-[#284B8C]/30 hover:text-white'
                        }`}
                      >
                        {EQUIPAMENTOS[id].rotulo}
                        {ordem >= 0 && <span className="block text-[9px] font-bold text-white/60">{ordem + 1}º</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[9px] text-white/35 leading-snug">
                  A ordem em que você clica é a ordem em que o sistema liga. Inverter é estouro no PA.
                </p>
              </div>

              <button
                onClick={fechar}
                disabled={fase === 'os'}
                className="py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-40 bg-white text-black hover:bg-white/90 active:scale-[0.98]"
              >
                Fechar e passar som
                <span className="block text-[9px] font-bold text-black/50 tracking-normal normal-case mt-0.5">
                  canais, multicabo, palco e ring out −{custoFechamento(estado)} min no total
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
          delay={osDelay}
          canais={osCanais}
          conferencia={conferencia}
          onDelay={setOsDelay}
          onCanais={setOsCanais}
          onConfirmar={confirmarLeitura}
          onDesistir={liberarSemAcertar}
        />
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
                {relogio(janela, janela)} · Passagem de som
              </span>

              {passo < 0 && !paLimpo && (
                <p className="text-lg sm:text-2xl font-black text-white leading-tight">
                  Casa aberta em minutos. Vamos ver o que ficou para trás.
                </p>
              )}
              {passo < 0 && paLimpo && (
                <p className="text-lg sm:text-2xl font-black text-[#4E93D8] leading-tight">
                  Cobertura fechada, impedância dentro do limite, sistema ligado na ordem. Passagem limpa.
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
                  {placar.reprovado ? 'Reprovado' : 'Som entregue'}
                </h2>
              </div>

              {placar.reprovado ? (
                <p className="text-sm text-red-200/80 leading-relaxed">
                  Falha de segurança ou de entrega zera a partida, independente do tempo. Meia plateia sem som não é apontamento de minutos — é o evento que não aconteceu.
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

              <LicaoAmplificacao estado={estado} />
              <LicaoCobertura estado={estado} />

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

              {!emTurno && podeGravar && !gravado && (
                <div className="rounded-xl border border-[#336699]/50 bg-[#0C1D4D]/30 p-4 flex flex-col gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#4E93D8]">
                    {placar.total} pontos · {posicaoNoRanking(placar.total, 'som')}º lugar hoje
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

              {!emTurno && ranking.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Melhores de hoje · som</span>
                  {ranking.map((m, k) => (
                    <div key={`${m.apelido}-${m.quando}`} className="flex items-baseline justify-between text-xs font-bold tabular-nums text-white/70">
                      <span>{k + 1}. {m.apelido}</span>
                      <span>{m.pontos}</span>
                    </div>
                  ))}
                </div>
              )}

              {emTurno ? (
                <Link
                  href={ROTA_SALAO}
                  className="py-4 rounded-xl bg-white text-black text-xs font-black uppercase tracking-widest text-center hover:bg-white/90 transition-colors"
                >
                  Voltar ao salão
                </Link>
              ) : (
                <>
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
                </>
              )}
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

function CartaoOS({ estado, portaAbre }: { estado: EstadoSom; portaAbre: string }) {
  const b = estado.briefing;
  return (
    <div className="rounded-xl border border-[#284B8C]/30 bg-black/40 p-4 flex flex-col gap-2">
      <span className="text-[10px] font-black uppercase tracking-widest text-[#336699]">OS {b.os}</span>
      <CampoOS rotulo="Caixas por lado">{b.caixasPorLado}</CampoOS>
      <CampoOS rotulo="Subs">{b.subs}</CampoOS>
      <CampoOS rotulo="Cobertura da plateia">{b.coberturaGraus}°</CampoOS>
      <CampoOS rotulo="Torre de delay">{b.torreM} m</CampoOS>
      <CampoOS rotulo="Porta abre">{portaAbre}</CampoOS>
    </div>
  );
}

function ModalOS({
  estado, delay, canais, conferencia, onDelay, onCanais, onConfirmar, onDesistir,
}: {
  estado: EstadoSom;
  delay: string;
  canais: string;
  conferencia: ConferenciaOS | null;
  onDelay: (v: string) => void;
  onCanais: (v: string) => void;
  onConfirmar: () => void;
  onDesistir: () => void;
}) {
  const b: BriefingSom = estado.briefing;
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
            <p className="text-xs text-white/50 leading-relaxed mt-1">{APLICACOES[b.aplicacao].descricao}</p>
          </div>

          <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-2">
            <CampoOS rotulo="Caixas por lado">{b.caixasPorLado}</CampoOS>
            <CampoOS rotulo="Subs">{b.subs}</CampoOS>
            <CampoOS rotulo="Cobertura da plateia">{b.coberturaGraus}°</CampoOS>
            <CampoOS rotulo="Torre de delay">{b.torreM} m do PA</CampoOS>
            <CampoOS rotulo="Porta abre">{relogio(b.janelaMin, b.janelaMin)}</CampoOS>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-white/50">
              Antes de encostar no PA: as duas contas
            </span>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Delay da torre, em ms</span>
              <input
                value={delay}
                onChange={(ev) => onDelay(ev.target.value)}
                inputMode="numeric"
                placeholder="0"
                className={`px-3 py-2.5 rounded-lg bg-black/50 border text-sm font-black tabular-nums text-white outline-none ${
                  conferencia && !conferencia.delayOk ? 'border-red-500/60' : 'border-[#284B8C]/40 focus:border-[#336699]'
                }`}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">Canais de amplificador</span>
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
          </div>

          {tentativas === 1 && (
            <p className="text-xs text-amber-200/80 leading-relaxed">
              O escritório respondeu: som anda {VELOCIDADE_SOM} m/s. E o canal do amplificador não desce de {AMPLIFICADOR.ohmsMin} Ω — caixa é de {CAIXAS.caixa.ohms} Ω, sub é de {CAIXAS.sub.ohms} Ω.
            </p>
          )}

          {tentativas >= 2 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">As contas</span>
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
              Entrar na obra com as contas prontas
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

function LicaoAmplificacao({ estado }: { estado: EstadoSom }) {
  const l = licaoAmplificacao(estado);
  if (l.puxados === 0) return null;
  const limpo = l.emProtecao === 0 && l.minutos === l.minutosIdeal;

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${
      limpo ? 'border-[#336699]/50 bg-[#0C1D4D]/30' : 'border-amber-500/40 bg-amber-950/20'
    }`}>
      <span className={`text-[10px] font-black uppercase tracking-widest ${limpo ? 'text-[#4E93D8]' : 'text-amber-400'}`}>
        Amplificação · {l.minutos} min{limpo ? ', o mínimo possível' : ` — dava para fazer em ${l.minutosIdeal}`}
      </span>
      <p className="text-xs text-white/75 leading-relaxed tabular-nums">{l.conta}.</p>
      <p className="text-xs text-white/75 leading-relaxed tabular-nums">
        {l.minimo} {l.minimo === 1 ? 'canal bastava' : 'canais bastavam'}, e você puxou {l.puxados}.
      </p>
      <div className="flex flex-wrap gap-1">
        {l.linhas.map((c) => (
          <span
            key={c.canal}
            className={`px-2 py-0.5 rounded text-[10px] font-black tabular-nums border ${
              c.situacao === 'protecao' ? 'border-red-500/60 bg-red-950/40 text-red-200'
                : c.situacao === 'sobra' ? 'border-amber-500/40 bg-amber-950/30 text-amber-100'
                : 'border-[#336699]/60 bg-[#0C1D4D]/50 text-white'
            }`}
          >
            C{c.canal} · {c.caixas} × {Number.isFinite(c.ohms) ? `${c.ohms.toFixed(1).replace('.', ',')} Ω` : 'vazio'}
          </span>
        ))}
      </div>
    </div>
  );
}

function LicaoCobertura({ estado }: { estado: EstadoSom }) {
  const l = licaoCobertura(estado);
  const limpo = l.lados.every((lado) => lado.caixas === 0 || (lado.fecha && lado.invertidos.length === 0))
    && l.arranjo === l.arranjoCerto
    && l.delayMs !== null && Math.abs(l.delayMs - l.delayCerto) <= 3;

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${
      limpo ? 'border-[#336699]/50 bg-[#0C1D4D]/30' : 'border-amber-500/40 bg-amber-950/20'
    }`}>
      <span className={`text-[10px] font-black uppercase tracking-widest ${limpo ? 'text-[#4E93D8]' : 'text-amber-400'}`}>
        Cobertura e tempo
      </span>
      <div className="flex flex-wrap gap-1">
        {l.lados.map((lado, k) => (
          <span
            key={k}
            className={`px-2 py-0.5 rounded text-[10px] font-black tabular-nums border ${
              lado.caixas === 0 ? 'border-white/15 bg-white/[0.03] text-white/40'
                : lado.fecha ? 'border-[#336699]/60 bg-[#0C1D4D]/50 text-white'
                : 'border-amber-500/40 bg-amber-950/30 text-amber-100'
            }`}
          >
            {FILAS[k].rotulo} · {lado.soma}° de {l.pedido}°
          </span>
        ))}
      </div>
      <p className="text-xs text-white/75 leading-relaxed tabular-nums">
        Delay: {l.torreM} m ÷ {VELOCIDADE_SOM} m/s = <strong className="text-white">{l.delayCerto} ms</strong>
        {l.delayMs === null ? ' · você deixou a torre sem delay' : ` · você programou ${l.delayMs} ms`}.
      </p>
      <p className="text-xs text-white/75 leading-relaxed">
        Subs: o certo neste evento era <strong className="text-white">{ARRANJOS[l.arranjoCerto].rotulo.toLowerCase()}</strong>
        {l.arranjo && l.arranjo !== l.arranjoCerto ? `, e você montou em ${ARRANJOS[l.arranjo].rotulo.toLowerCase()}` : ''}. {l.porqueArranjo}
      </p>
    </div>
  );
}
