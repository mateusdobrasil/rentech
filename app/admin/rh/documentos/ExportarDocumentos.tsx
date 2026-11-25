"use client";

// Botão "Exportar Excel" da aba Funcionários de /admin/rh/documentos — mesma
// estrutura do Exportar da Ficha do Funcionário: uma janela com caixas para
// escolher as categorias de documento, as situações de validade e as abas da
// planilha. Entram os funcionários da lista (busca e filtros atuais). Dados por
// exportarDocumentosAction (servidor). A escolha fica lembrada neste navegador.
import { useEffect, useState } from 'react';
import { exportarDocumentosAction } from '../actions/actions-exportar-documentos';
import { formatarDataBR } from '../../../lib/formatadores';
import { useToast } from '../../../components/ui/NotificationProvider';

type Situacao = 'VENCIDO' | 'VENCENDO' | 'OK' | 'SEM';
interface CategoriaDoc { id: number; nome: string; exige_validade: boolean }

const CHAVE_LEMBRAR = 'rentech_exportar_documentos';
const SITUACOES: { valor: Situacao; rotulo: string }[] = [
  { valor: 'VENCIDO', rotulo: 'Vencido' },
  { valor: 'VENCENDO', rotulo: 'Vencendo (até 30 dias)' },
  { valor: 'OK', rotulo: 'Em dia' },
  { valor: 'SEM', rotulo: 'Sem validade' },
];
const ROTULO_SITUACAO: Record<Situacao, string> = { VENCIDO: 'Vencido', VENCENDO: 'Vencendo', OK: 'Em dia', SEM: 'Sem validade' };
const textoDias = (s: Situacao, dias: number | null) =>
  dias == null ? '' : s === 'VENCIDO' ? `vencido há ${-dias} dia(s)` : dias === 0 ? 'vence hoje' : `vence em ${dias} dia(s)`;

