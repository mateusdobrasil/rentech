"use client";

// Formulário da Sublocação (2026-11-20): nasce da falta na OS ("Sublocar o
// que falta"), avulso na tela de Sublocação, ou edição. Pedido ao parceiro
// com itens (produto equivalente do nosso catálogo), custo, período,
// frete e vencimento do pagamento.
import { useState, useEffect } from 'react';
import Modal from '../../../components/ui/Modal';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';
import { formatarMoeda } from '../../../lib/formatadores';
import {
  criarSublocacaoAction, editarSublocacaoAction, buscarFornecedoresAction, buscarProdutosSublocacaoAction, buscarOsSublocacaoAction,
} from './actions';

export interface ItemForm { produto_id: number; nome: string; codigo?: string | null; quantidade: string; valor_unitario: string }
export interface InicialSublocacao {
  empresa_id?: number | null;
  ficha_reserva_id?: number | null;
  osRotulo?: string | null;
  fornecedor?: { id: number; nome: string } | null;
  data_retirada?: string;
  data_devolucao?: string;
  valor_frete?: number | null;
  vencimento?: string | null;
  contato?: string | null;
  condicoes?: string | null;
  observacoes?: string | null;
  itens: ItemForm[];
}

const num = (s: string) => { const x = Number(String(s || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const numSimples = (s: string) => { const x = Number(String(s || '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';
const inp = 'mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm';

export default function FormSublocacao({ aberto, onClose, accessToken, inicial, empresas, sublocacaoId, onSalvo, titulo }: {
  aberto: boolean; onClose: () => void; accessToken: string; inicial: InicialSublocacao;
  empresas?: { id: number; nome: string }[]; sublocacaoId?: number | null; onSalvo: (id: number, aviso: string | null) => void; titulo?: string;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const editando = !!sublocacaoId;
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [os, setOs] = useState<{ id: number; nome: string } | null>(null);
  const [osBusca, setOsBusca] = useState('');
  const [osAchadas, setOsAchadas] = useState<any[]>([]);
  const [forn, setForn] = useState<{ id: number; nome: string } | null>(null);
  const [fornBusca, setFornBusca] = useState('');
  const [fornAchados, setFornAchados] = useState<any[]>([]);
  const [itens, setItens] = useState<ItemForm[]>([]);
  const [prodBusca, setProdBusca] = useState('');
  const [prodAchados, setProdAchados] = useState<any[]>([]);
  const [retirada, setRetirada] = useState('');
  const [devolucao, setDevolucao] = useState('');
  const [frete, setFrete] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [contato, setContato] = useState('');
  const [condicoes, setCondicoes] = useState('');
  const [obs, setObs] = useState('');
  const [confirmado, setConfirmado] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setEmpresaId(inicial.empresa_id ?? empresas?.[0]?.id ?? null);
    setOs(inicial.ficha_reserva_id ? { id: inicial.ficha_reserva_id, nome: inicial.osRotulo || `OS #${inicial.ficha_reserva_id}` } : null);
    setForn(inicial.fornecedor || null); setFornBusca(''); setFornAchados([]);
    setItens(inicial.itens); setProdBusca(''); setProdAchados([]);
    setRetirada(inicial.data_retirada || ''); setDevolucao(inicial.data_devolucao || '');
    setFrete(inicial.valor_frete ? String(inicial.valor_frete).replace('.', ',') : ''); setVencimento(inicial.vencimento || '');
    setContato(inicial.contato || ''); setCondicoes(inicial.condicoes || ''); setObs(inicial.observacoes || ''); setConfirmado(true);
    setOsBusca(''); setOsAchadas([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  useEffect(() => {
    if (!aberto || fornBusca.trim().length < 2) return;
    const t = setTimeout(async () => { const r = await buscarFornecedoresAction(fornBusca, accessToken); if (r.ok) setFornAchados(r.info); }, 300);
    return () => clearTimeout(t);
  }, [aberto, fornBusca, accessToken]);
  useEffect(() => {
    if (!aberto || prodBusca.trim().length < 2) return;
    const t = setTimeout(async () => { const r = await buscarProdutosSublocacaoAction(prodBusca, accessToken); if (r.ok) setProdAchados(r.info); }, 300);
    return () => clearTimeout(t);
  }, [aberto, prodBusca, accessToken]);
  useEffect(() => {
    if (!aberto || osBusca.trim().length < 2) return;
    const t = setTimeout(async () => { const r = await buscarOsSublocacaoAction(osBusca, accessToken); if (r.ok) setOsAchadas(r.info); }, 300);
    return () => clearTimeout(t);
  }, [aberto, osBusca, accessToken]);

  const total = itens.reduce((a, i) => a + numSimples(i.quantidade) * num(i.valor_unitario), 0) + num(frete);

  const salvar = async () => {
    if (!forn) { toast('Escolha o parceiro.', 'error'); return; }
    if (!empresaId) { toast('Escolha a empresa.', 'error'); return; }
    const lista = itens.filter(i => numSimples(i.quantidade) > 0).map(i => ({ produto_id: i.produto_id, quantidade: numSimples(i.quantidade), valor_unitario: num(i.valor_unitario) }));
    if (!lista.length) { toast('Inclua ao menos um equipamento com quantidade.', 'error'); return; }
    if (lista.some(i => i.valor_unitario <= 0) && !(await confirmar('Há item com custo zero. Salvar mesmo assim?'))) return;
    const base = {
      fornecedor_id: forn.id, data_retirada: retirada, data_devolucao: devolucao, valor_frete: num(frete), vencimento: vencimento || null,
      contato, condicoes, observacoes: obs, itens: lista,
    };
    setOcupado(true);
    const r = editando
      ? await editarSublocacaoAction(sublocacaoId!, base, accessToken)
      : await criarSublocacaoAction({ ...base, empresa_id: empresaId, ficha_reserva_id: os?.id || null, confirmar: confirmado }, accessToken);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha ao salvar.', 'error'); return; }
    onSalvo(editando ? sublocacaoId! : r.info.id, r.info?.aviso || null);
  };

  return (
    <Modal open={aberto} onClose={onClose} title={titulo || (editando ? '✏️ Editar sublocação' : '🤝 Nova sublocação')} maxWidthClassName="max-w-4xl"
      footer={<div className="flex flex-col md:flex-row justify-between gap-3 md:items-center">
        <span className="text-sm font-black text-[#0C1D4D]">Custo: {formatarMoeda(total)}</span>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button>
          <button disabled={ocupado} onClick={salvar} className={`${btn} bg-[#0C1D4D] text-white`}>{ocupado ? 'Salvando…' : editando ? 'Salvar' : confirmado ? 'Salvar confirmada' : 'Salvar como solicitada'}</button>
        </div>
      </div>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="text-xs font-bold">Parceiro (de quem sublocamos)
          {forn ? (
            <div className="mt-1 flex items-center justify-between border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm"><span className="font-bold">{forn.nome}</span><button onClick={() => setForn(null)} className="text-red-500 text-xs">trocar</button></div>
          ) : (
            <>
              <input value={fornBusca} onChange={e => { setFornBusca(e.target.value); if (e.target.value.trim().length < 2) setFornAchados([]); }} placeholder="Nome ou CNPJ…" className={inp} />
              {fornAchados.length > 0 && (
                <div className="border border-[#E2E8F0] rounded-xl max-h-40 overflow-y-auto divide-y divide-[#E2E8F0] mt-1 font-normal">
                  {fornAchados.map(p => <button key={p.id} onClick={() => { setForn({ id: p.id, nome: p.nome }); setFornAchados([]); }} className="w-full text-left px-3 py-2 text-xs hover:bg-[#F8FAFC]"><strong>{p.nome}</strong> <span className="text-gray-400">{p.detalhe}</span></button>)}
                </div>
              )}
            </>
          )}
        </div>
        <div className="text-xs font-bold">OS do cliente
          {os ? (
            <div className="mt-1 flex items-center justify-between border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm"><span className="font-bold">{os.nome}</span>{!inicial.ficha_reserva_id && !editando && <button onClick={() => setOs(null)} className="text-red-500 text-xs">trocar</button>}</div>
          ) : editando ? <p className="mt-1 text-gray-400 font-normal">sem OS</p> : (
            <>
              <input value={osBusca} onChange={e => { setOsBusca(e.target.value); if (e.target.value.trim().length < 2) setOsAchadas([]); }} placeholder="FR-… ou cliente (opcional)" className={inp} />
              {osAchadas.length > 0 && (
                <div className="border border-[#E2E8F0] rounded-xl max-h-40 overflow-y-auto divide-y divide-[#E2E8F0] mt-1 font-normal">
                  {osAchadas.map(o => <button key={o.id} onClick={() => { setOs({ id: o.id, nome: o.nome }); setEmpresaId(o.empresa_id); if (!retirada) setRetirada(o.inicio); if (!devolucao) setDevolucao(o.fim); setOsAchadas([]); }} className="w-full text-left px-3 py-2 text-xs hover:bg-[#F8FAFC]"><strong>{o.nome}</strong> <span className="text-gray-400">{o.detalhe}</span></button>)}
                </div>
              )}
            </>
          )}
        </div>
        {!editando && !os && (empresas?.length || 0) > 1 && (
          <label className="text-xs font-bold">Empresa
            <select value={empresaId ?? ''} onChange={e => setEmpresaId(Number(e.target.value))} className={inp}>{empresas!.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-bold">Retirada no parceiro<input type="date" value={retirada} onChange={e => setRetirada(e.target.value)} className={inp} /></label>
          <label className="text-xs font-bold">Devolução ao parceiro<input type="date" value={devolucao} min={retirada} onChange={e => setDevolucao(e.target.value)} className={inp} /></label>
        </div>
      </div>

      <div>
        <p className="text-xs font-black uppercase tracking-wider text-[#0C1D4D] mb-2">Equipamentos</p>
        <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0]">
          {!itens.length && <p className="p-3 text-xs text-gray-400">Busque abaixo o equipamento equivalente do nosso catálogo.</p>}
          {itens.map((it, k) => (
            <div key={`${it.produto_id}-${k}`} className="p-3 flex flex-col md:flex-row md:items-center gap-2 text-xs">
              <span className="flex-1 font-bold">{it.nome} {it.codigo && <span className="text-gray-400 font-normal">{it.codigo}</span>}</span>
              <label className="flex items-center gap-1">Qtd<input value={it.quantidade} onChange={e => setItens(prev => prev.map((x, j) => j === k ? { ...x, quantidade: e.target.value } : x))} className="w-20 border rounded-lg px-2 py-1.5 text-right" /></label>
              <label className="flex items-center gap-1">Custo unit. (período)<input value={it.valor_unitario} onChange={e => setItens(prev => prev.map((x, j) => j === k ? { ...x, valor_unitario: e.target.value } : x))} placeholder="0,00" className="w-28 border rounded-lg px-2 py-1.5 text-right" /></label>
              <span className="w-28 text-right font-bold">{formatarMoeda(numSimples(it.quantidade) * num(it.valor_unitario))}</span>
              <button onClick={() => setItens(prev => prev.filter((_, j) => j !== k))} className="text-red-500 font-black px-2">✕</button>
            </div>
          ))}
        </div>
        <input value={prodBusca} onChange={e => { setProdBusca(e.target.value); if (e.target.value.trim().length < 2) setProdAchados([]); }} placeholder="+ Incluir equipamento (nome, código ou categoria)…" className={`${inp} mt-2`} />
        {prodAchados.length > 0 && (
          <div className="border border-[#E2E8F0] rounded-xl max-h-40 overflow-y-auto divide-y divide-[#E2E8F0] mt-1">
            {prodAchados.map(p => <button key={p.id} onClick={() => { setItens(prev => [...prev, { produto_id: p.id, nome: p.nome_item, codigo: p.codigo_formatado, quantidade: '1', valor_unitario: '' }]); setProdBusca(''); setProdAchados([]); }} className="w-full text-left px-3 py-2 text-xs hover:bg-[#F8FAFC]"><strong>{p.nome_item}</strong> <span className="text-gray-400">{p.codigo_formatado} · {p.categoria_nome}</span></button>)}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <label className="text-xs font-bold">Frete (R$)<input value={frete} onChange={e => setFrete(e.target.value)} placeholder="0,00" className={inp} /></label>
        <label className="text-xs font-bold">Vencimento do pagamento<input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} className={inp} /></label>
        <label className="text-xs font-bold">Contato no parceiro<input value={contato} onChange={e => setContato(e.target.value)} placeholder="nome / telefone" className={inp} /></label>
      </div>
      <label className="block text-xs font-bold">Condições combinadas<input value={condicoes} onChange={e => setCondicoes(e.target.value)} placeholder="ex.: retirada no galpão deles, pagamento 15 dias após a devolução" className={inp} /></label>
      <label className="block text-xs font-bold">Observações<input value={obs} onChange={e => setObs(e.target.value)} className={inp} /></label>
      {!editando && (
        <label className={`flex items-start gap-2 text-xs rounded-xl border p-3 ${confirmado ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'border-[#E2E8F0] text-gray-600'}`}>
          <input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} className="mt-0.5" />
          <span><strong>O parceiro já confirmou.</strong> Confirmada, a quantidade sublocada deixa de pesar no nosso estoque{os ? ` para a ${os.nome.split(' — ')[0]}` : ''} e a reserva passa. Sem confirmar, fica como “solicitada”.</span>
        </label>
      )}
    </Modal>
  );
}
