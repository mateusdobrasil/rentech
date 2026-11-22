"use client";

// Aba MDF-e da tela Fiscal (2026-11-21): manifesto da viagem com as NF-e,
// o veículo da frota e os motoristas (Ficha do Funcionário). Regras em
// app/lib/fiscal/mdfe.ts. Obrigatório só em viagem para fora de SP; dentro do
// estado é opcional (regra confirmada pelo usuário em 2026-11-22).
import { useState, useEffect, useMemo } from 'react';
import { useToast, useConfirm, usePrompt } from '../../../components/ui/NotificationProvider';
import { formatarMoeda } from '../../../lib/formatadores';
import { hojeISO } from '../../../lib/locacao/datas';
import {
  painelMdfeAction, percursoMdfeAction, emitirMdfeAction, consultarMdfeAction, encerrarMdfeAction, cancelarMdfeAction,
  incluirCondutorMdfeAction, arquivoMdfeAction,
} from './actions';

const STATUS: Record<string, { rot: string; cls: string }> = {
  PROCESSANDO: { rot: 'processando', cls: 'bg-blue-100 text-blue-700' }, AUTORIZADO: { rot: 'aberto', cls: 'bg-emerald-100 text-emerald-700' },
  ENCERRADO: { rot: 'encerrado', cls: 'bg-gray-200 text-gray-600' }, CANCELADO: { rot: 'cancelado', cls: 'bg-gray-200 text-gray-500' }, ERRO: { rot: 'erro', cls: 'bg-red-100 text-red-700' },
};
const OPERACAO: Record<string, string> = { REMESSA_LOCACAO: 'remessa', VENDA_ATIVO: 'venda de ativo', VENDA_MERCADORIA: 'venda', RETORNO_LOCACAO: 'retorno' };
const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';
const mini = 'text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md border border-[#E2E8F0] hover:bg-[#F1F5F9] disabled:opacity-40';
const inp = 'mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white text-[#0A2A4A] placeholder:text-gray-400';
const lbl = 'text-[11px] font-black uppercase tracking-wider text-gray-500';
const num = (s: string | number) => { const x = Number(String(s ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const numBR = (v: number, c = 2) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c });
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

function baixar(base64: string, nome: string, tipo: string) {
  const bin = atob(base64); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([b], { type: tipo })); const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}

type Veic = { tara_kg: string; capacidade_kg: string; capacidade_m3: string; tipo_rodado: string; tipo_carroceria: string; uf_licenciamento: string };
const veicDe = (v: any): Veic => ({
  tara_kg: v?.tara_kg ? String(v.tara_kg) : '', capacidade_kg: v?.capacidade_kg ? String(v.capacidade_kg) : '', capacidade_m3: v?.capacidade_m3 ? String(v.capacidade_m3) : '',
  tipo_rodado: v?.tipo_rodado || '', tipo_carroceria: v?.tipo_carroceria || '', uf_licenciamento: v?.uf_licenciamento || 'SP',
});

