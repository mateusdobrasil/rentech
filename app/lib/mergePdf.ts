// lib/mergePdf.ts
// Junta vários PDFs (Uint8Array) num único PDF, na ordem fornecida.
// Usado para anexar adiantamento/holerite da contabilidade ao resumo gerado,
// formando um documento único para assinatura.
import { PDFDocument } from 'pdf-lib';

export async function mergePdfs(pdfs: Uint8Array[]): Promise<Uint8Array> {
  const validos = pdfs.filter(p => p && p.length > 0);
  if (validos.length === 0) throw new Error('Nenhum PDF para juntar.');
  if (validos.length === 1) return validos[0];

  const final = await PDFDocument.create();
  for (const bytes of validos) {
    const doc = await PDFDocument.load(bytes);
    const paginas = await final.copyPages(doc, doc.getPageIndices());
    paginas.forEach(p => final.addPage(p));
  }
  return await final.save();
}