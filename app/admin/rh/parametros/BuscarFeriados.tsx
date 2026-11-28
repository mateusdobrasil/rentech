"use client";

// Botão "Buscar feriados do ano" da aba Feriados (RH → Parâmetros), 2026-11-28.
// Nacionais pela BrasilAPI; estaduais e municipais (cidades das empresas) pela
// IA com pesquisa na web, se marcado. Mostra uma prévia — o que já existe vem
// marcado como cadastrado — e grava só as linhas escolhidas.
import { useEffect, useMemo, useState } from 'react';
import { buscarFeriadosAnoAction, importarFeriadosAction, type LinhaFeriadoSugerido } from '../actions/actions-feriados-busca';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { useToast } from '../../../components/ui/NotificationProvider';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const diaSemana = (iso: string) => DIAS[new Date(iso + 'T12:00:00').getDay()];
const dataBR = (iso: string) => iso.split('-').reverse().join('/');
const ESFERA: Record<LinhaFeriadoSugerido['esfera'], string> = {
  NACIONAL: 'bg-blue-100 text-blue-800 border-blue-300',
  ESTADUAL: 'bg-violet-100 text-violet-800 border-violet-300',
  MUNICIPAL: 'bg-amber-100 text-amber-800 border-amber-300',
};
// nasce marcado: o que é novo, cai em dia útil, (se veio da IA) tem confiança alta
// ou média e não repete uma data que já está na lista como nacional
const marcarPorPadrao = (l: LinhaFeriadoSugerido, datasNacionais: Set<string>) =>
  l.situacao === 'NOVO' && new Date(l.data + 'T12:00:00').getDay() !== 0 && l.confianca !== 'BAIXA' &&
  !(l.esfera !== 'NACIONAL' && datasNacionais.has(l.data));
const datasNacionaisDe = (linhas: LinhaFeriadoSugerido[]) => new Set(linhas.filter(l => l.esfera === 'NACIONAL').map(l => l.data));

