"use client";

import { useEffect, useRef, useState } from 'react';
import Modal from '../../components/ui/Modal';
import { useToast, usePrompt, useConfirm } from '../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../lib/coresEmpresa';
import { PRIORIDADES, STATUS, STATUS_EM_ABERTO, rotuloPrioridade, type Anexo, type Prioridade } from '../../lib/suporte/constantes';
import { detalheChamadoAction, responderChamadoAction, acaoChamadoAction, type AcaoChamado } from './actions';
import { SeletorAnexos, ListaAnexos } from './Anexos';
import { dataHora, situacaoPrazo, type AreaSuporte, type Mensagem } from './tipos';

interface Detalhe {
  chamado: any; area: { id: number; nome: string; icone: string; cor: string } | null; mensagens: Mensagem[];
  urls: Record<string, string>; sou_solicitante: boolean; sou_atendente: boolean; atendentes: { id: string; nome: string }[];
}

export default function DetalheChamado({ id, onFechar, onMudou, areas, empresas, euId, accessToken }: {
  id: number | null; onFechar: () => void; onMudou: () => void;
  areas: AreaSuporte[]; empresas: { id: number; nome: string }[]; euId: string; accessToken: string;
}) {
  const toast = useToast();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const [d, setD] = useState<Detalhe | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [texto, setTexto] = useState('');
  const [interna, setInterna] = useState(false);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [transferir, setTransferir] = useState<{ areaId: number | ''; motivo: string } | null>(null);
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [reabrir, setReabrir] = useState<string | null>(null);
  const fimConversa = useRef<HTMLDivElement>(null);

  const carregar = async (silencioso = false) => {
    if (!id) return;
    if (!silencioso) setCarregando(true);
    const r = await detalheChamadoAction(id, accessToken);
    setCarregando(false);
    if (!r.ok) { toast(r.erro || 'Erro ao abrir o chamado.', 'error'); onFechar(); return; }
    setD(r.info);
  };

  useEffect(() => {
    setD(null); setTexto(''); setInterna(false); setAnexos([]); setTransferir(null); setNota(0); setComentario(''); setReabrir(null);
    if (id) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { fimConversa.current?.scrollIntoView({ block: 'end' }); }, [d?.mensagens.length]);

  const executar = async (a: AcaoChamado, ok?: string) => {
    if (!id) return false;
    setEnviando(true);
    const r = await acaoChamadoAction(id, a, accessToken);
    setEnviando(false);
    if (!r.ok) { toast(r.erro || 'Não foi possível concluir.', 'error'); return false; }
    if (ok) toast(ok, 'success');
    onMudou();
    // transferido pra outra área: quem não atende a área nova perde o acesso — fecha
    if (a.acao === 'TRANSFERIR') { onFechar(); return true; }
    await carregar(true);
    return true;
  };

  const responder = async () => {
    if (!id || (!texto.trim() && !anexos.length)) return;
    setEnviando(true);
    const r = await responderChamadoAction({ id, texto, anexos, interna }, accessToken);
    setEnviando(false);
    if (!r.ok) { toast(r.erro || 'Falha ao enviar.', 'error'); return; }
    setTexto(''); setAnexos([]);
    await carregar(true);
    onMudou();
  };

  const c = d?.chamado;
  const emAberto = c ? STATUS_EM_ABERTO.includes(c.status) : false;
  const encerrado = c ? ['FECHADO', 'CANCELADO'].includes(c.status) : false;
  const atendente = !!d?.sou_atendente;
  const comoAtendente = atendente && !d?.sou_solicitante;
  const prazo = c ? situacaoPrazo(c) : null;
  const prio = c ? PRIORIDADES.find(p => p.valor === c.prioridade) : null;
  const empresa = c?.empresa_id ? empresas.find(e => e.id === c.empresa_id) : null;

  return (
    <Modal open={!!id} onClose={onFechar} maxWidthClassName="max-w-6xl"
      title={c ? <span className="normal-case">#{c.id} · {c.titulo}</span> : `Chamado #${id ?? ''}`}>
      {carregando || !d || !c ? (
        <div className="py-16 flex justify-center"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 -m-1">
          {/* ================= CONVERSA ================= */}
          <div className="min-w-0 order-2 lg:order-1">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full ${STATUS[c.status as keyof typeof STATUS]?.cor}`}>{STATUS[c.status as keyof typeof STATUS]?.rotulo}</span>
              {prio && <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${prio.cor}`}>{prio.rotulo}</span>}
              {d.area && <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-full text-white" style={{ background: d.area.cor }}>{d.area.icone} {d.area.nome}</span>}
              {c.categoria && <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#475569]">{c.categoria}</span>}
              {empresa && <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full ${corSeloEmpresa(empresa.id)}`}>{empresa.nome}</span>}
              {prazo && <span className={`text-[11px] ${prazo.cor}`}>⏱ {prazo.texto}</span>}
            </div>

            {/* descrição original */}
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <div className="flex justify-between gap-2 text-[11px] text-[#64748B] mb-2">
                <strong className="text-[#0C1D4D]">{c.solicitante_nome}</strong>
                <span>{dataHora(c.created_at)}</span>
              </div>
              <p className="text-sm text-[#334155] whitespace-pre-wrap break-words leading-relaxed">{c.descricao}</p>
              <ListaAnexos anexos={c.anexos || []} urls={d.urls} />
            </div>

            {/* timeline */}
            <div className="mt-4 space-y-3">
              {d.mensagens.map(m => {
                if (m.tipo === 'EVENTO') {
                  return (
                    <div key={m.id} className="flex items-center gap-2 text-[11px] text-[#94A3B8] px-1">
                      <span className="h-px flex-1 bg-[#E2E8F0]" />
                      <span className="text-center max-w-[80%]">{m.texto} · {dataHora(m.created_at)}</span>
                      <span className="h-px flex-1 bg-[#E2E8F0]" />
                    </div>
                  );
                }
                const meu = m.autor_id === euId;
                const ehNota = m.tipo === 'NOTA_INTERNA';
                return (
                  <div key={m.id} className={`flex ${meu ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 border ${ehNota ? 'bg-amber-50 border-amber-200' : meu ? 'bg-[#E8F0FA] border-[#C7D7EC]' : 'bg-white border-[#E2E8F0]'}`}>
                      <div className="flex justify-between gap-4 text-[11px] mb-1">
                        <strong className="text-[#0C1D4D]">{m.autor_nome}{ehNota && <span className="ml-1.5 text-amber-700 uppercase text-[9px] tracking-wider">🔒 nota interna</span>}</strong>
                        <span className="text-[#94A3B8]">{dataHora(m.created_at)}</span>
                      </div>
                      <p className="text-sm text-[#334155] whitespace-pre-wrap break-words leading-relaxed">{m.texto}</p>
                      <ListaAnexos anexos={m.anexos || []} urls={d.urls} />
                    </div>
                  </div>
                );
              })}
              <div ref={fimConversa} />
            </div>

            {/* solicitante: confirmar solução / reabrir */}
            {d.sou_solicitante && c.status === 'RESOLVIDO' && (
              <div className="mt-5 border-2 border-emerald-200 bg-emerald-50 rounded-xl p-4">
                {reabrir === null ? (
                  <>
                    <div className="font-black text-emerald-800 text-sm uppercase tracking-wide">Ficou resolvido?</div>
                    <p className="text-xs text-emerald-700 mt-0.5">Avalie o atendimento para fechar. Se não resolveu, reabra.</p>
                    <div className="flex items-center gap-1 mt-3" role="radiogroup" aria-label="Nota do atendimento">
                      {[1, 2, 3, 4, 5].map(n => (
                        <button key={n} onClick={() => setNota(n)} aria-label={`${n} estrela(s)`}
                          className={`text-3xl leading-none transition-transform hover:scale-110 ${n <= nota ? 'text-amber-400' : 'text-[#CBD5E1]'}`}>★</button>
                      ))}
                    </div>
                    <input value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Comentário (opcional)" maxLength={2000}
                      className="w-full mt-3 border border-emerald-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button disabled={!nota || enviando} onClick={() => executar({ acao: 'FECHAR', avaliacao: nota, comentario }, 'Obrigado! Chamado fechado.')}
                        className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider">Confirmar e fechar</button>
                      <button onClick={() => setReabrir('')} className="bg-white border border-[#CBD5E1] text-[#475569] hover:border-red-300 hover:text-red-600 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider">Não resolveu — reabrir</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-black text-[#0C1D4D] text-sm uppercase tracking-wide">Reabrir chamado</div>
                    <textarea value={reabrir} onChange={e => setReabrir(e.target.value)} rows={3} autoFocus placeholder="O que ainda não ficou resolvido?"
                      className="w-full mt-2 border border-[#CBD5E1] bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]" />
                    <div className="flex gap-2 mt-2">
                      <button disabled={!reabrir.trim() || enviando} onClick={async () => { if (await executar({ acao: 'REABRIR', motivo: reabrir }, 'Chamado reaberto.')) setReabrir(null); }}
                        className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-40 text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider">Reabrir</button>
                      <button onClick={() => setReabrir(null)} className="text-xs font-bold text-[#64748B] px-3">Voltar</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {c.status === 'FECHADO' && c.avaliacao && (
              <div className="mt-5 text-center text-sm text-[#64748B]">
                Avaliação: <span className="text-amber-400 text-lg">{'★'.repeat(c.avaliacao)}</span><span className="text-[#CBD5E1] text-lg">{'★'.repeat(5 - c.avaliacao)}</span>
                {c.avaliacao_comentario && <div className="italic text-xs mt-1">“{c.avaliacao_comentario}”</div>}
              </div>
            )}

            {/* composer */}
            {(!encerrado || atendente) && (
              <div className={`mt-5 rounded-xl border-2 p-3 ${interna ? 'border-amber-300 bg-amber-50/60' : 'border-[#E2E8F0] bg-white'}`}>
                {atendente && (
                  <div className="flex gap-1 mb-2 text-[11px] font-black uppercase tracking-wider">
                    <button disabled={encerrado} onClick={() => setInterna(false)} className={`px-3 py-1.5 rounded-lg disabled:opacity-30 ${!interna ? 'bg-[#0C1D4D] text-white' : 'text-[#64748B] hover:bg-[#F1F5F9]'}`}>💬 Responder</button>
                    <button onClick={() => setInterna(true)} className={`px-3 py-1.5 rounded-lg ${interna ? 'bg-amber-500 text-white' : 'text-[#64748B] hover:bg-[#F1F5F9]'}`}>🔒 Nota interna</button>
                  </div>
                )}
                <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} maxLength={8000}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) responder(); }}
                  placeholder={interna ? 'Só a equipe da área vê esta nota.' : comoAtendente ? `Resposta para ${c.solicitante_nome.split(' ')[0]}…` : 'Escreva uma mensagem para a área…'}
                  className="w-full bg-transparent text-sm focus:outline-none resize-y" />
                <div className="flex flex-wrap items-end justify-between gap-2 mt-1">
                  <SeletorAnexos anexos={anexos} onChange={setAnexos} accessToken={accessToken} onErro={m => toast(m, 'error')} compacto />
                  <button onClick={responder} disabled={enviando || (!texto.trim() && !anexos.length)} title="Ctrl+Enter"
                    className={`${interna ? 'bg-amber-500 hover:bg-amber-600' : 'bg-[#0C1D4D] hover:bg-[#284B8C]'} disabled:opacity-40 text-white px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider`}>
                    {enviando ? 'Enviando…' : interna ? 'Salvar nota' : 'Enviar'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ================= LATERAL ================= */}
          <aside className="order-1 lg:order-2 space-y-4 text-sm">
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-2.5">
              <Info rotulo="Solicitante" valor={c.solicitante_nome} />
              <Info rotulo="Responsável" valor={c.responsavel_nome || <span className="text-[#94A3B8] italic">Na fila</span>} />
              <Info rotulo="Aberto em" valor={dataHora(c.created_at)} />
              <Info rotulo="Prazo" valor={c.prazo_em ? dataHora(c.prazo_em) : '—'} />
              {c.primeira_resposta_em && <Info rotulo="1ª resposta" valor={dataHora(c.primeira_resposta_em)} />}
              {c.resolvido_em && <Info rotulo="Resolvido em" valor={dataHora(c.resolvido_em)} />}
              {c.reaberturas > 0 && <Info rotulo="Reaberturas" valor={c.reaberturas} />}
            </div>

            {atendente && emAberto && (
              <div className="border border-[#E2E8F0] rounded-xl p-4 space-y-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Atendimento</div>

                {c.responsavel_id !== euId && (
                  <button disabled={enviando} onClick={() => executar({ acao: 'ASSUMIR' }, 'Chamado assumido.')}
                    className="w-full bg-[#336699] hover:bg-[#284B8C] text-white py-2 rounded-lg text-xs font-black uppercase tracking-wider">🙋 Assumir</button>
                )}

                <label className="block">
                  <span className="text-[11px] font-bold text-[#64748B]">Responsável</span>
                  <select value={c.responsavel_id || ''} disabled={enviando}
                    onChange={e => executar({ acao: 'ATRIBUIR', responsavelId: e.target.value || null })}
                    className="w-full mt-1 border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-sm bg-white">
                    <option value="">— Na fila —</option>
                    {d.atendentes.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
                    {c.responsavel_id && !d.atendentes.some(a => a.id === c.responsavel_id) && <option value={c.responsavel_id}>{c.responsavel_nome}</option>}
                  </select>
                </label>

                <label className="block">
                  <span className="text-[11px] font-bold text-[#64748B]">Prioridade</span>
                  <select value={c.prioridade} disabled={enviando} onChange={e => executar({ acao: 'PRIORIDADE', prioridade: e.target.value as Prioridade })}
                    className="w-full mt-1 border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-sm bg-white">
                    {PRIORIDADES.map(p => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-2 pt-1">
                  {c.status !== 'AGUARDANDO_SOLICITANTE' ? (
                    <button disabled={enviando} onClick={async () => {
                      const msg = await prompt({ title: 'Aguardar solicitante', message: 'O que você precisa do solicitante? (vai como mensagem pra ele)', placeholder: 'Ex.: Me mande um print do erro' });
                      if (msg !== null) executar({ acao: 'STATUS', status: 'AGUARDANDO_SOLICITANTE', texto: msg }, 'Aguardando o solicitante.');
                    }} className="w-full border border-amber-300 text-amber-700 hover:bg-amber-50 py-2 rounded-lg text-xs font-black uppercase tracking-wider">⏸ Aguardar solicitante</button>
                  ) : (
                    <button disabled={enviando} onClick={() => executar({ acao: 'STATUS', status: 'EM_ATENDIMENTO' })}
                      className="w-full border border-violet-300 text-violet-700 hover:bg-violet-50 py-2 rounded-lg text-xs font-black uppercase tracking-wider">▶ Retomar atendimento</button>
                  )}
                  <button disabled={enviando} onClick={async () => {
                    const msg = await prompt({ title: 'Resolver chamado', message: 'Conte ao solicitante o que foi feito (opcional).', placeholder: 'Ex.: Driver reinstalado, impressora funcionando.' });
                    if (msg !== null) executar({ acao: 'STATUS', status: 'RESOLVIDO', texto: msg }, 'Marcado como resolvido. O solicitante vai confirmar.');
                  }} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-xs font-black uppercase tracking-wider">✅ Resolver</button>
                </div>

                {transferir === null ? (
                  <button onClick={() => setTransferir({ areaId: '', motivo: '' })} className="w-full text-[11px] font-black uppercase tracking-wider text-[#64748B] hover:text-[#0C1D4D] pt-1">↪ Transferir para outra área</button>
                ) : (
                  <div className="border-t border-[#E2E8F0] pt-3 space-y-2">
                    <select value={transferir.areaId} onChange={e => setTransferir({ ...transferir, areaId: e.target.value ? Number(e.target.value) : '' })}
                      className="w-full border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-sm bg-white">
                      <option value="">Área de destino…</option>
                      {areas.filter(a => a.ativo && a.id !== c.area_id).map(a => <option key={a.id} value={a.id}>{a.icone} {a.nome}</option>)}
                    </select>
                    <textarea value={transferir.motivo} onChange={e => setTransferir({ ...transferir, motivo: e.target.value })} rows={2} placeholder="Motivo"
                      className="w-full border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-sm" />
                    <div className="flex gap-2">
                      <button disabled={!transferir.areaId || !transferir.motivo.trim() || enviando}
                        onClick={() => executar({ acao: 'TRANSFERIR', areaId: Number(transferir.areaId), motivo: transferir.motivo }, 'Chamado transferido.')}
                        className="flex-1 bg-[#0C1D4D] disabled:opacity-40 text-white py-1.5 rounded-lg text-[11px] font-black uppercase">Transferir</button>
                      <button onClick={() => setTransferir(null)} className="text-[11px] font-bold text-[#64748B] px-2">Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {d.sou_solicitante && emAberto && (
              <button disabled={enviando} onClick={async () => {
                if (!(await confirm({ title: 'Cancelar chamado', message: 'Cancelar este chamado? A área deixa de tratá-lo.', confirmLabel: 'Cancelar chamado', cancelLabel: 'Voltar', danger: true }))) return;
                const motivo = await prompt({ title: 'Motivo (opcional)', message: 'Por que está cancelando?', placeholder: 'Ex.: Resolvi sozinho' });
                executar({ acao: 'CANCELAR', motivo: motivo || '' }, 'Chamado cancelado.');
              }} className="w-full text-[11px] font-black uppercase tracking-wider text-[#94A3B8] hover:text-red-600">✕ Cancelar meu chamado</button>
            )}

            <p className="text-[10px] text-[#94A3B8] leading-relaxed">Prioridade {rotuloPrioridade(c.prioridade).toLowerCase()} · prazo contado em horas corridas desde a abertura.</p>
          </aside>
        </div>
      )}
    </Modal>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wider">{rotulo}</span>
      <span className="text-[13px] font-bold text-[#0C1D4D] text-right">{valor}</span>
    </div>
  );
}
