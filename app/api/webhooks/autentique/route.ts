// app/api/webhooks/autentique/route.ts
// Recebe os eventos da Autentique quando um documento é visualizado/assinado
// e atualiza folha_holerite_assinaturas. Escrita via service role.
//
// IMPORTANTE:
// - A Autentique envia o corpo em x-www-form-urlencoded (não JSON).
// - Configure a URL deste endpoint no painel da Autentique (Chaves de API > callback).
// - Eventos de "rejeitado" não disparam webhook (só visualizado/assinado).
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';

// Extrai um valor aninhado do payload form-urlencoded que a Autentique manda
// como "partes[0][assinado][created]" etc. Fazemos um parse tolerante.
function pick(obj: Record<string, string>, ...candidatos: string[]): string | null {
  for (const c of candidatos) {
    if (obj[c] != null && obj[c] !== '') return obj[c];
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    // A Autentique manda x-www-form-urlencoded; lemos como texto e parseamos.
    const raw = await req.text();
    const params = new URLSearchParams(raw);
    const flat: Record<string, string> = {};
    params.forEach((v, k) => { flat[k] = v; });

    // O identificador do documento pode vir em campos diferentes conforme a versão.
    const docId = pick(flat, 'uuid', 'id', 'document[id]', 'documento[uuid]');
    if (!docId) {
      // Sem id não há o que atualizar; responde 200 para a Autentique não reenviar em loop.
      return NextResponse.json({ ok: false, motivo: 'sem id de documento no payload' }, { status: 200 });
    }

    const assinadoEm = pick(flat, 'partes[0][assinado][created]', 'assinado[created]', 'signed[created]');
    const visualizadoEm = pick(flat, 'partes[0][visualizado][created]', 'visualizado[created]', 'viewed[created]');

    const status = assinadoEm ? 'ASSINADO' : visualizadoEm ? 'VISUALIZADO' : 'ENVIADO';

    const db = supabaseAdmin();
    const { error } = await db.from('folha_holerite_assinaturas').update({
      status,
      trilha: flat,                              // guarda o payload completo para auditoria
      visualizado_em: visualizadoEm || null,
      assinado_em: assinadoEm || null,
      atualizado_em: new Date().toISOString()
    }).eq('autentique_doc_id', docId);

    if (error) {
      // Loga mas responde 200 para evitar reentrega infinita
      console.error('Webhook Autentique — falha ao atualizar:', error.message);
      return NextResponse.json({ ok: false, erro: error.message }, { status: 200 });
    }

    return NextResponse.json({ ok: true, status });
  } catch (e: any) {
    console.error('Webhook Autentique — erro:', e.message);
    return NextResponse.json({ ok: false, erro: e.message }, { status: 200 });
  }
}

// Alguns provedores fazem um GET de verificação ao cadastrar o webhook.
export async function GET() {
  return NextResponse.json({ ok: true, servico: 'webhook-autentique' });
}