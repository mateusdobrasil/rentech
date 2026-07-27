// app/lib/textract.ts
// Helper compartilhado para leitura de PDFs via AWS Textract. Usado hoje pelo
// OCR de valores em app/admin/rh/actions/actions-financeiro.ts e pelo
// reconhecimento automático do funcionário nos holerites da contabilidade em
// app/admin/rh/actions/actions-documentos.ts. Credenciais via
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION (lidas
// automaticamente pelo SDK a partir do ambiente).
import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";

const textractClient = new TextractClient({
  region: process.env.AWS_REGION || "us-east-1"
});

// Envia o PDF (base64) ao Textract e devolve o texto lido, linha a linha.
export async function extrairTextoPdf(pdfBase64: string): Promise<string> {
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
