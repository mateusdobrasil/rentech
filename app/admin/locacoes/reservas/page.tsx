"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import type { AcessoTela } from '../../../lib/locacao/acessoFichas';
import { listarFichasAction, importarFichasP2sAction, listarSolicitacoesPortalAction, atualizarSolicitacaoPortalAction, converterSolicitacaoPortalAction, type StatusFicha } from './actions';
import Modal from '../../../components/ui/Modal';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { STATUS_FICHA, numeroFicha } from './statusFicha';
import { hojeISO } from '../../../lib/locacao/datas';
import { rotuloStatusP2s } from '../../../lib/locacao/statusP2s';

// Orçamentos e Reservas — lista das Fichas de Reserva próprias (2026-11-16).

interface FichaLista {
  id: number; empresa_id: number; status: StatusFicha; modalidade: string; data_inicio: string; data_fim: string;
  valor_total: number; vendedor_nome: string | null; desconto_pendente?: boolean; validade_orcamento: string | null; updated_at: string;
  cliente: string; evento_nome: string | null; p2s_numero: string | null; p2s_status: string | null; origem: 'SISTEMA' | 'P2S'; motivo_perda: string | null;
}
interface EmpresaOpcao { id: number; nome: string }

// "Todas" é o padrão: a ficha não some da lista quando muda de status (pedido do usuário 2026-11-17).
const GRUPOS: { chave: string; rotulo: string; status: StatusFicha[] }[] = [
  { chave: 'todas', rotulo: 'Todas as fichas', status: ['ORCAMENTO', 'ENVIADO', 'APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA', 'PERDIDO', 'CANCELADA'] },
  { chave: 'abertos', rotulo: 'Orçamentos abertos', status: ['ORCAMENTO', 'ENVIADO', 'APROVADO'] },
  { chave: 'reservadas', rotulo: 'Reservadas', status: ['RESERVADA'] },
  { chave: 'locacao', rotulo: 'Em locação', status: ['EM_LOCACAO'] },
  { chave: 'encerradas', rotulo: 'Finalizadas', status: ['FINALIZADA'] },
  { chave: 'perdidas', rotulo: 'Perdidas / canceladas', status: ['PERDIDO', 'CANCELADA'] },
];


