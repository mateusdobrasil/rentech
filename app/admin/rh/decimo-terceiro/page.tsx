"use client";

// app/admin/rh/decimo-terceiro/page.tsx
// Tela única do 13º Salário (pedido do usuário, 28/11/2026): toda a parte do
// 13º fica aqui, integral ou não.
// - "Via Empresa": Modelo de Contrato com decimo_terceiro_integral=true. O
//   bruto pode ser DIGITADO manualmente (pedido do usuário) antes de fechar —
//   se não digitado, sugere o cálculo automático a partir do salário
//   cadastrado. Fechar (congela avos/bruto/INSS/IRRF/parcelas) → Enviar p/
//   assinatura cada parcela (Autentique) → marcar paga (manual ou pelo lote
//   PIX do Financeiro RH, fonte "13º Integral — 1ª/2ª Parcela").
// - "Via Contabilidade": Modelo de Contrato com recebe_holerite_contabilidade
//   =true (e não integral). Só leitura — o valor é exatamente o do holerite
//   importado em /admin/rh/holerite → Separar Holerites. O pagamento já roda
//   pela fonte "DECIMO_TERCEIRO" do lote de Financeiro RH.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  painelDecimoTerceiroAction, fecharDecimoTerceiroLoteAction, reabrirDecimoTerceiroAction,
  marcarParcela13PagaAction, enviarDecimoTerceiroAssinaturaAction, previaHolerite13Action
} from '../actions/actions-decimo-terceiro';
import { urlDocumentoContabilAction } from '../actions/actions-documentos';
import { listarPdfsContabilidadeAction, processarOcrAwsAction } from '../actions/actions-financeiro';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast, useConfirm, usePrompt } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { supabase } from '../../../lib/supabase';
import { ehAdministradorGlobal } from '../../../lib/permissoes';

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Linha13 {
  func: { nome_completo: string; cargo: string | null; empresa_id: number | null; salario_folha: number | null };
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
  numeroDependentesIrrf: number;
}

