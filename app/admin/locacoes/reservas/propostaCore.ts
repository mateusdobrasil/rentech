// app/admin/locacoes/reservas/propostaCore.ts
// Proposta de locação assinada via Autentique (2026-11-16). SEM "use server":
// é usada pelas actions (já protegidas por accessToken) e pelo webhook
// app/api/webhooks/autentique (a própria Autentique chamando, sem sessão).
// Fora de "use server" ela não vira endpoint chamável direto — mesmo motivo
// de app/admin/op/assinaturaOpCore.ts.
//
// Assinou → arquiva o PDF assinado, marca a ficha como APROVADO e tenta
// reservar; faltando equipamento, fica APROVADO e o histórico avisa.
import { supabaseAdmin } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { autentiqueConsultarDocumento } from '../../../lib/autentique';
import { reservarFicha } from '../../../lib/locacao/disponibilidade';
import { numeroFichaPorId } from '../../../lib/locacao/fichaNumero';
import { avisarOsParaSeparar } from '../../../lib/locacao/avisoExpedicao';

type Db = ReturnType<typeof supabaseAdmin>;
export const BUCKET_PROPOSTAS = 'locacao-propostas';
export type StatusProposta = 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'REJEITADO' | 'CANCELADO';

export const numeroFichaTexto = numeroFichaPorId;

// Montagem dos dados do PDF: app/lib/locacao/dadosDocumentos.ts (compartilhada com o contrato).
export { montarDadosProposta } from '../../../lib/locacao/dadosDocumentos';

async function historico(db: Db, fichaId: number, usuario: string, acao: string, detalhe: string, de?: string | null, para?: string | null) {
  await db.from('locacao_fichas_reserva_historico').insert({ ficha_id: fichaId, usuario, acao, detalhe, status_de: de ?? null, status_para: para ?? null });
}

/** Baixa o PDF assinado na Autentique e guarda no bucket. Devolve o caminho. */
async function arquivarAssinado(db: Db, proposta: { id: number; ficha_id: number; versao: number }, docId: string): Promise<string | null> {
  const doc = await autentiqueConsultarDocumento(docId);
  const url = doc?.files?.signed || doc?.files?.pades;
  const token = process.env.AUTENTIQUE_API_TOKEN;
  if (!url || !token) return null;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return null;
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const caminho = `ficha-${proposta.ficha_id}/proposta-v${proposta.versao}-assinada.pdf`;
  const { error } = await db.storage.from(BUCKET_PROPOSTAS).upload(caminho, bytes, { contentType: 'application/pdf', upsert: true });
  return error ? null : caminho;
}

/**
 * Aplica um evento da Autentique numa proposta (webhook ou consulta manual).
 * Devolve false se o documento não é de proposta de locação.
 */