export default function ExportarDocumentos({ accessToken, nomesLista, categorias }: {
  accessToken: string;
  nomesLista: string[];          // os funcionários da lista, com a busca e os filtros atuais
  categorias: CategoriaDoc[];
}) {
  const toast = useToast();
  const [mostrar, setMostrar] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set());
  const [situacoes, setSituacoes] = useState<Set<Situacao>>(new Set(SITUACOES.map(s => s.valor)));
  const [soVigente, setSoVigente] = useState(true);
  const [quadro, setQuadro] = useState(true);
  const [daEmpresa, setDaEmpresa] = useState(false);
  const [gerando, setGerando] = useState(false);

  // padrão: todas as categorias; depois, a última escolha deste navegador
  useEffect(() => {
    if (categorias.length === 0) return;
    let lembrado: any = null;
    try { lembrado = JSON.parse(localStorage.getItem(CHAVE_LEMBRAR) || 'null'); } catch { /* sem storage */ }
    const ids = new Set(categorias.map(c => c.id));
    setMarcadas(new Set(lembrado?.categorias ? (lembrado.categorias as number[]).filter(id => ids.has(id)) : categorias.map(c => c.id)));
    if (lembrado) {
      if (Array.isArray(lembrado.situacoes)) setSituacoes(new Set(lembrado.situacoes));
      setSoVigente(lembrado.soVigente !== false);
      setQuadro(lembrado.quadro !== false);
      setDaEmpresa(!!lembrado.daEmpresa);
    }
  }, [categorias]);

  useEffect(() => {
    if (!mostrar) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !gerando) setMostrar(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [mostrar, gerando]);

  const alternarCat = (id: number) => setMarcadas(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const alternarSit = (v: Situacao) => setSituacoes(s => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });

  const gerar = async () => {
    setGerando(true);
    try {
      const cats = categorias.filter(c => marcadas.has(c.id)).map(c => c.id);
      const r = await exportarDocumentosAction({ nomes: nomesLista, categorias: cats, empresa: daEmpresa }, accessToken);
      if (!r.ok) { toast(r.erro || 'Não foi possível exportar.', 'error'); return; }
      const { funcionarios, categorias: catsInfo, documentos, documentosEmpresa } = r.info as {
        funcionarios: { id: string; nome: string; cargo: string; empresa: string }[];
        categorias: { id: number; nome: string; exigeValidade: boolean }[];
        documentos: any[]; documentosEmpresa: any[];
      };

      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const larguras = (dados: Record<string, any>[]) => Object.keys(dados[0] || {}).map(k => ({ wch: Math.min(45, Math.max(k.length + 2, ...dados.map(d => String(d[k] ?? '').length + 1))) }));
      const aba = (dados: Record<string, any>[], nome: string, vazio: string) => {
        const linhas = dados.length ? dados : [{ [Object.keys(dados[0] || { Aviso: '' })[0] || 'Aviso']: vazio }];
        const ws = XLSX.utils.json_to_sheet(linhas);
        ws['!cols'] = larguras(linhas);
        XLSX.utils.book_append_sheet(wb, ws, nome);
      };

      // 1) Documentos — uma linha por documento
      const docs = documentos
        .filter(d => (!soVigente || d.vigente) && situacoes.has(d.situacao))
        .map(d => ({
          'Funcionário': d.funcionario,
          'Empresa': d.empresa,
          'Cargo': d.cargo,
          'Categoria': d.categoria,
          'Título': d.titulo,
          'Validade': formatarDataBR(d.validade, ''),
          'Situação': ROTULO_SITUACAO[d.situacao as Situacao],
          'Prazo': textoDias(d.situacao, d.dias),
          ...(soVigente ? {} : { 'Versão': d.vigente ? 'Atual' : 'Histórico' }),
          'Enviado em': formatarDataBR(d.enviadoEm, ''),
          'Visível no Portal': d.visivelPortal ? 'Sim' : 'Não',
          'Arquivo': d.arquivo,
          'Observação': d.observacao,
        }));
      aba(docs, 'Documentos', 'Nenhum documento com essas escolhas');

      // 2) Quadro de validades — funcionário × categoria (documento atual)
      if (quadro) {
        // por funcionário + categoria: o documento atual (com validade) ou quantos foram entregues (sem validade)
        const atual = new Map<string, any>();
        const entregues = new Map<string, number>();
        documentos.filter(d => d.vigente).forEach(d => {
          const k = `${d.fichaId}|${d.categoriaId}`;
          atual.set(k, d);
          entregues.set(k, (entregues.get(k) || 0) + 1);
        });
        const linhas = funcionarios.map(f => {
          const linha: Record<string, string> = { 'Funcionário': f.nome, 'Empresa': f.empresa, 'Cargo': f.cargo };
          let vencidos = 0, vencendo = 0, faltam = 0, semData = 0;
          catsInfo.forEach(c => {
            const d = atual.get(`${f.id}|${c.id}`);
            if (!d) { linha[c.nome] = 'FALTA'; faltam++; return; }
            if (d.situacao === 'SEM' && c.exigeValidade) { linha[c.nome] = 'SEM DATA'; semData++; return; }
            if (d.situacao === 'SEM') { const n = entregues.get(`${f.id}|${c.id}`) || 1; linha[c.nome] = n > 1 ? `Entregue (${n})` : 'Entregue'; return; }
            const data = formatarDataBR(d.validade, '');
            if (d.situacao === 'VENCIDO') { linha[c.nome] = `VENCIDO ${data}`; vencidos++; }
            else if (d.situacao === 'VENCENDO') { linha[c.nome] = `VENCE ${data}`; vencendo++; }
            else linha[c.nome] = data;
          });
          linha['Vencidos'] = String(vencidos);
          linha['Vencendo'] = String(vencendo);
          linha['Sem documento'] = String(faltam);
          linha['Validade em branco'] = String(semData);
          return linha;
        });
        aba(linhas, 'Quadro de validades', 'Nenhum funcionário na lista');
      }

      // 3) Documentos da empresa
      if (daEmpresa) {
        const emp = documentosEmpresa.filter(d => situacoes.has(d.situacao)).map(d => ({
          'Empresa': d.empresa, 'Categoria': d.categoria, 'Título': d.titulo,
          'Validade': formatarDataBR(d.validade, ''), 'Situação': ROTULO_SITUACAO[d.situacao as Situacao], 'Prazo': textoDias(d.situacao, d.dias),
          'Enviado em': formatarDataBR(d.enviadoEm, ''), 'Arquivo': d.arquivo, 'Observação': d.observacao,
        }));
        aba(emp, 'Documentos da empresa', 'Nenhum documento da empresa com essas escolhas');
      }

      const hoje = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no horário local
      XLSX.writeFile(wb, `documentos-validades-${hoje}.xlsx`);
      try { localStorage.setItem(CHAVE_LEMBRAR, JSON.stringify({ categorias: cats, situacoes: [...situacoes], soVigente, quadro, daEmpresa })); } catch { /* sem storage */ }
      toast(`Excel gerado: ${docs.length} documento(s) de ${funcionarios.length} funcionário(s).`, 'success');
      setMostrar(false);
    } catch (e: any) {
      toast('Não foi possível gerar o Excel: ' + e.message, 'error');
    } finally {
      setGerando(false);
    }
  };

  const podeGerar = nomesLista.length > 0 && marcadas.size > 0 && situacoes.size > 0;

  return (
    <>
      <button onClick={() => setMostrar(true)} className="text-[10px] font-black bg-[#16A34A] hover:bg-[#15803D] text-white px-4 py-2.5 rounded-lg uppercase tracking-wider transition-colors">
        📗 Exportar Excel
      </button>

      {mostrar && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 overflow-y-auto overscroll-contain text-[#0A2A4A]" onClick={() => !gerando && setMostrar(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-5 py-4 border-b border-[#F1F5F9]">
              <h3 className="font-black text-[#0C1D4D] uppercase tracking-wide text-sm">📗 Exportar documentos e validades</h3>
              <button onClick={() => !gerando && setMostrar(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
            </div>

            <div className="p-5 space-y-5">
              <p className="text-sm text-[#334155]">
                Entram os <strong>{nomesLista.length} funcionário(s) da lista</strong>, com a busca e os filtros atuais. Para um funcionário só, busque o nome antes de exportar.
              </p>

              {/* categorias */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Categorias de documento ({marcadas.size} de {categorias.length})</p>
                  <div className="flex gap-3 text-[10px] font-black uppercase tracking-wider">
                    <button onClick={() => setMarcadas(new Set(categorias.map(c => c.id)))} className="text-[#336699] hover:underline">Todas</button>
                    <button onClick={() => setMarcadas(new Set(categorias.filter(c => c.exige_validade).map(c => c.id)))} className="text-[#336699] hover:underline">Só com validade ⏳</button>
                    <button onClick={() => setMarcadas(new Set())} className="text-gray-500 hover:underline">Limpar</button>
                  </div>
                </div>
                <div className="border border-[#E2E8F0] rounded-xl p-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {categorias.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-xs text-[#334155] cursor-pointer">
                      <input type="checkbox" checked={marcadas.has(c.id)} onChange={() => alternarCat(c.id)} />
                      {c.nome}{c.exige_validade && <span className="text-amber-500">⏳</span>}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* situação */}
                <div className="border border-[#E2E8F0] rounded-xl p-3">
                  <p className="text-[11px] font-black uppercase tracking-wider text-[#0C1D4D] mb-2 pb-2 border-b border-[#F1F5F9]">Situação da validade</p>
                  {SITUACOES.map(s => (
                    <label key={s.valor} className="flex items-center gap-2 text-xs text-[#334155] cursor-pointer mb-1">
                      <input type="checkbox" checked={situacoes.has(s.valor)} onChange={() => alternarSit(s.valor)} /> {s.rotulo}
                    </label>
                  ))}
                  <p className="text-[10px] text-gray-400 mt-1">Vale para as abas de documentos.</p>
                </div>

                {/* versões */}
                <div className="border border-[#E2E8F0] rounded-xl p-3">
                  <p className="text-[11px] font-black uppercase tracking-wider text-[#0C1D4D] mb-2 pb-2 border-b border-[#F1F5F9]">Versões</p>
                  <label className="flex items-start gap-2 text-xs text-[#334155] cursor-pointer mb-1">
                    <input type="radio" name="versoes" checked={soVigente} onChange={() => setSoVigente(true)} className="mt-0.5" /> Só o atual (nas categorias com validade)
                  </label>
                  <label className="flex items-start gap-2 text-xs text-[#334155] cursor-pointer">
                    <input type="radio" name="versoes" checked={!soVigente} onChange={() => setSoVigente(false)} className="mt-0.5" /> Todos, com o histórico (ex.: ASO antigo)
                  </label>
                </div>

                {/* abas */}
                <div className="border border-[#E2E8F0] rounded-xl p-3">
                  <p className="text-[11px] font-black uppercase tracking-wider text-[#0C1D4D] mb-2 pb-2 border-b border-[#F1F5F9]">Abas na planilha</p>
                  <label className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                    <input type="checkbox" checked disabled /> Documentos
                  </label>
                  <label className="flex items-start gap-2 text-xs text-[#334155] cursor-pointer mb-1">
                    <input type="checkbox" checked={quadro} onChange={e => setQuadro(e.target.checked)} className="mt-0.5" /> Quadro de validades (funcionário × categoria, com o que falta)
                  </label>
                  <label className="flex items-start gap-2 text-xs text-[#334155] cursor-pointer">
                    <input type="checkbox" checked={daEmpresa} onChange={e => setDaEmpresa(e.target.checked)} className="mt-0.5" /> Documentos da empresa
                  </label>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 px-5 py-4 border-t border-[#F1F5F9]">
              <button onClick={() => setMostrar(false)} disabled={gerando} className="px-5 py-2.5 rounded-xl border border-[#CBD5E1] text-xs font-black uppercase tracking-wider text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button onClick={gerar} disabled={gerando || !podeGerar} className="px-5 py-2.5 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-xs font-black uppercase tracking-wider shadow-md disabled:opacity-50">
                {gerando ? 'Gerando...' : `Gerar Excel (${nomesLista.length} funcionário${nomesLista.length === 1 ? '' : 's'})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
