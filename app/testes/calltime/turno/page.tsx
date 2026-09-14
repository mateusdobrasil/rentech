"use client";

// ============================================================================
// CALL TIME — Fase 5: a camada do salão
//
// Aqui não se monta nada: aqui se decide. O encarregado vê as três obras do
// dia, divide seis montadores entre elas, escolhe em que ordem atacar e leva
// a bronca quando o painel sobe antes do grid de luz ou quando a soma das
// cargas estoura o gerador.
//
// A execução continua nos três postos que já existem. O salão manda a pessoa
// para lá com o turno guardado em sessionStorage, e ela volta com o resultado.
// ============================================================================

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import BackButton from '../../BackButton';
import { useSom } from '../../useSom';
import {
  CUSTO_GERADOR_EXTRA,
  CUSTO_ORDEM_INVERTIDA,
  CUSTO_RACK,
  EQUIPE_TOTAL,
  GERADOR_KVA,
  JANELA_TURNO,
  POSTOS,
  alocarEquipe,
  buscarGerador,
  conflitos,
  criarTurno,
  equipeDeSobra,
  fatorEquipe,
  folgaDoTurno,
  geradorEstourado,
  kvaDoSalao,
  minutosDoTurno,
  montarRack,
  podeEntrarNoPosto,
  pontuarTurno,
  postoJogado,
  previsaoDoPosto,
  previsaoDoTurno,
  relatorio,
  relogio,
  resumoDaObra,
  turnoCompleto,
  type PostoId,
  type Turno,
} from '../../../jogo/turno/motor';
import { lerTurno, limparTurno, salvarTurno } from '../../../jogo/turno/armazem';

// O turno sorteia três obras com Math.random, e o localStorage não existe no
// servidor: a tela só monta no navegador.
const assinarNada = () => () => {};
const noNavegador = () => true;
const noServidor = () => false;

