"use client";

// Cadastro de produto/equipamento (2026-11-23). Novo e edição (produto do
// sistema, ou qualquer um depois da virada); produto do P2S abre só leitura.
// Regras em app/lib/cadastros/produtos.ts. Saldos, patrimônios e kits ficam
// em Estoque → Equipamentos de Locação; preço em Locações → Tabelas de Preço.
import { useEffect, useRef, useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/NotificationProvider';
import { carregarProdutoAction, salvarProdutoAction, sugerirCodigoProdutoAction } from './actions-cadastro';

export interface CatalogoCategorias { categorias: { categoria: string; subcategorias: string[] }[]; marcas: string[] }

const UNIDADES = ['UN', 'PÇ', 'CJT', 'KIT', 'M', 'M²', 'KG', 'CX'];
const ORIGENS: [string, string][] = [
  ['0', '0 — Nacional'], ['1', '1 — Estrangeira, importação direta'], ['2', '2 — Estrangeira, adquirida no mercado interno'],
  ['3', '3 — Nacional, mais de 40% importado'], ['4', '4 — Nacional, processos produtivos básicos'], ['5', '5 — Nacional, até 40% importado'],
  ['6', '6 — Estrangeira, importação direta, sem similar'], ['7', '7 — Estrangeira, mercado interno, sem similar'], ['8', '8 — Nacional, mais de 70% importado'],
];
const NOVA = '__nova__';

interface Form {
  nome_item: string; categoria_nome: string; sub_categoria_nome: string; codigo_formatado: string; unidade: string;
  marca_nome: string; modelo: string; descricao_detalhada: string;
  habilitado_para_locacao: boolean; habilitado_para_venda: boolean; flag_em_desuso: boolean;
  custo_reposicao: string; valor_indenizacao: string; classificacao_fiscal: string; origem_nfe: string; peso_unitario: string;
  controle_locacao: 'QUANTIDADE' | 'INDIVIDUAL'; dias_preparo: string; dias_retorno: string; observacoes: string;
}
const VAZIO: Form = {
  nome_item: '', categoria_nome: '', sub_categoria_nome: '', codigo_formatado: '', unidade: 'UN', marca_nome: '', modelo: '', descricao_detalhada: '',
  habilitado_para_locacao: true, habilitado_para_venda: false, flag_em_desuso: false,
  custo_reposicao: '', valor_indenizacao: '', classificacao_fiscal: '', origem_nfe: '0', peso_unitario: '',
  controle_locacao: 'QUANTIDADE', dias_preparo: '0', dias_retorno: '0', observacoes: '',
};
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));
const paraNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\./g, '').replace(',', '.')));

interface Props {
  produtoId: number | null; // null = novo
  accessToken: string;
  catalogo: CatalogoCategorias;
  onClose: () => void;
  onSalvo: (id: number) => void;
}

