"use client";

// /admin/operacional/multas/controle — escolhe quais veículos aparecem na
// tela de Multas e Débitos para a equipe. Veículo "restrito" (ex.: carros
// alugados da diretoria) continua sendo controlado normalmente, mas só quem
// tem acesso a ESTA rota enxerga ele, as multas e os pedágios dele — regra
// aplicada no servidor (app/admin/operacional/actions/actions-multas.ts) e
// nos avisos automáticos.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../../components/hooks/usePageAccess';
import { HubErro } from '../../../../components/ui/HubStates';
import { useToast, useConfirm } from '../../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../../lib/coresEmpresa';
import { formatarMoeda } from '../../../../lib/formatadores';
import {
  listarVeiculosControleMultasAction, salvarVisibilidadeMultasAction, type VeiculoControleMultas,
} from '../../actions/actions-multas';

export default function ControleMultasPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [veiculos, setVeiculos] = useState<VeiculoControleMultas[]>([]);
  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const carregar = useCallback(async () => {
    if (!accessToken) return;
    const res = await listarVeiculosControleMultasAction(accessToken);
    if (!res.ok) { setErroCarga(res.erro || 'Falha ao carregar.'); setCarregando(false); return; }
    setErroCarga(null);
    setVeiculos(res.info.veiculos);
    setEmpresas(res.info.empresas);
    setCarregando(false);
  }, [accessToken]);

  useEffect(() => {
    if (authLoading || acessoNegado || !accessToken) return;
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return veiculos
      .filter(v => mostrarInativos || v.status !== 'INATIVO')
      .filter(v => !termo || `${v.apelido} ${v.placa || ''}`.toLowerCase().includes(termo));
  }, [veiculos, busca, mostrarInativos]);

  const restritos = veiculos.filter(v => !v.exibir_em_multas && v.status !== 'INATIVO');

  const alternar = async (v: VeiculoControleMultas) => {
    const exibir = !v.exibir_em_multas;
    if (!exibir) {
      const ok = await confirm({
        title: 'Restringir veículo',
        message: `${v.apelido} (${v.placa || 's/ placa'}) deixa de aparecer na tela de Multas para a equipe — multas, pedágios e avisos automáticos dele só ficam visíveis para quem acessa esta página de controle.${v.multas_abertas ? ` Ele tem ${v.multas_abertas} multa(s) em aberto.` : ''}`,
        confirmLabel: 'Restringir',
      });
      if (!ok) return;
    }
    setSalvandoId(v.id);
    const res = await salvarVisibilidadeMultasAction({ veiculoId: v.id, exibir }, accessToken);
    setSalvandoId(null);
    if (!res.ok) { toast(res.erro || 'Falha ao salvar.', 'error'); return; }
    setVeiculos(lst => lst.map(x => x.id === v.id ? { ...x, exibir_em_multas: exibir } : x));
    toast(exibir ? `${v.apelido} liberado para a equipe.` : `${v.apelido} agora é restrito.`, 'success');
  };

  const empresaNome = (id: number | null) => (id === null ? 'Todas' : empresas.find(e => e.id === id)?.nome || `Empresa ${id}`);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#0C1D4D] border-t-[#336699] rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm">Verificando acesso...</h2>
        </div>
      </div>
    );
  }
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o controle de Multas.</p>
          <button onClick={() => router.push('/admin/operacional/multas')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar para Multas
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] pt-4 pb-16">
      <Analytics />

      <div className="bg-rose-50 border-b border-rose-200 px-4 md:px-8 py-4 flex justify-between items-center gap-3 shadow-sm">
        <p className="text-rose-800 font-medium text-sm">
          ⚙️ <strong>Controle de Multas</strong>. Escolha quais veículos a equipe enxerga na tela de Multas e Débitos.
        </p>
        <button onClick={() => router.push('/admin/operacional/multas')} className="shrink-0 text-[10px] md:text-xs font-black bg-white hover:bg-rose-50 border border-rose-200 text-rose-800 px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR ÀS MULTAS
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-8 mt-6 space-y-4">
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 text-xs text-gray-600 space-y-1">
          <p><strong className="text-[#0C1D4D]">👁️ Visível:</strong> o veículo, as multas e os pedágios dele aparecem para todos que acessam Multas e Débitos.</p>
          <p><strong className="text-[#0C1D4D]">🔒 Restrito:</strong> só quem tem acesso a esta página de controle enxerga — use para os carros da diretoria. Também fica de fora dos avisos automáticos de WhatsApp/push para a equipe.</p>
          <p className="text-gray-400">Quem pode abrir esta página é definido em Parâmetros → Permissões (rota <code className="font-mono">/admin/operacional/multas/controle</code>).</p>
        </div>

        {erroCarga && (
          <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl p-3 text-xs font-medium flex justify-between items-center gap-3">
            <span>❌ {erroCarga}</span>
            <button onClick={() => { setCarregando(true); carregar(); }} className="font-black uppercase text-[10px] underline">Tentar de novo</button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar veículo ou placa..." className="flex-1 min-w-[200px] p-2 border border-[#E2E8F0] rounded-lg text-xs bg-white" />
          <label className="flex items-center gap-2 text-[10px] font-black uppercase text-gray-500 cursor-pointer">
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} /> Mostrar inativos
          </label>
          <span className="text-[10px] font-black uppercase text-gray-500">{restritos.length} restrito(s)</span>
        </div>

        {carregando ? (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-sm text-gray-400">Carregando...</div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto">
            <table className="w-full text-xs min-w-[720px]">
              <thead>
                <tr className="bg-[#F8FAFC] text-[10px] uppercase tracking-wider text-gray-500 text-left">
                  <th className="p-3">Veículo</th><th className="p-3">Empresa</th><th className="p-3">Propriedade</th>
                  <th className="p-3 text-right">Em aberto</th><th className="p-3">Na tela de Multas</th>
                </tr>
              </thead>
              <tbody>
                {lista.map(v => (
                  <tr key={v.id} className={`border-t border-[#F1F5F9] ${v.exibir_em_multas ? '' : 'bg-amber-50/40'}`}>
                    <td className="p-3">
                      <div className="font-black text-[#0C1D4D] uppercase">{v.apelido}</div>
                      <div className="text-[10px] font-mono text-gray-400">{v.placa || 'sem placa'}{v.status === 'INATIVO' ? ' · inativo' : ''}{v.exibir_na_frota === false ? ' · fora da Frota' : ''}</div>
                    </td>
                    <td className="p-3"><span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${corSeloEmpresa(v.empresa_id)}`}>{v.empresa_id === null ? '🌐 Todas' : empresaNome(v.empresa_id)}</span></td>
                    <td className="p-3">
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${v.propriedade === 'ALUGADO' ? 'bg-indigo-100 text-indigo-700 border-indigo-300' : 'bg-slate-100 text-slate-600 border-slate-300'}`}>{v.propriedade || '—'}</span>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {v.multas_abertas ? <span className="font-black">{v.multas_abertas} · {formatarMoeda(v.valor_aberto)}</span> : <span className="text-gray-300">—</span>}
                      {v.pedagios_abertos ? <div className="text-[10px] text-orange-600 font-bold">{v.pedagios_abertos} pedágio(s)</div> : null}
                    </td>
                    <td className="p-3">
                      <button onClick={() => alternar(v)} disabled={salvandoId === v.id}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border transition-colors disabled:opacity-50 ${v.exibir_em_multas ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100' : 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'}`}>
                        {salvandoId === v.id ? 'Salvando...' : v.exibir_em_multas ? '👁️ Visível para a equipe' : '🔒 Restrito'}
                      </button>
                    </td>
                  </tr>
                ))}
                {lista.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-gray-400">Nenhum veículo.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
