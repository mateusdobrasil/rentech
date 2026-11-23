"use client";

// Cadastro de cliente/fornecedor (2026-11-23). Novo, edição (cadastro do
// sistema, ou qualquer um depois da virada) e só a carteira (cadastro do P2S
// enquanto o P2S é oficial). Regras em app/lib/cadastros/parceiros.ts.
import { useEffect, useRef, useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/NotificationProvider';
import {
  carregarParceiroAction, salvarParceiroAction, salvarCarteiraParceiroAction, consultarCnpjAction, consultarCepAction, verificarDocumentoParceiroAction,
} from './actions-cadastro';

interface Contato { nome: string; cargo: string; departamento: string; telefone: string; email: string; principal: boolean }
interface Endereco { tipo: string; endereco_completo: string; cidade: string; estado: string; cep: string; observacoes: string }
interface Form {
  natureza: 'J' | 'F'; documento: string; nome_completo: string; nome_exibicao: string; inscricao_estadual: string; inscricao_municipal: string;
  flag_cliente: boolean; flag_fornecedor: boolean; flag_transportadora: boolean; status_parceiro: string; motivo_bloqueio: string;
  cep1: string; endereco1: string; numero1: string; complemento1: string; bairro1: string; cidade1: string; estado1: string;
  telefone1: string; telefone2: string; email1: string; email2: string; site: string; observacoes: string;
  contatos: Contato[]; enderecos: Endereco[]; vendedor_id: number | null;
}

const VAZIO: Form = {
  natureza: 'J', documento: '', nome_completo: '', nome_exibicao: '', inscricao_estadual: '', inscricao_municipal: '',
  flag_cliente: true, flag_fornecedor: false, flag_transportadora: false, status_parceiro: 'A', motivo_bloqueio: '',
  cep1: '', endereco1: '', numero1: '', complemento1: '', bairro1: '', cidade1: '', estado1: '',
  telefone1: '', telefone2: '', email1: '', email2: '', site: '', observacoes: '', contatos: [], enderecos: [], vendedor_id: null,
};
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dig = (v: string) => v.replace(/\D/g, '');
const mascaraDoc = (v: string, nat: 'J' | 'F') => {
  const d = dig(v).slice(0, nat === 'J' ? 14 : 11);
  return nat === 'J'
    ? d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2')
    : d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

interface Props {
  aberto: boolean;
  parceiroId: number | null; // null = novo
  accessToken: string;
  vendedores: { id: number; nome: string }[];
  onClose: () => void;
  onSalvo: (id: number) => void;
}

export default function FormParceiro({ aberto, parceiroId, accessToken, vendedores, onClose, onSalvo }: Props) {
  const toast = useToast();
  const [f, setF] = useState<Form>(VAZIO);
  // A tela só monta o formulário quando ele abre (key = parceiro): o estado já
  // nasce certo para "novo" e o carregamento só acontece para edição.
  const [carregando, setCarregando] = useState(!!parceiroId);
  const [salvando, setSalvando] = useState(false);
  const [buscando, setBuscando] = useState<'' | 'cnpj' | 'cep'>('');
  const [editavel, setEditavel] = useState(true);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [info, setInfo] = useState<{ codigo: number | null; origem: string; situacao: string | null }>({ codigo: null, origem: 'SISTEMA', situacao: null });
  const [duplicado, setDuplicado] = useState<string | null>(null);
  const fecharRef = useRef(onClose);
  useEffect(() => { fecharRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!aberto || !parceiroId) return;
    let vivo = true;
    carregarParceiroAction(parceiroId, accessToken).then(r => {
      if (!vivo) return;
      setCarregando(false);
      if (!r.ok) { toast(r.erro || 'Falha ao abrir o cadastro.', 'error'); fecharRef.current(); return; }
      const p = r.info.parceiro;
      const nat: 'J' | 'F' = p.natureza === 'F' || (!p.cnpj && p.cpf) ? 'F' : 'J';
      setF({
        natureza: nat, documento: mascaraDoc(s(nat === 'J' ? p.cnpj : p.cpf), nat), nome_completo: s(p.nome_completo), nome_exibicao: s(p.nome_exibicao),
        inscricao_estadual: s(p.inscricao_estadual), inscricao_municipal: s(p.inscricao_municipal),
        flag_cliente: !!p.flag_cliente, flag_fornecedor: !!p.flag_fornecedor, flag_transportadora: !!p.flag_transportadora,
        status_parceiro: s(p.status_parceiro) || 'A', motivo_bloqueio: s(p.motivo_bloqueio),
        cep1: s(p.cep1), endereco1: s(p.endereco1), numero1: s(p.numero1), complemento1: s(p.complemento1), bairro1: s(p.bairro1), cidade1: s(p.cidade1), estado1: s(p.estado1),
        telefone1: s(p.telefone1), telefone2: s(p.telefone2), email1: s(p.email1), email2: s(p.email2), site: s(p.site), observacoes: s(p.observacoes),
        contatos: ((p.contatos || []) as Record<string, unknown>[]).map(c => ({ nome: s(c.nome), cargo: s(c.cargo), departamento: s(c.departamento), telefone: s(c.telefone), email: s(c.email), principal: !!c.principal })),
        enderecos: ((p.enderecos || []) as Record<string, unknown>[]).map(e => ({ tipo: s(e.tipo), endereco_completo: s(e.endereco_completo), cidade: s(e.cidade), estado: s(e.estado), cep: s(e.cep), observacoes: s(e.observacoes) })),
        vendedor_id: r.info.vendedorId ?? null,
      });
      setEditavel(!!r.info.editavel); setMotivo(r.info.motivo || null);
      setInfo({ codigo: p.codigo_parceiro ?? null, origem: p.origem || 'P2S', situacao: null });
    });
    return () => { vivo = false; };
  }, [aberto, parceiroId, accessToken, toast]);

  const muda = (parcial: Partial<Form>) => setF(atual => ({ ...atual, ...parcial }));
  const ro = !editavel;

  const checarDuplicado = async () => {
    const d = dig(f.documento);
    if (d.length !== (f.natureza === 'J' ? 14 : 11)) { setDuplicado(null); return; }
    const r = await verificarDocumentoParceiroAction(d, parceiroId, accessToken);
    setDuplicado(r.ok && r.info ? `Já cadastrado: ${r.info.nome_exibicao || r.info.nome_completo} (código ${r.info.codigo_parceiro ?? r.info.id}).` : null);
  };

  const buscarCnpj = async () => {
    setBuscando('cnpj');
    const r = await consultarCnpjAction(f.documento, accessToken);
    setBuscando('');
    if (!r.ok) { toast(r.erro || 'Consulta indisponível.', 'error'); return; }
    const c = r.info;
    setF(a => ({
      ...a,
      nome_completo: c.razao_social || a.nome_completo, nome_exibicao: c.nome_fantasia || a.nome_exibicao || c.razao_social || '',
      cep1: c.cep || a.cep1, endereco1: c.logradouro || a.endereco1, numero1: c.numero || a.numero1, complemento1: c.complemento || a.complemento1,
      bairro1: c.bairro || a.bairro1, cidade1: c.cidade || a.cidade1, estado1: c.uf || a.estado1,
      telefone1: a.telefone1 || c.telefone || '', email1: a.email1 || c.email || '',
    }));
    setInfo(i => ({ ...i, situacao: c.situacao }));
    toast(c.situacao && !/ATIVA/i.test(c.situacao) ? `Atenção: CNPJ com situação ${c.situacao} na Receita.` : 'Dados da Receita preenchidos. Confira antes de salvar.', c.situacao && !/ATIVA/i.test(c.situacao) ? 'error' : 'success');
  };

  const buscarCep = async () => {
    setBuscando('cep');
    const r = await consultarCepAction(f.cep1, accessToken);
    setBuscando('');
    if (!r.ok) { toast(r.erro || 'Consulta indisponível.', 'error'); return; }
    const c = r.info;
    setF(a => ({ ...a, endereco1: c.logradouro || a.endereco1, bairro1: c.bairro || a.bairro1, cidade1: c.cidade || a.cidade1, estado1: c.uf || a.estado1 }));
  };

  const salvar = async () => {
    setSalvando(true);
    const r = editavel
      ? await salvarParceiroAction({ ...f, id: parceiroId, documento: dig(f.documento) }, accessToken)
      : await salvarCarteiraParceiroAction(parceiroId!, f.vendedor_id, accessToken);
    setSalvando(false);
    if (!r.ok) { toast(r.erro || 'Falha ao salvar.', 'error'); return; }
    toast(editavel ? (parceiroId ? 'Cadastro salvo.' : `Parceiro cadastrado (código ${r.info.codigo}).`) : 'Carteira salva.', 'success');
    onSalvo(editavel ? r.info.id : parceiroId!);
  };

  const inp = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm disabled:bg-[#F8FAFC] disabled:text-gray-600';
  const lab = 'block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1';
  const sec = 'text-xs font-black uppercase tracking-wider text-[#0C1D4D] mb-2';
  const btnMini = 'text-[10px] font-black uppercase px-3 py-2 rounded-lg border border-[#336699] text-[#336699] hover:bg-blue-50 disabled:opacity-40 whitespace-nowrap';
  const titulo = parceiroId ? `${f.nome_exibicao || f.nome_completo || 'Parceiro'}${info.codigo ? ` · código ${info.codigo}` : ''}` : 'Novo cliente / fornecedor';

  return (
    <Modal open={aberto} onClose={onClose} title={titulo} maxWidthClassName="max-w-4xl"
      footer={<div className="flex flex-col md:flex-row justify-between gap-2 md:items-center">
        <span className="text-[11px] text-gray-500">{parceiroId ? `Origem: ${info.origem === 'SISTEMA' ? 'cadastro do sistema' : 'P2S'}` : 'Cadastro feito no sistema (origem SISTEMA).'}</span>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-black uppercase border border-[#E2E8F0]">Cancelar</button>
          <button onClick={salvar} disabled={salvando || carregando || (editavel && !!duplicado)} className="px-4 py-2 rounded-lg text-xs font-black uppercase bg-[#0C1D4D] text-white disabled:opacity-50">{salvando ? 'Salvando…' : editavel ? 'Salvar' : 'Salvar carteira'}</button>
        </div>
      </div>}>
      {carregando ? <p className="text-sm text-gray-500">Carregando…</p> : (
        <div className="space-y-6">
          {motivo && <p className="text-xs rounded-xl border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3">{motivo}</p>}

          <section>
            <h3 className={sec}>Identificação</h3>
            <div className="grid md:grid-cols-4 gap-3">
              <div>
                <label className={lab}>Tipo</label>
                <select value={f.natureza} disabled={ro || !!parceiroId} onChange={e => { const n = e.target.value as 'J' | 'F'; muda({ natureza: n, documento: '' }); setDuplicado(null); }} className={inp}>
                  <option value="J">Pessoa jurídica</option><option value="F">Pessoa física</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={lab}>{f.natureza === 'J' ? 'CNPJ' : 'CPF'} *</label>
                <div className="flex gap-2">
                  <input value={f.documento} disabled={ro} onChange={e => muda({ documento: mascaraDoc(e.target.value, f.natureza) })} onBlur={checarDuplicado} inputMode="numeric" placeholder={f.natureza === 'J' ? '00.000.000/0000-00' : '000.000.000-00'} className={inp} />
                  {f.natureza === 'J' && !ro && <button type="button" onClick={buscarCnpj} disabled={buscando !== '' || dig(f.documento).length !== 14} className={btnMini}>{buscando === 'cnpj' ? 'Buscando…' : 'Buscar na Receita'}</button>}
                </div>
                {duplicado && <p className="text-[11px] text-red-600 font-bold mt-1">{duplicado}</p>}
                {info.situacao && <p className={`text-[11px] font-bold mt-1 ${/ATIVA/i.test(info.situacao) ? 'text-emerald-700' : 'text-red-600'}`}>Situação na Receita: {info.situacao}</p>}
              </div>
              <div>
                <label className={lab}>Situação</label>
                <select value={f.status_parceiro} disabled={ro} onChange={e => muda({ status_parceiro: e.target.value })} className={inp}>
                  <option value="A">Ativo</option><option value="B">Bloqueado</option>
                  {!['A', 'B'].includes(f.status_parceiro) && <option value={f.status_parceiro}>Código do P2S: {f.status_parceiro}</option>}
                </select>
              </div>
              <div className="md:col-span-2"><label className={lab}>{f.natureza === 'J' ? 'Razão social' : 'Nome completo'} *</label><input value={f.nome_completo} disabled={ro} onChange={e => muda({ nome_completo: e.target.value })} className={inp} /></div>
              <div className="md:col-span-2"><label className={lab}>{f.natureza === 'J' ? 'Nome fantasia (como aparece nas listas)' : 'Nome de exibição'}</label><input value={f.nome_exibicao} disabled={ro} onChange={e => muda({ nome_exibicao: e.target.value })} className={inp} /></div>
              <div><label className={lab}>Inscrição estadual</label><input value={f.inscricao_estadual} disabled={ro} onChange={e => muda({ inscricao_estadual: e.target.value })} placeholder="ou ISENTO" className={inp} /></div>
              <div><label className={lab}>Inscrição municipal</label><input value={f.inscricao_municipal} disabled={ro} onChange={e => muda({ inscricao_municipal: e.target.value })} className={inp} /></div>
              <div className="md:col-span-2 flex flex-wrap items-end gap-4 pb-2">
                {([['flag_cliente', 'Cliente'], ['flag_fornecedor', 'Fornecedor'], ['flag_transportadora', 'Transportadora']] as const).map(([k, r]) => (
                  <label key={k} className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={f[k]} disabled={ro} onChange={e => muda({ [k]: e.target.checked } as Partial<Form>)} /> {r}</label>
                ))}
              </div>
              {f.status_parceiro === 'B' && <div className="md:col-span-4"><label className={lab}>Motivo do bloqueio *</label><input value={f.motivo_bloqueio} disabled={ro} onChange={e => muda({ motivo_bloqueio: e.target.value })} className={inp} /></div>}
            </div>
          </section>

          <section>
            <h3 className={sec}>Endereço principal</h3>
            <p className="text-[11px] text-gray-500 -mt-1 mb-2">É o endereço que sai na proposta, no contrato e na nota fiscal.</p>
            <div className="grid md:grid-cols-6 gap-3">
              <div className="md:col-span-2">
                <label className={lab}>CEP</label>
                <div className="flex gap-2">
                  <input value={f.cep1} disabled={ro} onChange={e => muda({ cep1: dig(e.target.value).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2') })} inputMode="numeric" placeholder="00000-000" className={inp} />
                  {!ro && <button type="button" onClick={buscarCep} disabled={buscando !== '' || dig(f.cep1).length !== 8} className={btnMini}>{buscando === 'cep' ? '…' : 'Buscar'}</button>}
                </div>
              </div>
              <div className="md:col-span-4"><label className={lab}>Logradouro</label><input value={f.endereco1} disabled={ro} onChange={e => muda({ endereco1: e.target.value })} className={inp} /></div>
              <div><label className={lab}>Número</label><input value={f.numero1} disabled={ro} onChange={e => muda({ numero1: e.target.value })} className={inp} /></div>
              <div className="md:col-span-2"><label className={lab}>Complemento</label><input value={f.complemento1} disabled={ro} onChange={e => muda({ complemento1: e.target.value })} className={inp} /></div>
              <div className="md:col-span-3"><label className={lab}>Bairro</label><input value={f.bairro1} disabled={ro} onChange={e => muda({ bairro1: e.target.value })} className={inp} /></div>
              <div className="md:col-span-4"><label className={lab}>Cidade</label><input value={f.cidade1} disabled={ro} onChange={e => muda({ cidade1: e.target.value })} className={inp} /></div>
              <div className="md:col-span-2"><label className={lab}>UF</label><input value={f.estado1} disabled={ro} maxLength={2} onChange={e => muda({ estado1: e.target.value.toUpperCase() })} className={inp} /></div>
            </div>
          </section>

          <section>
            <h3 className={sec}>Telefones e e-mails</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <div><label className={lab}>Telefone principal</label><input value={f.telefone1} disabled={ro} onChange={e => muda({ telefone1: e.target.value })} className={inp} /></div>
              <div><label className={lab}>Outro telefone</label><input value={f.telefone2} disabled={ro} onChange={e => muda({ telefone2: e.target.value })} className={inp} /></div>
              <div><label className={lab}>E-mail principal</label><input value={f.email1} disabled={ro} onChange={e => muda({ email1: e.target.value })} className={inp} /><p className="text-[10px] text-gray-400 mt-1">Com ele (ou o e-mail de um contato) o cliente entra no Portal do Cliente.</p></div>
              <div><label className={lab}>Outro e-mail (financeiro, NF…)</label><input value={f.email2} disabled={ro} onChange={e => muda({ email2: e.target.value })} className={inp} /></div>
              <div className="md:col-span-2"><label className={lab}>Site</label><input value={f.site} disabled={ro} onChange={e => muda({ site: e.target.value })} className={inp} /></div>
            </div>
          </section>

          <section>
            <div className="flex justify-between items-center mb-2">
              <h3 className={sec + ' mb-0'}>Contatos</h3>
              {!ro && <button type="button" onClick={() => muda({ contatos: [...f.contatos, { nome: '', cargo: '', departamento: '', telefone: '', email: '', principal: f.contatos.length === 0 }] })} className={btnMini}>+ Contato</button>}
            </div>
            {f.contatos.length === 0 && <p className="text-xs text-gray-400">Nenhum contato.</p>}
            <div className="space-y-2">
              {f.contatos.map((c, i) => {
                const mudaC = (p: Partial<Contato>) => muda({ contatos: f.contatos.map((x, j) => (j === i ? { ...x, ...p } : p.principal ? { ...x, principal: false } : x)) });
                return (
                  <div key={i} className="grid md:grid-cols-12 gap-2 items-center border border-[#E2E8F0] rounded-xl p-2">
                    <input value={c.nome} disabled={ro} onChange={e => mudaC({ nome: e.target.value })} placeholder="Nome" className={`${inp} md:col-span-3`} />
                    <input value={c.cargo} disabled={ro} onChange={e => mudaC({ cargo: e.target.value })} placeholder="Cargo / área" className={`${inp} md:col-span-2`} />
                    <input value={c.telefone} disabled={ro} onChange={e => mudaC({ telefone: e.target.value })} placeholder="Telefone" className={`${inp} md:col-span-2`} />
                    <input value={c.email} disabled={ro} onChange={e => mudaC({ email: e.target.value })} placeholder="E-mail" className={`${inp} md:col-span-3`} />
                    <label className="md:col-span-1 flex items-center gap-1 text-[10px] font-bold"><input type="checkbox" checked={c.principal} disabled={ro} onChange={e => mudaC({ principal: e.target.checked })} /> principal</label>
                    {!ro && <button type="button" onClick={() => muda({ contatos: f.contatos.filter((_, j) => j !== i) })} className="md:col-span-1 text-[10px] font-black text-red-500 uppercase">remover</button>}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <div className="flex justify-between items-center mb-2">
              <h3 className={sec + ' mb-0'}>Outros endereços (entrega, cobrança…)</h3>
              {!ro && <button type="button" onClick={() => muda({ enderecos: [...f.enderecos, { tipo: 'ENTREGA', endereco_completo: '', cidade: '', estado: '', cep: '', observacoes: '' }] })} className={btnMini}>+ Endereço</button>}
            </div>
            {f.enderecos.length === 0 && <p className="text-xs text-gray-400">Nenhum outro endereço.</p>}
            <div className="space-y-2">
              {f.enderecos.map((e, i) => {
                const mudaE = (p: Partial<Endereco>) => muda({ enderecos: f.enderecos.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <div key={i} className="grid md:grid-cols-12 gap-2 items-center border border-[#E2E8F0] rounded-xl p-2">
                    <input value={e.tipo} disabled={ro} onChange={ev => mudaE({ tipo: ev.target.value })} placeholder="Tipo" className={`${inp} md:col-span-2`} />
                    <input value={e.endereco_completo} disabled={ro} onChange={ev => mudaE({ endereco_completo: ev.target.value })} placeholder="Endereço completo" className={`${inp} md:col-span-5`} />
                    <input value={e.cidade} disabled={ro} onChange={ev => mudaE({ cidade: ev.target.value })} placeholder="Cidade" className={`${inp} md:col-span-2`} />
                    <input value={e.estado} disabled={ro} maxLength={2} onChange={ev => mudaE({ estado: ev.target.value.toUpperCase() })} placeholder="UF" className={`${inp} md:col-span-1`} />
                    <input value={e.cep} disabled={ro} onChange={ev => mudaE({ cep: ev.target.value })} placeholder="CEP" className={`${inp} md:col-span-1`} />
                    {!ro && <button type="button" onClick={() => muda({ enderecos: f.enderecos.filter((_, j) => j !== i) })} className="md:col-span-1 text-[10px] font-black text-red-500 uppercase">remover</button>}
                  </div>
                );
              })}
            </div>
          </section>

          {f.flag_cliente && (
            <section>
              <h3 className={sec}>Carteira do vendedor</h3>
              <select value={f.vendedor_id ?? ''} onChange={e => muda({ vendedor_id: e.target.value ? Number(e.target.value) : null })} className={`${inp} md:w-80`}>
                <option value="">— sem carteira —</option>
                {f.vendedor_id && !vendedores.some(v => v.id === f.vendedor_id) && <option value={f.vendedor_id}>Vendedor #{f.vendedor_id} (inativo)</option>}
                {vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">O vendedor padrão só vê e atende os clientes da carteira dele. Sem carteira, o cliente entra na carteira de quem fizer a primeira ficha.</p>
            </section>
          )}

          <section>
            <label className={lab}>Observações</label>
            <textarea value={f.observacoes} disabled={ro} onChange={e => muda({ observacoes: e.target.value })} rows={3} className={inp} />
          </section>
        </div>
      )}
    </Modal>
  );
}
