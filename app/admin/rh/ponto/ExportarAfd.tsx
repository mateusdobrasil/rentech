"use client";

// app/admin/rh/ponto/ExportarAfd.tsx
// Modal "AFD — Portaria 671" do card Ponto via WhatsApp (RH → Ponto): escolhe
// empresa e período, mostra os dados do REP-P (INPI, desenvolvedor, coletor) e
// o certificado que assina, e baixa o .txt e o .p7s. Ver app/lib/ponto/afdCore.ts.
import { useEffect, useState } from 'react';
import { dadosAfdAction, salvarParametrosAfdAction, gerarAfdAction, type DadosAfd, type ArquivoAfd } from '../actions/actions-afd';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { useToast } from '../../../components/ui/NotificationProvider';

const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const formatarDoc = (d: string) => (d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d);

function baixar(nome: string, base64: string, tipo: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function ExportarAfd({ accessToken, mesAno, onClose }: { accessToken: string; mesAno: string; onClose: () => void }) {
  const toast = useToast();
  const [dados, setDados] = useState<DadosAfd | null>(null);
  const [erro, setErro] = useState('');
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [inicio, setInicio] = useState(() => `${mesAno}-01`);
  const [fim, setFim] = useState(() => {
    const [a, m] = mesAno.split('-').map(Number);
    return `${mesAno}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
  });
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ inpiRegistro: '', desenvolvedorDocumento: '', coletor: '01' });
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<ArquivoAfd | null>(null);

  useEffect(() => {
    let vivo = true;
    dadosAfdAction(accessToken).then(r => {
      if (!vivo) return;
      if (!r.ok || !r.info) { setErro(r.erro || 'Erro ao carregar.'); return; }
      setDados(r.info);
      setEmpresaId(r.info.empresas[0]?.id ?? null);
      setForm({ inpiRegistro: r.info.parametros.inpiRegistro, desenvolvedorDocumento: r.info.parametros.desenvolvedorDocumento, coletor: r.info.parametros.coletor });
    });
    return () => { vivo = false; };
  }, [accessToken]);

  const empresa = dados?.empresas.find(e => e.id === empresaId) || null;

  const salvar = async () => {
    setSalvando(true);
    const r = await salvarParametrosAfdAction(form, accessToken);
    setSalvando(false);
    if (!r.ok || !r.info) { toast(r.erro || 'Erro ao salvar.', 'error'); return; }
    setDados(d => (d ? { ...d, parametros: r.info! } : d));
    setEditando(false);
    toast('Dados do REP-P salvos.', 'success');
  };

  const gerar = async (previa: boolean) => {
    if (!empresaId) return;
    setGerando(true); setResultado(null);
    const r = await gerarAfdAction({ empresaId, inicio, fim, previa }, accessToken);
    setGerando(false);
    if (!r.ok || !r.info) { toast(r.erro || 'Erro ao gerar o AFD.', 'error'); return; }
    setResultado(r.info);
    baixar(r.info.nomeTxt, r.info.txtBase64, 'text/plain');
    if (r.info.nomeP7s && r.info.p7sBase64) setTimeout(() => baixar(r.info!.nomeP7s!, r.info!.p7sBase64!, 'application/pkcs7-signature'), 400);
  };

  const p = dados?.parametros;
  const campo = 'w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold outline-none focus:border-[#336699] bg-[#F8FAFC]';
  const rotulo = 'block text-[10px] font-black text-[#64748B] uppercase tracking-wider mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[92vh] overflow-y-auto border border-[#E2E8F0]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-[#E2E8F0]">
          <div>
            <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">📄 AFD — Portaria 671</h3>
            <p className="text-[11px] text-[#64748B]">Arquivo Fonte de Dados do ponto via WhatsApp (REP-P), para a fiscalização.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {erro ? (
          <p className="p-5 text-sm font-bold text-red-600">{erro}</p>
        ) : !dados ? (
          <p className="p-5 text-xs font-bold text-gray-400 uppercase">Carregando...</p>
        ) : (
          <div className="p-5 space-y-5">
            {p?.semSql && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold px-4 py-3 rounded-lg">
                Falta rodar o SQL do AFD (.sql/Pendentes/ponto_afd_portaria_671.sql) antes de gerar.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-3">
                <label className={rotulo}>Empresa (empregador)</label>
                {dados.empresas.length === 0 ? (
                  <p className="text-xs font-bold text-red-600">Nenhuma empresa liberada com CNPJ cadastrado.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {dados.empresas.map(e => (
                      <button key={e.id} onClick={() => { setEmpresaId(e.id); setResultado(null); }}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-black uppercase border-2 transition-all ${corSeloEmpresa(e.id)} ${empresaId === e.id ? 'border-[#0C1D4D] shadow-sm' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                        {e.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className={rotulo}>De</label>
                <input type="date" value={inicio} onChange={e => { setInicio(e.target.value); setResultado(null); }} className={campo} />
              </div>
              <div>
                <label className={rotulo}>Até</label>
                <input type="date" value={fim} min={inicio} onChange={e => { setFim(e.target.value); setResultado(null); }} className={campo} />
              </div>
              <div className="flex items-end">
                <button onClick={() => gerar(false)} disabled={gerando || !empresaId || !!p?.semSql}
                  className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-40 text-white font-black uppercase tracking-widest text-xs py-3 rounded-lg transition-colors">
                  {gerando ? 'Gerando...' : '⬇ Gerar AFD'}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 -mt-2">
              <p className="text-[11px] text-gray-400 flex-1 min-w-[200px]">O primeiro AFD oficial congela as marcações (não mudam mais). Para a contabilidade conferir antes, use a prévia.</p>
              <button onClick={() => gerar(true)} disabled={gerando || !empresaId}
                className="text-[11px] font-black uppercase tracking-wider text-[#336699] border border-[#336699] hover:bg-[#F0F4F8] disabled:opacity-40 px-3 py-2 rounded-lg">
                👁 Prévia (não congela)
              </button>
            </div>

            {empresa && (
              <div className={`text-xs px-4 py-3 rounded-lg border ${empresa.certificado ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {empresa.certificado ? (
                  <><b>🔏 Assinatura (.p7s):</b> e-CNPJ {empresa.certificado.titular.split(':')[0]}, válido até {dataBR(empresa.certificado.validoAte)}.</>
                ) : (
                  <><b>Sem certificado digital desta empresa</b> (CNPJ {formatarDoc(empresa.cnpj)}). O AFD sai sem o .p7s.</>
                )}
              </div>
            )}

            {resultado && (
              <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4 space-y-2">
                <p className="text-xs font-black text-[#0C1D4D] uppercase">✅ AFD gerado</p>
                <p className="text-xs text-[#334155]">
                  {resultado.marcacoes} marcação(ões) de {resultado.funcionarios} funcionário(s)
                  {resultado.primeiroNsr !== null && <> · NSR {resultado.primeiroNsr} a {resultado.ultimoNsr}</>}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => baixar(resultado.nomeTxt, resultado.txtBase64, 'text/plain')} className="text-[11px] font-black text-[#336699] underline">{resultado.nomeTxt}</button>
                  {resultado.nomeP7s && resultado.p7sBase64 && (
                    <button onClick={() => baixar(resultado.nomeP7s!, resultado.p7sBase64!, 'application/pkcs7-signature')} className="text-[11px] font-black text-[#336699] underline">{resultado.nomeP7s}</button>
                  )}
                </div>
                {resultado.avisos.map(a => <p key={a} className="text-[11px] font-bold text-amber-700">⚠ {a}</p>)}
              </div>
            )}

            <div className="border-t border-[#E2E8F0] pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black text-[#64748B] uppercase tracking-wider">Dados do REP-P</p>
                {!editando && <button onClick={() => setEditando(true)} disabled={!!p?.semSql} className="text-[11px] font-black text-[#336699] disabled:opacity-40">Editar</button>}
              </div>
              {editando ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={rotulo}>Nº de registro no INPI</label>
                    <input value={form.inpiRegistro} inputMode="numeric" maxLength={17} placeholder="Ainda não registrado"
                      onChange={e => setForm(f => ({ ...f, inpiRegistro: e.target.value.replace(/\D/g, '') }))} className={campo} />
                  </div>
                  <div>
                    <label className={rotulo}>CNPJ/CPF do desenvolvedor</label>
                    <input value={form.desenvolvedorDocumento} inputMode="numeric" maxLength={14} placeholder="Vazio = CNPJ da empresa"
                      onChange={e => setForm(f => ({ ...f, desenvolvedorDocumento: e.target.value.replace(/\D/g, '') }))} className={campo} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={rotulo}>Coletor da marcação</label>
                    <select value={form.coletor} onChange={e => setForm(f => ({ ...f, coletor: e.target.value }))} className={campo}>
                      {Object.entries(dados.coletores).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">Vale para as marcações que ainda não entraram em nenhum AFD; as já geradas ficam como estão.</p>
                  </div>
                  <div className="sm:col-span-2 flex gap-2">
                    <button onClick={() => setEditando(false)} className="flex-1 text-[#64748B] font-bold text-xs py-2.5 rounded-lg border border-[#E2E8F0]">Cancelar</button>
                    <button onClick={salvar} disabled={salvando} className="flex-1 bg-[#336699] hover:bg-[#284B8C] disabled:opacity-40 text-white font-black uppercase text-xs py-2.5 rounded-lg">{salvando ? 'Salvando...' : 'Salvar'}</button>
                  </div>
                </div>
              ) : (
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-[10px] text-gray-400 font-bold uppercase">INPI</dt><dd className={`font-bold ${p?.inpiRegistro ? 'text-[#0C1D4D]' : 'text-amber-700'}`}>{p?.inpiRegistro || 'Ainda não registrado'}</dd></div>
                  <div><dt className="text-[10px] text-gray-400 font-bold uppercase">Desenvolvedor</dt><dd className="font-bold text-[#0C1D4D]">{p?.desenvolvedorDocumento ? formatarDoc(p.desenvolvedorDocumento) : 'CNPJ da empresa'}</dd></div>
                  <div><dt className="text-[10px] text-gray-400 font-bold uppercase">Coletor</dt><dd className="font-bold text-[#0C1D4D]">{p?.coletor} — {dados.coletores[p?.coletor || '01']}</dd></div>
                </dl>
              )}
            </div>

            <p className="text-[11px] text-gray-400 leading-relaxed">
              O AFD traz só as marcações originais do WhatsApp, na ordem do NSR, com o hash SHA-256 encadeado.
              Ajustes, abonos e dias descartados não entram (são tratamento, não marcação). Cada marcação é
              congelada na primeira vez que entra num AFD: o mesmo período gera sempre as mesmas linhas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
