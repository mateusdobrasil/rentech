// app/api/fatura/[token]/route.ts
// Link público da Nota de Débito (Faturamento, 2026-11-20) — vai no e-mail,
// no WhatsApp e no Portal do Cliente. O token é aleatório (18 bytes) e só
// existe na fatura; sem ele não há como listar ou adivinhar faturas.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { dadosFatura, numeroExibicao } from '../../../lib/financeiro/faturamento';
import { gerarFaturaPdf } from '../../../lib/financeiro/gerarFaturaPdf';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token || '')) return NextResponse.json({ erro: 'Link inválido.' }, { status: 404 });
  const db = supabaseAdmin();
  const { data: f } = await db.from('financeiro_faturas').select('id').eq('token_publico', token).maybeSingle();
  if (!f) return NextResponse.json({ erro: 'Fatura não encontrada.' }, { status: 404 });
  const d = await dadosFatura(db, f.id);
  const bytes = await gerarFaturaPdf(d);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="nota-de-debito-${numeroExibicao(d.fatura)}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
