"use client";

import { useEffect, useRef, useState } from 'react';
import { listarConversasDiretoriaAction, obterConversaDiretoriaAction, perguntarDiretorAction, excluirConversaDiretoriaAction } from './actions';
import { useToast, useConfirm } from '../../components/ui/NotificationProvider';

// Aba "Perguntar" de /admin/diretoria — chat com o Diretor (IA), que consulta
// os dados por ferramentas só de leitura (app/lib/diretoria/chat.ts). Cada
// conversa é só de quem a criou.

interface Item { papel: 'user' | 'assistant'; texto: string; em: string; consultas?: string[]; custo_usd?: number; erro?: boolean }
interface ConversaResumo { id: string; titulo: string; atualizado_em: string }

const SUGESTOES = [
  'Quanto recebemos este mês e quem mais pagou?',
  'Quais OPs estão pendentes há mais de 30 dias?',
  'Quem são os maiores devedores com atraso de até 90 dias?',
  'Que locações começam nos próximos 7 dias?',
  'Qual material ainda não voltou de evento?',
  'Quanto gastamos com freelancers em outubro?',
];

const horaCurta = (ts: string) => new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function Perguntar({ accessToken, empresaTelaId }: { accessToken: string; empresaTelaId: number | null }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [conversas, setConversas] = useState<ConversaResumo[] | null>(null);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  const carregarConversas = async () => {
    const res = await listarConversasDiretoriaAction(accessToken);
    if (res.ok) setConversas(res.info); else { setConversas([]); toast(res.erro || 'Erro ao carregar conversas.', 'error'); }
  };

  useEffect(() => {
    let ativo = true;
    listarConversasDiretoriaAction(accessToken).then(res => {
      if (!ativo) return;
      if (res.ok) setConversas(res.info); else { setConversas([]); toast(res.erro || 'Erro ao carregar conversas.', 'error'); }
    });
    return () => { ativo = false; };
  }, [accessToken, toast]);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [itens, enviando]);

  const abrirConversa = async (id: string) => {
    if (enviando) return;
    setConversaId(id);
    setItens([]);
    const res = await obterConversaDiretoriaAction(id, accessToken);
    if (res.ok) setItens(res.info.exibicao || []); else toast(res.erro || 'Erro ao abrir conversa.', 'error');
  };

  const novaConversa = () => { if (!enviando) { setConversaId(null); setItens([]); setTexto(''); } };

  const enviar = async (pergunta?: string) => {
    const q = (pergunta ?? texto).trim();
    if (!q || enviando) return;
    setTexto('');
    setEnviando(true);
    setItens(prev => [...prev, { papel: 'user', texto: q, em: new Date().toISOString() }]);
    const res = await perguntarDiretorAction(conversaId, q, empresaTelaId, accessToken);
    setEnviando(false);
    if (res.ok) {
      setItens(prev => [...prev, res.info.resposta]);
      if (!conversaId) { setConversaId(res.info.conversaId); carregarConversas(); }
    } else {
      // A pergunta que falhou não fica gravada na conversa — só aparece aqui, marcada.
      setItens(prev => [...prev, { papel: 'assistant', texto: res.erro || 'Falha ao responder.', em: new Date().toISOString(), erro: true }]);
    }
  };

  const excluir = async (c: ConversaResumo) => {
    if (!(await confirmar({ title: 'Excluir conversa', message: `Excluir “${c.titulo}”? Não dá para desfazer.`, confirmLabel: 'Excluir', danger: true }))) return;
    const res = await excluirConversaDiretoriaAction(c.id, accessToken);
    if (!res.ok) { toast(res.erro || 'Erro ao excluir.', 'error'); return; }
    if (conversaId === c.id) novaConversa();
    carregarConversas();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6">
      <aside className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden lg:max-h-[75vh] flex flex-col">
        <div className="p-3 border-b border-[#E2E8F0]">
          <button onClick={novaConversa} disabled={enviando} className="w-full bg-[#0C1D4D] text-white py-2 rounded-lg font-black uppercase text-[11px] tracking-wider hover:bg-[#284B8C] disabled:opacity-50">+ Nova conversa</button>
        </div>
        <ul className="overflow-y-auto max-h-48 lg:max-h-none">
          {conversas === null && <li className="px-4 py-3 text-xs text-gray-400">Carregando…</li>}
          {conversas?.length === 0 && <li className="px-4 py-3 text-xs text-gray-500">Nenhuma conversa ainda.</li>}
          {conversas?.map(c => (
            <li key={c.id} className={`group flex items-start border-l-4 ${c.id === conversaId ? 'bg-[#F0F4F8] border-[#336699]' : 'border-transparent hover:bg-slate-50'}`}>
              <button onClick={() => abrirConversa(c.id)} className="flex-1 min-w-0 text-left px-3 py-2.5">
                <p className="text-xs font-bold text-[#0C1D4D] line-clamp-2">{c.titulo}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{horaCurta(c.atualizado_em)}</p>
              </button>
              <button onClick={() => excluir(c)} title="Excluir conversa" className="px-2 py-2.5 text-gray-300 hover:text-red-500 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">✕</button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm flex flex-col min-h-[60vh] lg:h-[75vh] min-w-0">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {itens.length === 0 && !enviando && (
            <div className="h-full flex flex-col items-center justify-center text-center py-10">
              <div className="text-4xl mb-3">🧭</div>
              <p className="text-sm font-black text-[#0C1D4D]">Pergunte ao Diretor</p>
              <p className="text-xs text-gray-500 max-w-md mt-1">Ele consulta recebimentos, pagamentos, OPs, locações, expedição, frota, RH e os próprios relatórios antes de responder. Só lê — não altera nada.</p>
              <div className="flex flex-wrap justify-center gap-2 mt-5 max-w-xl">
                {SUGESTOES.map(s => (
                  <button key={s} onClick={() => enviar(s)} className="text-[11px] font-bold text-[#284B8C] bg-[#F0F4F8] border border-[#E2E8F0] rounded-full px-3 py-1.5 hover:border-[#336699] text-left">{s}</button>
                ))}
              </div>
            </div>
          )}
          {itens.map((it, i) => it.papel === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] bg-[#0C1D4D] text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-wrap break-words">{it.texto}</div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className={`max-w-[92%] rounded-2xl rounded-bl-md px-4 py-3 text-sm whitespace-pre-wrap break-words ${it.erro ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-[#F0F4F8] text-gray-800'}`}>
                {it.texto}
                {(it.consultas?.length || 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3 pt-2 border-t border-[#E2E8F0]">
                    {[...new Set(it.consultas)].map(c => <span key={c} className="text-[9px] font-bold text-gray-500 bg-white border border-[#E2E8F0] rounded-full px-2 py-0.5">🔎 {c}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {enviando && (
            <div className="flex justify-start">
              <div className="bg-[#F0F4F8] rounded-2xl rounded-bl-md px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" />
                O diretor está consultando os dados…
              </div>
            </div>
          )}
          <div ref={fimRef} />
        </div>
        <div className="border-t border-[#E2E8F0] p-3 flex gap-2 items-end">
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            placeholder="Pergunte algo… (Enter envia, Shift+Enter quebra linha)"
            rows={2}
            maxLength={2000}
            disabled={enviando}
            className="flex-1 resize-none p-2.5 border border-gray-300 rounded-xl text-sm bg-gray-50 text-gray-800 outline-none focus:border-[#336699] disabled:opacity-60"
          />
          <button onClick={() => enviar()} disabled={enviando || !texto.trim()} className="bg-[#0C1D4D] text-white px-4 py-3 rounded-xl font-black text-sm hover:bg-[#284B8C] disabled:opacity-40" aria-label="Enviar">→</button>
        </div>
      </section>
    </div>
  );
}
