"use client";

// Botão "💬 Pergunte" + painel do Assistente dos Manuais (2026-11-24). Fica no
// layout de /admin/manuais: aparece na lista e dentro de cada manual (e aí
// sabe qual manual está aberto). Endereços de tela na resposta (/admin/...)
// viram link; as seções de manual que ele leu aparecem como atalhos.
import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useConfirm, useToast } from '../../components/ui/NotificationProvider';
import { listarConversasAjudaAction, obterConversaAjudaAction, perguntarAjudaAction, excluirConversaAjudaAction, type ConversaAjudaResumo } from './actions-ajuda';
import type { ItemAjuda } from '../../lib/ajuda/assistente';

type Item = ItemAjuda & { erro?: boolean };

const SUGESTOES = [
  'Onde eu aprovo uma folga de funcionário?',
  'Como cadastro um cliente novo?',
  'Onde vejo o relatório de faturamento?',
  'Como emito uma nota fiscal?',
  'Onde abro um chamado para a TI?',
];

const tokenAtual = async () => (await supabase.auth.getSession()).data.session?.access_token || '';
const horaCurta = (ts: string) => new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Texto com os endereços "/admin/..." virando link. */
function ComLinks({ texto, aoNavegar }: { texto: string; aoNavegar: () => void }) {
  const partes = texto.split(/(\/admin\/[a-z0-9\-/]+[a-z0-9])/gi);
  return (
    <>
      {partes.map((p, i) => /^\/admin\//i.test(p)
        ? <Link key={i} href={p} onClick={aoNavegar} className="font-bold text-[#336699] underline underline-offset-2 break-all">{p}</Link>
        : <Fragment key={i}>{p}</Fragment>)}
    </>
  );
}

