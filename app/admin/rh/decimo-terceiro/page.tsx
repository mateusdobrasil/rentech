"use client";

// app/admin/rh/decimo-terceiro/page.tsx
// Tela única do 13º Salário (pedido do usuário, 28/11/2026): toda a parte do
// 13º fica aqui, integral ou não.
// - "Pagamento Direto (Integral)": Modelo de Contrato com
//   decimo_terceiro_integral=true. Fechar (congela avos/bruto/INSS/IRRF/
//   parcelas) → Enviar p/ assinatura cada parcela (Autentique) → marcar paga
//   (manual ou pelo lote PIX do Financeiro RH, fonte "13º Integral — 1ª/2ª
//   Parcela").
// - "Via Contabilidade": Modelo de Contrato com recebe_holerite_contabilidade
//   =true (e não integral). Só leitura — o valor é exatamente o do holerite
//   importado em /admin/rh/holerite → Separar Holerites. O pagamento já roda
//   pela fonte "DECIMO_TERCEIRO" do lote de Financeiro RH.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  painelDecimoTerceiroAction, fecharDecimoTerceiroLoteAction, reabrirDecimoTerceiroAction,
  marcarParcela13PagaAction, enviarDecimoTerceiroAssinaturaAction
} from '../actions/actions-decimo-terceiro';
import { urlDocumentoContabilAction } from '../actions/actions-documentos';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast, useConfirm, usePrompt } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Linha13 {
  func: { nome_completo: string; cargo: string | null; empresa_id: number | null };
  dados: {
    ano: number; mesesAvos: number; salarioBase: number; valorBruto: number;
    parcela1Valor: number; inssValor: number; irrfValor: number; parcela2Valor: number; calculadoEm: string;
  };
  fechamento: {
    id: number; fechadoEm: string; fechadoPor: string | null;
    parcela1PagoEm: string | null; parcela1PagoLoteId: number | null;
    parcela2PagoEm: string | null; parcela2PagoLoteId: number | null;
  } | null;
  statusAssinaturaP1: string | null;
  statusAssinaturaP2: string | null;
}

interface LinhaContabilidade13 {
  func: { nome_completo: string; cargo: string | null; empresa_id: number | null };
  documentos: { mesReferencia: string; valorOcr: number | null }[];
  totalValor: number;
}

const SELO_ASSINATURA: Record<string, { label: string; cls: string }> = {
  ENVIADO: { label: '📤 Enviado', cls: 'bg-indigo-100 text-indigo-700' },
  VISUALIZADO: { label: '👁 Visualizado', cls: 'bg-blue-100 text-blue-700' },
  ASSINADO: { label: '✅ Assinado', cls: 'bg-green-100 text-green-700' },
  REJEITADO: { label: '✖ Rejeitado', cls: 'bg-red-100 text-red-700' },
  CANCELADO: { label: '🚫 Cancelado', cls: 'bg-gray-100 text-gray-500' },
};

