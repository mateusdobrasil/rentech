"use client";

// Aba "📥 Retorno de Arquivo" de /admin/financeiro/rh — lê o arquivo de
// retorno do SISPAG (boletos pagos por arquivo CNAB) e dá baixa nas OPs e
// contas a pagar que vieram com ocorrência "00" (Pagamento efetuado). A
// leitura e a baixa acontecem no servidor (importarRetornoSispagAction); aqui
// só se mostra a prévia e se pede confirmação antes de gravar.

import { useState } from 'react';
import { importarRetornoSispagAction, type LinhaRetornoSispag } from '../../rh/actions/actions-financeiro';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (iso: string | null) => iso ? iso.split('-').reverse().join('/') : '—';

const SELO_SITUACAO: Record<LinhaRetornoSispag['situacao'], { rotulo: string; cor: string }> = {
  PAGO: { rotulo: 'Pago', cor: 'bg-emerald-100 text-emerald-700' },
  AGENDADO: { rotulo: 'Agendado', cor: 'bg-sky-100 text-sky-700' },
  PARCIAL: { rotulo: 'Pago em parte', cor: 'bg-amber-100 text-amber-800' },
  RECUSADO: { rotulo: 'Recusado', cor: 'bg-red-100 text-red-700' },
};

const ROTULO_ACAO: Record<LinhaRetornoSispag['acao'], { rotulo: string; cor: string }> = {
  BAIXAR: { rotulo: 'Vai dar baixa', cor: 'text-emerald-700' },
  BAIXADA: { rotulo: '✓ Baixa feita', cor: 'text-emerald-700' },
  JA_BAIXADA: { rotulo: 'Já estava baixada', cor: 'text-gray-500' },
  SEM_ACAO: { rotulo: 'Nada a fazer', cor: 'text-gray-500' },
  NAO_ENCONTRADA: { rotulo: 'Não encontrada', cor: 'text-red-600' },
  SEM_PERMISSAO: { rotulo: 'Sem permissão', cor: 'text-red-600' },
};

