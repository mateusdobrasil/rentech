import { NextResponse } from 'next/server';
import { obterPerfilValidado } from '../../../lib/serverAuth';
import {
  listarSolicitacoesPendentesAction,
  listarHistoricoSolicitacoesAction,
  listarSolicitacoesFolgaAction,
  type SolicitacaoHistorico,
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
//
// FOLGA_DIA fica fora de listarSolicitacoesPendentesAction/
// listarHistoricoSolicitacoesAction de propósito (a action explica: "tem
// listagem e aba próprias") — é a mesma separação que existe no admin entre
// a lista principal e a aba "Solicitação Folga". No app não faz sentido
// replicar essa divisão em duas telas, então mescla os dois aqui: mesmo
// acesso (validarAcessoPontoWhatsapp cobre as 3 rotas pra ambas as
// actions), e aprovar/rejeitar já usam as mesmas duas actions pra
// qualquer tipo (inclusive FOLGA_DIA).
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  const { searchParams } = new URL(request.url);
  const filtro = searchParams.get('filtro') === 'resolvidas' ? 'resolvidas' : 'pendentes';

  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  const folgas = await listarSolicitacoesFolgaAction(accessToken);
  const listaFolgas: SolicitacaoHistorico[] = folgas.ok ? (folgas.info || []) : [];

  if (filtro === 'pendentes') {
    const resultado = await listarSolicitacoesPendentesAction(accessToken);
    if (!resultado.ok) return NextResponse.json(resultado, { status: 401 });
    const pendentesFolga = listaFolgas.filter(s => s.status === 'PENDENTE');
    const info = [...(resultado.info || []), ...pendentesFolga].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    return NextResponse.json({ ok: true, info });
  }

  const resultado = await listarHistoricoSolicitacoesAction(undefined, accessToken);
  if (!resultado.ok) return NextResponse.json(resultado, { status: 401 });
  const resolvidas = (resultado.info || []).filter(s => s.status !== 'PENDENTE');
  const resolvidasFolga = listaFolgas.filter(s => s.status !== 'PENDENTE');
  const info = [...resolvidas, ...resolvidasFolga].sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  return NextResponse.json({ ok: true, info });
}
