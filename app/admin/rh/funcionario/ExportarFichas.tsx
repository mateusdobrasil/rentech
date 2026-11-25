"use client";

// Botão "Exportar Excel" da Ficha do Funcionário (/admin/rh/funcionario):
// abre uma janela com as caixas dos dados da ficha (os mesmos nomes do
// formulário), escolhe quem entra (a lista filtrada ou só o colaborador
// aberto) e gera a planilha. Dados por exportarFichasAction (servidor, só
// colunas do catálogo e só das empresas do usuário). A escolha das caixas fica
// lembrada neste navegador.
import { useEffect, useMemo, useState } from 'react';
import { exportarFichasAction } from '../actions/actions-exportar-fichas';
import { GRUPOS_CAMPOS_FICHA, CAMPOS_FICHA, type CampoFicha } from '../../../lib/camposFichaExport';
import { formatarDataBR } from '../../../lib/formatadores';
import { useToast } from '../../../components/ui/NotificationProvider';

interface FuncLista { id?: string; nome_completo: string; ativo?: boolean }

const CHAVE_LEMBRAR = 'rentech_exportar_ficha_campos';
const LABEL_MOTIVO: Record<string, string> = { ADMISSAO: 'Admissão', DEMISSAO: 'Desligamento', ALTERACAO_CARGO: 'Alteração de cargo' };

const soDigitos = (v: any) => String(v ?? '').replace(/\D/g, '');
function formatar(campo: CampoFicha, valor: any, nomeEmpresa: (id: any) => string): string {
  if (valor === null || valor === undefined || valor === '') return '';
  switch (campo.tipo) {
    case 'data': return formatarDataBR(String(valor), '');
    case 'simnao': return valor ? 'Sim' : 'Não';
    case 'situacao': return valor ? 'Ativo' : 'Inativo';
    case 'empresa': return nomeEmpresa(valor);
    case 'cpf': { const d = soDigitos(valor); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(valor); }
    case 'celular': {
      const d = soDigitos(valor).replace(/^55(?=\d{10,11}$)/, '');
      if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
      if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
      return String(valor);
    }
    default: return String(valor);
  }
}

const camposPadrao = () => new Set(GRUPOS_CAMPOS_FICHA.filter(g => g.padrao).flatMap(g => g.campos.map(c => c.coluna)));

