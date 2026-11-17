"use client";

// Suporte → Áreas e atendentes (2026-11-17): cadastro das áreas que recebem
// chamados (TI, Financeiro...), quem atende cada uma, categorias e prazos por
// prioridade. Indicadores dos últimos 90 dias por área.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import Modal from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/NotificationProvider';
import { PRIORIDADES, SLA_PADRAO, ROTA_SUPORTE, type Prioridade } from '../../../lib/suporte/constantes';
import { gestaoAreasAction, salvarAreaAction, type AreaForm } from '../actions';
import { horasLegiveis } from '../tipos';

interface Usuario { id: string; nome: string; email: string; permissao: string | null; tem_ficha: boolean; tem_celular: boolean; tem_email: boolean }
interface AreaGestao {
  id: number; nome: string; descricao: string | null; icone: string; cor: string; categorias: string[];
  sla_horas: Record<Prioridade, number>; ordem: number; ativo: boolean;
  membros: { perfil_id: string; receber_avisos: boolean }[];
  indicadores: null | { total: number; abertos: number; atrasados: number; horasPrimeiraResposta: number | null; horasSolucao: number | null; nota: number | null; avaliacoes: number };
}

const VAZIA: AreaForm = { id: null, nome: '', descricao: '', icone: '🛟', cor: '#336699', categorias: [], sla_horas: { ...SLA_PADRAO }, ordem: 0, ativo: true, membros: [] };