export default function FormProduto({ produtoId, accessToken, catalogo, onClose, onSalvo }: Props) {
  const toast = useToast();
  const [f, setF] = useState<Form>(VAZIO);
  // montado só quando abre (key = produto): para "novo" o estado já nasce certo
  const [carregando, setCarregando] = useState(!!produtoId);
  const [salvando, setSalvando] = useState(false);
  const [editavel, setEditavel] = useState(true);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [origem, setOrigem] = useState('SISTEMA');
  const [novaCat, setNovaCat] = useState(false);
  const [novaSub, setNovaSub] = useState(false);
  const [codigoAuto, setCodigoAuto] = useState(!produtoId);
  const fecharRef = useRef(onClose);
  useEffect(() => { fecharRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!produtoId) return;
    let vivo = true;
    carregarProdutoAction(produtoId, accessToken).then(r => {
      if (!vivo) return;
      setCarregando(false);
      if (!r.ok) { toast(r.erro || 'Falha ao abrir o produto.', 'error'); fecharRef.current(); return; }
      const p = r.info.produto;
      setF({
        nome_item: s(p.nome_item), categoria_nome: s(p.categoria_nome).trim(), sub_categoria_nome: s(p.sub_categoria_nome).trim(), codigo_formatado: s(p.codigo_formatado),
        unidade: s(p.unidade) || 'UN', marca_nome: s(p.marca_nome), modelo: s(p.modelo), descricao_detalhada: s(p.descricao_detalhada),
        habilitado_para_locacao: !!p.habilitado_para_locacao, habilitado_para_venda: !!p.habilitado_para_venda, flag_em_desuso: !!p.flag_em_desuso,
        custo_reposicao: num(p.custo_reposicao), valor_indenizacao: num(p.valor_indenizacao), classificacao_fiscal: s(p.classificacao_fiscal),
        origem_nfe: s(p.origem_nfe ?? '0') || '0', peso_unitario: num(p.peso_unitario),
        controle_locacao: p.controle_locacao === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'QUANTIDADE', dias_preparo: s(p.dias_preparo ?? 0), dias_retorno: s(p.dias_retorno ?? 0), observacoes: s(p.observacoes),
      });
      setEditavel(!!r.info.editavel); setMotivo(r.info.motivo || null); setOrigem(p.origem || 'P2S');
    });
    return () => { vivo = false; };
  }, [produtoId, accessToken, toast]);

  const muda = (parcial: Partial<Form>) => setF(a => ({ ...a, ...parcial }));
  const ro = !editavel;
  const subs = catalogo.categorias.find(c => c.categoria === f.categoria_nome)?.subcategorias || [];

  // código sugerido ao escolher categoria + subcategoria (produto novo)
  const sugerir = async (cat: string, sub: string) => {
    if (!codigoAuto || !cat || !sub) return;
    const r = await sugerirCodigoProdutoAction(cat, sub, accessToken);
    if (r.ok && r.info.codigo_formatado) muda({ codigo_formatado: r.info.codigo_formatado });
  };

  const salvar = async () => {
    setSalvando(true);
    const r = await salvarProdutoAction({
      id: produtoId, nome_item: f.nome_item, categoria_nome: f.categoria_nome, sub_categoria_nome: f.sub_categoria_nome,
      codigo_formatado: f.codigo_formatado || null, unidade: f.unidade, marca_nome: f.marca_nome || null, modelo: f.modelo || null, descricao_detalhada: f.descricao_detalhada || null,
      habilitado_para_locacao: f.habilitado_para_locacao, habilitado_para_venda: f.habilitado_para_venda, flag_em_desuso: f.flag_em_desuso,
      custo_reposicao: paraNum(f.custo_reposicao), valor_indenizacao: paraNum(f.valor_indenizacao), classificacao_fiscal: f.classificacao_fiscal || null,
      origem_nfe: Number(f.origem_nfe), peso_unitario: paraNum(f.peso_unitario),
      controle_locacao: f.controle_locacao, dias_preparo: Number(f.dias_preparo) || 0, dias_retorno: Number(f.dias_retorno) || 0, observacoes: f.observacoes || null,
    }, accessToken);
    setSalvando(false);
    if (!r.ok) { toast(r.erro || 'Falha ao salvar.', 'error'); return; }
    toast(produtoId ? 'Produto salvo.' : `Produto cadastrado (${r.info.codigo_formatado}). Lance o saldo em Equipamentos de Locação.`, 'success');
    onSalvo(r.info.id);
  };

  const inp = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm disabled:bg-[#F8FAFC] disabled:text-gray-600';
  const lab = 'block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1';
  const sec = 'text-xs font-black uppercase tracking-wider text-[#0C1D4D] mb-2';
  const titulo = produtoId ? `${f.nome_item || 'Produto'}${f.codigo_formatado ? ` · ${f.codigo_formatado}` : ''}` : 'Novo produto / equipamento';

  return (
    <Modal open onClose={onClose} title={titulo} maxWidthClassName="max-w-4xl"
      footer={<div className="flex flex-col md:flex-row justify-between gap-2 md:items-center">
        <span className="text-[11px] text-gray-500">{produtoId ? `Origem: ${origem === 'SISTEMA' ? 'cadastro do sistema' : 'P2S'}` : 'Cadastro feito no sistema (origem SISTEMA).'}</span>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-black uppercase border border-[#E2E8F0]">{ro ? 'Fechar' : 'Cancelar'}</button>
          {!ro && <button onClick={salvar} disabled={salvando || carregando} className="px-4 py-2 rounded-lg text-xs font-black uppercase bg-[#0C1D4D] text-white disabled:opacity-50">{salvando ? 'Salvando…' : 'Salvar'}</button>}
        </div>
      </div>}>
      {carregando ? <p className="text-sm text-gray-500">Carregando…</p> : (
        <div className="space-y-6">
          {motivo && <p className="text-xs rounded-xl border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3">{motivo}</p>}

          <section>
            <h3 className={sec}>Identificação</h3>
            <div className="grid md:grid-cols-6 gap-3">
              <div className="md:col-span-6"><label className={lab}>Nome do produto *</label><input value={f.nome_item} disabled={ro} onChange={e => muda({ nome_item: e.target.value })} placeholder="Ex.: MONITOR TV 55&quot; 4K LG" className={inp} /></div>
              <div className="md:col-span-3">
                <label className={lab}>Categoria *</label>
                {novaCat ? (
                  <div className="flex gap-2"><input value={f.categoria_nome} onChange={e => muda({ categoria_nome: e.target.value })} placeholder="NN - NOME (ex.: 60 - DRONE)" className={inp} /><button type="button" onClick={() => { setNovaCat(false); muda({ categoria_nome: '', sub_categoria_nome: '' }); }} className="text-[10px] font-black uppercase text-gray-500">lista</button></div>
                ) : (
                  <select value={f.categoria_nome} disabled={ro} onChange={e => {
                    if (e.target.value === NOVA) { setNovaCat(true); setNovaSub(true); muda({ categoria_nome: '', sub_categoria_nome: '' }); return; }
                    muda({ categoria_nome: e.target.value, sub_categoria_nome: '' });
                  }} className={inp}>
                    <option value="">—</option>
                    {f.categoria_nome && !catalogo.categorias.some(c => c.categoria === f.categoria_nome) && <option value={f.categoria_nome}>{f.categoria_nome}</option>}
                    {catalogo.categorias.map(c => <option key={c.categoria} value={c.categoria}>{c.categoria}</option>)}
                    {!ro && <option value={NOVA}>+ Nova categoria…</option>}
                  </select>
                )}
              </div>
              <div className="md:col-span-3">
                <label className={lab}>Subcategoria *</label>
                {novaSub || novaCat ? (
                  <div className="flex gap-2"><input value={f.sub_categoria_nome} onChange={e => muda({ sub_categoria_nome: e.target.value })} onBlur={() => sugerir(f.categoria_nome, f.sub_categoria_nome)} placeholder="NN - NOME (ex.: 01 - DRONE DE FILMAGEM)" className={inp} />{!novaCat && <button type="button" onClick={() => { setNovaSub(false); muda({ sub_categoria_nome: '' }); }} className="text-[10px] font-black uppercase text-gray-500">lista</button>}</div>
                ) : (
                  <select value={f.sub_categoria_nome} disabled={ro || !f.categoria_nome} onChange={e => {
                    if (e.target.value === NOVA) { setNovaSub(true); muda({ sub_categoria_nome: '' }); return; }
                    muda({ sub_categoria_nome: e.target.value }); sugerir(f.categoria_nome, e.target.value);
                  }} className={inp}>
                    <option value="">—</option>
                    {f.sub_categoria_nome && !subs.includes(f.sub_categoria_nome) && <option value={f.sub_categoria_nome}>{f.sub_categoria_nome}</option>}
                    {subs.map(x => <option key={x} value={x}>{x}</option>)}
                    {!ro && f.categoria_nome && <option value={NOVA}>+ Nova subcategoria…</option>}
                  </select>
                )}
              </div>
              <div className="md:col-span-2">
                <label className={lab}>Código</label>
                <input value={f.codigo_formatado} disabled={ro} onChange={e => { setCodigoAuto(false); muda({ codigo_formatado: e.target.value }); }} placeholder="gerado pela subcategoria" className={`${inp} font-mono`} />
                {!ro && <p className="text-[10px] text-gray-400 mt-1">Padrão categoria.subcategoria.sequência; vazio = gera o próximo.</p>}
              </div>
              <div>
                <label className={lab}>Unidade *</label>
                <select value={f.unidade} disabled={ro} onChange={e => muda({ unidade: e.target.value })} className={inp}>
                  {!UNIDADES.includes(f.unidade) && <option value={f.unidade}>{f.unidade}</option>}
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={lab}>Marca</label>
                <input value={f.marca_nome} disabled={ro} onChange={e => muda({ marca_nome: e.target.value })} list="marcas-catalogo" className={inp} />
                <datalist id="marcas-catalogo">{catalogo.marcas.map(m => <option key={m} value={m} />)}</datalist>
              </div>
              <div><label className={lab}>Modelo</label><input value={f.modelo} disabled={ro} onChange={e => muda({ modelo: e.target.value })} className={inp} /></div>
              <div className="md:col-span-6 flex flex-wrap gap-5">
                {([['habilitado_para_locacao', 'Para locação'], ['habilitado_para_venda', 'Para venda'], ['flag_em_desuso', 'Em desuso (some das listas)']] as const).map(([k, r]) => (
                  <label key={k} className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={f[k]} disabled={ro} onChange={e => muda({ [k]: e.target.checked } as Partial<Form>)} /> {r}</label>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h3 className={sec}>Locação</h3>
            <div className="grid md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className={lab}>Controle</label>
                <select value={f.controle_locacao} disabled={ro} onChange={e => muda({ controle_locacao: e.target.value as Form['controle_locacao'] })} className={inp}>
                  <option value="QUANTIDADE">Por quantidade (saldo)</option>
                  <option value="INDIVIDUAL">Por patrimônio (cada peça com nº e QR)</option>
                </select>
              </div>
              <div><label className={lab}>Dias de preparo</label><input value={f.dias_preparo} disabled={ro} inputMode="numeric" onChange={e => muda({ dias_preparo: e.target.value.replace(/\D/g, '') })} className={inp} /></div>
              <div><label className={lab}>Dias de retorno</label><input value={f.dias_retorno} disabled={ro} inputMode="numeric" onChange={e => muda({ dias_retorno: e.target.value.replace(/\D/g, '') })} className={inp} /></div>
              <div><label className={lab}>Custo de reposição (R$)</label><input value={f.custo_reposicao} disabled={ro} inputMode="decimal" onChange={e => muda({ custo_reposicao: e.target.value })} placeholder="0,00" className={inp} /></div>
              <div><label className={lab}>Valor de indenização (R$)</label><input value={f.valor_indenizacao} disabled={ro} inputMode="decimal" onChange={e => muda({ valor_indenizacao: e.target.value })} placeholder="0,00" className={inp} /></div>
              <p className="md:col-span-2 text-[11px] text-gray-500 self-end">Preparo e retorno prendem a agenda antes e depois da locação. A indenização é cobrada no extravio. Saldos, patrimônios e kit ficam em Estoque → Equipamentos de Locação; o preço, em Locações → Tabelas de Preço.</p>
            </div>
          </section>

          <section>
            <h3 className={sec}>Nota fiscal</h3>
            <div className="grid md:grid-cols-4 gap-3">
              <div><label className={lab}>NCM</label><input value={f.classificacao_fiscal} disabled={ro} inputMode="numeric" onChange={e => muda({ classificacao_fiscal: e.target.value.replace(/[^\d.]/g, '') })} placeholder="8 dígitos" className={inp} /></div>
              <div className="md:col-span-2">
                <label className={lab}>Origem da mercadoria</label>
                <select value={f.origem_nfe} disabled={ro} onChange={e => muda({ origem_nfe: e.target.value })} className={inp}>{ORIGENS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select>
              </div>
              <div><label className={lab}>Peso unitário (kg)</label><input value={f.peso_unitario} disabled={ro} inputMode="decimal" onChange={e => muda({ peso_unitario: e.target.value })} className={inp} /></div>
            </div>
          </section>

          <section className="grid md:grid-cols-2 gap-3">
            <div><label className={lab}>Descrição detalhada</label><textarea value={f.descricao_detalhada} disabled={ro} onChange={e => muda({ descricao_detalhada: e.target.value })} rows={3} className={inp} /></div>
            <div><label className={lab}>Observações</label><textarea value={f.observacoes} disabled={ro} onChange={e => muda({ observacoes: e.target.value })} rows={3} className={inp} /></div>
          </section>
        </div>
      )}
    </Modal>
  );
}
