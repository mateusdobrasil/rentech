// app/lib/textract.ts
// Helper compartilhado para leitura de PDFs. Usado hoje pelo OCR de valores
// em app/admin/rh/actions/actions-financeiro.ts e pelo reconhecimento
// automático do funcionário nos holerites da contabilidade em
// app/admin/rh/actions/actions-documentos.ts. Credenciais AWS via
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION (lidas
// automaticamente pelo SDK a partir do ambiente).
import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { PDFParse } from "pdf-parse";

const textractClient = new TextractClient({
  region: process.env.AWS_REGION || "us-east-1"
});

// Tenta ler a camada de texto NATIVA do PDF (sem OCR) — documentos digitados
// (recibos, TRCTs, holerites emitidos por sistema) sempre têm essa camada, é
// mais rápido, mais barato e mais confiável que o Textract, cuja ordem de
// leitura (linha a linha, sem entender a estrutura de tabela) embaralha
// formulários com colunas/campos numerados lado a lado (ex.: TRCT de
// rescisão — ver .sql/folha_documentos_contabeis_tipo_rescisao.sql), fazendo
// o nome do funcionário ou o "VALOR LÍQUIDO" não baterem com o texto lido.
// Só PDF realmente escaneado (foto, sem OCR prévio) não tem essa camada —
// devolve string vazia/curta e cai para o Textract abaixo.
async function extrairTextoNativoPdf(pdfBase64: string): Promise<string> {
  const bytes = Buffer.from(pdfBase64, 'base64');
  const parser = new PDFParse({ data: bytes });
  try {
    const resultado = await parser.getText();
    return resultado.text || '';
  } finally {
    await parser.destroy();
  }
}

// Devolve o texto do PDF, linha a linha: primeiro tenta a camada nativa do
// PDF; só chama o Textract (OCR de verdade, via AWS) se o PDF não tiver
// texto embutido suficiente (documento escaneado).
export async function extrairTextoPdf(pdfBase64: string): Promise<string> {
  try {
    const textoNativo = await extrairTextoNativoPdf(pdfBase64);
    if (textoNativo.trim().length > 20) return textoNativo;
  } catch {
    // PDF corrompido pro parser nativo, ou sem camada de texto de fato — segue pro Textract.
  }

  const documentBytes = Buffer.from(pdfBase64, 'base64');
  const command = new DetectDocumentTextCommand({
    Document: { Bytes: documentBytes },
  });
  const response = await textractClient.send(command);
  if (!response.Blocks) return '';
  return response.Blocks
    .filter(block => block.BlockType === 'LINE' && block.Text)
    .map(block => block.Text)
    .join('\n');
}

const normalizarTexto = (s: string): string => s
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export type MatchFuncionario = { nome: string; confianca: 'ALTA' | 'MEDIA' };

// Procura, dentre os nomes elegíveis, qual aparece no texto lido do
// cabeçalho do holerite. Evita associar errado: em caso de nome duplicado no
// texto ou empate na pontuação por similaridade, devolve null (revisão
// manual) em vez de arriscar um "chute".
export function identificarFuncionarioNoTexto(
  textoOcr: string,
  nomesElegiveis: string[]
): MatchFuncionario | null {
  const textoNorm = normalizarTexto(textoOcr);
  if (!textoNorm) return null;

  const exatos = nomesElegiveis.filter(nome => textoNorm.includes(normalizarTexto(nome)));
  if (exatos.length === 1) return { nome: exatos[0], confianca: 'ALTA' };
  if (exatos.length > 1) return null;

  const candidatos = nomesElegiveis
    .map(nome => {
      const palavras = normalizarTexto(nome).split(' ').filter(Boolean);
      if (palavras.length < 2) return { nome, score: 0 };
      const achadas = palavras.filter(p => new RegExp(`\\b${p}\\b`).test(textoNorm)).length;
      return { nome, score: achadas / palavras.length };
    })
    .filter(c => c.score >= 0.75)
    .sort((a, b) => b.score - a.score);

  if (candidatos.length === 0) return null;
  if (candidatos.length > 1 && candidatos[0].score === candidatos[1].score) return null;
  return { nome: candidatos[0].nome, confianca: 'MEDIA' };
}