export default function DecimoTerceiroPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const perguntar = usePrompt();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ nomeFallback: 'Equipe RH' });

  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [linhas, setLinhas] = useState<Linha13[]>([]);
  const [linhasContabilidade, setLinhasContabilidade] = useState<LinhaContabilidade13[]>([]);
  const [loading, setLoading] = useState(true);
  const [semRegraConfigurada, setSemRegraConfigurada] = useState(false);
  const [sandbox, setSandbox] = useState(true);
  const [processando, setProcessando] = useState<string | null>(null); // "{nome}::{acao}"
  const [abrindoDoc, setAbrindoDoc] = useState<string | null>(null); // "{nome}::{mesReferencia}"

  const carregar = async (anoRef: number) => {
    setLoading(true);
    try {
      const res = await painelDecimoTerceiroAction({ ano: anoRef }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setLinhas(res.info.linhas || []);
      setLinhasContabilidade(res.info.linhasContabilidade || []);
      setSemRegraConfigurada(!!res.info.semRegraConfigurada);
    } catch (e: any) {
      toast('Erro ao carregar o 13º: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const verDocumento = async (nome: string, mesReferencia: string) => {
    setAbrindoDoc(`${nome}::${mesReferencia}`);
    try {
      const res = await urlDocumentoContabilAction({ funcionarioNome: nome, mesReferencia, tipo: 'DECIMO_TERCEIRO' }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank');
    } catch (e: any) {
      toast('Erro ao abrir o documento: ' + e.message, 'error');
    } finally {
      setAbrindoDoc(null);
    }
  };

  const mesBR = (iso: string) => { const [a, m] = iso.split('-'); return `${m}/${a}`; };

  useEffect(() => { if (!authLoading && accessToken) carregar(ano); }, [ano, authLoading, accessToken]);

  const abertos = linhas.filter(l => !l.fechamento);
  const fechados = linhas.filter(l => l.fechamento);

  const fecharTodos = async () => {
    if (abertos.length === 0) { toast('Todos já estão fechados para este ano.', 'info'); return; }
    const totalBruto = abertos.reduce((s, l) => s + l.dados.valorBruto, 0);
    if (!(await confirmar(
      `Fechar o 13º Salário Integral de ${ano} para ${abertos.length} funcionário(s)?\n\n` +
      `Total bruto: ${BRL(totalBruto)}\n\n` +
      `Depois de fechado, os valores ficam congelados (não acompanham mudança de salário/dependentes) até reabrir.`
    ))) return;
    setProcessando('LOTE::fechar');
    try {
      const res = await fecharDecimoTerceiroLoteAction({ ano, nomes: abertos.map(l => l.func.nome_completo), usuarioNome: usuarioAtual }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      const ignoradosMsg = res.info?.ignorados?.length ? `\n\nIgnorados (já têm parcela paga): ${res.info.ignorados.join(', ')}` : '';
      toast(`${res.info?.fechados || 0} fechado(s).${ignoradosMsg}`, 'success');
      carregar(ano);
    } catch (e: any) {
      toast('Erro ao fechar: ' + e.message, 'error');
    } finally {
      setProcessando(null);
    }
  };

  const reabrir = async (l: Linha13) => {
    if (!l.fechamento) return;
    const descricao = await perguntar({ message: `Motivo para reabrir o 13º de ${l.func.nome_completo} (${ano})?` });
    if (descricao === null || !descricao.trim()) return;
    setProcessando(`${l.func.nome_completo}::reabrir`);
    try {
      const res = await reabrirDecimoTerceiroAction({ id: l.fechamento.id, usuarioNome: usuarioAtual, descricao: descricao.trim() }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      toast('Reaberto — os valores voltam a ser calculados ao vivo.', 'success');
      carregar(ano);
    } catch (e: any) {
      toast('Erro ao reabrir: ' + e.message, 'error');
    } finally {
      setProcessando(null);
    }
  };

  const marcarPaga = async (l: Linha13, parcela: 1 | 2, pago: boolean) => {
    if (!l.fechamento) return;
    if (pago && !(await confirmar(`Marcar a ${parcela}ª parcela de ${l.func.nome_completo} como PAGA manualmente?`))) return;
    setProcessando(`${l.func.nome_completo}::pagar${parcela}`);
    try {
      const res = await marcarParcela13PagaAction({ id: l.fechamento.id, parcela, pago, usuarioNome: usuarioAtual }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      carregar(ano);
    } catch (e: any) {
      toast('Erro: ' + e.message, 'error');
    } finally {
      setProcessando(null);
    }
  };

  const enviarAssinatura = async (l: Linha13, parcela: 1 | 2) => {
    if (!l.fechamento) return;
    const valor = parcela === 1 ? l.dados.parcela1Valor : l.dados.parcela2Valor;
    if (!(await confirmar(
      `Enviar a ${parcela}ª parcela do 13º de ${l.func.nome_completo} (${ano}) para assinatura?\n\n` +
      `Valor: ${BRL(valor)}\n\n` +
      (sandbox ? '🧪 MODO TESTE (sandbox): não gasta créditos.' : '⚠ MODO REAL: consome um documento do plano Autentique.')
    ))) return;
    setProcessando(`${l.func.nome_completo}::assinar${parcela}`);
    try {
      const res = await enviarDecimoTerceiroAssinaturaAction({ id: l.fechamento.id, parcela, usuarioNome: usuarioAtual, sandbox }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      toast(`Enviado para assinatura!${res.info?.link ? `\n\nLink: ${res.info.link}` : ''}`, 'success');
      carregar(ano);
    } catch (e: any) {
      toast('Erro ao enviar para assinatura: ' + e.message, 'error');
    } finally {
      setProcessando(null);
    }
  };

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar esta página.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#FEF3C7] border-b border-[#FDE68A] px-4 md:px-8 py-4 flex flex-col sm:flex-row justify-between items-center gap-3 shadow-sm print:hidden">
        <p className="text-[#92400E] font-medium text-sm">
          🎄 <strong>13º Salário</strong>. Pagamento Direto (Integral): calculamos, fechamos, enviamos p/ assinatura e levamos ao lote PIX. Via Contabilidade: o valor é exatamente o do holerite importado em Separar Holerites — só leitura aqui.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-amber-50 border border-[#FDE68A] text-[#92400E] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1500px] mx-auto w-full space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider">13º Salário — {ano}</h1>
            <p className="text-sm text-[#64748B] font-medium mt-1">
              Direto: {linhas.length} elegível(is) • {fechados.length} fechado(s) • {abertos.length} em aberto
              {linhasContabilidade.length > 0 && <> · Contabilidade: {linhasContabilidade.length} funcionário(s)</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            <input type="number" value={ano} onChange={e => setAno(Number(e.target.value) || ano)} className="w-24 p-2.5 border border-[#CBD5E1] rounded-xl text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]" />
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider cursor-pointer bg-gray-50 px-3 h-[42px] rounded-xl border border-gray-200 select-none">
              <input type="checkbox" checked={sandbox} onChange={e => setSandbox(e.target.checked)} className="accent-amber-600" />
              <span className={sandbox ? 'text-amber-600' : 'text-red-600'}>{sandbox ? '🧪 Teste' : '⚠ Real'}</span>
            </label>
            <button onClick={fecharTodos} disabled={processando !== null || abertos.length === 0} className="bg-[#16A34A] text-white font-black uppercase tracking-widest text-xs px-5 py-3.5 rounded-xl shadow-sm hover:bg-[#15803D] transition-all disabled:opacity-50 text-center">
              {processando === 'LOTE::fechar' ? '⏳ Fechando...' : `🔒 Fechar Todos (${abertos.length})`}
            </button>
            <button onClick={() => router.push('/admin/financeiro/rh')} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-5 py-3.5 rounded-xl shadow-sm hover:bg-[#284B8C] transition-all text-center">
              Ir para Financeiro RH
            </button>
          </div>
        </div>

        {semRegraConfigurada && (
          <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5 text-sm text-amber-800 font-medium">
            ⚠ Nenhum Modelo de Contrato está marcado com "13º Salário Integral" ainda. Configure em{' '}
            <button onClick={() => router.push('/admin/rh/parametros')} className="underline font-bold">/admin/rh/parametros</button>.
          </div>
        )}

        <h2 className="text-xs font-black text-[#64748B] uppercase tracking-widest pl-1">💰 Pagamento Direto (Integral)</h2>

        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-[#0C1D4D] border-t-transparent rounded-full animate-spin"></div>
              Calculando...
            </div>
          ) : linhas.length === 0 ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
              Nenhum funcionário elegível ao 13º Integral.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                  <tr className="text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                    <th className="p-4">Colaborador</th>
                    <th className="p-4 text-right">Avos</th>
                    <th className="p-4 text-right">Bruto</th>
                    <th className="p-4 text-right">1ª Parcela</th>
                    <th className="p-4 text-right">INSS</th>
                    <th className="p-4 text-right">IRRF</th>
                    <th className="p-4 text-right">2ª Parcela</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 text-center w-64">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] font-medium">
                  {linhas.map(l => {
                    const key = l.func.nome_completo;
                    return (
                      <tr key={key} className="hover:bg-[#F8FAFC] transition-colors align-top">
                        <td className="p-4">
                          <span className="font-black text-[#0C1D4D] text-sm block">{l.func.nome_completo}</span>
                          <span className="text-[10px] text-gray-400 font-bold block uppercase mt-0.5">{l.func.cargo || '—'}</span>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase inline-block mt-1 ${corSeloEmpresa(l.func.empresa_id)}`}>🏭 Empresa {l.func.empresa_id ?? '—'}</span>
                        </td>
                        <td className="p-4 text-right tabular-nums">{l.dados.mesesAvos}/12</td>
                        <td className="p-4 text-right tabular-nums font-bold">{BRL(l.dados.valorBruto)}</td>
                        <td className="p-4 text-right tabular-nums">{BRL(l.dados.parcela1Valor)}</td>
                        <td className="p-4 text-right tabular-nums text-red-600">−{BRL(l.dados.inssValor)}</td>
                        <td className="p-4 text-right tabular-nums text-red-600">−{BRL(l.dados.irrfValor)}</td>
                        <td className="p-4 text-right tabular-nums font-bold">{BRL(l.dados.parcela2Valor)}</td>
                        <td className="p-4 text-center">
                          {!l.fechamento ? (
                            <span className="text-[9px] font-black px-2 py-1 rounded-full uppercase bg-amber-100 text-amber-700">⚠ Em aberto</span>
                          ) : (
                            <div className="flex flex-col gap-1 items-center">
                              <span className="text-[9px] font-black px-2 py-1 rounded-full uppercase bg-emerald-100 text-emerald-700">🔒 Fechado</span>
                              <span className="text-[9px] font-bold text-gray-500">1ª: {l.fechamento.parcela1PagoEm ? '✅ Paga' : (SELO_ASSINATURA[l.statusAssinaturaP1 || '']?.label || '— Pendente')}</span>
                              <span className="text-[9px] font-bold text-gray-500">2ª: {l.fechamento.parcela2PagoEm ? '✅ Paga' : (SELO_ASSINATURA[l.statusAssinaturaP2 || '']?.label || '— Pendente')}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          {!l.fechamento ? (
                            <span className="text-[10px] text-gray-400 font-bold uppercase">Feche para liberar as ações</span>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex gap-1.5 items-center">
                                <span className="text-[9px] font-black text-gray-400 uppercase w-6">1ª</span>
                                {!l.fechamento.parcela1PagoEm && (
                                  <button onClick={() => enviarAssinatura(l, 1)} disabled={processando !== null} className="text-[9px] font-black text-indigo-600 uppercase hover:bg-indigo-50 px-2 py-1 rounded border border-indigo-200 disabled:opacity-50">
                                    {processando === `${key}::assinar1` ? '...' : '📤 Assinatura'}
                                  </button>
                                )}
                                {!l.fechamento.parcela1PagoEm ? (
                                  <button onClick={() => marcarPaga(l, 1, true)} disabled={processando !== null} className="text-[9px] font-black text-green-700 uppercase hover:bg-green-50 px-2 py-1 rounded border border-green-200 disabled:opacity-50">
                                    {processando === `${key}::pagar1` ? '...' : '✓ Marcar paga'}
                                  </button>
                                ) : (
                                  <button onClick={() => marcarPaga(l, 1, false)} disabled={processando !== null || !!l.fechamento.parcela1PagoLoteId} title={l.fechamento.parcela1PagoLoteId ? 'Paga via lote bancário — não é possível desmarcar por aqui' : ''} className="text-[9px] font-black text-gray-500 uppercase hover:bg-gray-100 px-2 py-1 rounded border border-gray-200 disabled:opacity-50">
                                    ✓ Paga — desfazer
                                  </button>
                                )}
                              </div>
                              <div className="flex gap-1.5 items-center">
                                <span className="text-[9px] font-black text-gray-400 uppercase w-6">2ª</span>
                                {!l.fechamento.parcela2PagoEm && (
                                  <button onClick={() => enviarAssinatura(l, 2)} disabled={processando !== null} className="text-[9px] font-black text-indigo-600 uppercase hover:bg-indigo-50 px-2 py-1 rounded border border-indigo-200 disabled:opacity-50">
                                    {processando === `${key}::assinar2` ? '...' : '📤 Assinatura'}
                                  </button>
                                )}
                                {!l.fechamento.parcela2PagoEm ? (
                                  <button onClick={() => marcarPaga(l, 2, true)} disabled={processando !== null} className="text-[9px] font-black text-green-700 uppercase hover:bg-green-50 px-2 py-1 rounded border border-green-200 disabled:opacity-50">
                                    {processando === `${key}::pagar2` ? '...' : '✓ Marcar paga'}
                                  </button>
                                ) : (
                                  <button onClick={() => marcarPaga(l, 2, false)} disabled={processando !== null || !!l.fechamento.parcela2PagoLoteId} title={l.fechamento.parcela2PagoLoteId ? 'Paga via lote bancário — não é possível desmarcar por aqui' : ''} className="text-[9px] font-black text-gray-500 uppercase hover:bg-gray-100 px-2 py-1 rounded border border-gray-200 disabled:opacity-50">
                                    ✓ Paga — desfazer
                                  </button>
                                )}
                              </div>
                              {!l.fechamento.parcela1PagoEm && !l.fechamento.parcela2PagoEm && (
                                <button onClick={() => reabrir(l)} disabled={processando !== null} className="text-[9px] font-black text-red-600 uppercase hover:bg-red-50 px-2 py-1 rounded border border-red-200 disabled:opacity-50 self-start">
                                  {processando === `${key}::reabrir` ? '...' : '↺ Reabrir'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[10px] text-gray-400 font-bold tracking-wide mt-2 text-center uppercase">
          Cálculo: 1ª parcela = 50% do bruto, sem desconto (prazo legal até 30/11) · 2ª parcela = bruto − 1ª parcela − INSS − IRRF, tributação exclusiva sobre o total do 13º (prazo legal até 20/12). Conferir com a contabilidade antes de pagar.
        </p>

        <h2 className="text-xs font-black text-[#64748B] uppercase tracking-widest pl-1 pt-4">🏢 Via Contabilidade</h2>

        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-[#0C1D4D] border-t-transparent rounded-full animate-spin"></div>
              Carregando...
            </div>
          ) : linhasContabilidade.length === 0 ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
              Nenhum funcionário com 13º pela contabilidade neste ano.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                  <tr className="text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                    <th className="p-4">Colaborador</th>
                    <th className="p-4">Documentos importados</th>
                    <th className="p-4 text-right">Total (valor do holerite)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] font-medium">
                  {linhasContabilidade.map(l => {
                    const key = l.func.nome_completo;
                    return (
                      <tr key={key} className="hover:bg-[#F8FAFC] transition-colors align-top">
                        <td className="p-4">
                          <span className="font-black text-[#0C1D4D] text-sm block">{l.func.nome_completo}</span>
                          <span className="text-[10px] text-gray-400 font-bold block uppercase mt-0.5">{l.func.cargo || '—'}</span>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase inline-block mt-1 ${corSeloEmpresa(l.func.empresa_id)}`}>🏭 Empresa {l.func.empresa_id ?? '—'}</span>
                        </td>
                        <td className="p-4">
                          {l.documentos.length === 0 ? (
                            <span className="text-[10px] font-black text-amber-600 uppercase">⚠ Nenhum documento importado ainda</span>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              {l.documentos.map(d => (
                                <div key={d.mesReferencia} className="flex items-center gap-2">
                                  <span className="text-[10px] font-black text-gray-500 uppercase w-16">{mesBR(d.mesReferencia)}</span>
                                  {d.valorOcr != null ? (
                                    <span className="text-xs font-bold text-[#0C1D4D] tabular-nums">{BRL(d.valorOcr)}</span>
                                  ) : (
                                    <span className="text-[10px] font-black text-amber-600 uppercase">⏳ aguardando leitura do valor</span>
                                  )}
                                  <button onClick={() => verDocumento(key, d.mesReferencia)} disabled={abrindoDoc !== null} className="text-[9px] font-black text-indigo-600 uppercase hover:bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 disabled:opacity-50">
                                    {abrindoDoc === `${key}::${d.mesReferencia}` ? '...' : '👁 Ver'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-right tabular-nums font-bold">{BRL(l.totalValor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[10px] text-gray-400 font-bold tracking-wide mt-2 text-center uppercase">
          Via Contabilidade: valor igual ao do holerite importado em /admin/rh/holerite → Separar Holerites (tipo "Décimo Terceiro"). Sem cálculo nosso; o pagamento roda pela fonte "13º Salário (contabilidade)" do lote de /admin/financeiro/rh.
        </p>
      </div>
    </div>
  );
}
