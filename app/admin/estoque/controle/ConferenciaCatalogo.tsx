"use client";

// Aba "🔗 Ligar a Produtos" do Controle de Estoque (2026-11-26). Cada
// equipamento do catálogo técnico é ligado a um produto do catálogo de
// locação, vira produto novo, ou fica marcado como "não é item de locação".
// A "qtd antiga" é a contagem do controle antigo, só como referência para o
// primeiro inventário — a contagem que vale é a de Equipamentos de Locação.
import { useEffect, useMemo, useState } from 'react';
import { useConfirm, useToast } from '../../../components/ui/NotificationProvider';
import { conferenciaCatalogoAction, ligarEquipamentosAction, criarProdutoDoEquipamentoAction, type DadosConferencia, type LinhaConferencia, type ProdutoLeve } from './actions-catalogo';

type Filtro = 'PENDENTES' | 'LIGADOS' | 'FORA' | 'TODOS';
const UNIDADES = ['UN', 'PÇ', 'CJT', 'KIT', 'M', 'CX'];
const pct = (n: number) => `${Math.round(n * 100)}%`;
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const rotuloProduto = (p: ProdutoLeve) => `${p.codigo || p.id} — ${p.nome}`;

/** Sugestão forte o bastante para ligar em lote: ≥ 80% e sem empate com a 2ª. */
const forte = (l: LinhaConferencia) => !!l.sugestoes[0] && l.sugestoes[0].nota >= 0.8 && (!l.sugestoes[1] || l.sugestoes[0].nota - l.sugestoes[1].nota >= 0.15);