export default function ReservasPage() {
  const router = useRouter();
  const toast = useToast();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [empresas, setEmpresas] = useState<EmpresaOpcao[]>([]);
  const [fichas, setFichas] = useState<FichaLista[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [grupo, setGrupo] = useState('todas');
  const POR_VEZ = 300;
  const [mostrando, setMostrando] = useState(POR_VEZ);
  const [filtroEmpresa, setFiltroEmpresa] = useState<number | null>(null);
  const [busca, setBusca] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [origem, setOrigem] = useState<'' | 'SISTEMA' | 'P2S'>('');
  const [ultimaImportacao, setUltimaImportacao] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [recarregar, setRecarregar] = useState(0);
  const [acesso, setAcesso] = useState<AcessoTela | null>(null);
  const [clientesCarteira, setClientesCarteira] = useState<number | null>(null);
  // pedidos de orçamento vindos do Portal do Cliente (/cliente)
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [modalPedidos, setModalPedidos] = useState(false);
  const [empresaConversao, setEmpresaConversao] = useState<number>(0);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    (async () => {
      setCarregando(true);
      const r = await listarFichasAction(accessToken);
      if (r.ok) {
        setEmpresas(r.info.empresas); setFichas(r.info.fichas); setUltimaImportacao(r.info.ultimaImportacaoP2s || null); setEmpresaConversao(e => e || r.info.empresas[0]?.id || 0);
        setAcesso(r.info.acesso || null); setClientesCarteira(r.info.clientesCarteira ?? null);
      } else toast(r.erro || 'Erro ao carregar.', 'error');
      const rp = await listarSolicitacoesPortalAction(accessToken);
      if (rp.ok) setPedidos(rp.info);
      setCarregando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, recarregar]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Orçamentos e Reservas.</p>
          <button onClick={() => router.push('/admin/locacoes')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">Voltar ao Hub</button>
        </div>
      </div>
    );
  }

  const hoje = hojeISO();
  const daEmpresa = fichas.filter(f => filtroEmpresa === null || f.empresa_id === filtroEmpresa);
  const statusDoGrupo = GRUPOS.find(g => g.chave === grupo)?.status || [];
  // com texto na busca, procura em TODAS as situações (a ficha some do grupo quando muda de status)
  const buscando = busca.trim().length > 0;
  const visiveis = daEmpresa.filter(f => {
    if (!buscando && !statusDoGrupo.includes(f.status)) return false;
    if (origem && f.origem !== origem) return false;
    if (de && f.data_fim < de) return false;
    if (ate && f.data_inicio > ate) return false;
    const t = busca.trim().toLowerCase();
    if (t && ![f.cliente, f.evento_nome, numeroFicha(f.id), String(f.id), f.vendedor_nome, f.p2s_numero].some(x => (x || '').toLowerCase().includes(t))) return false;
    return true;
  });
  const somaVisiveis = visiveis.reduce((s, f) => s + Number(f.valor_total || 0), 0);
  const nomeEmpresa = (id: number) => empresas.find(e => e.id === id)?.nome || '';

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">📝 <strong>Olá, {usuarioAtual}</strong>. Orçamentos e reservas de locação.</p>
        <button onClick={() => router.push('/admin/locacoes')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">⬅ VOLTAR AO HUB</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {GRUPOS.map(g => {
              const doGrupo = daEmpresa.filter(f => g.status.includes(f.status));
              const soma = doGrupo.reduce((s, f) => s + Number(f.valor_total || 0), 0);
              return (
                <button key={g.chave} onClick={() => { setGrupo(g.chave); setMostrando(POR_VEZ); }}
                  className={`text-left bg-white p-4 rounded-2xl border shadow-sm hover:shadow-md transition-all min-w-0 ${grupo === g.chave ? 'border-[#336699] ring-1 ring-[#336699]' : 'border-[#E2E8F0]'}`}>
                  <p className="text-2xl font-black text-[#0C1D4D]">{carregando ? '—' : doGrupo.length}</p>
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">{g.rotulo}</p>
                  <p className="text-[10px] text-gray-400 font-medium mt-1 truncate">{carregando ? '' : formatarMoeda(soma)}</p>
                </button>
              );
            })}
          </div>

          {acesso?.escopo === 'CARTEIRA' && (
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 text-xs text-violet-900">
              {acesso.vendedorId
                ? <>👤 Mostrando só as fichas dos clientes da <strong>sua carteira</strong>{acesso.vendedorNome ? <> ({acesso.vendedorNome})</> : null}{clientesCarteira !== null ? <> — {clientesCarteira} cliente(s)</> : null}. Cliente novo (sem carteira) entra na sua carteira na primeira ficha.</>
                : <>⚠ Seu usuário não está ligado a um vendedor, por isso nenhuma ficha aparece. Peça ao Administrador: Parâmetros → Permissões → seu usuário → Locação.</>}
            </div>
          )}

          {pedidos.length > 0 && (
            <button onClick={() => setModalPedidos(true)} className="w-full text-left bg-emerald-50 border border-emerald-300 rounded-2xl p-4 flex justify-between items-center gap-3 hover:bg-emerald-100">
              <span className="text-sm text-emerald-900">📨 <strong>{pedidos.length} pedido(s) de orçamento</strong> do Portal do Cliente aguardando atendimento{pedidos.filter(p => p.status === 'NOVA').length ? ` (${pedidos.filter(p => p.status === 'NOVA').length} novo(s))` : ''}.</span>
              <span className="text-[10px] font-black uppercase text-emerald-700">Ver pedidos →</span>
            </button>
          )}

          <div className="bg-orange-50/60 rounded-2xl border border-orange-200 shadow-sm p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <p className="text-xs text-orange-900">
              <strong>Fase paralela:</strong> o P2S segue oficial. As fichas de lá são importadas aqui <strong>só para leitura</strong> (selo P2S) e as aprovadas/em locação ocupam a agenda de disponibilidade. Importa sozinho às 11h e 17h.
              {ultimaImportacao && <> Última importação: {new Date(ultimaImportacao).toLocaleString('pt-BR')}.</>}
            </p>
            {acesso?.escopo === 'TODAS' && <button disabled={importando} onClick={async () => {
              setImportando(true);
              const r = await importarFichasP2sAction(accessToken);
              setImportando(false);
              if (!r.ok) return toast(r.erro || 'Erro ao importar.', 'error');
              toast(`${r.info.gravadas} ficha(s) do P2S importadas — ${r.info.ocupandoAgenda} ocupando a agenda.${r.info.puladas.length ? ` ${r.info.puladas.length} pulada(s).` : ''}`, 'success');
              if (r.info.puladas.length) toast(`Puladas: ${r.info.puladas.slice(0, 5).map((p: any) => `${p.numero} (${p.motivo})`).join(' · ')}`, 'info');
              setRecarregar(x => x + 1);
            }} className="flex-shrink-0 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">
              {importando ? 'Importando...' : '⬇ Importar do P2S agora'}
            </button>}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">{buscando ? 'Busca em todas as situações' : GRUPOS.find(g => g.chave === grupo)?.rotulo}</h2>
              {acesso?.podeCriar && <button onClick={() => router.push('/admin/locacoes/reservas/nova')}
                className="bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-5 py-2.5 rounded-lg font-bold uppercase text-xs tracking-wider">+ Novo orçamento</button>}
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Cliente, evento, nº da ficha, vendedor..."
                className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs w-72 focus:outline-none focus:border-[#336699]" />
              <label className="text-[10px] font-black text-gray-500 uppercase">Evento entre</label>
              <input type="date" value={de} onChange={e => setDe(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-xs" />
              <span className="text-xs text-gray-400">e</span>
              <input type="date" value={ate} onChange={e => setAte(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-xs" />
              <select value={origem} onChange={e => setOrigem(e.target.value as any)} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-xs font-bold text-[#0C1D4D]">
                <option value="">Todas as origens</option>
                <option value="SISTEMA">Criadas aqui</option>
                <option value="P2S">Do P2S</option>
              </select>
              {empresas.length > 1 && (
                <>
                  <button onClick={() => setFiltroEmpresa(null)}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${filtroEmpresa === null ? `${corSeloEmpresa(null)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>Todas</button>
                  {empresas.map(e => (
                    <button key={e.id} onClick={() => setFiltroEmpresa(e.id)}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${filtroEmpresa === e.id ? `${corSeloEmpresa(e.id)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>{e.nome}</button>
                  ))}
                </>
              )}
            </div>

            {carregando ? (
              <p className="text-sm text-gray-400 py-6 text-center">Carregando...</p>
            ) : visiveis.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-sm text-gray-500 font-medium">Nenhuma ficha aqui.</p>
                {fichas.length === 0 && <p className="text-xs text-gray-400 mt-1">Comece com <strong>+ Novo orçamento</strong>.</p>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                      <th className="p-2">Ficha</th><th className="p-2">Cliente / Evento</th><th className="p-2">Período</th>
                      <th className="p-2">Status</th><th className="p-2">Empresa</th><th className="p-2">Vendedor</th><th className="p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.slice(0, mostrando).map(f => {
                      const vencido = (f.status === 'ORCAMENTO' || f.status === 'ENVIADO') && f.validade_orcamento && f.validade_orcamento < hoje;
                      return (
                        <tr key={f.id} onClick={() => router.push(`/admin/locacoes/reservas/${f.id}`)} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer">
                          <td className="p-2 font-black text-[#0C1D4D] whitespace-nowrap">{f.origem === 'P2S' ? <><span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 mr-1">P2S</span>{f.p2s_numero}</> : numeroFicha(f.id)}{f.origem === 'P2S' && <span className="block text-[9px] text-gray-400 font-bold">{numeroFicha(f.id)}</span>}</td>
                          <td className="p-2 min-w-[220px]">
                            <p className="font-bold text-[#0C1D4D]">{f.cliente}</p>
                            {f.evento_nome && <p className="text-[10px] text-gray-500">{f.evento_nome}</p>}
                            {f.motivo_perda && <p className="text-[10px] text-red-500">{f.motivo_perda}</p>}
                          </td>
                          <td className="p-2 whitespace-nowrap">{formatarDataBR(f.data_inicio)} a {formatarDataBR(f.data_fim)}</td>
                          <td className="p-2 whitespace-nowrap">
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS_FICHA[f.status]?.cls}`}>{STATUS_FICHA[f.status]?.rotulo || f.status}</span>
                            {f.origem === 'P2S' && f.p2s_status && ['DR', 'PR', 'SB'].includes(f.p2s_status) && <span className="block text-[9px] text-orange-700 font-bold mt-0.5">P2S: {rotuloStatusP2s(f.p2s_status)}</span>}
                            {vencido && <span className="block text-[9px] text-amber-600 font-bold mt-0.5">validade vencida</span>}
                            {f.desconto_pendente && <span className="block text-[9px] text-amber-700 font-bold mt-0.5">⏳ desconto a aprovar</span>}
                          </td>
                          <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${corSeloEmpresa(f.empresa_id)}`}>{nomeEmpresa(f.empresa_id)}</span></td>
                          <td className="p-2 text-gray-500">{f.vendedor_nome || '—'}</td>
                          <td className="p-2 text-right font-black text-[#0C1D4D] whitespace-nowrap">{formatarMoeda(Number(f.valor_total || 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {visiveis.length > mostrando && (
                  <div className="text-center mt-3">
                    <button onClick={() => setMostrando(n => n + POR_VEZ)} className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider border border-[#CBD5E1] text-[#0C1D4D] hover:bg-[#F8FAFC]">
                      Mostrar mais ({visiveis.length - mostrando} restantes)
                    </button>
                  </div>
                )}
                <p className="text-[10px] text-gray-400 mt-3">{visiveis.length} ficha(s){visiveis.length > mostrando ? ` · mostrando ${mostrando}` : ''} · {formatarMoeda(somaVisiveis)}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={modalPedidos} onClose={() => setModalPedidos(false)} title="Pedidos do Portal do Cliente" maxWidthClassName="max-w-3xl">
        {empresas.length > 1 && (
          <label className="flex items-center gap-2 text-xs font-bold text-gray-600">Converter na empresa:
            <select value={empresaConversao} onChange={e => setEmpresaConversao(Number(e.target.value))} className="border border-[#CBD5E1] rounded-lg px-2 py-1 text-xs">{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
          </label>
        )}
        {pedidos.length === 0 && <p className="text-sm text-gray-400">Nenhum pedido pendente.</p>}
        <div className="space-y-3">
          {pedidos.map(p => (
            <div key={p.id} className="border border-[#E2E8F0] rounded-xl p-3 space-y-1">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-black text-[#0C1D4D]">{p.cliente_nome} <span className="text-[10px] text-gray-400">#{p.id} · {new Date(p.criado_em).toLocaleString('pt-BR')}</span></p>
                  <p className="text-xs text-gray-500">{[p.contato_nome, p.email, p.contato_telefone].filter(Boolean).join(' · ')}</p>
                </div>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${p.status === 'NOVA' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{p.status === 'NOVA' ? 'Novo' : 'Em atendimento'}</span>
              </div>
              <p className="text-xs"><strong>{p.evento || 'Evento não informado'}</strong>{p.local ? ` · ${p.local}` : ''} · {p.data_inicio ? formatarDataBR(p.data_inicio) : '?'} a {p.data_fim ? formatarDataBR(p.data_fim) : '?'}</p>
              <p className="text-xs whitespace-pre-line bg-[#F8FAFC] rounded-lg p-2">{p.itens}</p>
              {p.observacoes && <p className="text-xs text-gray-500 whitespace-pre-line">{p.observacoes}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={async () => { const r = await converterSolicitacaoPortalAction(p.id, empresaConversao, accessToken); if (!r.ok) return toast(r.erro || 'Erro.', 'error'); router.push(`/admin/locacoes/reservas/${r.info.id}`); }}
                  className="bg-[#0C1D4D] text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase">Converter em orçamento</button>
                {p.status === 'NOVA' && <button onClick={async () => { await atualizarSolicitacaoPortalAction(p.id, 'EM_ATENDIMENTO', accessToken); setRecarregar(x => x + 1); }} className="border border-[#CBD5E1] px-3 py-1.5 rounded-lg text-[10px] font-black uppercase">Em atendimento</button>}
                <button onClick={async () => { await atualizarSolicitacaoPortalAction(p.id, 'DESCARTADA', accessToken); setRecarregar(x => x + 1); }} className="border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase">Descartar</button>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
