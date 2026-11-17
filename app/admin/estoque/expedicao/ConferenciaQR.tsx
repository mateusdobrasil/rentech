"use client";

// Conferência peça a peça por QR no checklist da Expedição (2026-11-17).
// Lê a etiqueta do patrimônio (Estoque → Equipamentos de Locação → Etiquetas)
// com leitor USB/Bluetooth (funciona como teclado: digita e dá Enter) ou com a
// câmera do celular (BarcodeDetector — Chrome/Android; no iPhone, use o leitor
// ou digite o nº). Cada leitura conta 1 na Saída ou no Retorno da linha do
// mesmo produto; as quantidades vão para o checklist ao salvar.
import { useState, useEffect, useRef, useCallback } from 'react';
import { lerPecaAction, listarPecasAction, removerPecaAction } from './actions-fichas';
import FormAvaria from '../manutencao/FormAvaria';

interface ItemResumo { id: string; descricao: string; qtd_prevista: string; saida_qtd: number | null; retorno_qtd: number | null }
interface Peca {
  id: number; checklist_item_id: string | null; tipo: 'SAIDA' | 'RETORNO'; lido_por: string | null; lido_em: string; numero: string; serie: string | null; produto: string;
  patrimonio_id: number; produto_id: number; empresa_id: number; valor_indenizacao: number | null;
}

