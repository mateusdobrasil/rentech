"use client";

// Formulário de avaria (2026-11-17) — usado na tela Avarias e Manutenção e
// na conferência de retorno da Expedição (peça lida pelo QR já vem escolhida).
// Fotos: upload direto do navegador para o bucket privado por URL assinada.
import { useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import Modal from '../../../components/ui/Modal';
import CampoBusca, { type OpcaoBusca } from '../../../components/ui/CampoBusca';
import { formatarMoeda } from '../../../lib/formatadores';
import {
  registrarAvariaAction, buscarItemEstoqueAction, buscarFornecedoresAction, buscarFichasAction, urlUploadFotoAction,
} from './actions';

export interface ItemAvaria { patrimonio_id: number | null; produto_id: number; nome: string; controle: string; valor_indenizacao: number | null }

const GRAVIDADES = [
  { v: 'LEVE', r: 'Leve', d: 'Riscos, sujeira, detalhe estético' },
  { v: 'MEDIA', r: 'Média', d: 'Funciona com defeito / precisa reparo' },
  { v: 'GRAVE', r: 'Grave', d: 'Não funciona, conserto caro' },
  { v: 'PERDA_TOTAL', r: 'Perda total', d: 'Sem conserto / extraviado — dá baixa' },
] as const;

export function lerValorBR(s: string): number | null {
  const t = (s || '').replace(/\s|R\$/g, '');
  if (!t) return null;
  const v = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(v) ? v : NaN;
}

export async function enviarFotos(arquivos: File[], accessToken: string): Promise<string[]> {
  const caminhos: string[] = [];
  for (const f of arquivos) {
    const r = await urlUploadFotoAction(f.name, accessToken);
    if (!r.ok) throw new Error(r.erro || 'Falha ao preparar o envio da foto.');
    const { error } = await supabase.storage.from('locacao-avarias').uploadToSignedUrl(r.info.caminho, r.info.token, f, { contentType: f.type || 'image/jpeg' });
    if (error) throw new Error(`Falha ao enviar foto: ${error.message}`);
    caminhos.push(r.info.caminho);
  }
  return caminhos;
}

export default function FormAvaria({ empresaId, accessToken, itemInicial, checklistId, onSalvo, onFechar }: {
  empresaId: number; accessToken: string; itemInicial?: ItemAvaria | null; checklistId?: string | null;
  onSalvo: (r: { avariaId: number; manutencaoId: number | null }) => void; onFechar: () => void;
}) {
  const [item, setItem] = useState<ItemAvaria | null>(itemInicial || null);
  const [quantidade, setQuantidade] = useState('1');
  const [gravidade, setGravidade] = useState<'LEVE' | 'MEDIA' | 'GRAVE' | 'PERDA_TOTAL'>('MEDIA');
  const [descricao, setDescricao] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  const [ficha, setFicha] = useState<OpcaoBusca | null>(null);
  const [cobranca, setCobranca] = useState<'A_DEFINIR' | 'COBRAR' | 'NAO_COBRAR'>('A_DEFINIR');
  const [valor, setValor] = useState('');
  const [abrirOS, setAbrirOS] = useState(true);
  const [tipoOS, setTipoOS] = useState<'INTERNA' | 'TERCEIRO'>('INTERNA');
  const [fornecedor, setFornecedor] = useState<OpcaoBusca | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const buscarItem = useCallback(async (t: string) => { const r = await buscarItemEstoqueAction(t, empresaId, accessToken); return r.ok ? r.info : []; }, [empresaId, accessToken]);
  const buscarFichas = useCallback(async (t: string) => { const r = await buscarFichasAction(t, empresaId, accessToken); return r.ok ? r.info : []; }, [empresaId, accessToken]);
  const buscarFornec = useCallback(async (t: string) => { const r = await buscarFornecedoresAction(t, accessToken); return r.ok ? r.info : []; }, [accessToken]);

  const escolherGravidade = (g: typeof gravidade) => {
    setGravidade(g);
    if (g === 'PERDA_TOTAL') {
      setCobranca('COBRAR');
      const q = item?.patrimonio_id ? 1 : (lerValorBR(quantidade) || 1);
      if (item?.valor_indenizacao) setValor(String(Math.round(item.valor_indenizacao * q * 100) / 100).replace('.', ','));
    }
  };

  const salvar = async () => {
    setErro(null);
    if (!item) return setErro('Escolha o equipamento.');
    if (item.controle === 'INDIVIDUAL' && !item.patrimonio_id) return setErro('Este produto é por patrimônio — escolha a peça (busque pelo nº).');
    if (!descricao.trim()) return setErro('Descreva a avaria.');
    const q = item.patrimonio_id ? 1 : lerValorBR(quantidade);
    if (q === null || Number.isNaN(q) || q <= 0) return setErro('Quantidade inválida.');
    const v = lerValorBR(valor);
    if (Number.isNaN(v)) return setErro('Valor inválido.');
    if (cobranca === 'COBRAR' && !(v && v > 0)) return setErro('Informe o valor a cobrar (ou deixe "a definir").');
    setSalvando(true);
    try {
      const caminhos = fotos.length ? await enviarFotos(fotos, accessToken) : [];
      const r = await registrarAvariaAction({
        empresa_id: empresaId, produto_id: item.produto_id, patrimonio_id: item.patrimonio_id, quantidade: q, gravidade,
        descricao, fotos: caminhos, ficha_id: ficha ? Number(ficha.id) : null, parceiro_id: (ficha?.extra as any)?.parceiro_id || null,
        checklist_id: checklistId || null, status_cobranca: cobranca, valor_cobranca: v,
        abrir_os: gravidade !== 'PERDA_TOTAL' && abrirOS ? { tipo: tipoOS, fornecedor_id: fornecedor ? Number(fornecedor.id) : null } : null,
      }, accessToken);
      if (!r.ok) throw new Error(r.erro || 'Erro ao registrar.');
      onSalvo(r.info);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const labelCls = 'block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1';
  const inputCls = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]';

  return (
    <Modal open onClose={onFechar} zIndex={140} title="⚠ Registrar avaria" maxWidthClassName="max-w-2xl"
      footer={<div className="flex justify-between items-center gap-2">
        {erro ? <p className="text-xs text-red-600 font-bold">{erro}</p> : <span />}
        <div className="flex gap-2">
          <button onClick={onFechar} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">{salvando ? 'Salvando...' : 'Registrar'}</button>
        </div>
      </div>}>
      <div>
        <label className={labelCls}>Equipamento</label>
        {itemInicial ? (
          <p className="text-sm font-bold text-[#0C1D4D] border border-[#E2E8F0] rounded-lg px-3 py-2 bg-[#F8FAFC]">{itemInicial.nome}</p>
        ) : (
          <CampoBusca placeholder="Buscar produto, ou nº do patrimônio..." buscar={buscarItem}
            valor={item ? { id: item.produto_id, nome: item.nome } : null} onLimpar={() => setItem(null)}
            onEscolher={o => { const x = o.extra as any; setItem({ patrimonio_id: x.patrimonio_id, produto_id: x.produto_id, nome: o.nome, controle: x.controle, valor_indenizacao: x.valor_indenizacao }); }} />
        )}
        {item?.valor_indenizacao ? <p className="text-[10px] text-gray-500 mt-1">Valor de indenização (reposição): {formatarMoeda(item.valor_indenizacao)}</p> : null}
      </div>
      {item && !item.patrimonio_id && (
        <div className="w-40"><label className={labelCls}>Quantidade</label><input value={quantidade} onChange={e => setQuantidade(e.target.value)} inputMode="decimal" className={inputCls} /></div>
      )}
      <div>
        <label className={labelCls}>Gravidade</label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {GRAVIDADES.map(g => (
            <button key={g.v} type="button" onClick={() => escolherGravidade(g.v)}
              className={`text-left p-2 rounded-lg border-2 ${gravidade === g.v ? (g.v === 'PERDA_TOTAL' ? 'border-red-500 bg-red-50' : 'border-[#336699] bg-blue-50') : 'border-[#E2E8F0]'}`}>
              <p className="text-xs font-black text-[#0C1D4D]">{g.r}</p><p className="text-[9px] text-gray-500 leading-tight">{g.d}</p>
            </button>
          ))}
        </div>
      </div>
      <div><label className={labelCls}>O que aconteceu</label><textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={3} className={inputCls} placeholder="Ex.: tela trincada no canto inferior esquerdo; voltou sem o cabo de força" /></div>
      <div>
        <label className={labelCls}>Fotos</label>
        <input type="file" accept="image/*" capture="environment" multiple onChange={e => setFotos(Array.from(e.target.files || []).slice(0, 8))} className="text-xs" />
        {fotos.length > 0 && <p className="text-[10px] text-gray-500 mt-1">{fotos.length} foto(s) — enviadas ao registrar.</p>}
      </div>
      <div>
        <label className={labelCls}>Ficha / cliente responsável (opcional)</label>
        <CampoBusca placeholder="Buscar pelo cliente ou nº da ficha..." buscar={buscarFichas} valor={ficha} onEscolher={setFicha} onLimpar={() => setFicha(null)} />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Cobrança do cliente</label>
          <select value={cobranca} onChange={e => setCobranca(e.target.value as any)} className={inputCls}>
            <option value="A_DEFINIR">A definir (depois do orçamento do conserto)</option>
            <option value="COBRAR">Cobrar</option>
            <option value="NAO_COBRAR">Não cobrar</option>
          </select>
        </div>
        <div><label className={labelCls}>Valor a cobrar</label><input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" placeholder="R$" className={inputCls} /></div>
      </div>
      {gravidade === 'PERDA_TOTAL' ? (
        <p className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">Perda total: {item?.patrimonio_id ? 'o patrimônio é BAIXADO' : 'a quantidade sai do saldo'} ao registrar.</p>
      ) : (
        <div className="border border-[#E2E8F0] rounded-xl p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm font-bold text-[#0C1D4D]"><input type="checkbox" checked={abrirOS} onChange={e => setAbrirOS(e.target.checked)} />Abrir OS de manutenção agora (tira da disponibilidade)</label>
          {abrirOS && (
            <div className="grid md:grid-cols-2 gap-2">
              <select value={tipoOS} onChange={e => setTipoOS(e.target.value as any)} className={inputCls}>
                <option value="INTERNA">Manutenção interna</option>
                <option value="TERCEIRO">Em fornecedor / assistência</option>
              </select>
              {tipoOS === 'TERCEIRO' && <CampoBusca placeholder="Fornecedor..." buscar={buscarFornec} valor={fornecedor} onEscolher={setFornecedor} onLimpar={() => setFornecedor(null)} />}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