export default function AreasSuportePage() {
  const router = useRouter();
  const toast = useToast();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();
  const [carregando, setCarregando] = useState(true);
  const [areas, setAreas] = useState<AreaGestao[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [form, setForm] = useState<AreaForm | null>(null);
  const [novaCategoria, setNovaCategoria] = useState('');
  const [buscaUsuario, setBuscaUsuario] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    const r = await gestaoAreasAction(accessToken);
    setCarregando(false);
    if (!r.ok) { toast(r.erro || 'Erro ao carregar.', 'error'); return; }
    setAreas(r.info.areas); setUsuarios(r.info.usuarios);
  };

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado]);

  const usuarioPor = useMemo(() => new Map(usuarios.map(u => [u.id, u])), [usuarios]);

  const editar = (a: AreaGestao | null) => {
    setNovaCategoria(''); setBuscaUsuario('');
    setForm(a ? {
      id: a.id, nome: a.nome, descricao: a.descricao || '', icone: a.icone, cor: a.cor, categorias: [...a.categorias],
      sla_horas: { ...SLA_PADRAO, ...a.sla_horas }, ordem: a.ordem, ativo: a.ativo, membros: a.membros.map(m => ({ ...m })),
    } : { ...VAZIA, ordem: (areas.at(-1)?.ordem || 0) + 1, sla_horas: { ...SLA_PADRAO } });
  };

  const salvar = async () => {
    if (!form) return;
    setSalvando(true);
    const r = await salvarAreaAction(form, accessToken);
    setSalvando(false);
    if (!r.ok) { toast(r.erro || 'Erro ao salvar.', 'error'); return; }
    toast('Área salva.', 'success');
    setForm(null);
    carregar();
  };

  const addCategoria = () => {
    if (!form) return;
    const c = novaCategoria.trim();
    if (c && !form.categorias.includes(c)) setForm({ ...form, categorias: [...form.categorias, c] });
    setNovaCategoria('');
  };

  const alternarMembro = (id: string) => {
    if (!form) return;
    const tem = form.membros.some(m => m.perfil_id === id);
    setForm({ ...form, membros: tem ? form.membros.filter(m => m.perfil_id !== id) : [...form.membros, { perfil_id: id, receber_avisos: true }] });
  };

  if (authLoading || (carregando && !acessoNegado && !erro)) {
    return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  }
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para gerenciar as áreas de suporte.</p>
          <button onClick={() => router.push(ROTA_SUPORTE)} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">Voltar aos chamados</button>
        </div>
      </div>
    );
  }

  const termo = buscaUsuario.trim().toLowerCase();
  const usuariosFiltrados = usuarios
    .filter(u => !termo || `${u.nome} ${u.email} ${u.permissao || ''}`.toLowerCase().includes(termo))
    .sort((a, b) => Number(form?.membros.some(m => m.perfil_id === b.id)) - Number(form?.membros.some(m => m.perfil_id === a.id)) || a.nome.localeCompare(b.nome));

  return (
    <div className="min-h-screen bg-[#F0F4F8] text-[#0C1D4D] font-sans pt-12 pb-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">⚙️ Áreas e atendentes</h1>
            <p className="text-[#64748B] font-medium">Quem recebe os chamados de cada área, as categorias e o prazo de solução por prioridade. Indicadores dos últimos 90 dias.</p>
          </div>
          <button onClick={() => editar(null)} className="bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-5 py-3 rounded-lg font-black uppercase text-xs tracking-wider shadow-sm">+ Nova área</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {areas.map(a => {
            const ind = a.indicadores;
            const semAtendente = a.membros.length === 0;
            return (
              <button key={a.id} onClick={() => editar(a)} className={`text-left bg-white rounded-2xl border-2 p-5 shadow-sm hover:shadow-lg transition-all ${a.ativo ? 'border-transparent' : 'border-dashed border-[#CBD5E1] opacity-60'}`}
                style={{ borderLeft: `6px solid ${a.cor}` }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-3xl">{a.icone}</span>
                    <div className="min-w-0">
                      <div className="font-black text-[#0C1D4D] uppercase tracking-wide">{a.nome}{!a.ativo && <span className="ml-2 text-[10px] text-[#94A3B8]">(inativa)</span>}</div>
                      {a.descricao && <div className="text-xs text-[#64748B] truncate">{a.descricao}</div>}
                    </div>
                  </div>
                  <span className="text-[10px] font-black uppercase text-[#336699] shrink-0">Editar ✎</span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {semAtendente
                    ? <span className="text-[11px] font-black text-red-600 bg-red-50 px-2 py-1 rounded-lg">⚠ Sem atendentes — chamados ficam sem aviso</span>
                    : a.membros.map(m => <span key={m.perfil_id} className="text-[11px] font-bold bg-[#F1F5F9] text-[#475569] px-2 py-0.5 rounded-full">{usuarioPor.get(m.perfil_id)?.nome?.split(' ').slice(0, 2).join(' ') || '—'}{!m.receber_avisos && ' 🔕'}</span>)}
                </div>

                <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
                  <Mini rotulo="Abertos" valor={ind?.abertos ?? 0} />
                  <Mini rotulo="Atrasados" valor={ind?.atrasados ?? 0} alerta={!!ind?.atrasados} />
                  <Mini rotulo="1ª resposta" valor={horasLegiveis(ind?.horasPrimeiraResposta ?? null)} />
                  <Mini rotulo="Solução" valor={horasLegiveis(ind?.horasSolucao ?? null)} />
                  <Mini rotulo={`Nota (${ind?.avaliacoes ?? 0})`} valor={ind?.nota ? `★ ${ind.nota.toFixed(1).replace('.', ',')}` : '—'} />
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <button onClick={() => router.push(ROTA_SUPORTE)} className="text-[#64748B] font-bold text-sm hover:text-[#0C1D4D] transition-colors">⬅ Voltar aos chamados</button>
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `Editar área · ${form.nome}` : 'Nova área'} maxWidthClassName="max-w-3xl"
        footer={
          <div className="flex flex-col-reverse sm:flex-row justify-between gap-3 items-center">
            <label className="inline-flex items-center gap-2 text-xs font-bold text-[#475569]">
              <input type="checkbox" checked={form?.ativo ?? true} onChange={e => form && setForm({ ...form, ativo: e.target.checked })} />
              Área ativa (recebe chamados novos)
            </label>
            <button onClick={salvar} disabled={salvando || !form?.nome.trim()} className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-40 text-white px-6 py-3 rounded-lg font-black uppercase text-xs tracking-wider">
              {salvando ? 'Salvando…' : 'Salvar área'}
            </button>
          </div>
        }>
        {form && (
          <div className="space-y-5">
            <div className="grid grid-cols-[64px_1fr_64px] gap-3 items-end">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Ícone</span>
                <input value={form.icone} onChange={e => setForm({ ...form, icone: e.target.value })} maxLength={8} className="w-full mt-1 border border-[#CBD5E1] rounded-lg px-2 py-2 text-2xl text-center" />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Nome *</span>
                <input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} maxLength={60} placeholder="Ex.: TI" className="w-full mt-1 border border-[#CBD5E1] rounded-lg px-3 py-2.5 text-sm" />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Cor</span>
                <input type="color" value={form.cor} onChange={e => setForm({ ...form, cor: e.target.value })} className="w-full mt-1 h-[42px] border border-[#CBD5E1] rounded-lg cursor-pointer bg-white" />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px] gap-3">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Descrição (aparece ao abrir chamado)</span>
                <input value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} maxLength={400} className="w-full mt-1 border border-[#CBD5E1] rounded-lg px-3 py-2.5 text-sm" />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Ordem</span>
                <input type="number" value={form.ordem} onChange={e => setForm({ ...form, ordem: Number(e.target.value) })} className="w-full mt-1 border border-[#CBD5E1] rounded-lg px-3 py-2.5 text-sm" />
              </label>
            </div>

            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Categorias</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {form.categorias.map(c => (
                  <span key={c} className="inline-flex items-center gap-1 bg-[#F1F5F9] text-[#334155] text-xs font-bold pl-3 pr-1.5 py-1 rounded-full">
                    {c}<button onClick={() => setForm({ ...form, categorias: form.categorias.filter(x => x !== c) })} className="text-[#94A3B8] hover:text-red-500 px-1" aria-label={`Remover ${c}`}>×</button>
                  </span>
                ))}
                <span className="inline-flex">
                  <input value={novaCategoria} onChange={e => setNovaCategoria(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategoria(); } }}
                    placeholder="Nova categoria" className="border border-[#CBD5E1] rounded-l-full px-3 py-1 text-xs w-36" />
                  <button onClick={addCategoria} className="border border-l-0 border-[#CBD5E1] rounded-r-full px-2.5 text-xs font-black text-[#336699]">+</button>
                </span>
              </div>
            </div>

            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Prazo de solução (horas corridas)</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
                {PRIORIDADES.map(p => (
                  <label key={p.valor} className={`rounded-lg border-2 px-3 py-2 ${p.solido}`}>
                    <span className="text-[11px] font-black uppercase">{p.rotulo}</span>
                    <input type="number" min={0.5} step={0.5} value={form.sla_horas[p.valor]}
                      onChange={e => setForm({ ...form, sla_horas: { ...form.sla_horas, [p.valor]: Number(e.target.value) } })}
                      className="w-full mt-1 bg-white border border-white rounded px-2 py-1 text-sm font-bold text-[#0C1D4D]" />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-end justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Atendentes ({form.membros.length})</span>
                <input value={buscaUsuario} onChange={e => setBuscaUsuario(e.target.value)} placeholder="Buscar usuário…" className="border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs w-48" />
              </div>
              <p className="text-[11px] text-[#94A3B8] mt-1">WhatsApp usa o celular da Ficha do Funcionário ligada ao usuário (Parâmetros → Permissões → Colaboradores). 🔕 = atende, mas não recebe aviso de chamado novo.</p>
              <div className="mt-2 max-h-72 overflow-y-auto border border-[#E2E8F0] rounded-xl divide-y divide-[#F1F5F9]">
                {usuariosFiltrados.map(u => {
                  const m = form.membros.find(x => x.perfil_id === u.id);
                  return (
                    <div key={u.id} className={`flex items-center gap-3 px-3 py-2 ${m ? 'bg-[#F8FAFC]' : ''}`}>
                      <input type="checkbox" checked={!!m} onChange={() => alternarMembro(u.id)} className="shrink-0" aria-label={`Atendente: ${u.nome}`} />
                      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => alternarMembro(u.id)}>
                        <div className="text-sm font-bold text-[#0C1D4D] truncate">{u.nome}</div>
                        <div className="text-[11px] text-[#94A3B8] truncate">{u.permissao || '—'} · {u.email}</div>
                      </div>
                      <div className="flex gap-1 text-[10px] shrink-0" title="Canais de aviso disponíveis">
                        <span className={u.tem_celular ? 'text-emerald-600' : 'text-[#CBD5E1]'} title={u.tem_celular ? 'Tem celular na ficha' : 'Sem ficha/celular — não recebe WhatsApp'}>📱</span>
                        <span className={u.tem_email ? 'text-emerald-600' : 'text-[#CBD5E1]'}>✉️</span>
                      </div>
                      {m && (
                        <button onClick={() => setForm({ ...form, membros: form.membros.map(x => x.perfil_id === u.id ? { ...x, receber_avisos: !x.receber_avisos } : x) })}
                          className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg shrink-0 ${m.receber_avisos ? 'bg-[#336699] text-white' : 'bg-[#F1F5F9] text-[#94A3B8]'}`}>
                          {m.receber_avisos ? '🔔 Avisos' : '🔕 Sem aviso'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Mini({ rotulo, valor, alerta }: { rotulo: string; valor: React.ReactNode; alerta?: boolean }) {
  return (
    <div className={`rounded-lg py-2 ${alerta ? 'bg-red-50 text-red-600' : 'bg-[#F8FAFC] text-[#0C1D4D]'}`}>
      <div className="text-sm font-black">{valor}</div>
      <div className="text-[9px] font-black uppercase tracking-wider text-[#94A3B8] mt-0.5">{rotulo}</div>
    </div>
  );
}
