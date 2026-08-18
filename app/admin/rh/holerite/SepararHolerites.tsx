"use client";

import { useState, useRef, useEffect } from 'react';
import { salvarDocumentosContabeisAction, identificarFuncionarioOcrAction } from '../actions/actions-documentos';
import { useToast } from '../../../components/ui/NotificationProvider';

// pdf-lib e pdfjs são carregados dinamicamente (client-side) para separar e
// renderizar as páginas. Nada disso depende do servidor/Vercel.

interface FuncionarioElegivel {
  nome_completo: string;
  tipo_contrato: string;
}

interface PaginaSeparada {
  paginaOrigem: number;      // 1-based
  imagemDataUrl: string;     // preview renderizado
  pdfBase64: string;         // a página isolada em PDF
  funcionarioNome: string;   // associação (editável); '' = ignorar
  confianca: 'ALTA' | 'MEDIA' | 'MANUAL'; // ALTA/MEDIA = achado pelo OCR; MANUAL = chute posicional, precisa conferir
}

interface Props {
  mesReferencia: string;
  usuarioAtual: string;
  accessToken: string;
  // Funcionários ativos cujo contrato tem recebe_holerite_contabilidade = true,
  // já em ordem alfabética. Vem da página de Ponto.
  elegiveis: FuncionarioElegivel[];
  onFechar: () => void;
}