export default function ExportarFichas({ accessToken, listaFiltrada, aberto }: {
  accessToken: string;
  listaFiltrada: FuncLista[];            // a lista da esquerda, com os filtros aplicados
  aberto: FuncLista | null;              // o colaborador aberto na ficha (se houver)
}) {
  const toast = useToast();
  const [mostrar, setMostrar] = useState(false);
  const [quem, setQuem] = useState<'LISTA' | 'ABERTO'>('LISTA');
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(camposPadrao);
  const [dependentes, setDependentes] = useState(false);
  const [movimentacoes, setMovimentacoes] = useState(false);
  const [gerando, setGerando] = useState(false);

  // lembra as caixas da última exportação (só neste navegador)
  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_LEMBRAR) || 'null');
      if (salvo?.campos) setMarcados(new Set((salvo.campos as string[]).filter(c => CAMPOS_FICHA.some(x => x.coluna === c))));
      if (salvo) { setDependentes(!!salvo.dependentes); setMovimentacoes(!!salvo.movimentacoes); }
    } catch { /* sem storage: fica o padrão */ }
  }, []);

  useEffect(() => {
    if (!mostrar) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !gerando) setMostrar(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [mostrar, gerando]);

  const abrir = () => { setQuem(aberto?.id ? (listaFiltrada.length > 1 ? 'LISTA' : 'ABERTO') : 'LISTA'); setMostrar(true); };

  const inativosNaLista = listaFiltrada.filter(f => f.ativo === false).length;
  const alvos = useMemo(() => {
    if (quem === 'ABERTO') return aberto?.id ? [aberto] : [];
    return listaFiltrada.filter(f => f.id && (incluirInativos || f.ativo !== false));
  }, [quem, aberto, listaFiltrada, incluirInativos]);

  const alternar = (coluna: string) => setMarcados(s => { const n = new Set(s); n.has(coluna) ? n.delete(coluna) : n.add(coluna); return n; });
  const alternarGrupo = (colunas: string[], marcar: boolean) => setMarcados(s => { const n = new Set(s); colunas.forEach(c => marcar ? n.add(c) : n.delete(c)); return n; });

  const gerar = async () => {
    if (alvos.length === 0) return;
    setGerando(true);
    try {
      const colunas = CAMPOS_FICHA.filter(c => marcados.has(c.coluna)).map(c => c.coluna);
      const r = await exportarFichasAction({ ids: alvos.map(a => a.id!), colunas, dependentes, movimentacoes }, accessToken);
      if (!r.ok) { toast(r.erro || 'Não foi possível exportar.', 'error'); return; }
      const { fichas, dependentes: deps, movimentacoes: movs, empresas } = r.info as { fichas: any[]; dependentes: any[]; movimentacoes: any[]; empresas: { id: number; nome: string }[] };
      const nomeEmpresa = (id: any) => empresas.find(e => e.id === Number(id))?.nome || (id == null ? '' : `Empresa ${id}`);

      const campos = CAMPOS_FICHA.filter(c => colunas.includes(c.coluna));
      const linhas = fichas.map(f => {
        const linha: Record<string, string> = { 'Nome Completo': f.nome_completo };
        campos.forEach(c => { linha[c.rotulo] = formatar(c, f[c.coluna], nomeEmpresa); });
        return linha;
      });

      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const larguras = (dados: Record<string, any>[]) => Object.keys(dados[0] || {}).map(k => ({ wch: Math.min(50, Math.max(k.length + 2, ...dados.map(d => String(d[k] ?? '').length + 1))) }));
      const ws = XLSX.utils.json_to_sheet(linhas);
      ws['!cols'] = larguras(linhas);
      XLSX.utils.book_append_sheet(wb, ws, 'Colaboradores');

      if (dependentes) {
        const d = deps.map(x => ({
          'Colaborador': x.funcionario, 'Dependente': x.nome_completo || '', 'Tipo': x.tipo_dependente || '',
          'CPF': formatar({ coluna: 'cpf', rotulo: 'CPF', tipo: 'cpf' }, x.cpf, nomeEmpresa), 'Data de Nascimento': formatarDataBR(x.data_nascimento, ''),
        }));
        const wsd = XLSX.utils.json_to_sheet(d.length ? d : [{ 'Colaborador': 'Nenhum dependente cadastrado' }]);
        wsd['!cols'] = larguras(d.length ? d : [{ Colaborador: 'Nenhum dependente cadastrado' }]);
        XLSX.utils.book_append_sheet(wb, wsd, 'Dependentes');
      }
      if (movimentacoes) {
        const m = movs.map(x => ({
          'Colaborador': x.funcionario, 'Data': formatarDataBR(x.data_movimentacao, ''), 'Motivo': LABEL_MOTIVO[x.motivo] || x.motivo || '', 'Cargo': x.cargo || '',
        }));
        const wsm = XLSX.utils.json_to_sheet(m.length ? m : [{ 'Colaborador': 'Nenhuma movimentação cadastrada' }]);
        wsm['!cols'] = larguras(m.length ? m : [{ Colaborador: 'Nenhuma movimentação cadastrada' }]);
        XLSX.utils.book_append_sheet(wb, wsm, 'Movimentações');
      }

      const hoje = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no horário local
      const nomeArquivo = quem === 'ABERTO' && fichas[0]
        ? `ficha-${String(fichas[0].nome_completo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${hoje}.xlsx`
        : `fichas-colaboradores-${hoje}.xlsx`;
      XLSX.writeFile(wb, nomeArquivo);

      try { localStorage.setItem(CHAVE_LEMBRAR, JSON.stringify({ campos: colunas, dependentes, movimentacoes })); } catch { /* sem storage */ }
      toast(`Excel gerado com ${fichas.length} colaborador(es).`, 'success');
      setMostrar(false);
    } catch (e: any) {
      toast('Não foi possível gerar o Excel: ' + e.message, 'error');
    } finally {
      setGerando(false);
    }
  };

  const totalMarcados = CAMPOS_FICHA.filter(c => marcados.has(c.coluna)).length;

  return (
    <>
      <button
        onClick={abrir}
        className="w-full mt-3 bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-[10px] uppercase tracking-wider py-2.5 rounded-lg transition-colors"
      >
        📗 Exportar Excel
      </button>

      {mostrar && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 overflow-y-auto overscroll-contain text-[#0A2A4A]" onClick={() => !gerando && setMostrar(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-5 py-4 border-b border-[#F1F5F9]">
              <h3 className="font-black text-[#0C1D4D] uppercase tracking-wide text-sm">📗 Exportar fichas para Excel</h3>
              <button onClick={() => !gerando && setMostrar(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
            </div>

            <div className="p-5 space-y-5">
              {/* quem entra */}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Quem entra na planilha</p>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="radio" name="quem" checked={quem === 'LISTA'} onChange={() => setQuem('LISTA')} className="mt-1" />
                  <span><strong>Colaboradores da lista</strong> — os {listaFiltrada.length} que aparecem à esquerda, com a busca e os filtros atuais</span>
                </label>
                {quem === 'LISTA' && inativosNaLista > 0 && (
                  <label className="flex items-center gap-2 ml-6 text-xs font-bold text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={incluirInativos} onChange={e => setIncluirInativos(e.target.checked)} />
                    Incluir os {inativosNaLista} inativo(s)
                  </label>
                )}
                <label className={`flex items-start gap-2 text-sm ${aberto?.id ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                  <input type="radio" name="quem" checked={quem === 'ABERTO'} disabled={!aberto?.id} onChange={() => setQuem('ABERTO')} className="mt-1" />
                  <span><strong>Só o colaborador aberto</strong> — {aberto?.id ? aberto.nome_completo : 'abra uma ficha na lista para usar esta opção'}</span>
                </label>
              </div>

              {/* campos */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Dados da ficha ({totalMarcados} de {CAMPOS_FICHA.length} + nome)</p>
                  <div className="flex gap-3 text-[10px] font-black uppercase tracking-wider">
                    <button onClick={() => setMarcados(new Set(CAMPOS_FICHA.map(c => c.coluna)))} className="text-[#336699] hover:underline">Marcar tudo</button>
                    <button onClick={() => setMarcados(camposPadrao())} className="text-[#336699] hover:underline">Padrão</button>
                    <button onClick={() => setMarcados(new Set())} className="text-gray-500 hover:underline">Limpar</button>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 mb-3">O nome completo sempre vai. Salário e benefícios não são da ficha: ficam no Holerite e nos relatórios do RH.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {GRUPOS_CAMPOS_FICHA.map(g => {
                    const cols = g.campos.map(c => c.coluna);
                    const qtd = cols.filter(c => marcados.has(c)).length;
                    return (
                      <div key={g.id} className="border border-[#E2E8F0] rounded-xl p-3">
                        <label className="flex items-center gap-2 cursor-pointer mb-2 pb-2 border-b border-[#F1F5F9]">
                          <input
                            type="checkbox"
                            checked={qtd === cols.length}
                            ref={el => { if (el) el.indeterminate = qtd > 0 && qtd < cols.length; }}
                            onChange={e => alternarGrupo(cols, e.target.checked)}
                          />
                          <span className="text-[11px] font-black uppercase tracking-wider text-[#0C1D4D]">{g.titulo}</span>
                          <span className="ml-auto text-[10px] font-bold text-gray-400">{qtd}/{cols.length}</span>
                        </label>
                        <div className="grid grid-cols-1 gap-1">
                          {g.campos.map(c => (
                            <label key={c.coluna} className="flex items-center gap-2 text-xs text-[#334155] cursor-pointer">
                              <input type="checkbox" checked={marcados.has(c.coluna)} onChange={() => alternar(c.coluna)} />
                              {c.rotulo}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <div className="border border-[#E2E8F0] rounded-xl p-3">
                    <p className="text-[11px] font-black uppercase tracking-wider text-[#0C1D4D] mb-2 pb-2 border-b border-[#F1F5F9]">Abas extras na planilha</p>
                    <label className="flex items-center gap-2 text-xs text-[#334155] cursor-pointer">
                      <input type="checkbox" checked={dependentes} onChange={e => setDependentes(e.target.checked)} /> Dependentes
                    </label>
                    <label className="flex items-center gap-2 text-xs text-[#334155] cursor-pointer mt-1">
                      <input type="checkbox" checked={movimentacoes} onChange={e => setMovimentacoes(e.target.checked)} /> Movimentações (admissão, cargo, desligamento)
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 px-5 py-4 border-t border-[#F1F5F9]">
              <button onClick={() => setMostrar(false)} disabled={gerando} className="px-5 py-2.5 rounded-xl border border-[#CBD5E1] text-xs font-black uppercase tracking-wider text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button onClick={gerar} disabled={gerando || alvos.length === 0} className="px-5 py-2.5 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-xs font-black uppercase tracking-wider shadow-md disabled:opacity-50">
                {gerando ? 'Gerando...' : `Gerar Excel (${alvos.length} colaborador${alvos.length === 1 ? '' : 'es'})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
