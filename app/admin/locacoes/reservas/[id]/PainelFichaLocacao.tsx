"use client";

// Painel "Ficha de Locação" do editor da Ficha de Reserva (2026-11-20): abre a
// FL /A da OS reservada e leva às fichas de locação dela (saídas, devoluções,
// OS assinada). A saída também pode nascer da conferência da Expedição.
// Prorrogação e complemento ficam AQUI, com o Comercial (envolvem custo —
// decisão do usuário 2026-11-20); a tela da operação só mostra.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  abrirFichaLocacaoAction, fichasLocacaoDaReservaAction, prorrogarReservaAction, complementoReservaAction, buscarProdutosComplementoAction,
} from '../../fichas-locacao/actions';
import Modal from '../../../../components/ui/Modal';
import { useToast } from '../../../../components/ui/NotificationProvider';
import { formatarDataBR, formatarMoeda } from '../../../../lib/formatadores';
import type { StatusFicha } from '../actions';

const VISIVEL: StatusFicha[] = ['RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];
const ALTERAVEL: StatusFicha[] = ['RESERVADA', 'EM_LOCACAO'];
const num = (s: string) => { const x = Number(String(s || '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';

export default function PainelFichaLocacao({ fichaId, accessToken, status, alterado, podeEditar, dataFim, onMudou }: {
  fichaId: number; accessToken: string; status: StatusFicha; alterado: boolean; podeEditar: boolean; dataFim: string; onMudou: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [fls, setFls] = useState<any[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [recarregar, setRecarregar] = useState(0);
  const [faltas, setFaltas] = useState<any[]>([]);
  // prorrogação
  const [prorr, setProrr] = useState(false);
  const [prorrFim, setProrrFim] = useState('');
  const [prorrMotivo, setProrrMotivo] = useState('');
  // complemento
  const [compl, setCompl] = useState(false);
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<any[]>([]);
  const [itens, setItens] = useState<{ produto_id: number; nome: string; codigo: string | null; quantidade: string; valor: string }[]>([]);

  useEffect(() => {
    if (!VISIVEL.includes(status)) return;
    let vivo = true;
    fichasLocacaoDaReservaAction(fichaId, accessToken).then(r => { if (vivo) setFls(r.ok ? r.info : []); });
    return () => { vivo = false; };
  }, [fichaId, accessToken, status, recarregar]);

  useEffect(() => {
    if (!compl || busca.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await buscarProdutosComplementoAction(busca, accessToken);
      if (r.ok) setAchados(r.info);
    }, 300);
    return () => clearTimeout(t);
  }, [compl, busca, accessToken]);

  if (!VISIVEL.includes(status)) return null;
  const algumaSaida = (fls || []).some(f => f.data_saida);

  const abrir = async () => {
    setOcupado(true);
    const r = await abrirFichaLocacaoAction(fichaId, accessToken);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha ao abrir a ficha de locação.', 'error'); return; }
    router.push(`/admin/locacoes/fichas-locacao/${r.info.id}`);
  };

  const enviarProrr = async () => {
    setFaltas([]);
    setOcupado(true);
    const x = await prorrogarReservaAction(fichaId, prorrFim, prorrMotivo, accessToken);
    setOcupado(false);
    if (!x.ok) { toast(x.erro || 'Falha.', 'error'); setFaltas(x.info?.faltas || []); return; }
    toast(`Prorrogada por ${x.info.dias} dia(s)${x.info.valorEstimado != null ? ` · diárias a mais estimadas em ${formatarMoeda(x.info.valorEstimado)}` : ''}.`, 'success');
    setProrr(false); setRecarregar(v => v + 1); onMudou();
  };

  const enviarCompl = async () => {
    setFaltas([]);
    const lista = itens.filter(i => num(i.quantidade) > 0).map(i => ({ produto_id: i.produto_id, quantidade: num(i.quantidade), valor_unitario: i.valor.trim() ? num(i.valor) : null }));
    if (!lista.length) { toast('Inclua ao menos um equipamento.', 'error'); return; }
    setOcupado(true);
    const x = await complementoReservaAction(fichaId, lista, accessToken);
    setOcupado(false);
    if (!x.ok) { toast(x.erro || 'Falha.', 'error'); setFaltas(x.info?.faltas || []); return; }
    toast(`${x.info.numero ? `Complemento ${x.info.numero} aberto` : 'Itens incluídos na OS'} (${formatarMoeda(x.info.valor)}) — já reservados.`, 'success');
    setCompl(false); setRecarregar(v => v + 1); onMudou();
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">🚚 Ficha de locação</h2>
          <p className="text-xs text-gray-500 mt-1">Saída e devolução dos equipamentos desta OS, com a OS assinada pelo cliente na tela. A conferência da Expedição registra aqui sozinha.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status === 'RESERVADA' && !(fls || []).length && podeEditar && (
            <button disabled={ocupado || alterado} onClick={abrir} title={alterado ? 'Salve a ficha antes' : ''} className={`${btn} bg-[#0C1D4D] text-white hover:bg-[#284B8C]`}>
              {ocupado ? 'Abrindo…' : 'Abrir ficha de locação'}
            </button>
          )}
          {ALTERAVEL.includes(status) && podeEditar && (
            <>
              <button disabled={ocupado || alterado} title={alterado ? 'Salve a ficha antes' : ''} onClick={() => { setProrr(true); setProrrFim(dataFim); setProrrMotivo(''); setFaltas([]); }}
                className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D] hover:bg-gray-50`}>📅 Prorrogar</button>
              {(status === 'EM_LOCACAO' || algumaSaida) && (
                <button disabled={ocupado || alterado} title={alterado ? 'Salve a ficha antes' : ''} onClick={() => { setCompl(true); setItens([]); setBusca(''); setAchados([]); setFaltas([]); }}
                  className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D] hover:bg-gray-50`}>➕ Complemento</button>
              )}
            </>
          )}
        </div>
      </div>
      {(fls || []).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {fls!.map(f => (
            <button key={f.id} onClick={() => router.push(`/admin/locacoes/fichas-locacao/${f.id}`)}
              className="text-left border border-[#E2E8F0] rounded-xl px-4 py-2.5 hover:border-[#336699] hover:shadow-sm">
              <p className="text-sm font-black text-[#0C1D4D]">{f.numero} <span className={`ml-1 text-[9px] px-2 py-0.5 rounded-full uppercase ${f.status === 'F' ? 'bg-gray-200 text-gray-600' : f.data_saida ? 'bg-violet-100 text-violet-700' : 'bg-cyan-100 text-cyan-700'}`}>{f.status === 'F' ? 'finalizada' : f.data_saida ? 'em locação' : 'aguardando saída'}</span></p>
              <p className="text-[10px] text-gray-500">saída {formatarDataBR(f.data_saida)} · devolução {formatarDataBR(f.data_devolucao)}</p>
            </button>
          ))}
        </div>
      )}
      {fls !== null && !fls.length && status !== 'RESERVADA' && <p className="text-xs text-gray-400 mt-3">Sem ficha de locação.</p>}
      {status === 'RESERVADA' && !algumaSaida && podeEditar && <p className="text-[10px] text-gray-400 mt-3">Antes da saída, para incluir equipamento basta editar a ficha (a reserva é refeita ao salvar). Depois da saída, use Complemento.</p>}

      <Modal open={prorr} onClose={() => setProrr(false)} title="📅 Prorrogar locação"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setProrr(false)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={enviarProrr} className={`${btn} bg-[#0C1D4D] text-white`}>{ocupado ? 'Conferindo…' : 'Prorrogar'}</button></div>}>
        <p className="text-xs text-gray-600">Término atual: <strong>{formatarDataBR(dataFim)}</strong>. O sistema confere se os equipamentos (com o cliente e ainda reservados) estão livres nos dias a mais, estende a reserva e estima o valor das diárias a mais pela tabela.</p>
        <label className="block text-xs font-bold">Novo término<input type="date" value={prorrFim} min={dataFim} onChange={e => setProrrFim(e.target.value)} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-bold">Motivo<input value={prorrMotivo} onChange={e => setProrrMotivo(e.target.value)} placeholder="ex.: cliente estendeu o evento" className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
        <ListaFaltas faltas={faltas} />
      </Modal>

      <Modal open={compl} onClose={() => setCompl(false)} title="➕ Complemento (mais equipamento)" maxWidthClassName="max-w-3xl"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setCompl(false)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado || !itens.length} onClick={enviarCompl} className={`${btn} bg-[#0C1D4D] text-white`}>Reservar e incluir</button></div>}>
        <p className="text-xs text-gray-600">Os itens entram nesta OS pelo preço da tabela (ou o valor informado), são reservados para o mesmo período e, como já houve saída, ganham uma ficha de locação própria (/B, /C…).</p>
        <input value={busca} onChange={e => { setBusca(e.target.value); if (e.target.value.trim().length < 2) setAchados([]); }} placeholder="Buscar equipamento por nome, código ou categoria…" className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" />
        {achados.length > 0 && (
          <div className="border border-[#E2E8F0] rounded-xl max-h-48 overflow-y-auto divide-y divide-[#E2E8F0]">
            {achados.map(p => (
              <button key={p.id} onClick={() => { if (!itens.some(i => i.produto_id === p.id)) setItens(prev => [...prev, { produto_id: p.id, nome: p.nome_item, codigo: p.codigo_formatado, quantidade: '1', valor: '' }]); setBusca(''); setAchados([]); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-[#F8FAFC]"><strong>{p.nome_item}</strong> <span className="text-gray-400">{p.codigo_formatado} · {p.categoria_nome}</span></button>
            ))}
          </div>
        )}
        {itens.map((it, k) => (
          <div key={it.produto_id} className="flex items-center gap-2 text-xs">
            <span className="flex-1 font-bold">{it.nome} <span className="text-gray-400 font-normal">{it.codigo}</span></span>
            <input value={it.quantidade} onChange={e => setItens(prev => prev.map((x, j) => j === k ? { ...x, quantidade: e.target.value } : x))} className="w-20 border rounded-lg px-2 py-1.5 text-right" placeholder="Qtd" />
            <input value={it.valor} onChange={e => setItens(prev => prev.map((x, j) => j === k ? { ...x, valor: e.target.value } : x))} className="w-32 border rounded-lg px-2 py-1.5 text-right" placeholder="R$ unit. (tabela)" />
            <button onClick={() => setItens(prev => prev.filter((_, j) => j !== k))} className="text-red-500 font-black px-2">✕</button>
          </div>
        ))}
        <ListaFaltas faltas={faltas} />
      </Modal>
    </div>
  );
}

function ListaFaltas({ faltas }: { faltas: any[] }) {
  if (!faltas.length) return null;
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 space-y-1">
      <p className="font-black uppercase">Falta equipamento:</p>
      {faltas.map((l: any) => <p key={l.produto_id}>• {l.nome}: precisa {l.demanda}, livre {l.disponivel} ({String(l.periodo.inicio).split('-').reverse().join('/')} a {String(l.periodo.fim).split('-').reverse().join('/')})</p>)}
    </div>
  );
}