export default function AssistenteManuais() {
  const toast = useToast();
  const confirmar = useConfirm();
  const pathname = usePathname();
  const manualAberto = /^\/admin\/manuais\/([^/]+)/.exec(pathname || '')?.[1] || null;
  const [aberto, setAberto] = useState(false);
  const [verConversas, setVerConversas] = useState(false);
  const [conversas, setConversas] = useState<ConversaAjudaResumo[] | null>(null);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [itens, enviando, aberto]);

  const carregarConversas = async () => {
    const r = await listarConversasAjudaAction(await tokenAtual());
    if (r.ok) setConversas(r.info || []); else { setConversas([]); toast(r.erro || 'Erro ao carregar as conversas.', 'error'); }
  };

  const abrirLista = async () => {
    setVerConversas(v => !v);
    if (conversas === null) await carregarConversas();
  };

  const abrirConversa = async (id: string) => {
    if (enviando) return;
    setVerConversas(false); setConversaId(id); setItens([]);
    const r = await obterConversaAjudaAction(id, await tokenAtual());
    if (r.ok && r.info) setItens(r.info.exibicao || []); else toast(r.erro || 'Erro ao abrir a conversa.', 'error');
  };

  const nova = () => { if (!enviando) { setConversaId(null); setItens([]); setTexto(''); setVerConversas(false); } };

  const enviar = async (pergunta?: string) => {
    const q = (pergunta ?? texto).trim();
    if (!q || enviando) return;
    setTexto(''); setEnviando(true);
    setItens(prev => [...prev, { papel: 'user', texto: q, em: new Date().toISOString() }]);
    const r = await perguntarAjudaAction({ conversaId, pergunta: q, manualAberto }, await tokenAtual());
    setEnviando(false);
    if (r.ok && r.info) {
      setItens(prev => [...prev, r.info!.resposta]);
      if (!conversaId) { setConversaId(r.info.conversaId); setConversas(null); }
    } else {
      setItens(prev => [...prev, { papel: 'assistant', texto: r.erro || 'Falha ao responder.', em: new Date().toISOString(), erro: true }]);
    }
  };

  const excluir = async (c: ConversaAjudaResumo) => {
    if (!(await confirmar({ title: 'Excluir conversa', message: `Excluir "${c.titulo}"?`, confirmLabel: 'Excluir', danger: true }))) return;
    const r = await excluirConversaAjudaAction(c.id, await tokenAtual());
    if (!r.ok) { toast(r.erro || 'Erro ao excluir.', 'error'); return; }
    if (conversaId === c.id) nova();
    carregarConversas();
  };

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)} className="fixed bottom-5 right-5 z-40 bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-wider px-5 py-3.5 rounded-full shadow-xl flex items-center gap-2">
        <span className="text-base">💬</span> Pergunte
      </button>
    );
  }

  return (
    <div className="fixed z-40 inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[420px] sm:h-[min(640px,calc(100vh-110px))] bg-white sm:rounded-2xl shadow-2xl border border-[#E2E8F0] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[#0C1D4D] text-white">
        <div className="min-w-0">
          <p className="text-sm font-black truncate">💬 Pergunte sobre o sistema</p>
          <p className="text-[10px] text-white/70 truncate">Onde fica uma tela, um botão, um relatório, como fazer algo.</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={abrirLista} title="Minhas conversas" className={`text-[10px] font-black uppercase px-2 py-1 rounded ${verConversas ? 'bg-white/20' : 'hover:bg-white/10'}`}>Conversas</button>
          <button onClick={nova} title="Nova conversa" className="text-[10px] font-black uppercase px-2 py-1 rounded hover:bg-white/10">+ Nova</button>
          <button onClick={() => setAberto(false)} title="Fechar" className="text-lg leading-none px-2 hover:text-white/70">✕</button>
        </div>
      </div>

      {verConversas ? (
        <ul className="flex-1 overflow-y-auto divide-y divide-[#F1F5F9]">
          {conversas === null && <li className="px-4 py-3 text-xs text-gray-400">Carregando…</li>}
          {conversas?.length === 0 && <li className="px-4 py-3 text-xs text-gray-500">Nenhuma conversa ainda.</li>}
          {conversas?.map(c => (
            <li key={c.id} className={`flex items-start ${c.id === conversaId ? 'bg-[#F0F4F8]' : 'hover:bg-slate-50'}`}>
              <button onClick={() => abrirConversa(c.id)} className="flex-1 min-w-0 text-left px-4 py-2.5">
                <p className="text-xs font-bold text-[#0C1D4D] line-clamp-2">{c.titulo}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{horaCurta(c.atualizado_em)}</p>
              </button>
              <button onClick={() => excluir(c)} title="Excluir" className="px-3 py-2.5 text-gray-300 hover:text-red-500">✕</button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {itens.length === 0 && !enviando && (
            <div className="text-center py-6">
              <div className="text-3xl mb-2">🧭</div>
              <p className="text-xs text-gray-500 max-w-xs mx-auto">Pergunte onde encontrar algo no sistema ou como fazer uma tarefa. As respostas vêm dos manuais e do menu das telas que você pode abrir.</p>
              <div className="flex flex-col gap-2 mt-4">
                {SUGESTOES.map(s => (
                  <button key={s} onClick={() => enviar(s)} className="text-[11px] font-bold text-[#284B8C] bg-[#F0F4F8] border border-[#E2E8F0] rounded-full px-3 py-1.5 hover:border-[#336699]">{s}</button>
                ))}
              </div>
            </div>
          )}
          {itens.map((it, i) => it.papel === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] bg-[#0C1D4D] text-white rounded-2xl rounded-br-md px-3.5 py-2 text-sm whitespace-pre-wrap break-words">{it.texto}</div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className={`max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words ${it.erro ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-[#F0F4F8] text-gray-800'}`}>
                {it.erro ? it.texto : <ComLinks texto={it.texto} aoNavegar={() => setAberto(false)} />}
                {!!it.links?.length && (
                  <div className="flex flex-wrap gap-1 mt-2.5 pt-2 border-t border-[#E2E8F0]">
                    {it.links.map(l => (
                      <Link key={l.href} href={l.href} onClick={() => setAberto(false)} className="text-[10px] font-bold text-[#336699] bg-white border border-[#E2E8F0] rounded-full px-2 py-0.5 hover:border-[#336699]">📖 {l.rotulo}</Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {enviando && (
            <div className="flex justify-start">
              <div className="bg-[#F0F4F8] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-gray-500 flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /> Procurando nos manuais…
              </div>
            </div>
          )}
          <div ref={fimRef} />
        </div>
      )}

      <div className="border-t border-[#E2E8F0] p-2.5 flex gap-2 items-end">
        <textarea
          value={texto} onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          placeholder="Ex.: onde eu vejo as OPs pendentes?" rows={2} maxLength={1500} disabled={enviando}
          className="flex-1 resize-none p-2 border border-gray-300 rounded-xl text-sm bg-gray-50 text-gray-800 outline-none focus:border-[#336699] disabled:opacity-60"
        />
        <button onClick={() => enviar()} disabled={enviando || !texto.trim()} className="bg-[#0C1D4D] text-white px-4 py-2.5 rounded-xl font-black text-sm hover:bg-[#284B8C] disabled:opacity-40" aria-label="Enviar">→</button>
      </div>
    </div>
  );
}
