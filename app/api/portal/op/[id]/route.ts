import { NextResponse } from 'next/server';
import { buscarOP } from '../../../../admin/op/actions';

// GET /api/portal/op/[id]
// Authorization: Bearer <access_token>
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const resultado = await buscarOP(id, accessToken);
  if (!resultado.success) return NextResponse.json({ ok: false, erro: resultado.message }, { status: 401 });
  return NextResponse.json({ ok: true, info: resultado.data });
}