export default function ConferenciaCatalogo({ accessToken }: { accessToken: string }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [dados, setDados] = useState<DadosConferencia | null>(null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>('PENDENTES');
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    conferenciaCatalogoAction(accessToken).then(r => {
      if (!vivo) return;
      if (!r.ok || !r.info) { setErro(r.erro || 'Erro ao carregar a conferência.'); return; }
      setErro(''); setDados(r.info);
    });
    return () => { vivo = false; };
  }, [accessToken, versao]);

  const produtoPorId = useMemo(() => new Map((dados?.produtos || []).map(p => [p.id, p])), [dados]);
  const contagem = useMemo(() => {
    const l = dados?.linhas || [];
    return { total: l.length, ligados: l.filter(x => x.produtoId).length, fora: l.filter(x => x.foraDoCatalogo).length, pendentes: l.filter(x => !x.produtoId && !x.foraDoCatalogo).length, fortes: l.filter(x => !x.produtoId && !x.foraDoCatalogo && forte(x)).length };
  }, [dados]);
  const visiveis = useMemo(() => {
    const q = normalizar(busca.trim());
    return (dados?.linhas || []).filter(l =>
      (filtro === 'TODOS' || (filtro === 'LIGADOS' && l.produtoId) || (filtro === 'FORA' && l.foraDoCatalogo) || (filtro === 'PENDENTES' && !l.produtoId && !l.foraDoCatalogo))
      && (!q || normalizar(`${l.nome} ${l.categoriaNome} ${l.produtoId ? produtoPorId.get(l.produtoId)?.nome || '' : ''}`).includes(q)));
  }, [dados, filtro, busca, produtoPorId]);

  const gravar = async (itens: { equipamentoId: string; produtoId: number | null; fora: boolean }[], msg: string) => {
    setOcupado(true);
    const r = await ligarEquipamentosAction(itens, accessToken);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Erro ao gravar.', 'error'); return false; }
    toast(msg, 'success');
    setVersao(v => v + 1);
    return true;
  };

  const ligarFortes = async () => {
    const lista = (dados?.linhas || []).filter(l => !l.produtoId && !l.foraDoCatalogo && forte(l));
    if (!lista.length) return;
    const exemplos = lista.slice(0, 8).map(l => `• ${l.nome} → ${produtoPorId.get(l.sugestoes[0].produtoId)?.nome}`).join('\n');
    if (!(await confirmar({ title: `Ligar ${lista.length} sugestões fortes`, message: `Liga cada equipamento à sugestão de 80% ou mais, quando não há empate com a 2ª:\n\n${exemplos}${lista.length > 8 ? `\n… e mais ${lista.length - 8}` : ''}\n\nDá para desfazer uma a uma depois.`, confirmLabel: 'Ligar todas' }))) return;
    await gravar(lista.map(l => ({ equipamentoId: l.id, produtoId: l.sugestoes[0].produtoId, fora: false })), `${lista.length} equipamento(s) ligado(s).`);
  };

  if (erro) return <div className="mx-4 md:mx-8 my-6 bg-red-50 border border-red-200 text-red-700 text-xs font-bold px-4 py-3 rounded-lg">{erro}</div>;
  if (!dados) return <p className="text-center py-12 text-[#94A3B8] font-bold text-sm">Carregando a conferência...</p>;

  return (
    <div className="px-4 md:px-8 py-6 space-y-4">
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 space-y-3">
        <p className="text-xs text-[#334155]">
          <b>Uma lista só para o inventário.</b> Ligue cada equipamento desta tela (ficha técnica, simulador, acessórios) ao produto do catálogo de locação.
          A contagem que vale para reservar é a de Estoque → Equipamentos de Locação; a &quot;qtd antiga&quot; aqui é só referência.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {([['PENDENTES', `Pendentes (${contagem.pendentes})`], ['LIGADOS', `Ligados (${contagem.ligados})`], ['FORA', `Não é de locação (${contagem.fora})`], ['TODOS', `Todos (${contagem.total})`]] as [Filtro, string][]).map(([f, r]) => (
            <button key={f} onClick={() => setFiltro(f)} className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-full border ${filtro === f ? 'bg-[#0C1D4D] text-white border-[#0C1D4D]' : 'bg-white text-[#64748B] border-[#E2E8F0] hover:border-[#336699]'}`}>{r}</button>
          ))}
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar..." className="ml-auto w-full sm:w-56 p-2 border border-[#CBD5E1] rounded-lg text-xs font-semibold outline-none focus:border-[#336699]" />
          {contagem.fortes > 0 && (
            <button onClick={ligarFortes} disabled={ocupado} className="text-[10px] font-black uppercase px-3 py-2 rounded-lg bg-[#16A34A] hover:bg-[#15803D] text-white disabled:opacity-40">✔ Ligar sugestões fortes ({contagem.fortes})</button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#E2E8F0] divide-y divide-[#F1F5F9]">
        {visiveis.length === 0 && <p className="text-center py-10 text-[#94A3B8] font-bold text-xs uppercase">Nada aqui.</p>}
        {visiveis.map(l => (
          <Linha key={l.id} l={l} dados={dados} produtoPorId={produtoPorId} accessToken={accessToken} ocupado={ocupado}
            gravar={gravar} criado={() => setVersao(v => v + 1)} />
        ))}
      </div>
    </div>
  );
}

function Linha({ l, dados, produtoPorId, accessToken, ocupado, gravar, criado }: {
  l: LinhaConferencia; dados: DadosConferencia; produtoPorId: Map<number, ProdutoLeve>; accessToken: string; ocupado: boolean;
  gravar: (itens: { equipamentoId: string; produtoId: number | null; fora: boolean }[], msg: string) => Promise<boolean>;
  criado: () => void;
}) {
  const toast = useToast();
  const [modo, setModo] = useState<'' | 'outro' | 'criar'>('');
  const [outro, setOutro] = useState('');
  const [form, setForm] = useState(() => {
    const cat = l.categoriaSugerida || '';
    const subs = dados.arvore.find(c => c.categoria === cat)?.subcategorias || [];
    const subSug = l.sugestoes[0] ? produtoPorId.get(l.sugestoes[0].produtoId)?.subcategoria || '' : '';
    return { nome: l.nome.toUpperCase().replace(/\s+/g, ' ').trim(), categoria: cat, subcategoria: subs.includes(subSug) ? subSug : subs[0] || '', unidade: 'UN', controle: 'QUANTIDADE' as 'QUANTIDADE' | 'INDIVIDUAL' };
  });
  const [criando, setCriando] = useState(false);
  const ligado = l.produtoId ? produtoPorId.get(l.produtoId) : null;
  const subs = dados.arvore.find(c => c.categoria === form.categoria)?.subcategorias || [];

  const ligarOutro = async () => {
    const p = dados.produtos.find(x => rotuloProduto(x) === outro);
    if (!p) { toast('Escolha um produto da lista.', 'error'); return; }
    if (await gravar([{ equipamentoId: l.id, produtoId: p.id, fora: false }], `Ligado a ${p.nome}.`)) setModo('');
  };

  const criar = async () => {
    setCriando(true);
    const r = await criarProdutoDoEquipamentoAction({ equipamentoId: l.id, ...form }, accessToken);
    setCriando(false);
    if (!r.ok) { toast(r.erro || 'Erro ao criar o produto.', 'error'); return; }
    toast(`Produto ${r.info?.codigo} criado e ligado.`, 'success');
    setModo('');
    criado();
  };

  const campo = 'p-2 border border-[#CBD5E1] rounded-lg text-xs font-semibold bg-[#F8FAFC] outline-none focus:border-[#336699]';

  return (
    <div className={`p-4 space-y-2 ${l.ativo ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-black text-[#0C1D4D]">{l.nome}</p>
          <p className="text-[10px] font-bold uppercase text-[#94A3B8]">{l.categoriaNome}{l.qtdAntiga ? ` · qtd antiga ${l.qtdAntiga}` : ''}{l.ativo ? '' : ' · inativo'}</p>
        </div>
        {ligado ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">✅ {rotuloProduto(ligado)}</span>
            <button onClick={() => gravar([{ equipamentoId: l.id, produtoId: null, fora: false }], 'Ligação desfeita.')} disabled={ocupado} className="text-[10px] font-black uppercase text-[#64748B] hover:text-red-600">Desfazer</button>
          </div>
        ) : l.foraDoCatalogo ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-gray-600 bg-gray-100 rounded-full px-3 py-1">🚫 Não é item de locação</span>
            <button onClick={() => gravar([{ equipamentoId: l.id, produtoId: null, fora: false }], 'Voltou para pendentes.')} disabled={ocupado} className="text-[10px] font-black uppercase text-[#64748B] hover:text-red-600">Desfazer</button>
          </div>
        ) : null}
      </div>

      {!ligado && !l.foraDoCatalogo && (
        <>
          <div className="flex flex-wrap gap-2">
            {l.sugestoes.map(s => {
              const p = produtoPorId.get(s.produtoId);
              if (!p) return null;
              return (
                <button key={s.produtoId} onClick={() => gravar([{ equipamentoId: l.id, produtoId: p.id, fora: false }], `Ligado a ${p.nome}.`)} disabled={ocupado}
                  className={`text-left text-[11px] font-bold rounded-lg border px-3 py-1.5 hover:border-[#336699] disabled:opacity-40 ${s.nota >= 0.8 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : s.nota >= 0.5 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]'}`}>
                  🔗 {rotuloProduto(p)} <span className="font-black">· {pct(s.nota)}</span>
                </button>
              );
            })}
            {!l.sugestoes.length && <span className="text-[11px] text-[#94A3B8] font-bold">Sem sugestão parecida.</span>}
          </div>
          <div className="flex flex-wrap gap-3 text-[10px] font-black uppercase">
            <button onClick={() => setModo(modo === 'outro' ? '' : 'outro')} className="text-[#336699]">Outro produto…</button>
            {dados.podeCriar && <button onClick={() => setModo(modo === 'criar' ? '' : 'criar')} className="text-[#16A34A]">＋ Criar produto</button>}
            <button onClick={() => gravar([{ equipamentoId: l.id, produtoId: null, fora: true }], 'Marcado como não é item de locação.')} disabled={ocupado} className="text-[#64748B]">Não é item de locação</button>
          </div>

          {modo === 'outro' && (
            <div className="flex flex-col sm:flex-row gap-2">
              <input list={`produtos-${l.id}`} value={outro} onChange={e => setOutro(e.target.value)} placeholder="Digite o código ou o nome do produto" className={`${campo} flex-1`} />
              <datalist id={`produtos-${l.id}`}>{dados.produtos.map(p => <option key={p.id} value={rotuloProduto(p)} />)}</datalist>
              <button onClick={ligarOutro} disabled={ocupado || !outro} className="text-[10px] font-black uppercase px-4 py-2 rounded-lg bg-[#0C1D4D] text-white disabled:opacity-40">Ligar</button>
            </div>
          )}

          {modo === 'criar' && (
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3">
              <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value.toUpperCase() }))} placeholder="Nome do produto" className={`${campo} sm:col-span-6`} />
              <select value={form.categoria} onChange={e => { const c = e.target.value; setForm(f => ({ ...f, categoria: c, subcategoria: dados.arvore.find(x => x.categoria === c)?.subcategorias[0] || '' })); }} className={`${campo} sm:col-span-2`}>
                <option value="">Categoria…</option>
                {dados.arvore.map(c => <option key={c.categoria} value={c.categoria}>{c.categoria}</option>)}
              </select>
              <select value={form.subcategoria} onChange={e => setForm(f => ({ ...f, subcategoria: e.target.value }))} className={`${campo} sm:col-span-2`}>
                <option value="">Subcategoria…</option>
                {subs.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={form.unidade} onChange={e => setForm(f => ({ ...f, unidade: e.target.value }))} className={campo}>
                {UNIDADES.map(u => <option key={u}>{u}</option>)}
              </select>
              <select value={form.controle} onChange={e => setForm(f => ({ ...f, controle: e.target.value as 'QUANTIDADE' | 'INDIVIDUAL' }))} className={campo}>
                <option value="QUANTIDADE">Por quantidade</option>
                <option value="INDIVIDUAL">Por patrimônio</option>
              </select>
              <p className="sm:col-span-4 text-[10px] text-[#64748B] self-center">O código sai pela subcategoria. Subcategoria nova se cria em Estoque → Produtos. O saldo entra no inventário.</p>
              <button onClick={criar} disabled={criando || !form.nome.trim() || !form.categoria || !form.subcategoria} className="sm:col-span-2 text-[10px] font-black uppercase px-4 py-2 rounded-lg bg-[#16A34A] text-white disabled:opacity-40">{criando ? 'Criando...' : 'Criar e ligar'}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
