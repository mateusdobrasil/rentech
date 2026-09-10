"use client";

// ============================================================================
// CALL TIME — Fase 1: painel de LED jogável (protótipo 2D)
//
// O objetivo desta fase é validar UMA tese: penalizar erro com retrabalho (em
// minutos do relógio) é mais divertido e ensina melhor que penalizar com
// "errado". O 3D só entra na Fase 2, depois que a mecânica se provar.
//
// Toda a regra vive em app/jogo/montagem/motor.ts — aqui é só interação.
// ============================================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import QRCode from 'qrcode';
import BackButton from '../BackButton';
import { useSom } from '../useSom';
import { CORES_CIRCUITO, CORES_PORTA } from '../../jogo/montagem/cores';
import {
  lerRanking, gravarMarca, entraNoRanking, posicaoDe, limparApelido, APELIDO_MAX,
} from '../../jogo/montagem/ranking';
import {
  COLUNAS_MAX,
  janelaDe,
  minutoImprevisto,
  GABINETES_POR_CIRCUITO,
  PX_POR_PORTA,
  pxPorGabinete,
  APLICACOES,
  medidasM,
  PROCESSADORAS,
  acharProcessadora,
  aplicarImprevisto,
  gabinetesDoImprevisto,
  portasDisponiveis,
  tetoPorPorta,
  portasNecessarias,
  circuitosNecessarios,
  colunaDe,
  CUSTO_TROCA_PROCESSADORA,
  TALHAS_KG,
  CUSTO,
  PENALIDADE,
  CUSTO_TALHA_FOLGADA,
  criarPartida,
  celulaAtiva,
  linhaDe,
  relogio,
  folga,
  cargaPorPonto,
  talhaRecomendada,
  contarPorCircuito,
  contarPorPorta,
  distribuirAtribuicao,
  limparAtribuicao,
  gabinetesInstalados,
  gabinetesPedidos,
  resolucao,
  vistoriar,
  pontuar,
  type Estado,
} from '../../jogo/montagem/motor';

type Camada = 'estrutura' | 'energia' | 'sinal';
type Vista = 'palco' | 'planta';
/** Quantas células um toque atinge. Montador real trabalha por fiada, não por peça. */
type Pincel = 'celula' | 'coluna' | 'fiada';

// O 3D só existe no navegador (usa WebGL), então entra por dynamic sem SSR —
// mesmo padrão do Truss3D em /simulador/boxtruss.
const Palco3D = dynamic(() => import('../../jogo/montagem/Palco3D'), {
  ssr: false,
  loading: () => (
    <div className="h-[52vh] min-h-[22rem] rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/15 flex items-center justify-center">
      <span className="text-[10px] font-black uppercase tracking-widest text-white/30">
        Montando o palco…
      </span>
    </div>
  ),
});

type Toast = { id: number; texto: string; tom: 'custo' | 'penal' | 'ok' };
type Fase = 'jogando' | 'vistoria' | 'placar';

/** Para onde o QR do fim aponta. Trocar por um wa.me quando o comercial definir. */
const URL_CONTATO = 'https://rentech.tech';

/** Modo feira: sem toque nenhum por tanto tempo, a máquina se prepara sozinha. */
const OCIO_MS = 120_000;
const BEAT_ABERTURA_MS = 2_600;
const BEAT_PROBLEMA_MS = 3_800;
const BEAT_LIMPO_MS = 5_400;

