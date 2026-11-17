"use client";

import { useState } from 'react';
import Modal from '../../components/ui/Modal';
import { useToast } from '../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../lib/coresEmpresa';
import { PRIORIDADES, type Anexo, type Prioridade } from '../../lib/suporte/constantes';
import { abrirChamadoAction } from './actions';
import { SeletorAnexos } from './Anexos';
import type { AreaSuporte } from './tipos';

const horas = (h: number) => (h < 24 ? `${h}h` : `${Math.round(h / 24 * 10) / 10} dia${h >= 48 ? 's' : ''}`);

export default function NovoChamado({ aberto, onFechar, onCriado, areas, empresas, accessToken }: {
  aberto: boolean; onFechar: () => void; onCriado: (id: number) => void;
  areas: AreaSuporte[]; empresas: { id: number; nome: string }[]; accessToken: string;
}) {
  const toast = useToast();
  const [area, setArea] = useState<AreaSuporte | null>(null);
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [prioridade, setPrioridade] = useState<Prioridade>('MEDIA');
  const [empresaId, setEmpresaId] = useState<number | null>(empresas.length === 1 ? empresas[0].id : null);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [salvando, setSalvando] = useState(false);

  const limpar = () => { setArea(null); setTitulo(''); setDescricao(''); setCategoria(null); setPrioridade('MEDIA'); setAnexos([]); };
  const fechar = () => { limpar(); onFechar(); };

  const enviar = async () => {
    if (!area) return;
    setSalvando(true);
    const r = await abrirChamadoAction({ titulo, descricao, area_id: area.id, categoria, prioridade, empresa_id: empresaId, anexos }, accessToken);
    setSalvando(false);
    if (!r.ok) { toast(r.erro || 'Não foi possível abrir o chamado.', 'error'); return; }
    toast(r.info.semAtendentes
      ? `Chamado #${r.info.id} aberto. Atenção: ${area.nome} ainda não tem atendentes cadastrados.`
      : `Chamado #${r.info.id} aberto — ${area.nome} foi avisado.`, r.info.semAtendentes ? 'info' : 'success');
    limpar();
    onCriado(r.info.id);
  };

  const ativas = areas.filter(a => a.ativo);

  return (
    <Modal open={aberto} onClose={fechar} title={area ? `Novo chamado · ${area.icone} ${area.nome}` : 'Novo chamado · escolha a área'} maxWidthClassName="max-w-3xl"
      footer={area ? (
        <div className="flex flex-col-reverse sm:flex-row justify-between gap-3">
          <button onClick={() => setArea(null)} className="text-xs font-bold text-[#64748B] hover:text-[#0C1D4D] uppercase tracking-wider">⬅ Trocar área</button>
          <button onClick={enviar} disabled={salvando || titulo.trim().length < 4 || descricao.trim().length < 5}
            className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-40 text-white px-6 py-3 rounded-lg font-black uppercase text-xs tracking-wider transition-colors">
            {salvando ? 'Abrindo…' : 'Abrir chamado'}
          </button>
        </div>
      ) : undefined}>
      {!area ? (
        <div>
          <p className="text-sm text-[#64748B] mb-4">Para qual área é o seu pedido?</p>
          {ativas.length === 0 ? (
            <div className="text-center text-sm text-[#94A3B8] border-2 border-dashed border-[#E2E8F0] rounded-xl p-8">Nenhuma área de atendimento ativa. Peça ao administrador para cadastrar em Suporte → Áreas.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ativas.map(a => (
                <button key={a.id} onClick={() => { setArea(a); setCategoria(null); }}
                  className="text-left p-4 rounded-xl border-2 border-[#E2E8F0] hover:shadow-md transition-all group bg-white"
                  style={{ borderLeft: `6px solid ${a.cor}` }}>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl group-hover:scale-110 transition-transform">{a.icone}</span>
                    <div className="min-w-0">
                      <div className="font-black text-[#0C1D4D] uppercase tracking-wide text-sm">{a.nome}</div>
                      {a.descricao && <div className="text-xs text-[#64748B] leading-snug mt-0.5">{a.descricao}</div>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748B] mb-1.5">Assunto *</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={160} autoFocus
              placeholder="Resumo em uma linha (ex.: Impressora do comercial não imprime)"
              className="w-full border border-[#CBD5E1] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]" />
          </div>

          {area.categorias.length > 0 && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748B] mb-1.5">Categoria</label>
              <div className="flex flex-wrap gap-2">
                {area.categorias.map(c => (
                  <button key={c} type="button" onClick={() => setCategoria(categoria === c ? null : c)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${categoria === c ? 'text-white border-transparent' : 'bg-white text-[#475569] border-[#CBD5E1] hover:border-[#336699]'}`}
                    style={categoria === c ? { background: area.cor } : undefined}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748B] mb-1.5">Prioridade</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRIORIDADES.map(p => {
                const sel = prioridade === p.valor;
                return (
                  <button key={p.valor} type="button" onClick={() => setPrioridade(p.valor)} aria-pressed={sel}
                    className={`p-2.5 rounded-lg border-2 text-left transition-all ${sel ? `${p.solido} shadow-md` : 'bg-white text-[#0C1D4D] border-[#CBD5E1] hover:border-[#64748B]'}`}>
                    <div className="flex items-center gap-1.5 text-xs font-black uppercase">
                      <span className={`w-2.5 h-2.5 rounded-full ${sel ? 'bg-white' : p.ponto}`} />{p.rotulo}{sel && <span className="ml-auto">✓</span>}
                    </div>
                    <div className={`text-[11px] font-bold mt-0.5 ${sel ? 'text-white' : 'text-[#475569]'}`}>Prazo: {horas(area.sla_horas?.[p.valor] ?? 24)}</div>
                  </button>
                );
              })}
            </div>
            {prioridade === 'URGENTE' && <p className="text-[11px] text-red-600 font-bold mt-1.5">Use Urgente só quando o trabalho está parado.</p>}
          </div>

          {empresas.length > 1 && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748B] mb-1.5">Empresa</label>
              <div className="flex flex-wrap gap-2">
                {empresas.map(e => (
                  <button key={e.id} type="button" onClick={() => setEmpresaId(empresaId === e.id ? null : e.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-black uppercase border-2 transition-all ${corSeloEmpresa(e.id)} ${empresaId === e.id ? 'border-current' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                    {e.nome}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748B] mb-1.5">Descrição *</label>
            <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={6} maxLength={8000}
              placeholder="O que aconteceu, desde quando, onde (máquina, sala, OS, cliente...) e o que você já tentou."
              className="w-full border border-[#CBD5E1] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699] resize-y" />
          </div>

          <SeletorAnexos anexos={anexos} onChange={setAnexos} accessToken={accessToken} onErro={m => toast(m, 'error')} />
        </div>
      )}
    </Modal>
  );
}