export default function RetornoArquivoSispag({ accessToken }: { accessToken: string }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [arquivo, setArquivo] = useState<{ nome: string; conteudo: string } | null>(null);
  const [linhas, setLinhas] = useState<LinhaRetornoSispag[] | null>(null);
  const [ignorados, setIgnorados] = useState(0);
  const [processando, setProcessando] = useState(false);

  const ler = async (file: File | undefined) => {
    if (!file) return;
    setLinhas(null);
    setProcessando(true);
    try {
      const conteudo = await file.text();
      const res = await importarRetornoSispagAction({ conteudo, aplicar: false }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setArquivo({ nome: file.name, conteudo });
      setLinhas(res.info.linhas);
      setIgnorados(res.info.ignorados);
      if (res.info.linhas.length === 0) toast('O arquivo não tem pagamentos de boleto (segmentos J/O).', 'info');
    } catch (e) {
      setArquivo(null);
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setProcessando(false);
    }
  };

  const aBaixar = (linhas || []).filter(l => l.acao === 'BAIXAR');

  const aplicar = async () => {
    if (!arquivo || aBaixar.length === 0) return;
    const ok = await confirmar({
      title: 'Dar baixa pelo retorno do Itaú',
      message: `${aBaixar.length} pagamento(s) vão virar PAGO (e ser quitados no PrimeStart quando houver conta lá).\n\n` +
        'Use só arquivo de retorno do ambiente de PRODUÇÃO — o retorno do ambiente de Teste é simulado e daria baixa em pagamento que não aconteceu.',
      confirmLabel: 'Dar baixa',
      danger: true,
    });
    if (!ok) return;
    setProcessando(true);
    try {
      const res = await importarRetornoSispagAction({ conteudo: arquivo.conteudo, aplicar: true }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setLinhas(res.info.linhas);
      toast(`${res.info.baixadas} baixa(s) feita(s).${res.info.avisosP2s.length ? ` ${res.info.avisosP2s.length} com aviso do PrimeStart — veja a coluna Observação.` : ''}`, res.info.avisosP2s.length ? 'info' : 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0]">
      <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">📥 Retorno de arquivo SISPAG (boletos)</h3>
      <p className="text-[11px] text-gray-500 mb-4">
        Arquivo baixado no Itaú Empresas em Transmissão de Arquivo → Transmissão (Produção) → Retorno. Cada pagamento é ligado à OP ou conta a pagar
        pelo &quot;seu número&quot; (OP622, CP45). Só ocorrência <strong>00 — Pagamento efetuado</strong> dá baixa; agendados e recusados aparecem só para conferência.
      </p>

      <label className={`inline-flex items-center gap-2 text-xs font-black px-4 py-2.5 rounded-lg uppercase tracking-wider cursor-pointer ${processando ? 'bg-gray-200 text-gray-500' : 'bg-[#0C1D4D] hover:bg-[#13296b] text-white'}`}>
        {processando ? '⏳ Lendo...' : '📂 Escolher arquivo de retorno'}
        <input type="file" accept=".txt,.ret,.rem,text/plain" className="hidden" disabled={processando}
          onChange={e => { ler(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {arquivo && <span className="ml-3 text-[11px] font-bold text-gray-500">{arquivo.nome}</span>}

      {linhas && linhas.length > 0 && (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] font-black text-gray-500 uppercase border-b border-[#E2E8F0]">
                  <th className="p-2">Seu nº</th>
                  <th className="p-2">Favorecido</th>
                  <th className="p-2 text-right">Valor pago</th>
                  <th className="p-2">Data</th>
                  <th className="p-2">Retorno do Itaú</th>
                  <th className="p-2">Ação</th>
                  <th className="p-2">Observação</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={`${l.seuNumero}-${i}`} className={`border-b border-[#E2E8F0] ${i % 2 ? 'bg-[#F8FAFC]' : ''}`}>
                    <td className="p-2 font-black text-[#0C1D4D] whitespace-nowrap">{l.seuNumero || '—'}</td>
                    <td className="p-2">{l.favorecido}</td>
                    <td className="p-2 text-right tabular-nums whitespace-nowrap">
                      {BRL(l.valorPago)}
                      {l.valorEsperado != null && Math.abs(l.valorEsperado - l.valorPago) > 0.009 && (
                        <span className="block text-[10px] text-amber-700">sistema: {BRL(l.valorEsperado)}</span>
                      )}
                    </td>
                    <td className="p-2 whitespace-nowrap">{dataBR(l.dataPagamento)}</td>
                    <td className="p-2">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${SELO_SITUACAO[l.situacao].cor}`}>{SELO_SITUACAO[l.situacao].rotulo}</span>
                      <span className="block text-[10px] text-gray-500 mt-0.5">{l.descricao}</span>
                    </td>
                    <td className={`p-2 font-black whitespace-nowrap ${ROTULO_ACAO[l.acao].cor}`}>{ROTULO_ACAO[l.acao].rotulo}</td>
                    <td className="p-2 text-[10px] text-amber-700">{l.aviso || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ignorados > 0 && <p className="mt-2 text-[10px] text-gray-500">{ignorados} registro(s) de outro tipo (PIX/TED) ignorados — esses são conferidos pela aba Retorno API Itaú.</p>}
          <div className="mt-4 flex items-center gap-3">
            <button onClick={aplicar} disabled={processando || aBaixar.length === 0}
              className="text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-40">
              ✓ Dar baixa em {aBaixar.length} pagamento(s)
            </button>
            {aBaixar.length === 0 && <span className="text-[11px] text-gray-500">Nenhum pagamento novo com ocorrência 00 neste arquivo.</span>}
          </div>
        </>
      )}
    </div>
  );
}
