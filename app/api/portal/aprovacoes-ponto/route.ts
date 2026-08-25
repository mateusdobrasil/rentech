import { NextResponse } from 'next/server';
import { obterPerfilValidado } from '../../../lib/serverAuth';
import {
  listarSolicitacoesPendentesAction,
  listarHistoricoSolicitacoesAction,
} from '../../../admin/rh/actions/actions-ponto-whatsapp';

// GET /api/portal/aprovacoes-ponto?filtro=pendentes|resolvidas
// Authorization: Bearer <access_token>
//
// Wrapper fino em cima das Server Actions que já existem pra Aprovações de
// Ponto (app/admin/rh/actions/actions-ponto-whatsapp.ts) — elas mesmas já se
// validam contra folha_paginas_permissoes, não precisa de resolvedor novo.
// Chamar uma Server Action a partir de uma Route Handler (código de
// servidor chamando código de servidor) não cruza a fronteira que "use
// server" protege — isso só importa pra client components.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  const { searchParams } = new URL(request.url);
  const filtro = searchParams.get('filtro') === 'resolvidas' ? 'resolvidas' : 'pendentes';

  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  if (filtro === 'pendentes') {
    const resultado = await listarSolicitacoesPendentesAction(accessToken);
    if (!resultado.ok) return NextResponse.json(resultado, { status: 401 });
    return NextResponse.json({ ok: true, info: resultado.info });
  }

  const resultado = await listarHistoricoSolicitacoesAction(undefined, accessToken);
  if (!resultado.ok) return NextResponse.json(resultado, { status: 401 });
  const resolvidas = (resultado.info || []).filter(s => s.status !== 'PENDENTE');
  return NextResponse.json({ ok: true, info: resolvidas });
}