export default function ConferenciaQR({ checklistId, accessToken, itens, itensNaoSalvos, onContagem, onSalvar, onFechar }: {
  checklistId: string; accessToken: string; itens: ItemResumo[]; itensNaoSalvos: boolean;
  onContagem: (itemId: string, tipo: 'SAIDA' | 'RETORNO', contagem: number) => void;
  onSalvar: () => void; onFechar: () => void;
}) {
  const [tipo, setTipo] = useState<'SAIDA' | 'RETORNO'>('SAIDA');
  const [codigo, setCodigo] = useState('');
  const [pecas, setPecas] = useState<Peca[]>([]);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; texto: string } | null>(null);
  const [lendo, setLendo] = useState(false);
  const [camera, setCamera] = useState(false);
  // avaria constatada no retorno (abre FormAvaria com a peça já escolhida)
  const [avariaDe, setAvariaDe] = useState<Peca | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ultimoLido = useRef<{ codigo: string; em: number }>({ codigo: '', em: 0 });
  const temCamera = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

  const carregar = useCallback(async () => {
    const r = await listarPecasAction(checklistId, accessToken);
    if (r.ok) setPecas(r.info);
  }, [checklistId, accessToken]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { inputRef.current?.focus(); }, [tipo]);

  const bip = (ok: boolean) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator(); o.frequency.value = ok ? 1200 : 300; o.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
    } catch { /* sem áudio */ }
  };

  const ler = useCallback(async (valor: string) => {
    const v = valor.trim();
    if (!v || lendo) return;
    // a câmera repete a mesma leitura várias vezes por segundo
    if (ultimoLido.current.codigo === v && Date.now() - ultimoLido.current.em < 2500) return;
    ultimoLido.current = { codigo: v, em: Date.now() };
    setLendo(true);
    const r = await lerPecaAction(checklistId, v, tipo, accessToken);
    setLendo(false);
    setCodigo('');
    if (!r.ok) { setMsg({ tipo: r.info?.duplicada ? 'aviso' : 'erro', texto: r.erro || 'Erro na leitura.' }); bip(false); inputRef.current?.focus(); return; }
    onContagem(r.info.checklist_item_id, tipo, r.info.contagem);
    setMsg({ tipo: r.info.avisoSemSaida ? 'aviso' : 'ok', texto: `✔ ${r.info.numero} — ${r.info.produto} (${r.info.contagem} lida(s) na ${tipo === 'SAIDA' ? 'saída' : 'volta'})${r.info.avisoSemSaida ? ' · atenção: não constava saída por este checklist' : ''}` });
    bip(true);
    carregar();
    inputRef.current?.focus();
  }, [checklistId, tipo, accessToken, lendo, onContagem, carregar]);

  // ---------------- câmera ----------------
  // a câmera chama a leitura pela ref — senão o stream reiniciaria a cada
  // leitura (ler muda junto com "lendo"/"tipo")
  const lerRef = useRef(ler);
  useEffect(() => { lerRef.current = ler; }, [ler]);
  useEffect(() => {
    if (!camera) return;
    let parar = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        const loop = async () => {
          if (parar || !videoRef.current) return;
          try {
            const codigos = await detector.detect(videoRef.current);
            if (codigos?.[0]?.rawValue) await lerRef.current(codigos[0].rawValue);
          } catch { /* frame sem leitura */ }
          setTimeout(loop, 350);
        };
        loop();
      } catch (e: any) {
        setMsg({ tipo: 'erro', texto: `Não foi possível abrir a câmera: ${e.message}` });
        setCamera(false);
      }
    })();
    return () => { parar = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [camera]);

  const remover = async (p: Peca) => {
    const r = await removerPecaAction(p.id, accessToken);
    if (!r.ok) { setMsg({ tipo: 'erro', texto: r.erro || 'Erro.' }); return; }
    if (r.info.checklist_item_id) onContagem(r.info.checklist_item_id, r.info.tipo, r.info.contagem);
    carregar();
  };

  const doTipo = pecas.filter(p => p.tipo === tipo);
  const contagemItem = (id: string) => pecas.filter(p => p.tipo === tipo && p.checklist_item_id === id).length;
  const itensComLeitura = itens.filter(i => contagemItem(i.id) > 0);
  const saidasSemVolta = pecas.filter(p => p.tipo === 'SAIDA' && !pecas.some(q => q.tipo === 'RETORNO' && q.numero === p.numero));

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 md:p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 flex justify-between items-center text-white bg-[#0C1D4D] flex-shrink-0">
          <h3 className="font-black uppercase tracking-wider text-sm">📷 Conferir peças por QR</h3>
          <button onClick={onFechar} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-4 md:p-6 overflow-y-auto space-y-4">
          {itensNaoSalvos && (
            <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">Há itens novos ainda não salvos — salve o checklist para que as peças deles possam ser lidas.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(['SAIDA', 'RETORNO'] as const).map(t => (
              <button key={t} onClick={() => setTipo(t)}
                className={`py-3 rounded-xl text-sm font-black uppercase border-2 ${tipo === t ? (t === 'SAIDA' ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-emerald-600 bg-emerald-50 text-emerald-800') : 'border-[#E2E8F0] text-gray-400'}`}>
                {t === 'SAIDA' ? '⬆ Saída (separação)' : '⬇ Retorno (volta)'}
              </button>
            ))}
          </div>
          <form onSubmit={e => { e.preventDefault(); ler(codigo); }} className="flex gap-2">
            <input ref={inputRef} value={codigo} onChange={e => setCodigo(e.target.value)} autoFocus disabled={lendo}
              placeholder="Aponte o leitor para a etiqueta (ou digite o nº do patrimônio e Enter)"
              className="flex-1 border-2 border-[#336699] rounded-xl px-4 py-3 text-base font-bold uppercase focus:outline-none" />
            {temCamera && (
              <button type="button" onClick={() => setCamera(c => !c)} className={`px-4 rounded-xl font-black text-xs uppercase border-2 ${camera ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-[#CBD5E1] text-[#0C1D4D]'}`}>
                {camera ? 'Fechar câmera' : '📷 Câmera'}
              </button>
            )}
          </form>
          {camera && <video ref={videoRef} playsInline muted className="w-full max-h-64 object-cover rounded-xl bg-black" />}
          {msg && (
            <p className={`text-sm font-bold rounded-lg p-3 border ${msg.tipo === 'ok' ? 'bg-green-50 border-green-200 text-green-700' : msg.tipo === 'aviso' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.texto}</p>
          )}

          {itensComLeitura.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">Contagem por item ({tipo === 'SAIDA' ? 'saída' : 'retorno'})</p>
              <ul className="text-xs divide-y divide-[#F1F5F9] border border-[#E2E8F0] rounded-lg">
                {itensComLeitura.map(i => {
                  const c = contagemItem(i.id);
                  const previsto = parseInt(i.qtd_prevista, 10);
                  const alvo = tipo === 'SAIDA' ? (Number.isNaN(previsto) ? null : previsto) : (i.saida_qtd ?? null);
                  return (
                    <li key={i.id} className="flex justify-between px-3 py-2">
                      <span className="truncate pr-2">{i.descricao}</span>
                      <span className={`font-black whitespace-nowrap ${alvo !== null && c === alvo ? 'text-emerald-700' : alvo !== null && c > alvo ? 'text-red-600' : 'text-[#0C1D4D]'}`}>{c}{alvo !== null ? ` / ${alvo}` : ''}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div>
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">Peças lidas na {tipo === 'SAIDA' ? 'saída' : 'volta'} ({doTipo.length})</p>
            {doTipo.length === 0 ? <p className="text-xs text-gray-400">Nenhuma ainda.</p> : (
              <ul className="text-xs divide-y divide-[#F1F5F9] border border-[#E2E8F0] rounded-lg max-h-56 overflow-y-auto">
                {doTipo.map(p => (
                  <li key={p.id} className="flex justify-between items-center px-3 py-1.5">
                    <span><strong className="text-[#0C1D4D]">{p.numero}</strong> <span className="text-gray-500">{p.produto}</span></span>
                    <span className="flex items-center gap-3 text-gray-400 whitespace-nowrap">
                      {new Date(p.lido_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {p.lido_por}
                      {p.tipo === 'RETORNO' && <button onClick={() => setAvariaDe(p)} className="text-amber-600 hover:text-amber-800 font-black">⚠ avaria</button>}
                      <button onClick={() => remover(p)} className="text-red-400 hover:text-red-600 font-bold">desfazer</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {tipo === 'RETORNO' && saidasSemVolta.length > 0 && (
            <p className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">
              <strong>Saíram e ainda não voltaram ({saidasSemVolta.length}):</strong> {saidasSemVolta.map(p => p.numero).join(', ')}
            </p>
          )}
        </div>
        {avariaDe && (
          <FormAvaria
            empresaId={avariaDe.empresa_id} accessToken={accessToken} checklistId={checklistId}
            itemInicial={{ patrimonio_id: avariaDe.patrimonio_id, produto_id: avariaDe.produto_id, nome: `${avariaDe.numero} · ${avariaDe.produto}`, controle: 'INDIVIDUAL', valor_indenizacao: avariaDe.valor_indenizacao }}
            onFechar={() => setAvariaDe(null)}
            onSalvo={r => { setAvariaDe(null); setMsg({ tipo: 'aviso', texto: `⚠ Avaria #${r.avariaId} registrada para ${avariaDe.numero}${r.manutencaoId ? ` — OS de manutenção #${r.manutencaoId} aberta` : ''}.` }); }}
          />
        )}
        <div className="p-4 border-t border-[#E2E8F0] flex justify-between items-center gap-2 flex-shrink-0">
          <p className="text-[10px] text-gray-500">As quantidades lidas já estão no checklist — salve para gravar.</p>
          <div className="flex gap-2">
            <button onClick={onFechar} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Fechar</button>
            <button onClick={() => { onSalvar(); onFechar(); }} className="bg-[#0C1D4D] text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">Salvar checklist</button>
          </div>
        </div>
      </div>
    </div>
  );
}