export default function SepararHolerites({ mesReferencia, usuarioAtual, accessToken, elegiveis, onFechar }: Props) {
  const toast = useToast();
  const [competencia, setCompetencia] = useState(mesReferencia);
  const [tipo, setTipo] = useState<'ADIANTAMENTO' | 'HOLERITE_MENSAL' | 'DECIMO_TERCEIRO' | 'FERIAS'>('ADIANTAMENTO');
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState('');
  const [paginas, setPaginas] = useState<PaginaSeparada[]>([]);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Formata 'AAAA-MM' → 'MM/AAAA'
  const mesBR = (iso: string) => { if (!iso) return ''; const [a, m] = iso.split('-'); return `${m}/${a}`; };
  // Mês de pagamento = competência + 1 mês (a Rentech paga no mês seguinte)
  const mesPagamento = (comp: string) => {
    if (!comp) return '';
    const [a, m] = comp.split('-').map(Number);
    const d = new Date(a, m, 1); // m já é o mês seguinte (0-based + 1)
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  // Carrega o pdf.js uma vez (do CDN) e devolve a lib pronta
  const carregarPdfjs = async (): Promise<any> => {
    const w = window as any;
    if (w.pdfjsLib) return w.pdfjsLib;
    await new Promise<void>((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => res(); s.onerror = () => rej(new Error('Falha ao carregar pdf.js'));
      document.head.appendChild(s);
    });
    w.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return w.pdfjsLib;
  };

  const carregarPdfLib = async (): Promise<any> => {
    const w = window as any;
    if (w.PDFLib) return w.PDFLib;
    await new Promise<void>((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
      s.onload = () => res(); s.onerror = () => rej(new Error('Falha ao carregar pdf-lib'));
      document.head.appendChild(s);
    });
    return w.PDFLib;
  };

  // Converte bytes → base64 em blocos. Fazer String.fromCharCode(...array) de
  // uma vez estoura a pilha ("Maximum call stack size exceeded") em PDFs grandes.
  const bytesParaBase64 = (bytes: Uint8Array): string => {
    let binario = '';
    const bloco = 0x8000; // 32KB por vez
    for (let i = 0; i < bytes.length; i += bloco) {
      binario += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + bloco)));
    }
    return btoa(binario);
  };

  const handleArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { toast('Envie um arquivo PDF.', 'error'); return; }

    setProcessando(true);
    setPaginas([]);
    setNomeArquivo(file.name);
    try {
      setProgresso('Carregando bibliotecas...');
      const [pdfjsLib, PDFLib] = await Promise.all([carregarPdfjs(), carregarPdfLib()]);

      const buffer = await file.arrayBuffer();

      // 1) Renderiza cada página como imagem (preview) com pdf.js
      setProgresso('Lendo o PDF...');
      const doc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
      const totalPaginas = doc.numPages;

      // 2) Carrega o mesmo PDF no pdf-lib para poder recortar páginas
      const pdfOrigem = await PDFLib.PDFDocument.load(buffer.slice(0));

      const novas: PaginaSeparada[] = [];
      for (let i = 1; i <= totalPaginas; i++) {
        setProgresso(`Separando página ${i} de ${totalPaginas}...`);

        // Preview: renderiza SÓ o cabeçalho (canto superior esquerdo), onde ficam
        // o nome e os dados do funcionário. Escala maior deixa o texto nítido;
        // recortamos ~24% da altura e ~50% da largura (metade esquerda).
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.4 });
        const fatiaTopo = Math.round(viewport.height * 0.24);
        const fatiaLargura = Math.round(viewport.width * 0.5);
        const canvas = document.createElement('canvas');
        canvas.width = fatiaLargura;                   // metade esquerda
        canvas.height = fatiaTopo;                     // só a faixa do cabeçalho
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // render normal; o canvas menor "corta" naturalmente o que passa da faixa
        await page.render({ canvasContext: ctx, viewport }).promise;
        const imagemDataUrl = canvas.toDataURL('image/jpeg', 0.85);

        // recorta a página i para um PDF isolado
        const novoPdf = await PDFLib.PDFDocument.create();
        const [copiada] = await novoPdf.copyPages(pdfOrigem, [i - 1]);
        novoPdf.addPage(copiada);
        const bytes = await novoPdf.save();
        const pdfBase64 = bytesParaBase64(bytes);

        // Identifica o funcionário lendo o texto da página via AWS Textract
        // (mesmo OCR usado no Financeiro). Se não achar com segurança, cai
        // para o chute posicional (ordem alfabética) marcado como MANUAL,
        // para o usuário conferir.
        setProgresso(`Lendo página ${i} de ${totalPaginas} com OCR (AWS)...`);
        let funcionarioNome = '';
        let confianca: 'ALTA' | 'MEDIA' | 'MANUAL' = 'MANUAL';
        try {
          const ocr = await identificarFuncionarioOcrAction({
            pdfBase64, nomesElegiveis: elegiveis.map(f => f.nome_completo)
          }, accessToken);
          if (ocr.ok && ocr.info?.nome) {
            funcionarioNome = ocr.info.nome;
            confianca = ocr.info.confianca;
          }
        } catch { /* segue para o fallback abaixo */ }

        if (!funcionarioNome) {
          // fallback: pré-associação por ordem alfabética (página i → i-ésimo elegível)
          funcionarioNome = elegiveis[i - 1]?.nome_completo || '';
        }

        novas.push({ paginaOrigem: i, imagemDataUrl, pdfBase64, funcionarioNome, confianca });
      }

      setPaginas(novas);
      setProgresso('');
    } catch (err: any) {
      toast('Erro ao processar o PDF: ' + err.message, 'error');
    } finally {
      setProcessando(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const alterarAssociacao = (idx: number, nome: string) => {
    // Troca manual sobrescreve o que o OCR achou — deixa de ser ALTA/MEDIA
    setPaginas(prev => prev.map((p, i) => i === idx ? { ...p, funcionarioNome: nome, confianca: 'MANUAL' } : p));
  };

  // Nomes já usados (para sinalizar duplicidade)
  const nomesUsados = paginas.filter(p => p.funcionarioNome).map(p => p.funcionarioNome);
  const duplicados = new Set(nomesUsados.filter((n, i) => nomesUsados.indexOf(n) !== i));
  const semAssociacao = paginas.filter(p => !p.funcionarioNome).length;
  const achadasPeloOcr = paginas.filter(p => p.confianca === 'ALTA' || p.confianca === 'MEDIA').length;
  const precisamRevisao = paginas.filter(p => p.funcionarioNome && p.confianca === 'MANUAL').length;

  const salvar = async () => {
    const itens = paginas.filter(p => p.funcionarioNome).map(p => ({
      funcionarioNome: p.funcionarioNome, pdfBase64: p.pdfBase64, paginaOrigem: p.paginaOrigem,
      confiancaMatch: p.confianca
    }));
    if (itens.length === 0) { toast('Associe pelo menos uma página a um funcionário.', 'error'); return; }
    if (duplicados.size > 0) {
      if (!confirm(`Há ${duplicados.size} funcionário(s) associados a mais de uma página. O último sobrescreve. Continuar?`)) return;
    }

    setSalvando(true);
    // Envia um item por chamada: mandar todas as páginas juntas em uma única
    // Server Action estoura o limite de tamanho de requisição da hospedagem
    // (a Vercel limita o corpo da requisição independente do bodySizeLimit
    // configurado no next.config.ts), o que fazia o salvamento falhar com
    // "An unexpected response was received from the server".
    let salvos = 0;
    const falhas: string[] = [];
    try {
      for (let i = 0; i < itens.length; i++) {
        setProgresso(`Salvando ${i + 1} de ${itens.length}...`);
        const res = await salvarDocumentosContabeisAction({
          mesReferencia: competencia, tipo, nomeArquivoOrigem: nomeArquivo, importadoPor: usuarioAtual, itens: [itens[i]]
        }, accessToken);
        if (res.ok) {
          salvos += res.info?.salvos || 0;
          if (res.info?.falhas?.length) falhas.push(...res.info.falhas);
        } else {
          falhas.push(`${itens[i].funcionarioNome}: ${res.erro || 'falha desconhecida'}`);
        }
      }
      setProgresso('');
      const falhasMsg = falhas.length ? `\n\nFalhas:\n${falhas.join('\n')}` : '';
      toast(`${salvos} de ${itens.length} documento(s) salvos.${falhasMsg}`, falhas.length ? 'error' : 'success');
      if (salvos > 0) { setPaginas([]); setNomeArquivo(''); }
    } catch (e: any) {
      setProgresso('');
      toast('Erro ao salvar: ' + e.message, 'error');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0]">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Separar Holerites da Contabilidade</h2>
            <p className="text-sm text-gray-500">Importa o PDF, separa por página e associa a cada funcionário.</p>
          </div>
          <button onClick={onFechar} className="text-[10px] font-black bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-lg uppercase tracking-wider">⬅ Voltar</button>
        </div>

        {/* Competência (editável) + mês de pagamento (calculado) */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex flex-col sm:flex-row items-stretch sm:items-end gap-4">
          <div className="flex-1">
            <label className="block text-[10px] font-black text-blue-700 uppercase mb-1">Mês de competência</label>
            <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} disabled={paginas.length > 0} className="w-full p-2.5 border border-blue-300 rounded-lg text-sm font-bold bg-white disabled:opacity-50" />
          </div>
          <div className="hidden sm:flex items-center pb-3 text-blue-400 font-black">→</div>
          <div className="flex-1">
            <label className="block text-[10px] font-black text-blue-700 uppercase mb-1">Mês de pagamento (automático)</label>
            <div className="w-full p-2.5 border border-blue-200 rounded-lg text-sm font-black bg-blue-100 text-blue-800">
              {competencia ? mesPagamento(competencia) : '—'}
            </div>
          </div>
          <div className="flex-[2] text-[11px] font-medium text-blue-700 pb-1">
            Competência <strong>{mesBR(competencia) || '—'}</strong> será paga em <strong>{competencia ? mesPagamento(competencia) : '—'}</strong>.
            {paginas.length > 0 && <span className="block text-amber-600 font-bold mt-1">Para trocar a competência, limpe a importação atual.</span>}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
          <div className="flex-1">
            <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Tipo de documento</label>
            <select value={tipo} onChange={e => setTipo(e.target.value as any)} disabled={paginas.length > 0} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white disabled:opacity-50">
              <option value="ADIANTAMENTO">Adiantamento (dia 20)</option>
              <option value="HOLERITE_MENSAL">Holerite de pagamento mensal</option>
              <option value="DECIMO_TERCEIRO">Décimo Terceiro (13º)</option>
              <option value="FERIAS">Férias</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Arquivo PDF da contabilidade</label>
            <input ref={fileRef} type="file" accept="application/pdf" onChange={handleArquivo} disabled={processando || !competencia} className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#0C1D4D] file:text-white file:font-bold file:text-xs file:uppercase disabled:opacity-50" />
          </div>
        </div>

        <div className="mt-3 text-[11px] font-bold text-gray-500">
          {elegiveis.length} funcionário(s) elegível(is) (contrato com holerite da contabilidade), em ordem alfabética.
        </div>

        {processando && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm font-bold text-blue-700">
            ⏳ {progresso}
          </div>
        )}
      </div>

      {paginas.length > 0 && (
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0]">
          {/* Barra de status da conferência */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-4 border-b border-gray-200">
            <div className="flex items-center gap-4 text-xs font-bold flex-wrap">
              <span className="text-gray-700">{paginas.length} página(s)</span>
              <span className="text-gray-400">·</span>
              <span className={elegiveis.length === paginas.length ? 'text-emerald-600' : 'text-amber-600'}>
                {elegiveis.length === paginas.length
                  ? '✓ Contagem bate com os elegíveis'
                  : `⚠ ${paginas.length} páginas vs ${elegiveis.length} elegíveis`}
              </span>
              {semAssociacao > 0 && <span className="text-amber-600">· {semAssociacao} sem associação</span>}
              {duplicados.size > 0 && <span className="text-red-600">· {duplicados.size} duplicado(s)</span>}
              <span className="text-emerald-600">· {achadasPeloOcr} identificado(s) por OCR</span>
              {precisamRevisao > 0 && <span className="text-amber-600">· {precisamRevisao} sem leitura (revisar manualmente)</span>}
            </div>
            <button onClick={salvar} disabled={salvando} className="bg-[#16A34A] hover:bg-[#15803D] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md transition-all disabled:opacity-50">
              {salvando ? `⏳ ${progresso || 'Salvando...'}` : '💾 Salvar Documentos'}
            </button>
          </div>

          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-4 font-medium">
            ⚠ O nome de cada página foi lido automaticamente por OCR (AWS Textract). Onde o OCR não conseguiu ler com segurança, a página cai para a ordem alfabética e fica marcada como &ldquo;revisar&rdquo; — confira essas pelo nome visível e ajuste no dropdown se necessário.
          </p>

          {/* Grade de revisão: imagem da página + dropdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginas.map((p, idx) => {
              const dup = p.funcionarioNome && duplicados.has(p.funcionarioNome);
              return (
                <div key={idx} className={`border rounded-xl overflow-hidden ${!p.funcionarioNome ? 'border-amber-300' : dup ? 'border-red-300' : p.confianca === 'MANUAL' ? 'border-blue-200' : 'border-gray-200'}`}>
                  <div className="bg-gray-50 px-3 py-2 flex items-center justify-between border-b border-gray-200">
                    <span className="text-[10px] font-black text-gray-500 uppercase">Página {p.paginaOrigem}</span>
                    <div className="flex items-center gap-1.5">
                      {p.confianca === 'ALTA' && <span className="text-[9px] font-black text-emerald-600 uppercase">✓ OCR</span>}
                      {p.confianca === 'MEDIA' && <span className="text-[9px] font-black text-blue-600 uppercase">OCR (conferir)</span>}
                      {p.funcionarioNome && p.confianca === 'MANUAL' && <span className="text-[9px] font-black text-amber-600 uppercase">⚠ revisar</span>}
                      {dup && <span className="text-[9px] font-black text-red-600 uppercase">⚠ duplicado</span>}
                      {!p.funcionarioNome && <span className="text-[9px] font-black text-amber-600 uppercase">ignorada</span>}
                    </div>
                  </div>
                  <img src={p.imagemDataUrl} alt={`Cabeçalho da página ${p.paginaOrigem}`} className="w-full object-contain bg-white border-b border-gray-100" />
                  <div className="p-2 border-t border-gray-200">
                    <select
                      value={p.funcionarioNome}
                      onChange={e => alterarAssociacao(idx, e.target.value)}
                      className={`w-full p-2 border rounded text-xs font-bold ${!p.funcionarioNome ? 'border-amber-300 bg-amber-50 text-amber-700' : dup ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300 text-[#0C1D4D]'}`}
                    >
                      <option value="">— ignorar esta página —</option>
                      {elegiveis.map(f => (
                        <option key={f.nome_completo} value={f.nome_completo}>{f.nome_completo}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}