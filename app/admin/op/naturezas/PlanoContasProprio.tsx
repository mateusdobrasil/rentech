"use client";

// Centros e sub-centros criados no sistema (2026-11-23) — depois da virada o
// plano de contas não vem mais do P2S. Regras em app/lib/financeiro/planoContas.ts.
import { useState } from 'react';
import { useToast } from '../../../components/ui/NotificationProvider';
import { listarCentrosFinanceirosP2sAction, criarCentroFinanceiroAction, criarSubcentroFinanceiroAction } from '../actions-naturezas';

export default function PlanoContasProprio({ accessToken, onMudou }: { accessToken: string; onMudou: () => void }) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [centros, setCentros] = useState<{ oid: string; nome: string }[]>([]);
  const [c, setC] = useState({ codigo: '', nome: '', tipo: 'P' as 'P' | 'R' });
  const [s, setS] = useState({ centroOid: '', codigo: '', nome: '' });
  const [salvando, setSalvando] = useState<'' | 'c' | 's'>('');

  const carregarCentros = async () => {
    const r = await listarCentrosFinanceirosP2sAction(accessToken);
    if (r.ok) setCentros(r.info.centros); else toast(r.erro || 'Falha ao carregar os centros.', 'error');
  };
  const abrir = async () => { const novo = !aberto; setAberto(novo); if (novo && !centros.length) await carregarCentros(); };

  const criarCentro = async () => {
    setSalvando('c');
    const r = await criarCentroFinanceiroAction(c, accessToken);
    setSalvando('');
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(`Centro ${r.info.nome_p2s} criado.`, 'success');
    setC({ codigo: '', nome: '', tipo: 'P' }); await carregarCentros(); setS(x => ({ ...x, centroOid: r.info.p2s_oid }));
  };
  const criarSub = async () => {
    setSalvando('s');
    const r = await criarSubcentroFinanceiroAction(s, accessToken);
    setSalvando('');
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(`Sub-centro ${r.info.nome_p2s} criado — natureza "${r.info.natureza}".`, 'success');
    setS(x => ({ ...x, codigo: '', nome: '' })); onMudou();
  };

  const inp = 'p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] text-[#0A2A4A]';
  const btn = 'text-xs font-black text-white bg-[#0C1D4D] hover:bg-[#284B8C] px-4 py-2.5 rounded-lg uppercase disabled:opacity-50 shrink-0';
  return (
    <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-4 mb-4">
      <button onClick={abrir} className="text-xs font-black uppercase tracking-wider text-[#0C1D4D]">{aberto ? '▾' : '▸'} Centros e sub-centros (plano de contas)</button>
      {aberto && (
        <div className="mt-3 space-y-4">
          <p className="text-[11px] text-gray-500">Depois da virada o plano de contas não vem mais do P2S: crie aqui o centro ou sub-centro que faltar. Cada sub-centro novo vira uma natureza da OP já classificada.</p>
          <div>
            <p className="text-[10px] font-black uppercase text-gray-500 mb-1">Novo centro</p>
            <div className="flex flex-wrap gap-2">
              <input value={c.codigo} onChange={e => setC({ ...c, codigo: e.target.value.replace(/\D/g, '') })} placeholder="Nº (ex.: 12)" className={`${inp} w-28`} />
              <input value={c.nome} onChange={e => setC({ ...c, nome: e.target.value })} placeholder="Nome (ex.: MARKETING)" className={`${inp} flex-1 min-w-[180px] uppercase`} />
              <select value={c.tipo} onChange={e => setC({ ...c, tipo: e.target.value as 'P' | 'R' })} className={inp}><option value="P">Custo</option><option value="R">Receita</option></select>
              <button onClick={criarCentro} disabled={salvando !== '' || !c.codigo || !c.nome.trim()} className={btn}>{salvando === 'c' ? 'Criando…' : '+ Centro'}</button>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-gray-500 mb-1">Novo sub-centro</p>
            <div className="flex flex-wrap gap-2">
              <select value={s.centroOid} onChange={e => setS({ ...s, centroOid: e.target.value })} className={`${inp} min-w-[200px]`}>
                <option value="">Centro…</option>
                {centros.map(x => <option key={x.oid} value={x.oid}>{x.nome}</option>)}
              </select>
              <input value={s.codigo} onChange={e => setS({ ...s, codigo: e.target.value.replace(/[^\d.]/g, '') })} placeholder="Código (ex.: 6.4)" className={`${inp} w-32`} />
              <input value={s.nome} onChange={e => setS({ ...s, nome: e.target.value })} placeholder="Nome (ex.: TELEVISORES)" className={`${inp} flex-1 min-w-[180px] uppercase`} />
              <button onClick={criarSub} disabled={salvando !== '' || !s.centroOid || !s.codigo || !s.nome.trim()} className={btn}>{salvando === 's' ? 'Criando…' : '+ Sub-centro'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
