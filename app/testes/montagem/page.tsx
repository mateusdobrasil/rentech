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

import { useState, useRef, useCallback, useEffect, useSyncExternalStore } from 'react';
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
  LINHAS_MAX,
  janelaDe,
  deveDispararImprevisto,
  CONSUMO_W_M2,
  TENSAO_V,
  fmtKw,
  puxarCircuito,
  recolherCircuito,
  podeRecolherCircuito,
  PX_POR_PORTA,
  APLICACOES,
  PROCESSADORAS,
  acharProcessadora,
  aplicarImprevisto,
  gabinetesDoImprevisto,
  portasDisponiveis,
  colunaDe,
  CUSTO_TROCA_PROCESSADORA,
  CUSTO_CONSULTA_OS,
  PITCHES,
  CONTEUDOS,
  conferirLeitura,
  respostaOS,
  dadosOS,
  contaOS,
  licaoProcessadora,
  licaoEnergia,
  licaoSinal,
  motivosProcessadora,
  custoFechamento,
  ENERGIA,
  pxPorGabinete as pxDoGabinete,
  type ConferenciaOS,
  type PitchId,
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
  limparAtribuicao,
  gabinetesInstalados,
  resolucao,
  vistoriar,
  pontuar,
  type Estado,
} from '../../jogo/montagem/motor';

type Camada = 'estrutura' | 'energia' | 'sinal';
type Vista = 'palco' | 'planta';
/**
 * Retângulo: arrasta de um canto ao outro e habilita tudo de uma vez, que é
 * como se marca a medida da OS na grade. Uma peça: para acertar detalhe.
 */
type Pincel = 'retangulo' | 'celula';

/** Encaixes dentro do retângulo entre dois cantos da grade. */
function celulasDoRetangulo(a: number, b: number): number[] {
  const l0 = Math.min(linhaDe(a), linhaDe(b)), l1 = Math.max(linhaDe(a), linhaDe(b));
  const c0 = Math.min(colunaDe(a), colunaDe(b)), c1 = Math.max(colunaDe(a), colunaDe(b));
  const fora: number[] = [];
  for (let l = l0; l <= l1; l++) for (let c = c0; c <= c1; c++) fora.push(l * COLUNAS_MAX + c);
  return fora;
}

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
/** 'os' abre a partida: o técnico lê a ordem de serviço antes de liberar a montagem. */
type Fase = 'os' | 'jogando' | 'vistoria' | 'placar';

/** Para onde o QR do fim aponta. Trocar por um wa.me quando o comercial definir. */
const URL_CONTATO = 'https://rentech.tech';

/** Modo feira: sem toque nenhum por tanto tempo, a máquina se prepara sozinha. */
const OCIO_MS = 120_000;
const BEAT_ABERTURA_MS = 2_600;
const BEAT_PROBLEMA_MS = 3_800;
const BEAT_LIMPO_MS = 5_400;

// A obra é sorteada com Math.random. Se a página renderizasse no servidor, o
// servidor sortearia uma obra e o navegador outra — erro de hidratação. Então
// o jogo só aparece depois de montar no navegador; o servidor manda a casca.
const assinarNada = () => () => {};
const noNavegador = () => true;
const noServidor = () => false;