export default function Salao() {
  const montadoNoCliente = useSyncExternalStore(assinarNada, noNavegador, noServidor);
  // Retoma o turno guardado (a pessoa voltou de um posto) ou abre um novo.
  // Na inicialização do estado, e não num efeito: efeito que chama setState
  // dispara re-render em cascata, e o React 19 reclama com razão.
  const [turno, setTurno] = useState<Turno>(() => lerTurno() ?? criarTurno());
  const { iniciar, tocar } = useSom();

  // Turno novo precisa ser gravado para atravessar a ida a um posto.
  useEffect(() => { salvarTurno(turno); }, [turno]);

  const aplicar = useCallback((fn: (t: Turno) => Turno) => {
    setTurno((anterior) => fn(anterior));
  }, []);

  const novoTurno = () => {
    limparTurno();
    const t = criarTurno();
    salvarTurno(t);
    setTurno(t);
  };

  if (!montadoNoCliente) {
    return (
      <div className="min-h-[calc(100vh-5rem)] bg-black flex items-center justify-center">
        <span className="text-[10px] font-black uppercase tracking-widest text-white/30">Abrindo o salão…</span>
      </div>
    );
  }

  const r = relatorio(turno);
  const sobra = equipeDeSobra(turno);
  const completo = turnoCompleto(turno);
  const placar = pontuarTurno(turno);
  const previsao = previsaoDoTurno(turno);
  const kva = kvaDoSalao(turno);
  const listaDeConflitos = conflitos(turno);
  const faltaRack = !turno.rackMontado;
  const todosEntregues = POSTOS.every((p) => postoJogado(turno, p.id));

  const mexerNaEquipe = (id: PostoId, delta: number) => {
    iniciar(); tocar('clique', 520);
    aplicar((t) => alocarEquipe(t, id, t.equipe[id] + delta));
  };

  return (
    <>
      <BackButton href="/testes/calltime" />

      <div className="min-h-[calc(100vh-5rem)] bg-black text-white">

        {/* ---------------- cabeçalho do turno ---------------- */}
        <div className="border-b border-[#284B8C]/25 bg-[#0C1D4D]/20 px-4 py-3 sticky top-20 z-40 backdrop-blur">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <h1 className="text-lg font-black uppercase tracking-wider">
                Call Time <span className="text-[#336699]">· Turno</span>
              </h1>
              <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-white/35">
                Salão inteiro, uma equipe
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className={`text-2xl font-black tabular-nums leading-none ${
                  minutosDoTurno(turno) > JANELA_TURNO ? 'text-red-400' : ''
                }`}>
                  {relogio(minutosDoTurno(turno))}
                </div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-white/40 tabular-nums">
                  {folgaDoTurno(turno) >= 0 ? `${folgaDoTurno(turno)} min de folga` : `${-folgaDoTurno(turno)} min de atraso`}
                </div>
              </div>
              <button
                onClick={novoTurno}
                className="px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest bg-black/40 border border-[#284B8C]/40 text-white/60 hover:text-white transition-colors"
              >
                Novo turno
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-5">

          {/* ---------------- a régua do turno ---------------- */}
          <div className="flex flex-col gap-1.5">
            <div className="flex h-3 rounded-full overflow-hidden bg-white/[0.06]">
              {POSTOS.map((p) => {
                const min = r.postos.find((x) => x.id === p.id)?.calendario ?? 0;
                return (
                  <div
                    key={p.id}
                    style={{ width: `${Math.min(100, (min / JANELA_TURNO) * 100)}%`, background: p.cor }}
                    title={`${p.rotulo}: ${min} min`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-white/35 tabular-nums">
              <span>14:00 · o caminhão chegou</span>
              <span>
                montagem {r.montagem} min · extras {r.extras} min
                {!todosEntregues && Number.isFinite(previsao) && ` · previsto ${previsao} min`}
              </span>
              <span className="text-red-400/80">19:00 · porta abre</span>
            </div>
          </div>

          {/* ---------------- planta do salão ---------------- */}
          <div className="rounded-2xl border border-[#284B8C]/30 bg-[#0C1D4D]/15 p-4 sm:p-5 flex flex-col gap-3">

            {/* o grid cruza por cima do palco: é isso que amarra a ordem */}
            <PostoDoSalao
              turno={turno}
              id="luz"
              largo
              aviso="O truss cruza por cima do palco — se o LED subir antes, não passa mais."
              onEquipe={mexerNaEquipe}
            />

            <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
              <PostoDoSalao turno={turno} id="som" onEquipe={mexerNaEquipe} />
              <PostoDoSalao turno={turno} id="video" onEquipe={mexerNaEquipe} />
            </div>

            {/* rack de controle: não é mini-jogo, é uma etapa do salão */}
            <div className={`rounded-xl border p-4 flex items-center justify-between gap-3 ${
              turno.rackMontado ? 'border-[#336699]/50 bg-[#0C1D4D]/35' : 'border-dashed border-white/15 bg-white/[0.02]'
            }`}>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[10px] font-black uppercase tracking-widest text-white/50">Rack de controle</span>
                <span className="text-xs text-white/50 leading-snug">
                  Régie, multicabo e sinal até o palco. Sem ele o salão não abre.
                </span>
              </div>
              {turno.rackMontado ? (
                <span className="text-[11px] font-black uppercase tracking-widest text-[#4E93D8] shrink-0">
                  ✓ {CUSTO_RACK} min
                </span>
              ) : (
                <button
                  onClick={() => { iniciar(); tocar('sucesso', 620); aplicar(montarRack); }}
                  className="shrink-0 px-4 py-2.5 rounded-lg text-[11px] font-black uppercase tracking-widest bg-[#336699] text-white hover:bg-[#3d7bb5] transition-colors"
                >
                  Montar · −{CUSTO_RACK} min
                </button>
              )}
            </div>
          </div>

          {/* ---------------- recursos do salão ---------------- */}
          <div className="grid gap-3 sm:grid-cols-2">

            {/* equipe */}
            <div className="rounded-xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-4 flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Equipe</h2>
                <span className={`text-[10px] font-black uppercase tracking-wider tabular-nums ${
                  sobra > 0 ? 'text-amber-400' : 'text-white/35'
                }`}>
                  {sobra > 0 ? `${sobra} no pátio` : 'toda alocada'}
                </span>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: EQUIPE_TOTAL }, (_, k) => (
                  <div
                    key={k}
                    className={`h-8 flex-1 rounded ${k < EQUIPE_TOTAL - sobra ? 'bg-[#336699]' : 'bg-white/10'}`}
                  />
                ))}
              </div>
              <p className="text-[10px] text-white/40 leading-snug">
                A dupla é a régua: dois montadores fazem a obra na janela prevista. O terceiro ainda
                ajuda bastante, o quinto quase não. Quem entrega um posto devolve a equipe ao pátio.
              </p>
            </div>

            {/* gerador */}
            <div className={`rounded-xl border p-4 flex flex-col gap-2 ${
              geradorEstourado(turno) && !turno.geradorExtra
                ? 'border-red-500/50 bg-red-950/20'
                : 'border-[#284B8C]/30 bg-[#0C1D4D]/20'
            }`}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-[#336699]">
                  Gerador {turno.geradorExtra ? '· 2 unidades' : `· ${GERADOR_KVA} kVA`}
                </h2>
                <span className="text-[10px] font-black uppercase tracking-wider tabular-nums text-white/60">
                  {kva.toFixed(1).replace('.', ',')} kVA
                </span>
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-white/[0.06]">
                <div
                  className={`h-full ${geradorEstourado(turno) ? 'bg-red-500' : 'bg-[#E0912F]'}`}
                  style={{ width: `${Math.min(100, (kva / GERADOR_KVA) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-white/40 leading-snug">
                A carga dos três postos somada, em VA — watt dividido pelo fator de potência de 0,9.
                Ela só aparece conforme os postos entregam.
              </p>
              {geradorEstourado(turno) && !turno.geradorExtra && (
                <button
                  onClick={() => { iniciar(); tocar('erro'); aplicar(buscarGerador); }}
                  className="mt-1 py-2.5 rounded-lg text-[11px] font-black uppercase tracking-widest bg-amber-500 text-black hover:bg-amber-400 transition-colors"
                >
                  Buscar o segundo gerador · −{CUSTO_GERADOR_EXTRA} min
                </button>
              )}
            </div>
          </div>

          {/* ---------------- o que o salão está cobrando ---------------- */}
          {listaDeConflitos.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {listaDeConflitos.map((c) => (
                <div
                  key={c.curto}
                  className={`rounded-lg border px-3 py-2 text-xs leading-snug ${
                    c.reprova ? 'border-red-500/50 bg-red-950/30 text-red-100'
                      : c.minutos > 0 ? 'border-amber-500/40 bg-amber-950/20 text-amber-100'
                      : 'border-[#284B8C]/40 bg-[#0C1D4D]/25 text-white/70'
                  }`}
                >
                  {c.texto}
                  {c.minutos > 0 && <strong className="block mt-1 font-black">−{c.minutos} min</strong>}
                </div>
              ))}
            </div>
          )}

          {/* ---------------- fechamento do turno ---------------- */}
          {completo && (
            <div className={`rounded-2xl border p-5 flex flex-col gap-3 ${
              placar.reprovado ? 'border-red-500/50 bg-red-950/20' : 'border-[#336699]/50 bg-[#0C1D4D]/30'
            }`}>
              <span className="text-[10px] font-black uppercase tracking-widest text-[#4E93D8]">
                {relogio(minutosDoTurno(turno))} · Salão entregue
              </span>

              {placar.reprovado ? (
                <>
                  <h2 className="text-3xl font-black text-red-400 leading-none">Turno reprovado</h2>
                  <p className="text-sm text-red-200/80 leading-relaxed">{placar.motivo}</p>
                </>
              ) : (
                <>
                  <div className="flex items-baseline gap-3">
                    <span className="text-5xl font-black tabular-nums">{placar.total}</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/40">pontos do turno</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <Caixinha rotulo="Os três postos" valor={placar.dosPostos} />
                    <Caixinha rotulo={`Folga · ${placar.folgaMin} min`} valor={placar.daFolga} />
                    <Caixinha rotulo="Salão completo" valor={placar.bonusCompleto} />
                  </div>
                </>
              )}

              <div className="flex flex-col gap-1 mt-1">
                {r.postos.map((p) => (
                  <div key={p.id} className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums">
                    <span className="font-bold" style={{ color: p.cor }}>{p.rotulo}</span>
                    <span className="text-white/45 truncate">
                      {p.montadores} {p.montadores === 1 ? 'montador' : 'montadores'} · {p.trabalho} min de trabalho → {p.calendario} min de salão
                    </span>
                    <span className="font-black">{p.pontos}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-1">
                <button
                  onClick={novoTurno}
                  className="flex-1 py-3 rounded-xl bg-white text-black text-xs font-black uppercase tracking-widest hover:bg-white/90 transition-colors"
                >
                  Outro turno
                </button>
                <Link
                  href="/testes/calltime"
                  className="py-3 px-4 rounded-xl border border-[#284B8C]/40 text-white/60 text-[11px] font-black uppercase tracking-widest hover:text-white hover:border-[#336699] transition-colors"
                >
                  Voltar aos postos
                </Link>
              </div>
            </div>
          )}

          {!completo && (
            <p className="text-[11px] text-white/35 leading-relaxed max-w-[62ch]">
              {sobra > 0
                ? 'Distribua os montadores entre os postos que faltam — o salão não deixa ninguém entrar com gente parada no pátio.'
                : faltaRack && todosEntregues
                  ? 'Falta o rack de controle para o salão abrir.'
                  : 'Toque num posto para montar. Entregar o menor primeiro devolve a equipe mais cedo para o que falta.'}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Caixinha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-[#284B8C]/30 bg-black/30 px-3 py-2">
      <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">{rotulo}</span>
      <span className="font-black tabular-nums">{valor}</span>
    </div>
  );
}

/** Um posto na planta: o que a obra pede, quanta gente está nela e o estado. */
function PostoDoSalao({
  turno, id, largo = false, aviso, onEquipe,
}: {
  turno: Turno;
  id: PostoId;
  largo?: boolean;
  aviso?: string;
  onEquipe: (id: PostoId, delta: number) => void;
}) {
  const posto = POSTOS.find((p) => p.id === id)!;
  const obra = resumoDaObra(turno, id);
  const entregue = postoJogado(turno, id);
  const resultado = turno.resultados[id];
  const previsto = previsaoDoPosto(turno, id);
  const pode = podeEntrarNoPosto(turno, id);
  const montadores = turno.equipe[id];

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-3 ${largo ? 'sm:flex-row sm:items-center sm:gap-5' : ''} ${
        entregue
          ? resultado?.reprovado ? 'border-red-500/50 bg-red-950/20' : 'border-[#336699]/50 bg-[#0C1D4D]/35'
          : 'border-[#284B8C]/30 bg-black/30'
      }`}
    >
      <div className="flex flex-col gap-1 flex-grow min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: posto.cor }}>
            {posto.rotulo}
          </span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-white/30 truncate">
            {obra.titulo}
          </span>
        </div>
        <span className="text-sm font-black text-white leading-tight">{obra.detalhe}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/35 tabular-nums">
          {entregue
            ? `entregue em ${resultado?.minutos} min · ${resultado?.pontos} pontos`
            : `previsto ${Number.isFinite(previsto) ? `${previsto} min` : '— sem equipe'} · janela ${obra.previsto} min com dupla`}
        </span>
        {aviso && !entregue && (
          <span className="text-[10px] text-amber-300/70 leading-snug">{aviso}</span>
        )}
        {entregue && (resultado?.problemas.length ?? 0) > 0 && (
          <span className="text-[10px] text-amber-300/70 leading-snug truncate">
            {resultado?.problemas.join(' · ')}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {/* equipe naquele posto */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEquipe(id, -1)}
            disabled={entregue || montadores === 0}
            className="h-8 w-8 rounded-lg border border-[#284B8C]/40 bg-black/40 text-white/60 font-black disabled:opacity-25 hover:text-white transition-colors"
          >
            −
          </button>
          <div className="w-14 text-center">
            <div className="text-lg font-black tabular-nums leading-none">{montadores}</div>
            <div className="text-[8px] font-bold uppercase tracking-wider text-white/35 tabular-nums">
              ×{fatorEquipe(montadores).toFixed(2).replace('.', ',')}
            </div>
          </div>
          <button
            onClick={() => onEquipe(id, +1)}
            disabled={entregue || equipeDeSobra(turno) === 0}
            className="h-8 w-8 rounded-lg border border-[#284B8C]/40 bg-black/40 text-white/60 font-black disabled:opacity-25 hover:text-white transition-colors"
          >
            +
          </button>
        </div>

        {entregue ? (
          <span className="px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-[#4E93D8]">
            ✓ Montado
          </span>
        ) : pode ? (
          <Link
            href={`${posto.rota}?turno=1`}
            className="px-4 py-2.5 rounded-lg text-[11px] font-black uppercase tracking-widest text-white transition-all hover:brightness-125"
            style={{ background: posto.cor }}
          >
            Montar
          </Link>
        ) : (
          <span
            className="px-4 py-2.5 rounded-lg text-[11px] font-black uppercase tracking-widest border border-white/10 text-white/25"
            title={montadores === 0 ? 'Posto sem equipe' : 'Tem montador parado no pátio'}
          >
            {montadores === 0 ? 'Sem equipe' : 'Aloque a equipe'}
          </span>
        )}
      </div>

      {/* o custo de inverter a ordem fica escrito, não é pegadinha */}
      {id === 'luz' && !entregue && postoJogado(turno, 'video') && (
        <span className="text-[10px] font-bold text-red-300/80 leading-snug">
          O LED já subiu: passar o grid agora custa {CUSTO_ORDEM_INVERTIDA} min.
        </span>
      )}
    </div>
  );
}