export default function CallTimeMontagem() {
  const [estado, setEstado] = useState<Estado>(criarPartida);
  const [camada, setCamada] = useState<Camada>('estrutura');
  const [vista, setVista] = useState<Vista>('palco');
  const [ferramenta, setFerramenta] = useState<string>('gabinete');
  const [pincel, setPincel] = useState<Pincel>('celula');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [imprevisto, setImprevisto] = useState(false);
  const [fase, setFase] = useState<Fase>('jogando');
  const [passo, setPasso] = useState(-1);
  const [apelido, setApelido] = useState('');
  const [gravado, setGravado] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');

  const pintando = useRef(false);
  const toastId = useRef(0);
  const { iniciar, tocar } = useSom();

  // --- feedback -------------------------------------------------------------
  const toast = useCallback((texto: string, tom: Toast['tom'] = 'custo') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, texto, tom }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  // --- aplica uma mudança e checa o imprevisto das 16:00 --------------------
  const aplicar = useCallback((fn: (e: Estado) => Estado) => {
    setEstado((anterior) => {
      const proximo = fn(anterior);
      if (!proximo.imprevistoDisparado && proximo.gastos >= minutoImprevisto(proximo)) {
        setImprevisto(true);
        return aplicarImprevisto(proximo);
      }
      return proximo;
    });
  }, []);

  // --- pintura na grade -----------------------------------------------------

  /** Células que um toque em `i` atinge, conforme o pincel escolhido. */
  const celulasDoPincel = useCallback((i: number, e: Estado): number[] => {
    if (pincel === 'celula') return [i];
    const linha = linhaDe(i);
    const coluna = colunaDe(i);
    const fora: number[] = [];
    if (pincel === 'coluna') {
      for (let l = 0; l < e.linhas; l++) fora.push(l * COLUNAS_MAX + coluna);
    } else {
      for (let c = 0; c < e.colunas; c++) fora.push(linha * COLUNAS_MAX + c);
    }
    return fora;
  }, [pincel]);

  const pintar = useCallback((i: number) => {
    aplicar((e) => {
      if (e.finalizado) return e;
      const alvos = celulasDoPincel(i, e).filter((k) => celulaAtiva(e, k));
      if (alvos.length === 0) return e;

      // --- energia e sinal: planejamento, não consomem relógio aqui. O
      // fechamento do cabeamento é cobrado de uma vez no "Fechar montagem".
      if (camada !== 'estrutura') {
        const campo = camada === 'energia' ? 'circuito' : 'porta';
        if (ferramenta === 'limpar') {
          const { celulas, mudou } = limparAtribuicao(e, alvos, campo);
          return mudou ? { ...e, celulas } : e;
        }
        const { celulas, ultimo, mudou } = distribuirAtribuicao(e, alvos, campo, Number(ferramenta));
        if (!mudou) return e;
        // A paleta acompanha para onde o pincel derramou.
        if (String(ultimo) !== ferramenta) setFerramenta(String(ultimo));
        return { ...e, celulas };
      }

      // --- estrutura: instalar e remover gabinete, aí sim custa relógio
      let celulas = e.celulas;
      let gastos = e.gastos;
      let retrabalho = e.retrabalho;
      let mudou = false;
      const copiar = () => { if (celulas === e.celulas) celulas = [...e.celulas]; };

      for (const k of alvos) {
        const celula = celulas[k];
        if (ferramenta === 'gabinete') {
          if (celula.instalado) continue;
          copiar();
          celulas[k] = { ...celula, instalado: true, instaladoNoAr: e.icado };
          gastos += e.icado ? CUSTO.instalarAr : CUSTO.instalarChao;
          // montar no ar custa a diferença a mais: isso é retrabalho
          if (e.icado) retrabalho += CUSTO.instalarAr - CUSTO.instalarChao;
          mudou = true;
        } else if (ferramenta === 'remover') {
          if (!celula.instalado) continue;
          copiar();
          celulas[k] = { instalado: false, instaladoNoAr: false, circuito: null, porta: null };
          gastos += CUSTO.remover;
          retrabalho += CUSTO.remover;
          mudou = true;
        }
      }

      return mudou ? { ...e, celulas, gastos, retrabalho } : e;
    });
  }, [aplicar, camada, ferramenta, celulasDoPincel]);

  // Hit-test manual: pointerenter não dispara durante arrasto por toque.
  const pintarNoPonto = useCallback((x: number, y: number) => {
    const alvo = document.elementFromPoint(x, y) as HTMLElement | null;
    const attr = alvo?.dataset?.idx;
    if (attr !== undefined) pintar(Number(attr));
  }, [pintar]);

  useEffect(() => {
    const soltar = () => { pintando.current = false; };
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
    return () => {
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
    };
  }, []);

  // --- ações ----------------------------------------------------------------
  const conferirPrumo = () => {
    iniciar(); tocar('sucesso', 700);
    toast(`Prumo e nível conferidos · −${CUSTO.conferirPrumo} min`);
    aplicar((e) => ({ ...e, prumoConferido: true, gastos: e.gastos + CUSTO.conferirPrumo }));
  };

  const escolherTalha = (kg: number) => {
    iniciar(); tocar('clique', 500);
    aplicar((e) => ({ ...e, talhaKg: kg }));
  };

  const icar = () => {
    iniciar();
    const semPrumo = !estado.prumoConferido;
    const extraTalha = CUSTO_TALHA_FOLGADA[estado.talhaKg ?? 1000] ?? 0;

    if (semPrumo) {
      tocar('erro');
      toast(`Painel subiu torto e desceu de volta · −${PENALIDADE.semPrumo} min`, 'penal');
    } else {
      tocar('vitoria');
      toast(`Painel içado · −${CUSTO.icar} min`, 'ok');
    }
    if (extraTalha > 0) {
      toast(`Talha superdimensionada, peso e gente a mais · −${extraTalha} min`, 'penal');
    }

    aplicar((e) => ({
      ...e,
      icado: true,
      gastos: e.gastos + CUSTO.icar + extraTalha + (semPrumo ? PENALIDADE.semPrumo : 0),
      retrabalho: e.retrabalho + (semPrumo ? PENALIDADE.semPrumo : 0),
    }));
  };

  const hubExtra = () => {
    iniciar(); tocar('clique', 450);
    toast(`Segundo hub buscado, +5 circuitos · −${CUSTO.hubExtra} min`);
    aplicar((e) => ({
      ...e,
      circuitosDisponiveis: e.circuitosDisponiveis + 5,
      gastos: e.gastos + CUSTO.hubExtra,
    }));
  };

  /** A primeira processadora é escolha de projeto e sai de graça; trocar custa. */
  const escolherProcessadora = (id: string) => {
    iniciar(); tocar('clique', 520);
    aplicar((e) => {
      if (e.processadoraId === id) return e;
      const troca = e.processadoraId !== null;
      if (troca) toast(`Re-rack e remapeamento · −${CUSTO_TROCA_PROCESSADORA} min`, 'penal');
      return {
        ...e,
        processadoraId: id,
        trocasProcessadora: e.trocasProcessadora + (troca ? 1 : 0),
        gastos: e.gastos + (troca ? CUSTO_TROCA_PROCESSADORA : 0),
        retrabalho: e.retrabalho + (troca ? CUSTO_TROCA_PROCESSADORA : 0),
        // portas mudaram: atribuições acima do novo limite viram inválidas na
        // vistoria, então é honesto zerar e obrigar a redistribuir.
        celulas: troca ? e.celulas.map((c) => ({ ...c, porta: null })) : e.celulas,
      };
    });
  };

  const finalizar = () => {
    iniciar(); tocar('vitoria');
    const setup = acharProcessadora(estado.processadoraId)?.setupMin ?? 0;
    aplicar((e) => ({
      ...e,
      finalizado: true,
      gastos: e.gastos + CUSTO.fecharEnergia + CUSTO.fecharSinal + CUSTO.testar + CUSTO.acabamento + setup,
    }));
    setVista('palco');   // a vistoria acontece no 3D, não na planta
    setPasso(-1);
    setFase('vistoria');
  };

  const reiniciar = useCallback(() => {
    setEstado(criarPartida());
    setCamada('estrutura');
    setVista('palco');
    setFerramenta('gabinete');
    setToasts([]);
    setImprevisto(false);
    setFase('jogando');
    setPasso(-1);
    setApelido('');
    setGravado(false);
  }, []);

  // --- derivados ------------------------------------------------------------
  const porCircuito = contarPorCircuito(estado);
  const porPorta = contarPorPorta(estado);
  const instalados = gabinetesInstalados(estado);
  const pedidos = gabinetesPedidos(estado);
  const carga = cargaPorPonto(estado);
  const talhaMin = talhaRecomendada(carga);
  const res = resolucao(estado);
  const janela = janelaDe(estado);
  const restante = folga(estado);
  const progresso = Math.min(100, (estado.gastos / janela) * 100);
  const estourou = estado.gastos >= janela;

  const circuitosCheios = [...porCircuito.values()].filter((n) => n > GABINETES_POR_CIRCUITO).length;
  const portasCheias = [...porPorta.values()].filter((n) => n > tetoPorPorta(estado)).length;

  // Quanta infraestrutura o painel contratado exige. Mostrar isso ANTES do erro
  // é o que transforma o jogo de "adivinhe a regra" em "decida com a regra".
  const medidas = medidasM(estado);
  const precisaCircuitos = circuitosNecessarios(estado);
  const precisaPortas = portasNecessarias(estado);
  const faltamCircuitos = precisaCircuitos > estado.circuitosDisponiveis;
  const faltamPortas = precisaPortas > portasDisponiveis(estado);

  const semCircuito = estado.celulas.filter(
    (c, i) => celulaAtiva(estado, i) && c.instalado && c.circuito === null).length;
  const semPorta = estado.celulas.filter(
    (c, i) => celulaAtiva(estado, i) && c.instalado && c.porta === null).length;

  // Onde o jogador está na sequência. É a espinha do jogo, então fica à vista.
  const etapas = [
    { nome: 'Montar', ok: instalados === pedidos, ativa: !estado.icado },
    { nome: 'Içar', ok: estado.icado, ativa: instalados === pedidos && !estado.icado },
    { nome: 'Energia', ok: instalados > 0 && semCircuito === 0, ativa: estado.icado && semCircuito > 0 },
    { nome: 'Sinal', ok: instalados > 0 && semPorta === 0, ativa: estado.icado && semCircuito === 0 && semPorta > 0 },
    { nome: 'Fechar', ok: estado.finalizado, ativa: estado.icado && semCircuito === 0 && semPorta === 0 },
  ];

  const vistoria = estado.finalizado ? vistoriar(estado) : null;
  const placar = vistoria ? pontuar(estado, vistoria) : null;
  const problemas = vistoria?.problemas ?? [];
  const montagemLimpa = estado.finalizado && problemas.length === 0;
  const focoAtual = fase === 'vistoria' && passo >= 0 ? problemas[passo] ?? null : null;

  // Lido direto no render, sem memo nem efeito. Um efeito com setState o React
  // 19 reclama, e um memo precisaria de uma dependência inventada só para
  // invalidar. Como gravar uma marca já dispara re-render, ler aqui sempre
  // devolve a lista atual — e é um JSON pequeno, lido só com o placar aberto.
  const ranking = fase === 'placar' ? lerRanking() : [];

  const podeGravar = placar !== null && !placar.reprovado && entraNoRanking(placar.total);

  const registrarMarca = () => {
    if (!placar || !limparApelido(apelido)) return;
    gravarMarca(apelido, placar.total);
    setGravado(true);
    tocar('vitoria');
  };

  // --- ritmo da vistoria: um problema por vez, e a câmera segue ------------
  useEffect(() => {
    if (fase !== 'vistoria') return;
    const duracao = montagemLimpa
      ? BEAT_LIMPO_MS
      : passo < 0 ? BEAT_ABERTURA_MS : BEAT_PROBLEMA_MS;

    const id = setTimeout(() => {
      if (passo + 1 >= problemas.length) setFase('placar');
      else setPasso(passo + 1);
    }, duracao);
    return () => clearTimeout(id);
  }, [fase, passo, problemas.length, montagemLimpa]);

  // --- QR de contato ------------------------------------------------------
  useEffect(() => {
    let cancelado = false;
    QRCode.toDataURL(URL_CONTATO, { margin: 0, width: 256, color: { dark: '#0C1D4D', light: '#ffffff' } })
      .then((url) => { if (!cancelado) setQrDataUrl(url); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, []);

  // --- modo feira: volta pro início sozinho depois de um tempo parado -----
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

  // --- cor de cada célula ---------------------------------------------------
  const corCelula = (i: number) => {
    const c = estado.celulas[i];
    if (!celulaAtiva(estado, i)) return 'transparent';
    if (!c.instalado) return 'rgba(255,255,255,0.03)';
    if (camada === 'energia') {
      return c.circuito === null ? '#1E2A40' : CORES_CIRCUITO[(c.circuito - 1) % CORES_CIRCUITO.length];
    }
    if (camada === 'sinal') {
      return c.porta === null ? '#1E2A40' : CORES_PORTA[(c.porta - 1) % CORES_PORTA.length];
    }
    return c.instaladoNoAr ? '#8A5A22' : '#336699';
  };

  const rotuloCelula = (i: number) => {
    const c = estado.celulas[i];
    if (!c.instalado || !celulaAtiva(estado, i)) return '';
    if (camada === 'energia') return c.circuito ?? '';
    if (camada === 'sinal') return c.porta ?? '';
    return '';
  };

  return (
    <>
      <BackButton />

      <div className="min-h-[calc(100vh-5rem)] bg-black bg-[radial-gradient(circle_at_20%_20%,_rgba(12,29,77,0.45)_0%,_transparent_50%),radial-gradient(circle_at_85%_75%,_rgba(51,102,153,0.18)_0%,_transparent_50%)] text-white select-none">

        {/* ---------------- barra de call time ---------------- */}
        <div className="sticky top-0 z-40 bg-black/85 backdrop-blur border-b border-[#284B8C]/30 px-4 py-3">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Call Time</span>
              <span className={`text-2xl font-black tabular-nums ${estourou ? 'text-red-400' : 'text-white'}`}>
                {relogio(estado.gastos, janela)}
              </span>
            </div>

            <div className="flex-1 min-w-[10rem] h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${estourou ? 'bg-red-500' : 'bg-[#336699]'}`}
                style={{ width: `${progresso}%` }}
              />
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Folga</span>
              <span className={`text-lg font-black tabular-nums ${restante < 40 ? 'text-amber-400' : 'text-white'}`}>
                {restante}
              </span>
              <span className="text-[10px] text-white/40 font-bold">min</span>
            </div>

            {estado.retrabalho > 0 && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-red-400/70">Retrabalho</span>
                <span className="text-lg font-black tabular-nums text-red-400">−{estado.retrabalho}</span>
              </div>
            )}

            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Painel</span>
              <span className="text-lg font-black tabular-nums text-white">{instalados}/{pedidos}</span>
            </div>
          </div>

          {/* a obra da vez: muda a cada partida, então tem que estar sempre legível */}
          <div className="max-w-6xl mx-auto mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wider">
            <span className="px-2 py-0.5 rounded bg-[#336699]/25 border border-[#336699]/50 text-white font-black">
              {APLICACOES[estado.briefing.aplicacao].rotulo}
            </span>
            <span className="text-white/50">{estado.briefing.evento}</span>
            <span className="text-white/20">·</span>
            <span className="text-white/60 tabular-nums">
              {medidas.largura.toFixed(1).replace('.', ',')} × {medidas.altura.toFixed(1).replace('.', ',')} m
            </span>
            <span className="text-white/20">·</span>
            <span className="text-[#4E93D8] font-black">{estado.briefing.pitch}</span>
            <span className="text-white/20">·</span>
            <span className="text-white/40 tabular-nums">{res.x} × {res.y} px</span>
          </div>

          {/* trilha das etapas: a ordem é o jogo, então ela fica sempre à vista */}
          {fase === 'jogando' && (
            <div className="max-w-6xl mx-auto mt-2.5 flex items-center gap-1">
              {etapas.map((et, k) => (
                <div key={et.nome} className="flex items-center gap-1 flex-1 min-w-0">
                  <div
                    className={`flex-1 min-w-0 px-2 py-1 rounded text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-center truncate border transition-colors ${
                      et.ok
                        ? 'border-[#336699]/60 bg-[#336699]/25 text-white'
                        : et.ativa
                          ? 'border-amber-400/70 bg-amber-400/10 text-amber-300'
                          : 'border-white/10 bg-white/[0.03] text-white/30'
                    }`}
                  >
                    {et.ok ? '✓ ' : ''}{et.nome}
                  </div>
                  {k < etapas.length - 1 && <span className="text-white/15 text-[9px] shrink-0">›</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`max-w-6xl mx-auto px-4 py-6 grid gap-6 items-start ${fase === 'jogando' ? 'lg:grid-cols-[1fr_20rem]' : 'grid-cols-1'}`}>

          {/* ---------------- grade do painel ---------------- */}
          <div className="flex flex-col gap-3">

            {/* camadas */}
            {fase === 'jogando' && (
            <div className="flex gap-1.5 flex-wrap">
              {([
                ['estrutura', 'Estrutura'],
                ['energia', 'Energia'],
                ['sinal', 'Sinal'],
              ] as const).map(([id, rotulo]) => (
                <button
                  key={id}
                  onClick={() => {
                    setCamada(id);
                    setFerramenta(id === 'estrutura' ? 'gabinete' : '1');
                  }}
                  className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
                    camada === id
                      ? 'bg-[#336699] text-white'
                      : 'bg-[#0C1D4D]/30 text-white/50 border border-[#284B8C]/30 hover:text-white'
                  }`}
                >
                  {rotulo}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-3">
                <span className="hidden sm:flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-white/40">
                  <span>{res.x} × {res.y} px</span>
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

            {/* palco 3D */}
            {vista === 'palco' && (
              <div className={`rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/15 overflow-hidden ${
                fase === 'jogando' ? 'h-[52vh] min-h-[22rem]' : 'h-[68vh] min-h-[26rem]'
              }`}>
                <Palco3D
                  estado={estado}
                  camada={camada}
                  onPintar={pintar}
                  vistoriando={fase !== 'jogando'}
                  foco={focoAtual}
                  orbitar={montagemLimpa && fase === 'vistoria'}
                  telaModo={montagemLimpa ? 'show' : 'teste'}
                />
              </div>
            )}

            {/* planta 2D */}
            {vista === 'planta' && (
            <div
              className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/15 p-3 touch-none"
              onPointerDown={(e) => {
                iniciar();
                pintando.current = true;
                pintarNoPonto(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (pintando.current) pintarNoPonto(e.clientX, e.clientY);
              }}
            >
              <div
                className="grid gap-[3px]"
                style={{ gridTemplateColumns: `repeat(${estado.colunas}, minmax(0, 1fr))` }}
              >
                {estado.celulas.map((c, i) => {
                  const ativa = celulaAtiva(estado, i);
                  const nova = estado.imprevistoDisparado && (linhaDe(i) >= estado.briefing.linhas || colunaDe(i) >= estado.briefing.colunas);
                  return (
                    <div
                      key={i}
                      data-idx={i}
                      className={`aspect-square rounded-[3px] flex items-center justify-center text-[9px] md:text-[11px] font-black tabular-nums transition-colors ${
                        ativa ? 'cursor-pointer' : 'pointer-events-none opacity-0'
                      } ${nova && !c.instalado ? 'ring-1 ring-amber-400/60' : ''}`}
                      style={{
                        backgroundColor: corCelula(i),
                        color: 'rgba(0,0,0,0.65)',
                      }}
                    >
                      {rotuloCelula(i)}
                    </div>
                  );
                })}
              </div>
            </div>
            )}

            {/* pincel: 1 peça, coluna ou fiada inteira */}
            {fase === 'jogando' && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-white/35">Pincel</span>
                <div className="flex rounded-lg overflow-hidden border border-[#284B8C]/40">
                  {([['celula', '1 peça'], ['coluna', 'Coluna'], ['fiada', 'Fiada']] as const).map(([id, rotulo]) => (
                    <button
                      key={id}
                      onClick={() => setPincel(id)}
                      className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                        pincel === id ? 'bg-[#336699] text-white' : 'bg-black/40 text-white/45 hover:text-white'
                      }`}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* paleta */}
            {fase === 'jogando' && (
            <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/15 p-3 flex flex-wrap gap-1.5">
              {camada === 'estrutura' && (
                <>
                  <BotaoFerramenta
                    ativo={ferramenta === 'gabinete'}
                    onClick={() => setFerramenta('gabinete')}
                    cor="#336699"
                  >
                    Gabinete · −{estado.icado ? CUSTO.instalarAr : CUSTO.instalarChao} min
                  </BotaoFerramenta>
                  <BotaoFerramenta
                    ativo={ferramenta === 'remover'}
                    onClick={() => setFerramenta('remover')}
                    cor="#DC2626"
                  >
                    Remover · −{CUSTO.remover} min
                  </BotaoFerramenta>
                </>
              )}

              {camada === 'energia' && (
                <>
                  {Array.from({ length: estado.circuitosDisponiveis }, (_, k) => {
                    const n = k + 1;
                    const qtd = porCircuito.get(n) ?? 0;
                    const cheio = qtd > GABINETES_POR_CIRCUITO;
                    return (
                      <BotaoFerramenta
                        key={n}
                        ativo={ferramenta === String(n)}
                        onClick={() => setFerramenta(String(n))}
                        cor={CORES_CIRCUITO[k % CORES_CIRCUITO.length]}
                        alerta={cheio}
                      >
                        C{n} · {qtd}/{GABINETES_POR_CIRCUITO}
                      </BotaoFerramenta>
                    );
                  })}
                  <BotaoFerramenta ativo={ferramenta === 'limpar'} onClick={() => setFerramenta('limpar')} cor="#64748B">
                    Limpar
                  </BotaoFerramenta>
                </>
              )}

              {camada === 'sinal' && (
                <>
                  {Array.from({ length: portasDisponiveis(estado) }, (_, k) => {
                    const n = k + 1;
                    const qtd = porPorta.get(n) ?? 0;
                    const cheia = qtd > tetoPorPorta(estado);
                    return (
                      <BotaoFerramenta
                        key={n}
                        ativo={ferramenta === String(n)}
                        onClick={() => setFerramenta(String(n))}
                        cor={CORES_PORTA[k % CORES_PORTA.length]}
                        alerta={cheia}
                      >
                        P{n} · {qtd}/{tetoPorPorta(estado)}
                      </BotaoFerramenta>
                    );
                  })}
                  <BotaoFerramenta ativo={ferramenta === 'limpar'} onClick={() => setFerramenta('limpar')} cor="#64748B">
                    Limpar
                  </BotaoFerramenta>
                </>
              )}
            </div>
            )}

            {/* dica da camada */}
            {fase === 'jogando' && (
            <p className="text-xs text-white/45 leading-relaxed max-w-[60ch]">
              {camada === 'estrutura' && (
                estado.icado
                  ? `O painel já subiu. Gabinete instalado agora custa ${CUSTO.instalarAr} min em vez de ${CUSTO.instalarChao} — é o preço de montar no ar.`
                  : 'Arraste sobre a grade para instalar os gabinetes com a estrutura ainda deitada no chão. É assim que se monta de verdade: o painel sobe pronto.'
              )}
              {camada === 'energia' && `Cada circuito de 16 A aguenta ${GABINETES_POR_CIRCUITO} gabinetes em série. Passar disso derruba o disjuntor no meio do evento.`}
              {camada === 'sinal' && `Cada porta do processador aguenta ${PX_POR_PORTA.toLocaleString('pt-BR')} px — ${tetoPorPorta(estado)} gabinetes de ${pxPorGabinete(estado.briefing.pitch).toLocaleString('pt-BR')} px no ${estado.briefing.pitch}.`}
            </p>
            )}
          </div>

          {/* ---------------- painel de ações ---------------- */}
          {fase === 'jogando' && (
          <aside className="flex flex-col gap-3">

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
                        estado.talhaKg === kg
                          ? 'bg-[#336699] text-white'
                          : 'bg-black/40 text-white/50 border border-[#284B8C]/30 hover:text-white'
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

              <button
                onClick={conferirPrumo}
                disabled={estado.prumoConferido || estado.icado}
                className="py-2.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40 bg-black/40 border border-[#284B8C]/40 text-white/80 hover:border-[#336699] hover:text-white"
              >
                {estado.prumoConferido ? '✓ Prumo conferido' : `Conferir prumo · −${CUSTO.conferirPrumo} min`}
              </button>

              <button
                onClick={icar}
                disabled={estado.icado || estado.talhaKg === null}
                className="py-3 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40 bg-[#336699] text-white hover:bg-[#3d7bb5] active:scale-[0.98]"
              >
                {estado.icado ? '✓ Painel içado' : `Içar painel · −${CUSTO.icar} min`}
              </button>
            </div>

            {/* suprimento */}
            <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-2">
              <h2 className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Suprimento</h2>

              {/* a conta do painel contratado, feita para o jogador */}
              <div className="grid grid-cols-2 gap-2 mb-1">
                <div className={`rounded-lg border p-2.5 flex flex-col gap-0.5 ${
                  faltamCircuitos ? 'border-red-500/50 bg-red-950/25' : 'border-[#284B8C]/30 bg-black/30'
                }`}>
                  <span className="text-[9px] font-black uppercase tracking-wider text-white/40">Circuitos</span>
                  <span className={`text-lg font-black tabular-nums leading-none ${faltamCircuitos ? 'text-red-400' : 'text-white'}`}>
                    {estado.circuitosDisponiveis}<span className="text-white/30 text-sm">/{precisaCircuitos}</span>
                  </span>
                  <span className="text-[9px] font-bold text-white/35 leading-tight">
                    {pedidos} gab · {GABINETES_POR_CIRCUITO} por circuito
                  </span>
                </div>
                <div className={`rounded-lg border p-2.5 flex flex-col gap-0.5 ${
                  faltamPortas ? 'border-red-500/50 bg-red-950/25' : 'border-[#284B8C]/30 bg-black/30'
                }`}>
                  <span className="text-[9px] font-black uppercase tracking-wider text-white/40">Portas</span>
                  <span className={`text-lg font-black tabular-nums leading-none ${faltamPortas ? 'text-red-400' : 'text-white'}`}>
                    {portasDisponiveis(estado)}<span className="text-white/30 text-sm">/{precisaPortas}</span>
                  </span>
                  <span className="text-[9px] font-bold text-white/35 leading-tight">
                    {res.x} × {res.y} px
                  </span>
                </div>
              </div>

              <button
                onClick={hubExtra}
                className="py-2.5 rounded-lg text-[11px] font-black uppercase tracking-widest bg-black/40 border border-[#284B8C]/40 text-white/80 hover:border-[#336699] hover:text-white transition-all text-left px-3"
              >
                + Hub de energia
                <span className="block text-[9px] font-bold text-white/40 tracking-normal normal-case mt-0.5">
                  +5 circuitos · −{CUSTO.hubExtra} min · tem {estado.circuitosDisponiveis}
                </span>
              </button>
            </div>

            {/* processadora: a escolha técnica da obra */}
            <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Processadora</h2>
                <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">
                  precisa {portasNecessarias(estado)} {portasNecessarias(estado) === 1 ? 'porta' : 'portas'}
                </span>
              </div>

              {estado.processadoraId === null && (
                <p className="text-[10px] font-bold text-amber-400 leading-snug">
                  Sem processadora não há imagem. Escolha antes de fechar.
                </p>
              )}

              <div className="flex flex-col gap-1">
                {PROCESSADORAS.map((proc) => {
                  const escolhida = estado.processadoraId === proc.id;
                  const serve = proc.portas >= portasNecessarias(estado);
                  return (
                    <button
                      key={proc.id}
                      onClick={() => escolherProcessadora(proc.id)}
                      className={`px-3 py-2 rounded-lg text-left transition-all border ${
                        escolhida
                          ? 'bg-[#336699] border-[#336699] text-white'
                          : serve
                            ? 'bg-black/40 border-[#284B8C]/40 text-white/75 hover:border-[#336699] hover:text-white'
                            : 'bg-black/20 border-white/5 text-white/30 hover:text-white/50'
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-black uppercase tracking-wider">{proc.nome}</span>
                        <span className="text-[10px] font-black tabular-nums shrink-0">
                          {proc.portas}p · {proc.setupMin}min
                        </span>
                      </span>
                      <span className={`block text-[9px] font-bold leading-tight mt-0.5 ${escolhida ? 'text-white/70' : 'text-white/35'}`}>
                        {serve ? proc.nota : `Só ${proc.portas * tetoPorPorta(estado)} gabinetes — não fecha`}
                      </span>
                    </button>
                  );
                })}
              </div>

              {estado.processadoraId !== null && (
                <p className="text-[9px] font-bold text-white/30 leading-snug">
                  Trocar agora custa {CUSTO_TROCA_PROCESSADORA} min e zera a distribuição de sinal.
                </p>
              )}
            </div>

            {/* alertas vivos */}
            {(circuitosCheios > 0 || portasCheias > 0 || (estado.talhaKg !== null && estado.talhaKg < talhaMin)) && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/25 p-4 flex flex-col gap-1.5">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-red-400">Vai dar problema</h2>
                {estado.talhaKg !== null && estado.talhaKg < talhaMin && (
                  <p className="text-xs text-red-200/90 leading-snug">
                    Talha de {estado.talhaKg} kg para {carga} kg por ponto — o mínimo é {talhaMin} kg.
                  </p>
                )}
                {circuitosCheios > 0 && (
                  <p className="text-xs text-red-200/90 leading-snug">
                    {circuitosCheios} {circuitosCheios === 1 ? 'circuito passou' : 'circuitos passaram'} do teto de {GABINETES_POR_CIRCUITO}.
                  </p>
                )}
                {portasCheias > 0 && (
                  <p className="text-xs text-red-200/90 leading-snug">
                    {portasCheias} {portasCheias === 1 ? 'porta estourou' : 'portas estouraram'} o limite de pixels.
                  </p>
                )}
              </div>
            )}

            {/* fechar */}
            <button
              onClick={finalizar}
              disabled={!estado.icado || estado.finalizado}
              className="py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-40 bg-white text-black hover:bg-white/90 active:scale-[0.98]"
            >
              Fechar montagem e testar
              <span className="block text-[9px] font-bold text-black/50 tracking-normal normal-case mt-0.5">
                energia, sinal, teste e acabamento · −{CUSTO.fecharEnergia + CUSTO.fecharSinal + CUSTO.testar + CUSTO.acabamento} min
              </span>
            </button>
          </aside>
          )}
        </div>
      </div>

      {/* ---------------- toasts ---------------- */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] flex flex-col-reverse items-center gap-2 pointer-events-none px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider backdrop-blur border shadow-lg text-center ${
              t.tom === 'penal'
                ? 'bg-red-950/85 border-red-500/50 text-red-200'
                : t.tom === 'ok'
                  ? 'bg-[#0C1D4D]/90 border-[#336699]/60 text-white'
                  : 'bg-black/85 border-white/20 text-white/80'
            }`}
          >
            {t.texto}
          </div>
        ))}
      </div>

      {/* ---------------- imprevisto das 16:00 ---------------- */}
      {imprevisto && (
        <div className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-amber-500/40 bg-[#0C1D4D]/40 p-7 flex flex-col gap-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
              16:00 · Rádio do produtor
            </span>
            <h2 className="text-2xl font-black text-white leading-tight">
              O cliente pediu uma fiada a mais no painel.
            </h2>
            <p className="text-sm text-white/70 leading-relaxed">
              São <strong className="text-white">{gabinetesDoImprevisto(estado)} gabinetes</strong> a mais — o painel vai a {estado.colunas} x {estado.linhas}.
              Refaça a conta: a carga por ponto sobe para <strong className="text-white">{carga} kg</strong>, e
              provavelmente não cabe mais nos circuitos e portas que você tem.
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

      {/* ---------------- vistoria: a câmera passeia, o texto acompanha ---------------- */}
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
                19:00 · Vistoria
              </span>

              {passo < 0 && !montagemLimpa && (
                <p className="text-lg sm:text-2xl font-black text-white leading-tight">
                  A porta abriu. Vamos ver o que ficou para trás.
                </p>
              )}

              {passo < 0 && montagemLimpa && (
                <p className="text-lg sm:text-2xl font-black text-[#4E93D8] leading-tight">
                  Painel completo, energia e sinal dentro do limite, estrutura dimensionada. Montagem limpa.
                </p>
              )}

              {passo >= 0 && problemas[passo] && (
                <>
                  <p className="text-base sm:text-xl font-bold text-white leading-snug">
                    {problemas[passo].texto}
                  </p>
                  {problemas[passo].minutos ? (
                    <span className="text-xs font-black uppercase tracking-widest text-amber-400">
                      −{problemas[passo].minutos} min
                    </span>
                  ) : problemas[passo].tipo === 'reprovacao' ? (
                    <span className="text-xs font-black uppercase tracking-widest text-red-400">
                      Reprovação
                    </span>
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
        <div className="fixed inset-0 z-[95] bg-black/92 backdrop-blur overflow-y-auto">
          <div className="min-h-full flex items-center justify-center p-6">
            <div className="max-w-lg w-full flex flex-col gap-5 py-8">

              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#336699]">
                  19:00 · Resultado
                </span>
                <h2 className={`text-4xl font-black leading-none ${placar.reprovado ? 'text-red-400' : 'text-white'}`}>
                  {placar.reprovado ? 'Reprovado' : 'Salão entregue'}
                </h2>
              </div>

              {placar.reprovado ? (
                <p className="text-sm text-red-200/80 leading-relaxed">
                  Falha de segurança ou de entrega zera a partida, independente do tempo. Não é penalidade de minutos — é a montagem que não podia ter sido entregue assim.
                </p>
              ) : (
                <div className="flex items-baseline gap-3">
                  <span className="text-6xl font-black tabular-nums text-white">{placar.total}</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">pontos</span>
                </div>
              )}

              {!placar.reprovado && (
                <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 divide-y divide-white/5">
                  <LinhaPlacar rotulo={`Folga · ${placar.folgaMin} min x 10`} valor={placar.folgaMin * 10} />
                  <LinhaPlacar rotulo={`Qualidade · ${placar.qualidade} x 5`} valor={placar.qualidade * 5} />
                  {placar.bonusSemRetrabalho > 0 && (
                    <LinhaPlacar rotulo="Bônus · zero retrabalho" valor={placar.bonusSemRetrabalho} destaque />
                  )}
                </div>
              )}

              {podeGravar && !gravado && (
                <div className="rounded-xl border border-[#336699]/50 bg-[#0C1D4D]/30 p-4 flex flex-col gap-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#336699]">
                    {posicaoDe(placar.total)}º lugar hoje — entra no quadro
                  </span>
                  <div className="flex gap-2">
                    <input
                      id="apelido-ranking"
                      value={apelido}
                      onChange={(e) => setApelido(limparApelido(e.target.value))}
                      maxLength={APELIDO_MAX}
                      placeholder="Seu apelido"
                      aria-label="Apelido para o quadro do dia"
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-black/50 border border-[#284B8C]/50 text-white text-sm font-bold placeholder:text-white/25 focus:border-[#336699] focus:outline-none"
                    />
                    <button
                      onClick={registrarMarca}
                      disabled={!limparApelido(apelido)}
                      className="px-5 rounded-lg bg-[#336699] text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-[#3d7bb5] transition-colors"
                    >
                      Gravar
                    </button>
                  </div>
                  <p className="text-[10px] text-white/35 leading-relaxed">
                    Só o apelido fica guardado, só neste aparelho, e a lista se apaga sozinha na virada do dia.
                  </p>
                </div>
              )}

              {ranking.length > 0 && (
                <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
                    Quadro de hoje
                  </span>
                  <ol className="flex flex-col gap-1">
                    {ranking.map((m, k) => (
                      <li key={`${m.apelido}-${m.quando}`} className="flex items-baseline gap-3 text-sm">
                        <span className="w-5 text-[11px] font-black tabular-nums text-white/30">{k + 1}</span>
                        <span className="flex-1 font-bold text-white/85 truncate">{m.apelido}</span>
                        <span className="font-black tabular-nums text-[#4E93D8]">{m.pontos}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
                  {problemas.length === 0 ? 'Nada a apontar' : `${problemas.length} ${problemas.length === 1 ? 'apontamento' : 'apontamentos'}`}
                </span>
                {problemas.length === 0 && (
                  <p className="text-sm text-[#336699] font-bold leading-relaxed">
                    Painel completo, energia e sinal fechados dentro do limite, estrutura dimensionada. Montagem limpa.
                  </p>
                )}
                {problemas.map((p, k) => (
                  <div
                    key={k}
                    className={`rounded-lg border p-3 text-xs leading-relaxed ${
                      p.tipo === 'reprovacao'
                        ? 'border-red-500/50 bg-red-950/30 text-red-200'
                        : p.tipo === 'tempo'
                          ? 'border-amber-500/40 bg-amber-950/20 text-amber-100/90'
                          : 'border-[#284B8C]/40 bg-[#0C1D4D]/25 text-white/70'
                    }`}
                  >
                    {p.texto}
                    {p.minutos ? <strong className="block mt-1 font-black">−{p.minutos} min</strong> : null}
                  </div>
                ))}
              </div>

              {estado.retrabalho > 0 && !placar.reprovado && (
                <p className="text-xs text-white/45 leading-relaxed">
                  Você perdeu <strong className="text-red-400">{estado.retrabalho} min</strong> em retrabalho — tempo que
                  uma montagem na ordem certa não teria gasto. É a diferença entre ser rápido e ser bom.
                </p>
              )}

              <div className="rounded-xl border border-[#284B8C]/30 bg-white/95 p-4 flex items-center gap-4">
                {qrDataUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={qrDataUrl} alt="QR code de contato da Rentech" className="w-20 h-20 shrink-0" />
                )}
                <div className="flex flex-col gap-1 min-w-0">
                  <strong className="text-[#0C1D4D] text-sm font-black leading-tight">
                    Quer esse painel de verdade?
                  </strong>
                  <span className="text-[11px] text-[#0C1D4D]/60 font-bold leading-snug">
                    Aponte a câmera e fale com a Rentech.
                  </span>
                </div>
              </div>

              <button
                onClick={reiniciar}
                className="py-4 rounded-xl bg-white text-black text-xs font-black uppercase tracking-widest hover:bg-white/90 active:scale-[0.98] transition-all"
              >
                Montar de novo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function BotaoFerramenta({
  ativo, onClick, cor, alerta, children,
}: {
  ativo: boolean;
  onClick: () => void;
  cor: string;
  alerta?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={ativo ? { backgroundColor: cor, borderColor: cor } : { borderColor: `${cor}66` }}
      className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider tabular-nums border transition-all ${
        ativo ? 'text-black' : 'bg-black/40 text-white/70 hover:text-white'
      } ${alerta ? 'ring-2 ring-red-500' : ''}`}
    >
      {children}
    </button>
  );
}

function LinhaPlacar({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className="flex justify-between items-baseline px-4 py-2.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-white/50">{rotulo}</span>
      <span className={`text-base font-black tabular-nums ${destaque ? 'text-[#336699]' : 'text-white'}`}>
        +{valor}
      </span>
    </div>
  );
}