interface LinhaSem13 {
  func: { nome_completo: string; cargo: string | null; empresa_id: number | null; tipo_contrato: string | null };
  motivo: string;
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
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken, permissaoBruta } = usePageAccess({ nomeFallback: 'Equipe RH' });

  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [linhas, setLinhas] = useState<Linha13[]>([]);
  const [linhasContabilidade, setLinhasContabilidade] = useState<LinhaContabilidade13[]>([]);
  const [linhasSem13, setLinhasSem13] = useState<LinhaSem13[]>([]);
  const [loading, setLoading] = useState(true);
  const [semRegraConfigurada, setSemRegraConfigurada] = useState(false);
  const [sandbox, setSandbox] = useState(true);
  const [processando, setProcessando] = useState<string | null>(null); // "{nome}::{acao}"
  const [abrindoDoc, setAbrindoDoc] = useState<string | null>(null); // "{nome}::{mesReferencia}"
  const [gerandoPrevia, setGerandoPrevia] = useState<string | null>(null); // nome
  const [lendoOcr, setLendoOcr] = useState(false);
  const [ocrFalhas, setOcrFalhas] = useState<string[]>([]);
  // 1ª/2ª parcela digitadas (Via Empresa), por nome — só valem enquanto o 13º
  // está em aberto; somem ao fechar (o snapshot fica congelado).
  const [parcelasDigitadas, setParcelasDigitadas] = useState<Record<string, { p1: string; p2: string }>>({});

  // Empresa (Rentech × AlfaLight) — pedido do usuário (28/11/2026): nunca
  // "ambas", sempre uma escolhida, com Rentech como padrão. Mesmo padrão de
  // /admin/financeiro/rh (catálogo + vínculos do usuário via Supabase client),
  // revalidado no servidor em painelDecimoTerceiroAction.
  const [empresaSelecionada, setEmpresaSelecionada] = useState<number | null>(null);
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    async function carregarEmpresas() {
      const { data: empresasData } = await supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome');
      setEmpresasCatalogo(empresasData || []);
      if (ehAdministradorGlobal(permissaoBruta)) { setEmpresasPermitidas(null); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: vinculos } = await supabase.from('perfis_usuarios_empresas').select('empresa_id').eq('perfil_id', session.user.id);
      setEmpresasPermitidas((vinculos || []).map(v => v.empresa_id));
    }
    carregarEmpresas();
  }, [authLoading, acessoNegado, permissaoBruta]);

  const empresasCatalogoVisivel = empresasPermitidas === null
    ? empresasCatalogo
    : empresasCatalogo.filter(e => empresasPermitidas.includes(e.id));

  // Default Rentech (se visível); senão, trava na única empresa disponível.
  useEffect(() => {
    if (empresaSelecionada !== null || empresasCatalogoVisivel.length === 0) return;
    const rentech = empresasCatalogoVisivel.find(e => e.nome.toUpperCase().includes('RENTECH'));
    setEmpresaSelecionada(rentech ? rentech.id : empresasCatalogoVisivel[0].id);
  }, [empresasCatalogoVisivel, empresaSelecionada]);

  const carregar = async (anoRef: number, empresaId: number) => {
    setLoading(true);
    try {
      const res = await painelDecimoTerceiroAction({ ano: anoRef, empresaId }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setLinhas(res.info.linhas || []);
      setLinhasContabilidade(res.info.linhasContabilidade || []);
      setLinhasSem13(res.info.linhasSem13 || []);
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

  // Lê o valor dos holerites do 13º (contabilidade) direto por aqui — pedido
  // do usuário 2026-11-28, pra não precisar ir ao Financeiro RH só pra isso.
  // Mesmo mecanismo (listarPdfsContabilidadeAction + processarOcrAwsAction,
  // AWS Textract) já usado lá; aqui só recarrega o painel no final, sem
  // montar lote.
  const lerValoresContabilidade = async (forcar = false) => {
    setLendoOcr(true);
    setOcrFalhas([]);
    try {
      // Um holerite por parcela: "AAAA-P1" e "AAAA-P2" (ver Separar Holerites).
      const falhas: string[] = [];
      let lidos = 0, tentados = 0, emCache = 0;
      for (const parcela of [1, 2] as const) {
        const mesReferencia = `${ano}-P${parcela}`;
        const res = await listarPdfsContabilidadeAction({ mesReferencia, tipo: 'DECIMO_TERCEIRO', forcar }, accessToken);
        if (!res.ok) throw new Error(res.erro);
        const pdfs: { funcionario_nome: string; pdfBase64: string }[] = res.info?.pdfs || [];
        emCache += (res.info?.cache || []).length;
        for (const { funcionario_nome, pdfBase64 } of pdfs) {
          tentados++;
          try {
            const r = await processarOcrAwsAction(pdfBase64, 'DECIMO_TERCEIRO', mesReferencia, funcionario_nome, accessToken);
            if (r.ok && r.valor) lidos++;
            else falhas.push(`${funcionario_nome} (${parcela}ª parcela): ${r.erro || 'valor não encontrado no PDF.'}`);
          } catch {
            falhas.push(`${funcionario_nome} (${parcela}ª parcela): falha de conexão.`);
          }
        }
      }
      if (tentados === 0 && emCache === 0) {
        toast('Nenhum holerite do 13º (contabilidade) importado para este ano.', 'info');
        return;
      }
      setOcrFalhas(falhas);
      const msg = tentados === 0
        ? `${emCache} valor(es) já lido(s) anteriormente.`
        : `${lidos} de ${tentados} valor(es) lido(s).${falhas.length ? ` ${falhas.length} falha(s) — confira manualmente.` : ''}`;
      toast(msg, falhas.length ? 'error' : 'success');
      carregar(ano, empresaSelecionada!);
    } catch (e: any) {
      toast('Erro ao ler os valores: ' + e.message, 'error');
    } finally {
      setLendoOcr(false);
    }
  };

  useEffect(() => { if (!authLoading && accessToken && empresaSelecionada) carregar(ano, empresaSelecionada); }, [ano, authLoading, accessToken, empresaSelecionada]);

  const abertos = linhas.filter(l => !l.fechamento);
  const fechados = linhas.filter(l => l.fechamento);
  // Teste/Real só vale pro envio de assinatura: aparece junto com o botão
  // 📤 Assinatura (linha fechada com alguma parcela ainda não paga).
  const temAssinaturaDisponivel = fechados.some(l => !l.fechamento!.parcela1PagoEm || !l.fechamento!.parcela2PagoEm);

  // Aceita "1.500,50", "1500,50" e "1500.50" (com vírgula, o ponto é milhar).
  const numeroDigitado = (s?: string) => {
    const t = (s || '').trim();
    return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0;
  };
  // Parcelas digitadas de uma linha, ou null se nenhuma das duas foi digitada.
  const digitadasDe = (nome: string) => {
    const p = parcelasDigitadas[nome];
    if (!p || (!p.p1.trim() && !p.p2.trim())) return null;
    return { parcela1: numeroDigitado(p.p1), parcela2: numeroDigitado(p.p2) };
  };

  // Dados exibidos pra uma linha: congelados se já fechou; com parcelas
  // digitadas, o digitado é o que se paga (sem INSS/IRRF, bruto = 1ª + 2ª);
  // senão, o cálculo sugerido.
  const dadosExibidos = (l: Linha13) => {
    if (l.fechamento) return l.dados;
    const dig = digitadasDe(l.func.nome_completo);
    if (!dig) return l.dados;
    return { ...l.dados, valorBruto: dig.parcela1 + dig.parcela2, parcela1Valor: dig.parcela1, parcela2Valor: dig.parcela2, inssValor: 0, irrfValor: 0 };
  };

  // Prévia do holerite das 2 parcelas, sem gravar nem enviar: aberto usa os
  // valores da tela (digitados ou sugeridos); fechado, os congelados.
  const previaHolerite = async (l: Linha13) => {
    const nome = l.func.nome_completo;
    setGerandoPrevia(nome);
    try {
      const res = await previaHolerite13Action({
        ano, funcionarioNome: nome,
        parcelasDigitadas: l.fechamento ? null : digitadasDe(nome)
      }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      const bin = atob(res.info.pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      toast('Erro ao gerar a prévia: ' + e.message, 'error');
    } finally {
      setGerandoPrevia(null);
    }
  };

  // Parcela zerada não entra no fechamento (o servidor também barra).
  const temValor = (l: Linha13) => { const d = dadosExibidos(l); return d.parcela1Valor > 0 && d.parcela2Valor > 0; };
  const fechaveis = abertos.filter(temValor);
  const zeradosAbertos = abertos.length - fechaveis.length;

  const fecharTodos = async () => {
    if (abertos.length === 0) { toast('Todos já estão fechados para este ano.', 'info'); return; }
    if (fechaveis.length === 0) { toast('Todos os 13º em aberto estão com parcela zerada — digite a 1ª e a 2ª parcela antes de fechar.', 'error'); return; }
    const totalBruto = fechaveis.reduce((s, l) => s + dadosExibidos(l).valorBruto, 0);
    const valoresParcelasDigitadas: Record<string, { parcela1: number; parcela2: number }> = {};
    fechaveis.forEach(l => {
      const dig = digitadasDe(l.func.nome_completo);
      if (dig) valoresParcelasDigitadas[l.func.nome_completo] = dig;
    });
    if (!(await confirmar(
      `Fechar o 13º Salário (Via Empresa) de ${ano} para ${fechaveis.length} funcionário(s)?\n\n` +
      `Total bruto: ${BRL(totalBruto)}\n\n` +
      (zeradosAbertos > 0 ? `${zeradosAbertos} funcionário(s) com parcela zerada ficam de fora.\n\n` : '') +
      `Depois de fechado, os valores ficam congelados (não acompanham mudança de salário/dependentes) até reabrir.`
    ))) return;
    setProcessando('LOTE::fechar');
    try {
      const res = await fecharDecimoTerceiroLoteAction({ ano, nomes: fechaveis.map(l => l.func.nome_completo), usuarioNome: usuarioAtual, valoresParcelasDigitadas }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      const ignoradosMsg = res.info?.ignorados?.length ? `\n\nIgnorados (já têm parcela paga): ${res.info.ignorados.join(', ')}` : '';
      const zeradosMsg = res.info?.zerados?.length ? `\n\nNão fechados (parcela zerada): ${res.info.zerados.join(', ')}` : '';
      toast(`${res.info?.fechados || 0} fechado(s).${ignoradosMsg}${zeradosMsg}`, 'success');
      setParcelasDigitadas({});
      carregar(ano, empresaSelecionada!);
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
      carregar(ano, empresaSelecionada!);
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
      carregar(ano, empresaSelecionada!);
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
      carregar(ano, empresaSelecionada!);
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
          🎄 <strong>13º Salário</strong>. Via Empresa: você pode digitar a 1ª e a 2ª parcela (ou deixar o cálculo sugerido), fechamos, enviamos p/ assinatura e levamos ao lote PIX. Via Contabilidade: o valor é exatamente o do holerite importado em Separar Holerites — só leitura aqui.
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
              {linhasSem13.length > 0 && <> · Sem 13º: {linhasSem13.length}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            <select
              value={empresaSelecionada ?? ''}
              onChange={e => setEmpresaSelecionada(e.target.value ? Number(e.target.value) : null)}
              disabled={empresasCatalogoVisivel.length <= 1}
              className="p-2.5 border border-[#CBD5E1] rounded-xl text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <input type="number" value={ano} onChange={e => setAno(Number(e.target.value) || ano)} className="w-24 p-2.5 border border-[#CBD5E1] rounded-xl text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]" />
            {temAssinaturaDisponivel && (
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider cursor-pointer bg-gray-50 px-3 h-[42px] rounded-xl border border-gray-200 select-none">
                <input type="checkbox" checked={sandbox} onChange={e => setSandbox(e.target.checked)} className="accent-amber-600" />
                <span className={sandbox ? 'text-amber-600' : 'text-red-600'}>{sandbox ? '🧪 Teste' : '⚠ Real'}</span>
              </label>
            )}
            <button onClick={fecharTodos} disabled={processando !== null || fechaveis.length === 0} className="bg-[#16A34A] text-white font-black uppercase tracking-widest text-xs px-5 py-3.5 rounded-xl shadow-sm hover:bg-[#15803D] transition-all disabled:opacity-50 text-center">
              {processando === 'LOTE::fechar' ? '⏳ Fechando...' : `🔒 Fechar Todos (${fechaveis.length})`}
            </button>
            <button onClick={() => router.push('/admin/financeiro/rh')} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-5 py-3.5 rounded-xl shadow-sm hover:bg-[#284B8C] transition-all text-center">
              Ir para Financeiro RH
            </button>
          </div>
        </div>

        {semRegraConfigurada && (
          <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5 text-sm text-amber-800 font-medium">
            ⚠ Nenhum Modelo de Contrato está marcado com "Recebe 13º Salário pela empresa?" ainda. Configure em{' '}
            <button onClick={() => router.push('/admin/rh/parametros')} className="underline font-bold">/admin/rh/parametros</button>.
          </div>
        )}

        <h2 className="text-xs font-black text-[#64748B] uppercase tracking-widest pl-1">💰 Via Empresa</h2>

        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-[#0C1D4D] border-t-transparent rounded-full animate-spin"></div>
              Calculando...
            </div>
          ) : linhas.length === 0 ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
              Nenhum funcionário elegível ao 13º Via Empresa.
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
                    const d = dadosExibidos(l);
                    return (
                      <tr key={key} className="hover:bg-[#F8FAFC] transition-colors align-top">
                        <td className="p-4">
                          <span className="font-black text-[#0C1D4D] text-sm block">{l.func.nome_completo}</span>
                          <span className="text-[10px] text-gray-400 font-bold block uppercase mt-0.5">{l.func.cargo || '—'}</span>
                          <span className="text-[10px] text-[#0C1D4D] font-bold block mt-1">📄 Salário folha: <span className="tabular-nums">{l.func.salario_folha ? BRL(Number(l.func.salario_folha)) : '—'}</span></span>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase inline-block mt-1 ${corSeloEmpresa(l.func.empresa_id)}`}>🏭 Empresa {l.func.empresa_id ?? '—'}</span>
                        </td>
                        <td className="p-4 text-right tabular-nums">{d.mesesAvos}/12</td>
                        <td className="p-4 text-right tabular-nums font-bold">{BRL(d.valorBruto)}</td>
                        <td className="p-4 text-right tabular-nums">
                          {!l.fechamento ? (
                            <input
                              type="text" inputMode="decimal"
                              value={parcelasDigitadas[key]?.p1 ?? ''}
                              onChange={e => setParcelasDigitadas(prev => ({ ...prev, [key]: { p1: e.target.value, p2: prev[key]?.p2 ?? '' } }))}
                              placeholder={BRL(l.dados.parcela1Valor)}
                              title="Digite o valor a pagar na 1ª parcela (sem INSS/IRRF). Vazio = cálculo sugerido."
                              className="w-28 p-1.5 border border-[#CBD5E1] rounded-lg text-right text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]"
                            />
                          ) : BRL(d.parcela1Valor)}
                        </td>
                        <td className="p-4 text-right tabular-nums text-red-600">−{BRL(d.inssValor)}</td>
                        <td className="p-4 text-right tabular-nums text-red-600">−{BRL(d.irrfValor)}</td>
                        <td className="p-4 text-right tabular-nums font-bold">
                          {!l.fechamento ? (
                            <input
                              type="text" inputMode="decimal"
                              value={parcelasDigitadas[key]?.p2 ?? ''}
                              onChange={e => setParcelasDigitadas(prev => ({ ...prev, [key]: { p1: prev[key]?.p1 ?? '', p2: e.target.value } }))}
                              placeholder={BRL(l.dados.parcela2Valor)}
                              title="Digite o valor a pagar na 2ª parcela (sem INSS/IRRF). Vazio = cálculo sugerido."
                              className="w-28 p-1.5 border border-[#CBD5E1] rounded-lg text-right text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]"
                            />
                          ) : BRL(d.parcela2Valor)}
                        </td>
                        <td className="p-4 text-center">
                          {!l.fechamento ? (
                            temValor(l)
                              ? <span className="text-[9px] font-black px-2 py-1 rounded-full uppercase bg-amber-100 text-amber-700">⚠ Em aberto</span>
                              : <span className="text-[9px] font-black px-2 py-1 rounded-full uppercase bg-red-100 text-red-700" title="Não entra no fechamento enquanto a 1ª ou a 2ª parcela estiver zerada">⛔ Valor zerado</span>
                          ) : (
                            <div className="flex flex-col gap-1 items-center">
                              <span className="text-[9px] font-black px-2 py-1 rounded-full uppercase bg-emerald-100 text-emerald-700">🔒 Fechado</span>
                              <span className="text-[9px] font-bold text-gray-500">1ª: {l.fechamento.parcela1PagoEm ? '✅ Paga' : (SELO_ASSINATURA[l.statusAssinaturaP1 || '']?.label || '— Pendente')}</span>
                              <span className="text-[9px] font-bold text-gray-500">2ª: {l.fechamento.parcela2PagoEm ? '✅ Paga' : (SELO_ASSINATURA[l.statusAssinaturaP2 || '']?.label || '— Pendente')}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          <button onClick={() => previaHolerite(l)} disabled={gerandoPrevia !== null} className="text-[10px] font-black text-gray-500 uppercase tracking-wider hover:bg-gray-100 px-3 py-1 rounded disabled:opacity-50 border border-gray-200 mb-1.5">
                            {gerandoPrevia === key ? '⏳' : '👁 Prévia'}
                          </button>
                          {!l.fechamento ? (
                            <span className="text-[10px] text-gray-400 font-bold uppercase block">Feche para liberar as ações</span>
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
          Parcelas digitadas: o valor digitado é o que se paga, sem INSS/IRRF (bruto = 1ª + 2ª). Campo vazio = cálculo sugerido: 1ª parcela = 50% do bruto, sem desconto (prazo legal até 30/11) · 2ª parcela = bruto − 1ª parcela − INSS − IRRF (prazo legal até 20/12).
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
          <h2 className="text-xs font-black text-[#64748B] uppercase tracking-widest pl-1">🏢 Via Contabilidade</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => lerValoresContabilidade(false)} disabled={lendoOcr || linhasContabilidade.length === 0} className="text-[10px] font-black bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
              {lendoOcr ? '⏳ Lendo...' : '🔍 Ler valores (OCR)'}
            </button>
            <button onClick={() => lerValoresContabilidade(true)} disabled={lendoOcr || linhasContabilidade.length === 0} title="Ignora o valor já salvo e lê os comprovantes de novo" className="text-[10px] font-black bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 px-3 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
              🔄 Reler tudo
            </button>
          </div>
        </div>

        {ocrFalhas.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700 font-medium space-y-1">
            <strong className="block uppercase text-[10px] font-black mb-1">⚠ Falhas na leitura — confira manualmente ou digite o valor no documento:</strong>
            {ocrFalhas.map((f, i) => <div key={i}>{f}</div>)}
          </div>
        )}

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
                    <th className="p-4">1ª Parcela</th>
                    <th className="p-4">2ª Parcela</th>
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
                        {([1, 2] as const).map(parcela => {
                          const ref = `${ano}-P${parcela}`;
                          const doc = l.documentos.find(x => x.mesReferencia === ref);
                          return (
                            <td key={parcela} className="p-4">
                              {!doc ? (
                                <span className="text-[10px] font-black text-amber-600 uppercase">⚠ Não importado</span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  {doc.valorOcr != null ? (
                                    <span className="text-xs font-bold text-[#0C1D4D] tabular-nums">{BRL(doc.valorOcr)}</span>
                                  ) : (
                                    <span className="text-[10px] font-black text-amber-600 uppercase">⏳ aguardando leitura</span>
                                  )}
                                  <button onClick={() => verDocumento(key, ref)} disabled={abrindoDoc !== null} className="text-[9px] font-black text-indigo-600 uppercase hover:bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 disabled:opacity-50">
                                    {abrindoDoc === `${key}::${ref}` ? '...' : '👁 Ver'}
                                  </button>
                                </div>
                              )}
                            </td>
                          );
                        })}
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
          Via Contabilidade: valor igual ao do holerite importado em /admin/rh/holerite → Separar Holerites (tipo "Décimo Terceiro", escolhendo a 1ª ou a 2ª parcela). Sem cálculo nosso; o pagamento roda pela fonte "13º Salário (contabilidade)" do lote de /admin/financeiro/rh, escolhendo a parcela.
        </p>

        <h2 className="text-xs font-black text-[#64748B] uppercase tracking-widest pl-1 pt-4">🚫 Sem 13º Salário</h2>

        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-[#0C1D4D] border-t-transparent rounded-full animate-spin"></div>
              Carregando...
            </div>
          ) : linhasSem13.length === 0 ? (
            <div className="p-10 text-center text-emerald-600 font-bold uppercase tracking-wider text-sm">
              ✓ Todos os colaboradores ativos desta empresa estão em Via Empresa ou Via Contabilidade.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                  <tr className="text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                    <th className="p-4">Colaborador</th>
                    <th className="p-4">Modelo de Contrato</th>
                    <th className="p-4">Por que não recebe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] font-medium">
                  {linhasSem13.map(l => (
                    <tr key={l.func.nome_completo} className="hover:bg-[#F8FAFC] transition-colors align-top">
                      <td className="p-4">
                        <span className="font-black text-[#0C1D4D] text-sm block">{l.func.nome_completo}</span>
                        <span className="text-[10px] text-gray-400 font-bold block uppercase mt-0.5">{l.func.cargo || '—'}</span>
                      </td>
                      <td className="p-4 text-xs font-bold text-[#0C1D4D] uppercase">{l.func.tipo_contrato || '—'}</td>
                      <td className="p-4 text-xs text-gray-600">{l.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[10px] text-gray-400 font-bold tracking-wide mt-2 text-center uppercase">
          Sem 13º: colaboradores ativos da empresa que não caem em nenhuma das listas acima. Se alguém aqui deveria receber, ajuste o Modelo de Contrato em{' '}
          <button onClick={() => router.push('/admin/rh/parametros')} className="underline">/admin/rh/parametros</button> ou na ficha do funcionário.
        </p>
      </div>
    </div>
  );
}