export default function MdfeAba({ tok, empresaId, homolog, notaInicial, onNotaUsada }: { tok: string; empresaId: number; homolog: boolean; notaInicial: number | null; onNotaUsada: () => void }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const pedir = usePrompt();
  const [info, setInfo] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [novo, setNovo] = useState(false);

  // formulário
  const [sentido, setSentido] = useState<'IDA' | 'VOLTA'>('IDA');
  const [sel, setSel] = useState<number[]>([]);
  const [veiculoId, setVeiculoId] = useState('');
  const [veic, setVeic] = useState<Veic>(veicDe(null));
  const [motoristas, setMotoristas] = useState<number[]>([]);
  const [percursoEditado, setPercurso] = useState<string[]>([]);
  const [peso, setPeso] = useState('');
  const [pesoTocado, setPesoTocado] = useState(false);
  const [dataViagem, setDataViagem] = useState('');
  const [infoAd, setInfoAd] = useState('');
  // encerrar / incluir motorista
  const [encerrando, setEncerrando] = useState<{ id: number; numero: string; data: string; uf: string; municipio: string } | null>(null);
  const [incluindo, setIncluindo] = useState<{ id: number; numero: string; funcionarioId: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      const r = await painelMdfeAction(empresaId, tok);
      if (!vivo) return;
      if (r.ok) setInfo(r.info); else toast(r.erro || 'Erro ao carregar o MDF-e.', 'error');
      setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, tok, recarregar]);

  // atalho vindo da lista de notas: abre o formulário com a NF-e marcada
  useEffect(() => {
    if (!notaInicial || !info) return;
    const nota = (info.notas || []).find((x: any) => x.id === notaInicial);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNovo(true);
    if (nota) { setSentido(nota.sentido); setSel([nota.id]); } else toast('Esta NF-e não está disponível para MDF-e (já manifestada, cancelada ou de mais de 30 dias).', 'info');
    onNotaUsada();
  }, [notaInicial, info, onNotaUsada, toast]);

  const notas: any[] = useMemo(() => (info?.notas || []).filter((x: any) => x.sentido === sentido), [info, sentido]);
  const escolhidas = notas.filter(x => sel.includes(x.id));
  const ufsCli = [...new Set(escolhidas.map(x => x.uf).filter(Boolean))];
  const ufIni = sentido === 'IDA' ? 'SP' : ufsCli[0] || '';
  const ufFim = sentido === 'IDA' ? ufsCli[0] || '' : 'SP';
  const interestadual = !!ufIni && !!ufFim && ufIni !== ufFim;
  const pesoNotas = escolhidas.reduce((a, x) => a + (Number(x.peso) || 0), 0);
  const valorNotas = escolhidas.reduce((a, x) => a + (Number(x.valor) || 0), 0);
  const veiculo = (info?.veiculos || []).find((v: any) => v.id === veiculoId);
  const percurso = interestadual ? percursoEditado : [];

  // percurso sugerido quando a UF de destino muda
  useEffect(() => {
    if (!ufIni || !ufFim || ufIni === ufFim) return;
    let vivo = true;
    percursoMdfeAction(ufIni, ufFim, tok).then(r => { if (vivo && r.ok) setPercurso(r.info); });
    return () => { vivo = false; };
  }, [ufIni, ufFim, tok]);
  // peso: soma das NF-e, enquanto o usuário não mexer
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!pesoTocado) setPeso(pesoNotas > 0 ? numBR(pesoNotas, 3) : '');
  }, [pesoNotas, pesoTocado]);

  if (carregando && !info) return <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 text-sm text-gray-500">Carregando…</div>;
  if (!info) return null;
  const atualizar = () => setRecarregar(v => v + 1);
  const abertos = (info.mdfes || []).filter((m: any) => m.status === 'AUTORIZADO');
  const velhos = abertos.filter((m: any) => (m.aberto_horas ?? 0) >= 24);
  const pendentes = (info.notas || []).filter((x: any) => x.uf && x.uf !== 'SP');

  function limpar() {
    setSel([]); setVeiculoId(''); setVeic(veicDe(null)); setMotoristas([]); setPercurso([]); setPeso(''); setPesoTocado(false); setDataViagem(''); setInfoAd('');
  }
  function escolherVeiculo(id: string) {
    setVeiculoId(id);
    setVeic(veicDe((info.veiculos || []).find((v: any) => v.id === id)));
  }
  const alternar = (id: number) => setSel(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  async function emitir() {
    if (!sel.length) { toast('Marque as NF-e da viagem.', 'error'); return; }
    if (ufsCli.length > 1) { toast('As notas são de UFs diferentes — um MDF-e por UF.', 'error'); return; }
    if (!veiculoId) { toast('Escolha o veículo.', 'error'); return; }
    if (!motoristas.length) { toast('Escolha o motorista.', 'error'); return; }
    const amb = homolog ? 'HOMOLOGAÇÃO (sem valor fiscal)' : 'PRODUÇÃO — documento com valor fiscal';
    if (!(await confirmar({ title: 'Emitir MDF-e', message: `${veiculo?.placa} · ${sel.length} NF-e · ${ufIni} → ${ufFim}${percurso.length ? ` (via ${percurso.join(', ')})` : ''} · ${formatarMoeda(valorNotas)}\nAmbiente: ${amb}.`, confirmLabel: 'Emitir' }))) return;
    setOcupado(true);
    const r = await emitirMdfeAction({
      empresaId, sentido, notaIds: sel, veiculoId, funcionarioIds: motoristas, percurso, pesoKg: num(peso), dataViagem: dataViagem || null, informacoes: infoAd || null,
      veiculo: { tara_kg: num(veic.tara_kg) || null, capacidade_kg: num(veic.capacidade_kg) || null, capacidade_m3: num(veic.capacidade_m3) || null, tipo_rodado: veic.tipo_rodado || null, tipo_carroceria: veic.tipo_carroceria || null, uf_licenciamento: veic.uf_licenciamento || null },
    }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha ao emitir.', 'error'); return; }
    const st = r.info.status;
    toast(st === 'AUTORIZADO' ? `MDF-e nº ${r.info.numero || ''} autorizado. Encerre quando a entrega terminar.` : st === 'ERRO' ? `Recusado: ${r.info.mensagem}` : 'Enviado — aguardando autorização.', st === 'ERRO' ? 'error' : st === 'AUTORIZADO' ? 'success' : 'info');
    if (st !== 'ERRO') { limpar(); setNovo(false); }
    atualizar();
  }

  const consultar = async (m: any) => { setOcupado(true); const r = await consultarMdfeAction(m.id, tok); setOcupado(false); if (!r.ok) toast(r.erro || 'Falha.', 'error'); else if (r.info.mensagem) toast(r.info.mensagem, r.info.status === 'ERRO' ? 'error' : 'info'); atualizar(); };
  const arquivo = async (m: any, qual: 'pdf' | 'xml') => { setOcupado(true); const r = await arquivoMdfeAction(m.id, qual, tok); setOcupado(false); if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; } baixar(r.info.base64, r.info.nome, r.info.tipo); };
  const abrirEncerrar = (m: any) => {
    const ultimo = (m.municipios_descarregamento || []).at(-1) || {};
    setIncluindo(null);
    setEncerrando({ id: m.id, numero: m.numero || '', data: hojeISO(), uf: ultimo.uf || m.uf_fim, municipio: ultimo.nome || '' });
  };
  async function encerrar() {
    if (!encerrando) return;
    setOcupado(true);
    const r = await encerrarMdfeAction(encerrando.id, { data: encerrando.data, uf: encerrando.uf, municipio: encerrando.municipio }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('MDF-e encerrado.', 'success'); setEncerrando(null); atualizar();
  }
  async function incluir() {
    if (!incluindo?.funcionarioId) return;
    setOcupado(true);
    const r = await incluirCondutorMdfeAction(incluindo.id, Number(incluindo.funcionarioId), tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Motorista incluído no MDF-e.', 'success'); setIncluindo(null); atualizar();
  }
  const cancelar = async (m: any) => {
    const j = await pedir({ title: `Cancelar MDF-e nº ${m.numero || ''}`, message: 'Justificativa (15 a 255 caracteres). Só dá para cancelar em até 24h da autorização e antes de a viagem começar; depois disso, encerre.', defaultValue: '', confirmLabel: 'Cancelar MDF-e' });
    if (!j) return;
    setOcupado(true); const r = await cancelarMdfeAction(m.id, j, tok); setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('MDF-e cancelado.', 'success'); atualizar();
  };

  return (
    <div className="space-y-4">
      {velhos.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl px-4 py-3">
          <strong>{velhos.length} MDF-e aberto(s) há mais de 1 dia</strong> ({velhos.map((m: any) => `nº ${m.numero} · ${m.placa}`).join('; ')}). Encerre assim que a entrega terminar: enquanto estiver aberto, a SEFAZ recusa outro MDF-e para a mesma placa.
        </div>
      )}

      {pendentes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl px-4 py-3">
          <strong>{pendentes.length} NF-e de viagem para fora de SP sem MDF-e</strong> — obrigatório antes de o caminhão sair:{' '}
          {pendentes.map((x: any) => `nº ${x.numero} (${OPERACAO[x.operacao] || x.operacao}, ${x.cidade}/${x.uf})`).join('; ')}.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-black uppercase text-[#0C1D4D]">Manifestos (MDF-e)</h2>
            <p className="text-xs text-gray-500">Junta as NF-e de uma viagem com o veículo e o motorista. Obrigatório só em viagem para fora de SP; dentro do estado é opcional.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={atualizar} disabled={carregando} className={`${btn} bg-white border border-[#CBD5E1] text-[#0C1D4D]`}>Atualizar</button>
            <button onClick={() => { setNovo(v => !v); if (novo) limpar(); }} className={`${btn} bg-[#0C1D4D] text-white`}>{novo ? 'Fechar' : 'Novo MDF-e'}</button>
          </div>
        </div>

        {encerrando && (
          <div className="border border-[#336699] bg-[#EFF6FF] rounded-xl p-3 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <p className="col-span-2 md:col-span-5 text-xs font-black uppercase text-[#0C1D4D]">Encerrar MDF-e nº {encerrando.numero} — onde e quando a viagem terminou</p>
            <label className="text-xs"><span className={lbl}>Data</span><input type="date" value={encerrando.data} onChange={e => setEncerrando({ ...encerrando, data: e.target.value })} className={inp} /></label>
            <label className="text-xs"><span className={lbl}>UF</span><select value={encerrando.uf} onChange={e => setEncerrando({ ...encerrando, uf: e.target.value })} className={inp}>{(info.ufs || []).map((u: string) => <option key={u}>{u}</option>)}</select></label>
            <label className="text-xs"><span className={lbl}>Município</span><input value={encerrando.municipio} onChange={e => setEncerrando({ ...encerrando, municipio: e.target.value })} className={inp} /></label>
            <button onClick={encerrar} disabled={ocupado || !encerrando.municipio} className={`${btn} bg-[#0C1D4D] text-white`}>{ocupado ? 'Encerrando…' : 'Encerrar'}</button>
            <button onClick={() => setEncerrando(null)} className={`${btn} bg-white border border-[#CBD5E1] text-[#0C1D4D]`}>Voltar</button>
          </div>
        )}
        {incluindo && (
          <div className="border border-[#336699] bg-[#EFF6FF] rounded-xl p-3 flex flex-wrap gap-3 items-end">
            <label className="text-xs flex-1 min-w-[240px]"><span className={lbl}>Incluir motorista no MDF-e nº {incluindo.numero}</span>
              <select value={incluindo.funcionarioId} onChange={e => setIncluindo({ ...incluindo, funcionarioId: e.target.value })} className={inp}>
                <option value="">— escolha —</option>
                {(info.condutores || []).map((c: any) => <option key={c.id} value={c.id}>{c.nome}{c.cargo ? ` · ${c.cargo.toLowerCase()}` : ''}</option>)}
              </select>
            </label>
            <button onClick={incluir} disabled={ocupado || !incluindo.funcionarioId} className={`${btn} bg-[#0C1D4D] text-white`}>Incluir</button>
            <button onClick={() => setIncluindo(null)} className={`${btn} bg-white border border-[#CBD5E1] text-[#0C1D4D]`}>Voltar</button>
          </div>
        )}

        {!(info.mdfes || []).length ? <p className="text-sm text-gray-500 p-2">Nenhum MDF-e nos últimos 90 dias.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] font-black text-gray-500 uppercase border-b"><th className="p-2">Nº</th><th className="p-2">Veículo / motorista</th><th className="p-2">Viagem</th><th className="p-2">NF-e</th><th className="p-2 text-right">Carga</th><th className="p-2">Situação</th><th className="p-2"></th></tr></thead>
              <tbody>
                {(info.mdfes || []).map((m: any) => (
                  <tr key={m.id} className="border-b border-[#F1F5F9] align-top">
                    <td className="p-2 font-bold whitespace-nowrap">{m.numero || '—'}{m.serie ? <span className="text-gray-400 font-normal"> s{m.serie}</span> : null}<div className="text-[10px] text-gray-400 font-normal">{quando(m.criado_em)}</div>{m.ambiente !== 'PRODUCAO' && <div className="text-[10px] font-black text-amber-700 uppercase">homologação</div>}</td>
                    <td className="p-2 text-xs"><strong>{m.placa}</strong><div className="text-gray-500">{(m.condutores || []).join(', ')}</div></td>
                    <td className="p-2 text-xs">{m.municipio_carregamento} → {(m.municipios_descarregamento || []).map((d: any) => `${d.nome}/${d.uf}`).join(', ')}{m.percurso?.length ? <div className="text-gray-400">via {m.percurso.join(', ')}</div> : null}{m.interestadual && <div className="text-[10px] font-black uppercase text-[#336699]">interestadual</div>}</td>
                    <td className="p-2 text-xs">{(m.notas || []).join(', ') || '—'}</td>
                    <td className="p-2 text-right text-xs whitespace-nowrap"><strong>{formatarMoeda(Number(m.valor_carga))}</strong><div className="text-gray-500">{numBR(Number(m.peso_kg), 1)} kg</div></td>
                    <td className="p-2 max-w-[260px]">
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${STATUS[m.status]?.cls || ''}`}>{STATUS[m.status]?.rot || m.status}</span>
                      {m.status === 'AUTORIZADO' && m.aberto_horas !== null && <div className={`text-[11px] mt-1 ${m.aberto_horas >= 24 ? 'text-red-700 font-bold' : 'text-gray-500'}`}>aberto há {m.aberto_horas < 24 ? `${m.aberto_horas}h` : `${Math.floor(m.aberto_horas / 24)} dia(s)`}</div>}
                      {m.status === 'ENCERRADO' && m.encerrado_em && <div className="text-[11px] mt-1 text-gray-500">em {quando(m.encerrado_em)}{m.encerramento_municipio ? ` · ${m.encerramento_municipio}` : ''}</div>}
                      {m.mensagem && m.status === 'ERRO' && <div className="text-[11px] mt-1 text-red-700">{m.mensagem}</div>}
                      {m.motivo_cancelamento && <div className="text-[11px] mt-1 text-gray-500">{m.motivo_cancelamento}</div>}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1 justify-end">
                        {m.status === 'PROCESSANDO' && <button disabled={ocupado} onClick={() => consultar(m)} className={mini}>Consultar</button>}
                        {m.tem_pdf && <button disabled={ocupado} onClick={() => arquivo(m, 'pdf')} className={mini}>DAMDFE</button>}
                        {m.tem_xml && <button disabled={ocupado} onClick={() => arquivo(m, 'xml')} className={mini}>XML</button>}
                        {m.status === 'AUTORIZADO' && <button disabled={ocupado} onClick={() => abrirEncerrar(m)} className={`${mini} text-[#336699]`}>Encerrar</button>}
                        {m.status === 'AUTORIZADO' && <button disabled={ocupado} onClick={() => { setEncerrando(null); setIncluindo({ id: m.id, numero: m.numero || '', funcionarioId: '' }); }} className={mini}>+ Motorista</button>}
                        {m.status === 'AUTORIZADO' && <button disabled={ocupado} onClick={() => cancelar(m)} className={`${mini} text-red-700`}>Cancelar</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {novo && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-black uppercase text-[#0C1D4D]">Novo MDF-e</h2>
            <div className="flex gap-1 bg-[#F1F5F9] rounded-lg p-1">
              {(['IDA', 'VOLTA'] as const).map(s => <button key={s} onClick={() => { setSentido(s); setSel([]); }} className={`px-3 py-1.5 text-[11px] font-black uppercase rounded-md ${sentido === s ? 'bg-white shadow text-[#0C1D4D]' : 'text-gray-500'}`}>{s === 'IDA' ? 'Ida (remessa / venda)' : 'Volta (retorno)'}</button>)}
            </div>
          </div>

          <div>
            <p className={lbl}>NF-e da viagem <span className="normal-case font-normal">— autorizadas nos últimos 30 dias, ainda sem MDF-e</span></p>
            {!notas.length ? <p className="text-sm text-gray-500 mt-2">Nenhuma NF-e de {sentido === 'IDA' ? 'remessa ou venda' : 'retorno'} disponível.</p> : (
              <div className="overflow-x-auto max-h-72 overflow-y-auto border border-[#E2E8F0] rounded-xl mt-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#F8FAFC]"><tr className="text-left text-[10px] font-black uppercase text-gray-500"><th className="p-2 w-8"></th><th className="p-2">NF-e</th><th className="p-2">Cliente</th><th className="p-2">{sentido === 'IDA' ? 'Destino' : 'Origem'}</th><th className="p-2 text-right">Valor</th><th className="p-2 text-right">Peso</th></tr></thead>
                  <tbody>{notas.map(x => (
                    <tr key={x.id} onClick={() => alternar(x.id)} className={`border-t border-[#F1F5F9] cursor-pointer ${sel.includes(x.id) ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'}`}>
                      <td className="p-2"><input type="checkbox" readOnly checked={sel.includes(x.id)} /></td>
                      <td className="p-2 font-bold whitespace-nowrap">{x.numero}<span className="text-gray-400 font-normal"> · {OPERACAO[x.operacao] || x.operacao}</span>{x.fl && <div className="text-[10px] text-gray-400 font-normal">FL {x.fl}</div>}</td>
                      <td className="p-2">{x.cliente}</td>
                      <td className="p-2 whitespace-nowrap">{x.cidade}/{x.uf}{x.uf && x.uf !== 'SP' && <span className="ml-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">obrigatório</span>}</td>
                      <td className="p-2 text-right">{formatarMoeda(x.valor)}</td>
                      <td className="p-2 text-right">{x.peso ? `${numBR(x.peso, 1)} kg` : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {sel.length > 0 && (
              <div className={`mt-2 text-xs rounded-lg px-3 py-2 ${ufsCli.length > 1 ? 'bg-red-50 border border-red-200 text-red-700' : interestadual ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-[#F1F5F9] text-gray-600'}`}>
                {ufsCli.length > 1 ? `As notas marcadas são de UFs diferentes (${ufsCli.join(', ')}) — emita um MDF-e por UF.`
                  : interestadual ? <><strong>Obrigatório:</strong> viagem {ufIni} → {ufFim}.</>
                  : <>Viagem dentro de {ufIni}: o MDF-e é <strong>opcional</strong>.</>}
                {' '}{sel.length} NF-e · {formatarMoeda(valorNotas)}.
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs block"><span className={lbl}>Veículo da frota</span>
                <select value={veiculoId} onChange={e => escolherVeiculo(e.target.value)} className={inp}>
                  <option value="">— escolha —</option>
                  {(info.veiculos || []).map((v: any) => <option key={v.id} value={v.id}>{v.placa} · {v.apelido || v.modelo}{v.tipo ? ` (${String(v.tipo).toLowerCase()})` : ''}</option>)}
                </select>
              </label>
              {veiculo && (
                <div className="grid grid-cols-3 gap-2 border border-[#E2E8F0] rounded-xl p-3">
                  <p className="col-span-3 text-[10px] text-gray-500">Dados que o MDF-e exige (do CRLV). O que você preencher aqui fica salvo na frota.</p>
                  <label className="text-xs"><span className={lbl}>Tara (kg)</span><input value={veic.tara_kg} onChange={e => setVeic({ ...veic, tara_kg: e.target.value })} inputMode="numeric" className={`${inp} ${num(veic.tara_kg) > 0 ? '' : 'border-red-400 bg-red-50'}`} /></label>
                  <label className="text-xs"><span className={lbl}>Capac. (kg)</span><input value={veic.capacidade_kg} onChange={e => setVeic({ ...veic, capacidade_kg: e.target.value })} inputMode="numeric" className={inp} /></label>
                  <label className="text-xs"><span className={lbl}>UF licenc.</span><select value={veic.uf_licenciamento} onChange={e => setVeic({ ...veic, uf_licenciamento: e.target.value })} className={inp}>{(info.ufs || []).map((u: string) => <option key={u}>{u}</option>)}</select></label>
                  <label className="text-xs col-span-3 md:col-span-1"><span className={lbl}>Rodado</span><select value={veic.tipo_rodado} onChange={e => setVeic({ ...veic, tipo_rodado: e.target.value })} className={`${inp} ${veic.tipo_rodado ? '' : 'border-red-400 bg-red-50'}`}><option value="">—</option>{Object.entries(info.rodados || {}).map(([k, r]) => <option key={k} value={k}>{r as string}</option>)}</select></label>
                  <label className="text-xs col-span-3 md:col-span-2"><span className={lbl}>Carroceria</span><select value={veic.tipo_carroceria} onChange={e => setVeic({ ...veic, tipo_carroceria: e.target.value })} className={`${inp} ${veic.tipo_carroceria ? '' : 'border-red-400 bg-red-50'}`}><option value="">—</option>{Object.entries(info.carrocerias || {}).map(([k, r]) => <option key={k} value={k}>{r as string}</option>)}</select></label>
                  {veiculo.propriedade === 'ALUGADO' && <p className="col-span-3 text-[11px] text-amber-700 font-bold">Veículo alugado: confirme com o contador se o MDF-e precisa dos dados do proprietário (locadora).</p>}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <span className={lbl}>Motorista(s) <span className="normal-case font-normal">— nome e CPF da Ficha do Funcionário</span></span>
              <div className="flex flex-wrap gap-1">
                {motoristas.map(id => { const c = (info.condutores || []).find((x: any) => x.id === id); return <span key={id} className="text-xs bg-[#EFF6FF] border border-[#BFDBFE] rounded-full px-2 py-1">{c?.nome || id} <button onClick={() => setMotoristas(p => p.filter(x => x !== id))} className="text-red-600 font-black ml-1">×</button></span>; })}
              </div>
              <select value="" onChange={e => { const id = Number(e.target.value); if (id && !motoristas.includes(id)) setMotoristas(p => [...p, id].slice(0, 10)); }} className={inp}>
                <option value="">+ adicionar motorista</option>
                {(info.condutores || []).filter((c: any) => !motoristas.includes(c.id)).map((c: any) => <option key={c.id} value={c.id}>{c.nome}{c.cargo ? ` · ${c.cargo.toLowerCase()}` : ''}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs"><span className={lbl}>Peso bruto (kg)</span><input value={peso} onChange={e => { setPeso(e.target.value); setPesoTocado(true); }} inputMode="decimal" className={`${inp} ${num(peso) > 0 ? '' : 'border-red-400 bg-red-50'}`} /></label>
                <label className="text-xs"><span className={lbl}>Saída prevista</span><input type="datetime-local" value={dataViagem} onChange={e => setDataViagem(e.target.value)} className={inp} /></label>
              </div>
              {interestadual && (
                <label className="text-xs block"><span className={lbl}>UFs do percurso <span className="normal-case font-normal">(entre {ufIni} e {ufFim}, na ordem)</span></span>
                  <input value={percurso.join(', ')} onChange={e => setPercurso(e.target.value.toUpperCase().split(/[^A-Z]+/).filter(Boolean))} placeholder="nenhuma — divisa direta" className={inp} />
                </label>
              )}
            </div>
          </div>
          <label className="text-xs block"><span className={lbl}>Informações complementares</span>
            <textarea value={infoAd} onChange={e => setInfoAd(e.target.value)} rows={2} className={inp} placeholder="Ex.: evento, local de montagem." />
          </label>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-xs text-gray-500">{homolog ? 'Homologação — sem valor fiscal' : 'PRODUÇÃO — documento com valor fiscal'}</span>
            <button onClick={emitir} disabled={ocupado || !sel.length || ufsCli.length > 1 || !veiculoId || !motoristas.length} className={`${btn} ${homolog ? 'bg-[#0C1D4D]' : 'bg-red-700'} text-white`}>{ocupado ? 'Enviando…' : 'Emitir MDF-e'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
