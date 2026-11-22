// app/api/cron/fiscal/route.ts
// Atualização automática do Fiscal (2026-11-22).
//
// Por quê: NF-e, NFS-e e MDF-e que ficam "processando" na Focus (SEFAZ ou
// Prefeitura demoraram, ou a resposta se perdeu na rede) só eram consultados
// quando alguém abria a tela Fiscal. Sem isso, uma nota podia ficar parada sem
// número/DANFE, ou ter dado erro sem ninguém ver.
//
// Como: a cada 10 min (vercel.json) consulta na Focus tudo que está
// PROCESSANDO — notas e MDF-e, de todas as empresas e dos dois ambientes — com
// as mesmas funções da tela (consultarNota / consultarMdfe). Nota que a Focus
// não conhece vira ERRO ("emita de novo"). Sem nada processando, é uma
// consulta rápida ao banco e nenhuma chamada à Focus.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { atualizarProcessando } from '../../../lib/fiscal/notas';
import { atualizarMdfeProcessando } from '../../../lib/fiscal/mdfe';

export const maxDuration = 120;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  const db = supabaseAdmin();
  const resultado: Record<string, unknown> = {};
  try { resultado.notas = await atualizarProcessando(db, 50); } catch (e: any) { resultado.erroNotas = e?.message || String(e); }
  try { resultado.mdfe = await atualizarMdfeProcessando(db, 30); } catch (e: any) { resultado.erroMdfe = e?.message || String(e); }
  return NextResponse.json({ ok: !resultado.erroNotas && !resultado.erroMdfe, ...resultado });
}