export default function BuscarFeriados({ accessToken, nomeEmpresa, onImportado }: {
  accessToken: string;
  nomeEmpresa: (id: number | null) => string;
  onImportado: () => void;
}) {
  const toast = useToast();
  const anoPadrao = (() => { const h = new Date(); return h.getMonth() >= 10 ? h.getFullYear() + 1 : h.getFullYear(); })();
  const [mostrar, setMostrar] = useState(false);
  const [ano, setAno] = useState(anoPadrao);
  const [incluirLocais, setIncluirLocais] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [resultado, setResultado] = useState<{ ano: number; linhas: LinhaFeriadoSugerido[]; avisos: string[]; ia: { buscas: number } | null } | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!mostrar) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !buscando && !gravando) setMostrar(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [mostrar, buscando, gravando]);

  const buscar = async () => {
    setBuscando(true);
    setResultado(null);
    try {
      const r = await buscarFeriadosAnoAction({ ano, incluirLocais }, accessToken);
      if (!r.ok) { toast(r.erro || 'Não foi possível buscar os feriados.', 'error'); return; }
      setResultado(r.info);
      const ls = r.info.linhas as LinhaFeriadoSugerido[];
      const nac = datasNacionaisDe(ls);
      setMarcadas(new Set(ls.filter(l => marcarPorPadrao(l, nac)).map(l => l.chave)));
    } catch (e: any) {
      toast('Falha na busca: ' + e.message, 'error');
    } finally {
      setBuscando(false);
    }
  };

  const gravar = async () => {
    if (!resultado) return;
    const itens = resultado.linhas.filter(l => marcadas.has(l.chave) && l.situacao !== 'JA_CADASTRADO')
      .map(l => ({ data: l.data, descricao: l.descricao, empresa_id: l.empresa_id }));
    if (itens.length === 0) return;
    setGravando(true);
    try {
      const r = await importarFeriadosAction({ itens }, accessToken);
      if (!r.ok) { toast(r.erro || 'Não foi possível cadastrar.', 'error'); return; }
      const { gravados, jaExistiam, erros } = r.info as { gravados: number; jaExistiam: number; erros: string[] };
      toast(`${gravados} feriado(s) cadastrado(s)${jaExistiam ? `, ${jaExistiam} já existia(m)` : ''}${erros.length ? `. ${erros.length} com erro: ${erros.slice(0, 2).join('; ')}` : '.'}`, erros.length ? 'error' : 'success');
      onImportado();
      setMostrar(false);
      setResultado(null);
    } finally {
      setGravando(false);
    }
  };

  const linhas = resultado?.linhas || [];
  const qtdMarcadas = useMemo(() => linhas.filter(l => marcadas.has(l.chave) && l.situacao !== 'JA_CADASTRADO').length, [linhas, marcadas]);
  const contagem = useMemo(() => ({
    novos: linhas.filter(l => l.situacao === 'NOVO').length,
    cadastrados: linhas.filter(l => l.situacao !== 'NOVO').length,
  }), [linhas]);
  const datasNacionais = useMemo(() => datasNacionaisDe(linhas), [linhas]);
  const alternar = (chave: string) => setMarcadas(s => { const n = new Set(s); n.has(chave) ? n.delete(chave) : n.add(chave); return n; });

  return (
    <>
      <button onClick={() => setMostrar(true)} className="w-full sm:w-auto mb-4 bg-white border-2 border-amber-500 text-amber-700 hover:bg-amber-50 font-black text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-colors">
        🔎 Buscar feriados do ano
      </button>

      {mostrar && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 overflow-y-auto overscroll-contain text-[#0A2A4A]" onClick={() => !buscando && !gravando && setMostrar(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-5 py-4 border-b border-[#F1F5F9]">
              <h3 className="font-black text-[#0C1D4D] uppercase tracking-wide text-sm">🔎 Buscar feriados do ano</h3>
              <button onClick={() => !buscando && !gravando && setMostrar(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1">Ano</label>
                  <select value={ano} onChange={e => { setAno(Number(e.target.value)); setResultado(null); }} disabled={buscando} className="p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-white">
                    {[anoPadrao - 1, anoPadrao, anoPadrao + 1].map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <label className="flex items-start gap-2 text-sm cursor-pointer max-w-md">
                  <input type="checkbox" checked={incluirLocais} onChange={e => { setIncluirLocais(e.target.checked); setResultado(null); }} disabled={buscando} className="mt-1" />
                  <span><strong>Incluir estaduais e municipais</strong> (cidade de cada empresa) — pesquisa feita pelo nosso agente de IA na internet, leva 1 a 2 minutos.</span>
                </label>
                <button onClick={buscar} disabled={buscando} className="ml-auto bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-wider px-6 py-3 rounded-xl disabled:opacity-50">
                  {buscando ? 'Buscando…' : 'Buscar'}
                </button>
              </div>
              <p className="text-[11px] text-gray-500">Nacionais: BrasilAPI (oficial). Nada é gravado até você conferir e clicar em Cadastrar.</p>

              {buscando && (
                <div className="border-2 border-dashed border-amber-200 rounded-2xl p-10 text-center text-sm font-bold text-amber-700">
                  {incluirLocais ? 'Buscando os nacionais e pesquisando as leis estaduais e municipais… isso leva 1 a 2 minutos.' : 'Buscando os feriados nacionais…'}
                </div>
              )}

              {resultado && !buscando && (<>
                {resultado.avisos.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 space-y-1">
                    {resultado.avisos.map((a, i) => <p key={i}>⚠ {a}</p>)}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-gray-600">
                    {linhas.length} feriado(s) em {resultado.ano}: {contagem.novos} novo(s), {contagem.cadastrados} já cadastrado(s){resultado.ia ? ` • IA fez ${resultado.ia.buscas} busca(s) na web` : ''}
                  </p>
                  <div className="flex gap-3 text-[10px] font-black uppercase tracking-wider">
                    <button onClick={() => setMarcadas(new Set(linhas.filter(l => l.situacao === 'NOVO').map(l => l.chave)))} className="text-[#336699] hover:underline">Marcar novos</button>
                    <button onClick={() => setMarcadas(new Set())} className="text-gray-500 hover:underline">Desmarcar</button>
                  </div>
                </div>

                <div className="border border-[#E2E8F0] rounded-xl overflow-hidden divide-y divide-[#F1F5F9]">
                  {linhas.length === 0 && <p className="p-8 text-center text-xs font-bold text-gray-400 uppercase">Nada encontrado.</p>}
                  {linhas.map(l => {
                    const cadastrado = l.situacao === 'JA_CADASTRADO';
                    const domingo = new Date(l.data + 'T12:00:00').getDay() === 0;
                    return (
                      <label key={l.chave} className={`flex items-start gap-3 p-3 ${cadastrado ? 'bg-gray-50 opacity-70' : 'cursor-pointer hover:bg-amber-50/40'}`}>
                        <input type="checkbox" className="mt-1" disabled={cadastrado} checked={!cadastrado && marcadas.has(l.chave)} onChange={() => alternar(l.chave)} />
                        <div className="w-24 flex-shrink-0">
                          <strong className="block text-sm text-[#0C1D4D]">{dataBR(l.data)}</strong>
                          <span className={`text-[10px] font-bold ${domingo ? 'text-gray-400' : 'text-gray-500'}`}>{diaSemana(l.data)}</span>
                        </div>
                        <div className="min-w-0 flex-grow">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <strong className="text-sm text-[#0C1D4D]">{l.descricao}</strong>
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase ${ESFERA[l.esfera]}`}>{l.esfera === 'NACIONAL' ? 'Nacional' : l.esfera === 'ESTADUAL' ? `Estadual ${l.local}` : `Municipal ${l.local}`}</span>
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${l.empresa_id === null ? 'bg-gray-100 text-gray-600' : corSeloEmpresa(l.empresa_id)}`}>{l.empresa_id === null ? 'Todas as empresas' : nomeEmpresa(l.empresa_id)}</span>
                            {l.esfera !== 'NACIONAL' && l.confianca && (
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${l.confianca === 'ALTA' ? 'bg-green-100 text-green-700' : l.confianca === 'MEDIA' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-700'}`}>Confiança {l.confianca.toLowerCase()}</span>
                            )}
                            {cadastrado && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-green-100 text-green-700 uppercase">✓ Já cadastrado{l.cadastradoComo ? `: ${l.cadastradoComo}` : ''}</span>}
                            {l.esfera !== 'NACIONAL' && datasNacionais.has(l.data) && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 uppercase">Mesma data do nacional</span>}
                            {l.situacao === 'COBERTO_POR_TODAS' && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 uppercase">Já existe para todas{l.cadastradoComo ? `: ${l.cadastradoComo}` : ''}</span>}
                          </div>
                          {(l.base_legal || l.observacao || (l.fonte_url && l.esfera !== 'NACIONAL')) && (
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              {l.base_legal && <>{l.base_legal}</>}
                              {l.observacao && <>{l.base_legal ? ' • ' : ''}{l.observacao}</>}
                              {l.fonte_url && l.esfera !== 'NACIONAL' && /^https?:\/\//.test(l.fonte_url) && (
                                <> • <a href={l.fonte_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[#336699] underline">fonte</a></>
                              )}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-500">Nascem desmarcados: o que já está cadastrado, o que cai no domingo, o municipal que repete uma data nacional da lista e o que a IA não conseguiu confirmar (confiança baixa). Confira a fonte antes de cadastrar um municipal.</p>
              </>)}
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 px-5 py-4 border-t border-[#F1F5F9]">
              <button onClick={() => setMostrar(false)} disabled={buscando || gravando} className="px-5 py-2.5 rounded-xl border border-[#CBD5E1] text-xs font-black uppercase tracking-wider text-gray-600 hover:bg-gray-50 disabled:opacity-50">Fechar</button>
              <button onClick={gravar} disabled={!resultado || gravando || buscando || qtdMarcadas === 0} className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-wider shadow-md disabled:opacity-50">
                {gravando ? 'Cadastrando…' : `Cadastrar ${qtdMarcadas} feriado(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