export async function processarEventoProposta(
  db: Db,
  docId: string,
  ev: { status: StatusProposta; visualizadoEm?: string | null; assinadoEm?: string | null; rejeitadoEm?: string | null; trilha?: unknown }
): Promise<boolean> {
  const { data: prop } = await db.from('locacao_propostas').select('*').eq('autentique_doc_id', docId).maybeSingle();
  if (!prop) return false;
  if (prop.status === 'CANCELADO' || prop.status === 'ASSINADO') {
    // cancelada: evento atrasado não reabre. assinada: só completa o arquivo se faltou.
    if (prop.status === 'ASSINADO' && !prop.pdf_assinado_path) {
      const caminho = await arquivarAssinado(db, prop, docId);
      if (caminho) await db.from('locacao_propostas').update({ pdf_assinado_path: caminho, atualizado_em: new Date().toISOString() }).eq('id', prop.id);
    }
    return true;
  }

  const agora = new Date().toISOString();
  await db.from('locacao_propostas').update({
    status: ev.status, trilha: ev.trilha ?? prop.trilha,
    visualizado_em: ev.visualizadoEm || prop.visualizado_em, assinado_em: ev.assinadoEm || prop.assinado_em, rejeitado_em: ev.rejeitadoEm || prop.rejeitado_em,
    atualizado_em: agora,
  }).eq('id', prop.id);

  const ficha = numeroFichaTexto(prop.ficha_id);
  if (ev.status === 'VISUALIZADO' && !prop.visualizado_em) {
    await historico(db, prop.ficha_id, 'CLIENTE (Autentique)', 'PROPOSTA_VISUALIZADA', `Cliente abriu a proposta v${prop.versao}`);
  }
  if (ev.status === 'REJEITADO') {
    await historico(db, prop.ficha_id, 'CLIENTE (Autentique)', 'PROPOSTA_RECUSADA', `Cliente recusou a proposta v${prop.versao} na Autentique`);
    registrarLogAuditoria({ usuario_nome: 'AUTENTIQUE', acao: 'PROPOSTA DE LOCAÇÃO RECUSADA', setor: 'LOCACOES', equipamento_nome: `${ficha} v${prop.versao}` });
  }
  if (ev.status === 'ASSINADO') {
    const caminho = await arquivarAssinado(db, prop, docId).catch(() => null);
    if (caminho) await db.from('locacao_propostas').update({ pdf_assinado_path: caminho }).eq('id', prop.id);

    const { data: f } = await db.from('locacao_fichas_reserva').select('id, status').eq('id', prop.ficha_id).single();
    if (prop.sandbox) {
      // envio de TESTE: só registra — nunca aprova nem reserva equipamento de verdade
      await historico(db, prop.ficha_id, 'CLIENTE (Autentique)', 'PROPOSTA_ASSINADA', `Proposta v${prop.versao} de TESTE (sandbox) assinada — ficha não foi aprovada nem reservada`);
      return true;
    }
    await historico(db, prop.ficha_id, 'CLIENTE (Autentique)', 'PROPOSTA_ASSINADA', `Cliente assinou a proposta v${prop.versao}`);
    if (f && ['ORCAMENTO', 'ENVIADO'].includes(f.status)) {
      await db.from('locacao_fichas_reserva').update({ status: 'APROVADO', aprovado_em: ev.assinadoEm || agora, aprovado_por: `${prop.signatario_nome || 'Cliente'} (assinatura Autentique)`, updated_at: agora }).eq('id', f.id);
      await historico(db, f.id, 'SISTEMA', 'APROVADO', 'Aprovada pela assinatura do cliente', f.status, 'APROVADO');
      const r = await reservarFicha(db, f.id).catch((e: any) => ({ ok: false, erro: e.message, faltas: undefined }));
      if (r.ok) {
        await db.from('locacao_fichas_reserva').update({ status: 'RESERVADA', updated_at: new Date().toISOString() }).eq('id', f.id);
        await historico(db, f.id, 'SISTEMA', 'RESERVAR', 'Equipamentos reservados automaticamente após a assinatura', 'APROVADO', 'RESERVADA');
        await avisarOsParaSeparar(db, f.id);
      } else {
        const faltas = (r.faltas || []).map(l => `${l.nome} (faltam ${l.falta})`).join(', ');
        await historico(db, f.id, 'SISTEMA', 'RESERVA_PENDENTE', `Assinada, mas não deu para reservar: ${faltas || r.erro || 'falta equipamento'}. Ajuste e use "Aprovar e reservar".`);
      }
    }
    registrarLogAuditoria({ usuario_nome: 'AUTENTIQUE', acao: 'PROPOSTA DE LOCAÇÃO ASSINADA', setor: 'LOCACOES', equipamento_nome: `${ficha} v${prop.versao} · ${prop.signatario_nome || ''}` });
  }
  return true;
}

/** Consulta a Autentique e aplica o status atual (botão "Atualizar status"). */
export async function atualizarPropostaPelaAutentique(db: Db, propostaId: number): Promise<StatusProposta | null> {
  const { data: prop } = await db.from('locacao_propostas').select('autentique_doc_id').eq('id', propostaId).maybeSingle();
  if (!prop?.autentique_doc_id) return null;
  const doc = await autentiqueConsultarDocumento(prop.autentique_doc_id);
  const sig = (doc?.signatures || []).find((x: any) => x?.action?.name === 'SIGN') || (doc?.signatures || [])[0];
  const assinadoEm = sig?.signed?.created_at || null, visualizadoEm = sig?.viewed?.created_at || null, rejeitadoEm = sig?.rejected?.created_at || null;
  const status: StatusProposta = rejeitadoEm ? 'REJEITADO' : assinadoEm ? 'ASSINADO' : visualizadoEm ? 'VISUALIZADO' : 'ENVIADO';
  await processarEventoProposta(db, prop.autentique_doc_id, { status, assinadoEm, visualizadoEm, rejeitadoEm });
  return status;
}