export default function CallTimeMontagem() {
  const montadoNoCliente = useSyncExternalStore(assinarNada, noNavegador, noServidor);
  const [estado, setEstado] = useState<Estado>(criarPartida);
  const [camada, setCamada] = useState<Camada>('estrutura');
  const [vista, setVista] = useState<Vista>('palco');
  const [ferramenta, setFerramenta] = useState<string>('gabinete');
  const [pincel, setPincel] = useState<Pincel>('retangulo');
  const [selecao, setSelecao] = useState<{ a: number; b: number } | null>(null);
  const selecaoRef = useRef<{ a: number; b: number } | null>(null);
  const ancora = useRef<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [imprevisto, setImprevisto] = useState(false);
  const [fase, setFase] = useState<Fase>('os');
  const [osPitch, setOsPitch] = useState('');
  const [osAltura, setOsAltura] = useState('');
  const [osUltima, setOsUltima] = useState<ConferenciaOS | null>(null);
  const [passo, setPasso] = useState(-1);
  const [apelido, setApelido] = useState('');
  const [gravado, setGravado] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  /**
   * Durante a montagem o técnico trabalha pela resolução: converter pixels
   * em gabinetes é o exercício. A medida em metros só aparece quando ele
   * termina e abre a Energia — aí serve para conferir o que montou.
   */
  const [medidaRevelada, setMedidaRevelada] = useState(false);

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
      if (deveDispararImprevisto(proximo)) {
        setImprevisto(true);
        return aplicarImprevisto(proximo);
      }
      return proximo;
    });
  }, []);

  // --- pintura na grade -----------------------------------------------------

  const circuitosPuxados = estado.circuitosPuxados;

  /** Aplica a ferramenta atual num conjunto de encaixes. */
  const aplicarEm = useCallback((alvosBrutos: number[]) => {
    if (camada === 'energia' && ferramenta !== 'limpar' && Number(ferramenta) > circuitosPuxados) {
      toast('Nenhum circuito puxado ainda — use "+ Circuito"');
      return;
    }
    aplicar((e) => {
      if (e.finalizado) return e;
      const alvos = alvosBrutos.filter((k) => celulaAtiva(e, k));
      if (alvos.length === 0) return e;

      // --- energia e sinal: planejamento, não consomem relógio aqui. O
      // fechamento do cabeamento é cobrado de uma vez no "Fechar montagem".
      if (camada !== 'estrutura') {
        const campo = camada === 'energia' ? 'circuito' : 'porta';
        if (ferramenta === 'limpar') {
          const { celulas, mudou } = limparAtribuicao(e, alvos, campo);
          return mudou ? { ...e, celulas } : e;
        }
        // Sem ajuda, em energia e em sinal: o circuito ou a porta escolhida
        // vai para todos os gabinetes do traço, caiba ou não. Quem passar do
        // teto descobre na vistoria — disjuntor caindo, faixa apagada.
        const n = Number(ferramenta);
        const alvo = new Set(alvos);
        let mudou = false;
        const celulas = e.celulas.map((c, k) => {
          if (!alvo.has(k) || !c.instalado || c[campo] === n) return c;
          mudou = true;
          return { ...c, [campo]: n };
        });
        return mudou ? { ...e, celulas } : e;
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
  }, [aplicar, camada, ferramenta, circuitosPuxados, toast]);

  /**
   * Um toque na grade. Com o pincel de uma peça, aplica na hora. Com o de
   * retângulo, o primeiro toque crava a âncora e o arrasto só mostra a prévia:
   * nada custa relógio até soltar o dedo.
   */
  const pintar = useCallback((i: number) => {
    if (pincel === 'celula') { aplicarEm([i]); return; }
    if (ancora.current === null) ancora.current = i;
    const s = { a: ancora.current, b: i };
    const atual = selecaoRef.current;
    if (atual && atual.a === s.a && atual.b === s.b) return;
    selecaoRef.current = s;
    setSelecao(s);
  }, [pincel, aplicarEm]);

  // Hit-test manual: pointerenter não dispara durante arrasto por toque.
  const pintarNoPonto = useCallback((x: number, y: number) => {
    const alvo = document.elementFromPoint(x, y) as HTMLElement | null;
    const attr = alvo?.dataset?.idx;
    if (attr !== undefined) pintar(Number(attr));
  }, [pintar]);

  useEffect(() => {
    const soltar = () => {
      pintando.current = false;
      ancora.current = null;
      const s = selecaoRef.current;
      if (!s) return;
      selecaoRef.current = null;
      setSelecao(null);
      aplicarEm(celulasDoRetangulo(s.a, s.b));
    };
    const cancelar = () => {
      pintando.current = false;
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

  // Quantos circuitos puxar é a conta do técnico: nada aqui diz se bastam.
  const puxar = () => {
    iniciar(); tocar('clique', 450);
    const n = estado.circuitosPuxados + 1;
    setFerramenta(String(n));
    aplicar(puxarCircuito);
  };

  const recolher = () => {
    if (!podeRecolherCircuito(estado)) return;
    iniciar(); tocar('clique', 300);
    const n = estado.circuitosPuxados;
    if (ferramenta === String(n)) setFerramenta(n > 1 ? String(n - 1) : 'limpar');
    aplicar(recolherCircuito);
  };

  /**
   * Leitura da OS. Acertar de primeira vale bônus; errar custa uma ligação
   * para o escritório — primeiro uma dica, depois a conta pronta. Nunca trava
   * a partida: o objetivo é a pessoa sair sabendo fazer a conta.
   */
  const confirmarLeitura = () => {
    iniciar();
    const conferencia = conferirLeitura(estado.briefing, osPitch, osAltura);
    const certo = conferencia.pitchOk && conferencia.alturaOk;
    const tentativas = estado.leitura.tentativas;
    setOsUltima(conferencia);

    if (certo) {
      tocar('vitoria');
      aplicar((e) => ({
        ...e,
        leitura: { tentativas: tentativas + 1, resolvida: true, dePrimeira: tentativas === 0 },
      }));
      return;
    }

    const custo = CUSTO_CONSULTA_OS[Math.min(tentativas, CUSTO_CONSULTA_OS.length - 1)];
    tocar('erro');
    toast(
      tentativas === 0
        ? `Ligou pro escritório pedindo uma dica · −${custo} min`
        : `Ligou de novo e pediu a conta pronta · −${custo} min`,
      'penal',
    );
    aplicar((e) => ({
      ...e,
      gastos: e.gastos + custo,
      leitura: { tentativas: tentativas + 1, resolvida: tentativas + 1 >= CUSTO_CONSULTA_OS.length, dePrimeira: false },
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
    aplicar((e) => ({
      ...e,
      finalizado: true,
      gastos: e.gastos + custoFechamento(e),
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
    setFase('os');
    setOsPitch('');
    setOsAltura('');
    setOsUltima(null);
    setPasso(-1);
    setApelido('');
    setMedidaRevelada(false);
    setGravado(false);
  }, []);

  // --- derivados ------------------------------------------------------------
  const instalados = gabinetesInstalados(estado);
  const carga = cargaPorPonto(estado);
  const talhaMin = talhaRecomendada(carga);
  const res = resolucao(estado);
  const janela = janelaDe(estado);
  const restante = folga(estado);
  const progresso = Math.min(100, (estado.gastos / janela) * 100);
  const estourou = estado.gastos >= janela;


  // Quanta infraestrutura o painel contratado exige. Mostrar isso ANTES do erro
  // é o que transforma o jogo de "adivinhe a regra" em "decida com a regra".
  // Circuitos pela conta do que está montado, não do pedido: o pedido é o
  // técnico quem tem que ler na OS.
  const pxMontado = instalados * pxDoGabinete(estado.briefing.pitch);
  const processadora = acharProcessadora(estado.processadoraId);
  const selecionadas = new Set(selecao ? celulasDoRetangulo(selecao.a, selecao.b) : []);
  const tamanhoSelecao = selecao
    ? {
        colunas: Math.abs(colunaDe(selecao.a) - colunaDe(selecao.b)) + 1,
        linhas: Math.abs(linhaDe(selecao.a) - linhaDe(selecao.b)) + 1,
      }
    : null;

  const semCircuito = estado.celulas.filter(
    (c, i) => celulaAtiva(estado, i) && c.instalado && c.circuito === null).length;
  const semPorta = estado.celulas.filter(
    (c, i) => celulaAtiva(estado, i) && c.instalado && c.porta === null).length;

  // Onde o jogador está na sequência. É a espinha do jogo, então fica à vista.
  const etapas = [
    { nome: 'Montar', ok: estado.icado, ativa: !estado.icado },
    { nome: 'Içar', ok: estado.icado, ativa: instalados > 0 && !estado.icado },
    { nome: 'Energia', ok: instalados > 0 && semCircuito === 0, ativa: estado.icado && semCircuito > 0 },
    { nome: 'Sinal', ok: instalados > 0 && semPorta === 0, ativa: estado.icado && semCircuito === 0 && semPorta > 0 },
    { nome: 'Fechar', ok: estado.finalizado, ativa: estado.icado && semCircuito === 0 && semPorta === 0 },
  ];

  const vistoria = estado.finalizado ? vistoriar(estado) : null;
  const placar = vistoria ? pontuar(estado, vistoria) : null;
  const problemas = vistoria?.problemas ?? [];
  const montagemLimpa = estado.finalizado && problemas.length === 0;
  const emJogo = fase === 'jogando' || fase === 'os';
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
    if (!c.instalado) return 'rgba(255,255,255,0.045)';
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
    if (!c.instalado) return '';
    if (camada === 'energia') return c.circuito ?? '';
    if (camada === 'sinal') return c.porta ?? '';
    return '';
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
              <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Gabinetes</span>
              <span className="text-lg font-black tabular-nums text-white">{instalados}</span>
            </div>
          </div>

          {/* a obra da vez, sem os números: medida e resolução moram no cartão da OS */}
          <div className="max-w-6xl mx-auto mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wider">
            <span className="text-white/35 tabular-nums">OS {estado.briefing.os}</span>
            <span className="px-2 py-0.5 rounded bg-[#336699]/25 border border-[#336699]/50 text-white font-black">
              {APLICACOES[estado.briefing.aplicacao].rotulo}
            </span>
            <span className="text-white/50">{estado.briefing.evento}</span>
          </div>

          {/* trilha das etapas: a ordem é o jogo, então ela fica sempre à vista */}
          {emJogo && (
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

        <div className={`max-w-6xl mx-auto px-4 py-6 grid gap-6 items-start ${emJogo ? 'lg:grid-cols-[1fr_20rem]' : 'grid-cols-1'}`}>

          {/* ---------------- grade do painel ---------------- */}
          <div className="flex flex-col gap-3">

            {/* camadas */}
            {emJogo && (
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
                    if (id === 'energia') setMedidaRevelada(true);
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
                emJogo ? 'h-[52vh] min-h-[22rem]' : 'h-[68vh] min-h-[26rem]'
              }`}>
                <Palco3D
                  estado={estado}
                  camada={camada}
                  onPintar={pintar}
                  vistoriando={!emJogo}
                  foco={focoAtual}
                  orbitar={montagemLimpa && fase === 'vistoria'}
                  telaModo={montagemLimpa ? 'show' : 'teste'}
                  selecionadas={selecionadas}
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
              {/* régua de colunas e de fiadas: a grade é maior que a obra, e contar
                  gabinete é parte do trabalho */}
              <div
                className="grid gap-[3px]"
                style={{ gridTemplateColumns: `1.1rem repeat(${COLUNAS_MAX}, minmax(0, 1fr))` }}
              >
                <span />
                {Array.from({ length: COLUNAS_MAX }, (_, c) => (
                  <span key={`c${c}`} className="text-center text-[8px] md:text-[9px] font-black tabular-nums text-white/25">{c + 1}</span>
                ))}
                {Array.from({ length: LINHAS_MAX }, (_, l) => (
                  <div key={`l${l}`} className="contents">
                    <span className="flex items-center justify-end pr-1 text-[8px] md:text-[9px] font-black tabular-nums text-white/25">{l + 1}</span>
                    {Array.from({ length: COLUNAS_MAX }, (_, c) => {
                      const i = l * COLUNAS_MAX + c;
                      const naSelecao = selecionadas.has(i);
                      return (
                        <div
                          key={i}
                          data-idx={i}
                          className={`aspect-square rounded-[3px] flex items-center justify-center text-[8px] md:text-[10px] font-black tabular-nums transition-colors cursor-pointer border ${
                            naSelecao ? 'border-white/80' : estado.celulas[i].instalado ? 'border-transparent' : 'border-white/[0.06]'
                          }`}
                          style={{
                            backgroundColor: naSelecao && !estado.celulas[i].instalado ? 'rgba(78,147,216,0.35)' : corCelula(i),
                            color: 'rgba(0,0,0,0.65)',
                          }}
                        >
                          {rotuloCelula(i)}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* pincel: retângulo de canto a canto, ou uma peça */}
            {emJogo && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-white/35">Pincel</span>
                <div className="flex rounded-lg overflow-hidden border border-[#284B8C]/40">
                  {([['retangulo', 'Retângulo'], ['celula', '1 peça']] as const).map(([id, rotulo]) => (
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
            {emJogo && (
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
                  {Array.from({ length: estado.circuitosPuxados }, (_, k) => {
                    const n = k + 1;
                    return (
                      <BotaoFerramenta
                        key={n}
                        ativo={ferramenta === String(n)}
                        onClick={() => setFerramenta(String(n))}
                        cor={CORES_CIRCUITO[k % CORES_CIRCUITO.length]}
                      >
                        C{n}
                      </BotaoFerramenta>
                    );
                  })}
                  <button
                    onClick={puxar}
                    className="px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border border-dashed border-[#336699]/70 text-[#4E93D8] hover:bg-[#0C1D4D]/60 hover:text-white transition-all"
                  >
                    + Circuito · {ENERGIA.porCircuito} min
                  </button>
                  {estado.circuitosPuxados > 0 && (
                    <button
                      onClick={recolher}
                      disabled={!podeRecolherCircuito(estado)}
                      title={podeRecolherCircuito(estado) ? undefined : `C${estado.circuitosPuxados} tem gabinetes ligados`}
                      className="px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border border-dashed border-white/20 text-white/50 hover:text-white hover:border-white/40 transition-all disabled:opacity-30 disabled:hover:text-white/50 disabled:hover:border-white/20"
                    >
                      − Recolher C{estado.circuitosPuxados}
                    </button>
                  )}
                  <BotaoFerramenta ativo={ferramenta === 'limpar'} onClick={() => setFerramenta('limpar')} cor="#64748B">
                    Limpar
                  </BotaoFerramenta>
                </>
              )}

              {camada === 'sinal' && (
                <>
                  {Array.from({ length: portasDisponiveis(estado) }, (_, k) => {
                    const n = k + 1;
                    return (
                      <BotaoFerramenta
                        key={n}
                        ativo={ferramenta === String(n)}
                        onClick={() => setFerramenta(String(n))}
                        cor={CORES_PORTA[k % CORES_PORTA.length]}
                      >
                        P{n}
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
            {emJogo && (
            <p className="text-xs text-white/45 leading-relaxed max-w-[60ch]">
              {camada === 'estrutura' && (
                estado.icado
                  ? `O painel já subiu. Gabinete instalado agora custa ${CUSTO.instalarAr} min em vez de ${CUSTO.instalarChao} — é o preço de montar no ar.`
                  : 'Arraste sobre a grade para instalar os gabinetes com a estrutura ainda deitada no chão. É assim que se monta de verdade: o painel sobe pronto.'
              )}
              {camada === 'energia' && `A tomada do local é de ${TENSAO_V} V com disjuntor de ${estado.briefing.tomadaA} A, e o painel consome ${CONSUMO_W_M2} W por m². Quantos circuitos puxar é conta sua — e disjuntor não trabalha no limite. Cada circuito é um lance de cabo de ${ENERGIA.porCircuito} min, usado ou não; carga demais derruba o disjuntor no meio do evento.`}
              {camada === 'sinal' && `Cada porta do processador aguenta ${PX_POR_PORTA.toLocaleString('pt-BR')} px. Quantos gabinetes cabem nela depende do pitch — a conta é sua. Passar do limite apaga uma faixa do painel.`}
            </p>
            )}
          </div>

          {/* ---------------- painel de ações ---------------- */}
          {emJogo && (
          <aside className="flex flex-col gap-3">

            {/* ordem de serviço: o lugar fixo onde a obra está descrita */}
            {estado.leitura.resolvida && (
              <CartaoOS estado={estado} portaAbre={relogio(janela, janela)} mostrarMetros={medidaRevelada} />
            )}

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
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border p-2.5 flex flex-col gap-0.5 border-[#284B8C]/30 bg-black/30">
                  <span className="text-[9px] font-black uppercase tracking-wider text-white/40">Circuitos</span>
                  <span className="text-lg font-black tabular-nums leading-none text-white">
                    {estado.circuitosPuxados}
                  </span>
                  <span className="text-[9px] font-bold text-white/35 leading-tight">
                    puxados · tomada {estado.briefing.tomadaA} A
                  </span>
                </div>
                <div className="rounded-lg border p-2.5 flex flex-col gap-0.5 border-[#284B8C]/30 bg-black/30">
                  <span className="text-[9px] font-black uppercase tracking-wider text-white/40">Portas</span>
                  <span className="text-lg font-black tabular-nums leading-none text-white">
                    {processadora ? portasDisponiveis(estado) : '—'}
                  </span>
                  <span className="text-[9px] font-bold text-white/35 leading-tight tabular-nums">
                    {pxMontado.toLocaleString('pt-BR')} px montados
                  </span>
                </div>
              </div>
              {estado.circuitosPuxados === 0 && (
                <p className="text-[10px] text-white/40 leading-snug">Os circuitos se puxam na aba Energia.</p>
              )}
            </div>

            {/* processadora: a escolha técnica da obra */}
            <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Processadora</h2>
                <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">
                  {CONTEUDOS[estado.briefing.conteudo].rotulo}
                </span>
              </div>

              {estado.processadoraId === null && (
                <p className="text-[10px] font-bold text-amber-400 leading-snug">
                  Sem processadora não há imagem. As portas não estão escritas: quem monta tem que saber.
                </p>
              )}

              {(['envio', 'player'] as const).map((linha) => (
                <div key={linha} className="flex flex-col gap-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/30 pt-1">
                    {linha === 'envio' ? 'Envio e all-in-one' : 'Player Taurus · guarda o conteúdo'}
                  </span>
                  {PROCESSADORAS.filter((proc) => proc.linha === linha).map((proc) => {
                    const escolhida = estado.processadoraId === proc.id;
                    return (
                      <button
                        key={proc.id}
                        onClick={() => escolherProcessadora(proc.id)}
                        className={`px-3 py-2 rounded-lg text-left transition-all border ${
                          escolhida
                            ? 'bg-[#336699] border-[#336699] text-white'
                            : 'bg-black/40 border-[#284B8C]/40 text-white/75 hover:border-[#336699] hover:text-white'
                        }`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] font-black uppercase tracking-wider">{proc.nome}</span>
                          <span className="text-[10px] font-black tabular-nums shrink-0">setup {proc.setupMin} min</span>
                        </span>
                        <span className={`block text-[9px] font-bold leading-tight mt-0.5 ${escolhida ? 'text-white/70' : 'text-white/35'}`}>
                          {proc.nota}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}

              {estado.processadoraId !== null && (
                <p className="text-[9px] font-bold text-white/30 leading-snug">
                  Trocar agora custa {CUSTO_TROCA_PROCESSADORA} min e zera a distribuição de sinal.
                </p>
              )}
            </div>

            {/* alertas vivos */}
            {(estado.talhaKg !== null && estado.talhaKg < talhaMin) && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/25 p-4 flex flex-col gap-1.5">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-red-400">Vai dar problema</h2>
                {estado.talhaKg !== null && estado.talhaKg < talhaMin && (
                  <p className="text-xs text-red-200/90 leading-snug">
                    Talha de {estado.talhaKg} kg para {carga} kg por ponto — o mínimo é {talhaMin} kg.
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
                energia pelos circuitos puxados · sinal, teste e acabamento −{CUSTO.fecharSinal + CUSTO.testar + CUSTO.acabamento} min
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

      {/* tamanho do retângulo enquanto arrasta: em gabinetes, nunca em metros —
          converter a medida da OS em gabinetes é justamente o exercício */}
      {tamanhoSelecao && (
        <div className="fixed top-28 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-lg bg-black/85 border border-white/30 backdrop-blur text-sm font-black tabular-nums text-white pointer-events-none">
          {tamanhoSelecao.colunas} × {tamanhoSelecao.linhas} gabinetes
        </div>
      )}

      {/* ---------------- leitura da ordem de serviço ---------------- */}
      {fase === 'os' && (
        <ModalOS
          estado={estado}
          pitch={osPitch}
          altura={osAltura}
          ultima={osUltima}
          portaAbre={relogio(janela, janela)}
          onPitch={setOsPitch}
          onAltura={setOsAltura}
          onConfirmar={confirmarLeitura}
          onLiberar={() => { iniciar(); tocar('clique', 640); setFase('jogando'); }}
        />
      )}

      {/* ---------------- imprevisto das 16:00 ---------------- */}
      {imprevisto && (
        <div className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-amber-500/40 bg-[#0C1D4D]/40 p-7 flex flex-col gap-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
              {relogio(estado.gastos, janela)} · Rádio do produtor
            </span>
            <h2 className="text-2xl font-black text-white leading-tight">
              {APLICACOES[estado.briefing.aplicacao].cresce === 'largura'
                ? 'O cliente pediu o painel mais largo.'
                : 'O cliente pediu uma fiada a mais no painel.'}
            </h2>
            <p className="text-sm text-white/70 leading-relaxed">
              São <strong className="text-white">{gabinetesDoImprevisto(estado)} gabinetes</strong> a mais — o painel passa a ter{' '}
              <strong className="text-white">{fmtPx(res.x)} × {fmtPx(res.y)} px</strong>
              {medidaRevelada && <> ({fmtM(estado.colunas * 0.5)} × {fmtM(estado.linhas * 0.5)} m)</>}.
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
                  {placar.bonusLeitura > 0 && (
                    <LinhaPlacar rotulo="Bônus · leu a OS de primeira" valor={placar.bonusLeitura} destaque />
                  )}
                </div>
              )}

              <LicaoEnergia estado={estado} />
              <LicaoProcessadora estado={estado} />
              <LicaoSinal estado={estado} />

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

// ---------------------------------------------------------------------------
// Ordem de serviço
// ---------------------------------------------------------------------------

const fmtM = (n: number) => n.toFixed(1).replace('.', ',');
const fmtPx = (n: number) => n.toLocaleString('pt-BR');

function CampoOS({ rotulo, children, calcular }: { rotulo: string; children?: React.ReactNode; calcular?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-white/5 last:border-b-0">
      <span className="text-[10px] font-black uppercase tracking-widest text-white/35 shrink-0">{rotulo}</span>
      {calcular ? (
        <span className="text-[11px] font-black uppercase tracking-wider text-amber-400">? calcule</span>
      ) : (
        <span className="text-sm font-bold text-white text-right tabular-nums">{children}</span>
      )}
    </div>
  );
}

function ModalOS({
  estado, pitch, altura, ultima, portaAbre, onPitch, onAltura, onConfirmar, onLiberar,
}: {
  estado: Estado;
  pitch: string;
  altura: string;
  ultima: ConferenciaOS | null;
  portaAbre: string;
  onPitch: (v: string) => void;
  onAltura: (v: string) => void;
  onConfirmar: () => void;
  onLiberar: () => void;
}) {
  const b = estado.briefing;
  const aplicacao = APLICACOES[b.aplicacao];
  const conteudo = CONTEUDOS[b.conteudo];
  const dados = dadosOS(b);
  const certo = respostaOS(b);
  const { tentativas, resolvida, dePrimeira } = estado.leitura;
  const acertou = ultima?.pitchOk && ultima?.alturaOk;
  const pxLado = PITCHES[b.pitch].pxLado;

  const alturaInformada = dados.alturaInformada.unidade === 'm'
    ? `${fmtM(dados.alturaInformada.valor)} m`
    : `${fmtPx(dados.alturaInformada.valor)} px`;
  const alturaCerta = certo.unidade === 'm' ? `${fmtM(certo.altura)} m` : `${fmtPx(certo.altura)} px`;

  return (
    <div className="fixed inset-0 z-[92] bg-[#05070B] overflow-y-auto">
      <div className="min-h-full flex items-center justify-center p-5">
        <div className="max-w-xl w-full flex flex-col gap-5 py-6">

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#336699]">
              14:00 · O caminhão chegou
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-white leading-none">
              Ordem de serviço nº {b.os}
            </h2>
          </div>

          <div className="rounded-xl border border-[#284B8C]/40 bg-[#0C1D4D]/25 px-4 py-2">
            <CampoOS rotulo="Evento">{b.evento}</CampoOS>
            <CampoOS rotulo="Aplicação">{aplicacao.rotulo}</CampoOS>
            <p className="text-[11px] text-white/45 leading-snug pb-1.5 border-b border-white/5">{aplicacao.descricao}</p>
            <CampoOS rotulo="Conteúdo">{conteudo.rotulo}</CampoOS>
            <p className="text-[11px] text-white/45 leading-snug pb-1.5 border-b border-white/5">{conteudo.descricao}</p>
            <CampoOS rotulo="Largura">{fmtM(dados.larguraM)} m · {fmtPx(dados.larguraPx)} px</CampoOS>
            <CampoOS rotulo="Altura">
              {resolvida ? `${fmtM(b.linhas * 0.5)} m · ${fmtPx(b.linhas * pxLado)} px` : alturaInformada}
            </CampoOS>
            <CampoOS rotulo="Painel" calcular={!resolvida}>{b.pitch} · gabinete 500 × 500 mm</CampoOS>
            <CampoOS rotulo="Porta abre">{portaAbre}</CampoOS>
          </div>

          {!resolvida && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(ev) => { ev.preventDefault(); onConfirmar(); }}
            >
              <p className="text-lg font-black text-white leading-snug">
                Qual painel o depósito tem que separar, e qual a altura em {certo.unidade === 'm' ? 'metros' : 'pixels'}?
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-3">
                <label className="flex flex-col gap-1 min-w-0">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Painel</span>
                  <select
                    id="os-painel"
                    value={pitch}
                    onChange={(ev) => onPitch(ev.target.value)}
                    className={`w-full px-3 py-3 rounded-lg bg-black/60 border text-white text-base font-black focus:border-[#4E93D8] focus:outline-none ${
                      ultima && !ultima.pitchOk ? 'border-red-500/70' : 'border-[#284B8C]/60'
                    }`}
                  >
                    <option value="">Escolha…</option>
                    {(Object.keys(PITCHES) as PitchId[]).map((id) => (
                      <option key={id} value={id}>{id} · gabinete 500 × 500 mm</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 min-w-0">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Altura</span>
                  <span className="flex items-center gap-1.5">
                    <input
                      id="os-altura"
                      value={altura}
                      onChange={(ev) => onAltura(ev.target.value)}
                      inputMode="decimal"
                      autoComplete="off"
                      className={`w-full min-w-0 px-3 py-3 rounded-lg bg-black/60 border text-white text-lg font-black tabular-nums focus:border-[#4E93D8] focus:outline-none ${
                        ultima && !ultima.alturaOk ? 'border-red-500/70' : 'border-[#284B8C]/60'
                      }`}
                    />
                    <span className="text-xs font-black text-white/40">{certo.unidade}</span>
                  </span>
                </label>
              </div>

              {tentativas > 0 && ultima && !acertou && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-950/25 px-4 py-3 text-sm text-amber-100/90 leading-relaxed">
                  <strong className="block text-[10px] font-black uppercase tracking-widest text-amber-400 mb-1">
                    {ultima.pitchOk ? 'O painel está certo; a altura não.' : ultima.alturaOk ? 'A altura está certa; o painel não.' : 'Painel e altura não conferem.'}
                  </strong>
                  Cada gabinete tem 0,5 m de lado. Divida os pixels da largura pelo número de gabinetes e você
                  tem os pixels de um gabinete. O pitch é a distância entre os LEDs: 500 mm divididos por esses pixels.
                </div>
              )}

              <button
                type="submit"
                disabled={!pitch || !altura.trim()}
                className="py-4 rounded-xl bg-white text-black text-xs font-black uppercase tracking-widest disabled:opacity-40 hover:bg-white/90 active:scale-[0.98] transition-all"
              >
                Confirmar leitura
              </button>
              <p className="text-[11px] text-white/35 leading-relaxed">
                Acertar de primeira vale +100 no placar. Errar custa uma ligação pro escritório:
                −{CUSTO_CONSULTA_OS[0]} min pela dica, −{CUSTO_CONSULTA_OS[1]} min pela conta pronta.
              </p>
            </form>
          )}

          {resolvida && (
            <div className="flex flex-col gap-3">
              <div className={`rounded-xl border px-4 py-3 ${
                acertou ? 'border-[#336699]/60 bg-[#0C1D4D]/40' : 'border-amber-500/40 bg-amber-950/25'
              }`}>
                <strong className={`block text-lg font-black leading-tight mb-2 ${acertou ? 'text-white' : 'text-amber-300'}`}>
                  {acertou
                    ? dePrimeira ? `Confere: ${b.pitch}, ${alturaCerta}. +100 no placar.` : `Confere: ${b.pitch}, ${alturaCerta}.`
                    : `O escritório passou a conta: ${b.pitch}, ${alturaCerta}.`}
                </strong>
                <ul className="flex flex-col gap-1">
                  {contaOS(b).map((linha) => (
                    <li key={linha} className="text-xs sm:text-sm font-bold text-white/75 tabular-nums leading-snug">{linha}</li>
                  ))}
                </ul>
              </div>
              <p className="text-[11px] text-white/45 leading-relaxed">
                A grade da montagem é maior que a obra. Habilite exatamente os gabinetes da medida da OS — nem a menos, nem a mais.
              </p>
              <button
                onClick={onLiberar}
                className="py-4 rounded-xl bg-[#336699] text-white text-xs font-black uppercase tracking-widest hover:bg-[#3d7bb5] active:scale-[0.98] transition-all"
              >
                Liberar a montagem
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A OS fica fixa ao lado do palco: é o lugar onde a obra está descrita. */
function CartaoOS({ estado, portaAbre, mostrarMetros }: { estado: Estado; portaAbre: string; mostrarMetros: boolean }) {
  const b = estado.briefing;
  const px = PITCHES[b.pitch].pxLado;
  const cresceu = estado.colunas !== b.colunas || estado.linhas !== b.linhas;

  return (
    <div className="rounded-xl border border-[#284B8C]/40 bg-[#0C1D4D]/25 p-4 flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <h2 className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Ordem de serviço</h2>
        <span className="text-[10px] font-black tabular-nums text-white/40">nº {b.os}</span>
      </div>
      <CampoOS rotulo="Evento">{b.evento}</CampoOS>
      <CampoOS rotulo="Aplicação">{APLICACOES[b.aplicacao].rotulo}</CampoOS>
      <CampoOS rotulo="Conteúdo">{CONTEUDOS[b.conteudo].rotulo}</CampoOS>
      <CampoOS rotulo="Pitch">{b.pitch}</CampoOS>
      <CampoOS rotulo="Resolução">
        {fmtPx(estado.colunas * px)} × {fmtPx(estado.linhas * px)} px
        {cresceu && (
          <span className="block text-[10px] font-bold text-amber-400">
            era {fmtPx(b.colunas * px)} × {fmtPx(b.linhas * px)} px
          </span>
        )}
      </CampoOS>
      <CampoOS rotulo="Painel">
        {mostrarMetros ? (
          <>
            {fmtM(estado.colunas * 0.5)} × {fmtM(estado.linhas * 0.5)} m
            {cresceu && (
              <span className="block text-[10px] font-bold text-amber-400">
                era {fmtM(b.colunas * 0.5)} × {fmtM(b.linhas * 0.5)} m
              </span>
            )}
          </>
        ) : (
          <span className="text-[10px] font-bold text-white/35">aparece na energia</span>
        )}
      </CampoOS>
      <CampoOS rotulo="Tomada do local">{b.tomadaA} A · {TENSAO_V} V</CampoOS>
      <CampoOS rotulo="Porta abre">{portaAbre}</CampoOS>
    </div>
  );
}

/**
 * As portas ficam escondidas durante o jogo, então é aqui, no placar, que a
 * pessoa aprende: quantas portas a escolhida tem, o que a obra pedia e qual
 * era a certa.
 */
function LicaoProcessadora({ estado }: { estado: Estado }) {
  const l = licaoProcessadora(estado);
  const pitch = estado.briefing.pitch;
  const autonomo = estado.briefing.conteudo === 'autonomo';
  const descricao = (nome: string, portas: number, pxMax: number) =>
    `${nome}: ${portas} ${portas === 1 ? 'porta' : 'portas'}, ${(pxMax / 1_000_000).toFixed(2).replace('.', ',')} milhões de px`;

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${
      l.acertou ? 'border-[#336699]/50 bg-[#0C1D4D]/30' : 'border-amber-500/40 bg-amber-950/20'
    }`}>
      <span className={`text-[10px] font-black uppercase tracking-widest ${l.acertou ? 'text-[#4E93D8]' : 'text-amber-400'}`}>
        Processadora · {l.acertou ? 'escolha certa' : l.serviu ? 'serviu, mas não era a melhor' : 'escolha errada'}
      </span>
      <p className="text-xs text-white/75 leading-relaxed">
        A obra pedia <strong className="text-white">{l.portasNecessarias} {l.portasNecessarias === 1 ? 'porta' : 'portas'}</strong> em {pitch} ({l.pxTexto} de px)
        {autonomo ? ', com conteúdo rodando sozinho — só player serve' : ', com operador na régie'}.
      </p>
      <ul className="flex flex-col gap-1 text-xs font-bold leading-snug">
        {motivosProcessadora(estado).map((frase) => (
          <li key={frase} className="text-white/85 flex gap-2">
            <span className="text-white/30">—</span>
            <span>{frase}</span>
          </li>
        ))}
      </ul>
      {l.usada && (
        <p className="text-[10px] text-white/40 tabular-nums">
          {descricao(l.usada.nome, l.usada.portas, l.usada.pxMax)} · setup {l.usada.setupMin} min
          {!l.acertou && <> · a melhor: {descricao(l.ideal.nome, l.ideal.portas, l.ideal.pxMax)} · setup {l.ideal.setupMin} min</>}
        </p>
      )}
    </div>
  );
}

/**
 * Durante o jogo os circuitos não mostram carga, então o placar é onde a
 * pessoa vê o que fez: a conta dos watts, quantos circuitos bastavam, quantos
 * derrubaram o disjuntor, e quanto tempo isso custou contra o mínimo.
 */
function LicaoEnergia({ estado }: { estado: Estado }) {
  const l = licaoEnergia(estado);
  if (l.puxados === 0) return null;
  const perfeito = l.sobrecarregados === 0 && l.minutos === l.minutosIdeal;

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${
      perfeito ? 'border-[#336699]/50 bg-[#0C1D4D]/30' : 'border-amber-500/40 bg-amber-950/20'
    }`}>
      <span className={`text-[10px] font-black uppercase tracking-widest ${perfeito ? 'text-[#4E93D8]' : 'text-amber-400'}`}>
        Energia · {l.minutos} min{perfeito ? ', o mínimo possível' : ` — dava para fazer em ${l.minutosIdeal}`}
      </span>
      <p className="text-xs text-white/75 leading-relaxed tabular-nums">{l.conta}.</p>
      <p className="text-xs text-white/75 leading-relaxed tabular-nums">
        O painel puxa <strong className="text-white">{fmtKw(l.wattsTotal)}</strong>: {l.minimo} {l.minimo === 1 ? 'circuito bastava' : 'circuitos bastavam'}, e você puxou {l.puxados}.
        Cada circuito é um lance de cabo de {ENERGIA.porCircuito} min, usado ou não.
      </p>
      <div className="flex flex-wrap gap-1">
        {l.circuitos.map((c) => (
          <span
            key={c.circuito}
            className={`px-2 py-0.5 rounded text-[10px] font-black tabular-nums border ${
              c.situacao === 'sobrecarregado'
                ? 'border-red-500/60 bg-red-950/40 text-red-200'
                : c.situacao === 'ideal'
                  ? 'border-[#336699]/60 bg-[#0C1D4D]/50 text-white'
                  : 'border-amber-500/40 bg-amber-950/30 text-amber-100'
            }`}
          >
            C{c.circuito} · {c.gabinetes} gab · {fmtKw(c.watts)}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-white/40 leading-snug">
        Azul: circuito necessário, dentro de {fmtKw(l.wattsUtil)}. Âmbar: circuito a mais, dava para ter juntado ou nem puxado. Vermelho: passou de {l.teto} gabinetes e derrubou o disjuntor.
      </p>
    </div>
  );
}

/** Durante o jogo as portas não mostram lotação; o placar mostra a conta. */
function LicaoSinal({ estado }: { estado: Estado }) {
  const l = licaoSinal(estado);
  if (l.portas.length === 0) return null;
  const limpo = l.estouradas === 0 && l.semSinal === 0;

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${
      limpo ? 'border-[#336699]/50 bg-[#0C1D4D]/30' : 'border-amber-500/40 bg-amber-950/20'
    }`}>
      <span className={`text-[10px] font-black uppercase tracking-widest ${limpo ? 'text-[#4E93D8]' : 'text-amber-400'}`}>
        Sinal · {limpo ? 'todas as portas dentro do limite' : l.estouradas > 0 ? `${l.estouradas} ${l.estouradas === 1 ? 'porta estourada' : 'portas estouradas'}` : 'gabinetes sem sinal'}
      </span>
      <p className="text-xs text-white/75 leading-relaxed tabular-nums">{l.conta}.</p>
      <div className="flex flex-wrap gap-1">
        {l.portas.map((q) => (
          <span
            key={q.porta}
            className={`px-2 py-0.5 rounded text-[10px] font-black tabular-nums border ${
              q.estourada ? 'border-red-500/60 bg-red-950/40 text-red-200' : 'border-[#336699]/60 bg-[#0C1D4D]/50 text-white'
            }`}
          >
            P{q.porta} · {q.gabinetes}/{l.teto}
          </span>
        ))}
      </div>
      {l.semSinal > 0 && (
        <p className="text-[10px] text-amber-200/80">{l.semSinal} {l.semSinal === 1 ? 'gabinete ficou' : 'gabinetes ficaram'} sem porta.</p>
      )}
    </div>
  );
}
