// app/api/webhooks/autentique/route.ts
// Recebe os eventos da Autentique e atualiza folha_holerite_assinaturas.
// Escrita via service role.
//
// A Autentique tem DOIS formatos de webhook, e este endpoint aceita os dois:
//  1) Clássico (painel): corpo em x-www-form-urlencoded, campos "partes[0][assinado][created]".
//  2) Novo (Events/v2): corpo em application/json, com event.data.signatures[].
// Detectamos pelo Content-Type e normalizamos para os mesmos campos de saída.
//
// Configure a URL deste endpoint no painel da Autentique.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';

type Extraido = {
  docId: string | null;
  assinadoEm: string | null;
  visualizadoEm: string | null;
  rejeitadoEm: string | null;
};

// ---- Formato CLÁSSICO: x-www-form-urlencoded (partes[0][...][created]) ----
function extrairDeUrlEncoded(raw: string): Extraido {
  const params = new URLSearchParams(raw);
  const flat: Record<string, string> = {};
  params.forEach((v, k) => { flat[k] = v; });

  const pick = (...cs: string[]) => {
    for (const c of cs) if (flat[c] != null && flat[c] !== '') return flat[c];
    return null;
  };

  return {
    docId: pick('uuid', 'id', 'document[id]', 'documento[uuid]'),
    assinadoEm: pick('partes[0][assinado][created]', 'assinado[created]', 'signed[created]'),
    visualizadoEm: pick('partes[0][visualizado][created]', 'visualizado[created]', 'viewed[created]'),
    rejeitadoEm: pick('partes[0][rejeitado][created]', 'rejeitado[created]', 'rejected[created]'),
  };
}

// ---- Formato NOVO: application/json (event.data com signatures[]) ----
function extrairDeJson(body: any): Extraido {
  // A estrutura do documento pode vir em event.data.object ou event.data
  const data = body?.event?.data?.object || body?.event?.data || body?.data || body;
  const docId = data?.id || data?.uuid || body?.event?.data?.id || null;

  // Considera apenas os signatários (action SIGN) — a primeira signature é o
  // autor do documento, que não assina. Fallback: todas, se action não vier.
  const todas = data?.signatures || [];
  const sigs = todas.filter((s: any) => s?.action?.name === 'SIGN');
  const lista = sigs.length > 0 ? sigs : todas;
  let assinadoEm: string | null = null;
  let visualizadoEm: string | null = null;
  let rejeitadoEm: string | null = null;
  for (const s of lista) {
    if (!assinadoEm && (s?.signed?.created_at || s?.signed?.created)) assinadoEm = s.signed.created_at || s.signed.created;
    if (!visualizadoEm && (s?.viewed?.created_at || s?.viewed?.created)) visualizadoEm = s.viewed.created_at || s.viewed.created;
    if (!rejeitadoEm && (s?.rejected?.created_at || s?.rejected?.created)) rejeitadoEm = s.rejected.created_at || s.rejected.created;
  }

  return { docId, assinadoEm, visualizadoEm, rejeitadoEm };
}

export async function POST(req: NextRequest) {
  try {
    const contentType = (req.headers.get('content-type') || '').toLowerCase();
    const raw = await req.text();

    let dados: Extraido;
    let trilha: any;

    if (contentType.includes('application/json')) {
      const body = JSON.parse(raw);
      dados = extrairDeJson(body);
      trilha = body;
    } else {
      // urlencoded (ou desconhecido — tentamos urlencoded, que é o clássico)
      dados = extrairDeUrlEncoded(raw);
      const params = new URLSearchParams(raw);
      const flat: Record<string, string> = {};
      params.forEach((v, k) => { flat[k] = v; });
      trilha = flat;
    }

    if (!dados.docId) {
      // Sem id não há o que atualizar; responde 200 para não haver reentrega em loop.
      return NextResponse.json({ ok: false, motivo: 'sem id de documento no payload', contentType }, { status: 200 });
    }

    const status = dados.rejeitadoEm ? 'REJEITADO'
      : dados.assinadoEm ? 'ASSINADO'
      : dados.visualizadoEm ? 'VISUALIZADO'
      : 'ENVIADO';

    const db = supabaseAdmin();
    const { error } = await db.from('folha_holerite_assinaturas').update({
      status,
      trilha,                                    // payload completo para auditoria
      visualizado_em: dados.visualizadoEm || null,
      assinado_em: dados.assinadoEm || null,
      atualizado_em: new Date().toISOString()
    }).eq('autentique_doc_id', dados.docId);

    if (error) {
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