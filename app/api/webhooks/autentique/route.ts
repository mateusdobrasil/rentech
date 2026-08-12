// app/api/webhooks/autentique/route.ts
// Recebe os eventos da Autentique e atualiza folha_holerite_assinaturas (RH)
// ou op_assinaturas (Ordens de Pagamento) — um mesmo token da Autentique
// serve os dois fluxos, então este endpoint tenta as duas tabelas pelo
// autentique_doc_id (só um dos dois terá o documento). Escrita via service role.
//
// A Autentique tem DOIS formatos de webhook, e este endpoint aceita os dois:
//  1) Clássico (painel): corpo em x-www-form-urlencoded, campos "partes[0][assinado][created]".
//  2) Novo (Events/v2): corpo em application/json, com event.data.signatures[].
// Detectamos pelo Content-Type e normalizamos para os mesmos campos de saída.
//
// Configure a URL deste endpoint no painel da Autentique.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { finalizarAssinaturaOP } from '../../../admin/op/assinaturaOpCore';

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
    const atualizadoEm = new Date().toISOString();

    // 1) Tenta RH primeiro (folha_holerite_assinaturas) — .select() devolve as
    // linhas afetadas, o que dá pra saber se o docId pertence a este fluxo.
    const { data: folhaAtualizada, error: folhaError } = await db
      .from('folha_holerite_assinaturas')
      .update({ status, trilha, visualizado_em: dados.visualizadoEm || null, assinado_em: dados.assinadoEm || null, atualizado_em: atualizadoEm })
      .eq('autentique_doc_id', dados.docId)
      .select('id');

    if (folhaError) {
      console.error('Webhook Autentique — falha ao atualizar folha_holerite_assinaturas:', folhaError.message);
      return NextResponse.json({ ok: false, erro: folhaError.message }, { status: 200 });
    }

    if (folhaAtualizada && folhaAtualizada.length > 0) {
      return NextResponse.json({ ok: true, status, origem: 'RH' });
    }

    // 2) Não é RH: tenta Ordens de Pagamento (op_assinaturas).
    const { data: opAtualizada, error: opError } = await db
      .from('op_assinaturas')
      .update({ status, trilha, visualizado_em: dados.visualizadoEm || null, assinado_em: dados.assinadoEm || null, atualizado_em: atualizadoEm })
      .eq('autentique_doc_id', dados.docId)
      .select('op_id');

    if (opError) {
      console.error('Webhook Autentique — falha ao atualizar op_assinaturas:', opError.message);
      return NextResponse.json({ ok: false, erro: opError.message }, { status: 200 });
    }

    if (opAtualizada && opAtualizada.length > 0) {
      // Assinado: baixa o PDF, arquiva e atualiza a OP (recibo_url/status),
      // igual ao que o canvas manuscrito fazia automaticamente antes.
      if (status === 'ASSINADO') {
        try {
          await finalizarAssinaturaOP(opAtualizada[0].op_id, dados.docId);
        } catch (e: any) {
          console.error('Webhook Autentique — falha ao finalizar assinatura de OP:', e.message);
        }
      }
      return NextResponse.json({ ok: true, status, origem: 'OP' });
    }

    // Nenhuma das duas tabelas tem esse docId — não há o que atualizar.
    return NextResponse.json({ ok: false, motivo: 'docId não encontrado em nenhum fluxo de assinatura' }, { status: 200 });
  } catch (e: any) {
    console.error('Webhook Autentique — erro:', e.message);
    return NextResponse.json({ ok: false, erro: e.message }, { status: 200 });
  }
}

// Alguns provedores fazem um GET de verificação ao cadastrar o webhook.
export async function GET() {
  return NextResponse.json({ ok: true, servico: 'webhook-autentique' });
}