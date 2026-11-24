// app/lib/suporte/avisos.ts
// Avisos do módulo Suporte e Chamados. Configuração nos cards de Agendamentos
// e Disparos (chaves suporte-aviso-area / suporte-aviso-solicitante):
//   - card desligado → nenhum aviso (nem push);
//   - canal "WhatsApp" marcado → celular da Ficha do Funcionário ligada ao
//     usuário (perfis_usuarios.funcionario_id); Meta fora da janela de 24h
//     usa o template do card;
//   - canal "E-mail" marcado → e-mail da ficha; sem ficha, o e-mail de login;
//   - push do app (inbox + notificação) sempre que o card estiver ativo.
// Os destinatários vêm do chamado (atendentes da área / solicitante) — o campo
// `destinatarios` do card não se aplica. Fica em lib, SEM 'use server': como
// Server Action exportada viraria um endpoint pra mandar mensagem pra qualquer um.
import { transporteSmtp } from '../cofre/smtp';
import { supabaseAdmin } from '../supabase';
import { resolverProvedorAutomacao, enviarComJanela, type ProvedorAutomacao, type TemplateMeta } from '../whatsapp';
import { notificarPushParaUsuario } from '../push';
import { carregarNomesEmpresas, nomeEmpresaPara } from '../empresa';
import { ROTA_SUPORTE } from './constantes';

const baseUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const linkChamado = (id: number) => `${baseUrl()}${ROTA_SUPORTE}?chamado=${id}`;

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const preencher = (t: string, vars: Record<string, string>) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
// A Meta recusa parâmetro de template com quebra de linha/tab/4+ espaços (erro 132018)
const paramMeta = (s: string) => s.replace(/\s*\n+\s*/g, ' · ').replace(/\t/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 900);

interface Card {
  ativo: boolean; canais: string[] | null; mensagem: string | null; provedor_whatsapp: string | null;
  meta_template_nome: string | null; meta_template_idioma: string | null; meta_template_variaveis: string[] | null;
}

export interface AvisoChamado {
  chave: string;
  perfilIds: string[];
  chamado: { id: number; titulo: string; empresa_id: number | null };
  /** Linha curta do que aconteceu ("Novo chamado de Fulano · Prioridade Alta"). */
  evento: string;
  /** Trecho opcional (texto da resposta) que entra só no e-mail. */
  detalhe?: string;
}

export async function avisarChamado(a: AvisoChamado): Promise<void> {
  const ids = [...new Set(a.perfilIds.filter(Boolean))];
  if (!ids.length) return;
  const db = supabaseAdmin();
  try {
    const { data: card } = await db.from('parametros_automacoes')
      .select('ativo, canais, mensagem, provedor_whatsapp, meta_template_nome, meta_template_idioma, meta_template_variaveis')
      .eq('chave', a.chave).maybeSingle<Card>();
    if (!card || card.ativo === false) return;
    const canais = card.canais || [];

    const { data: perfis } = await db.from('perfis_usuarios').select('id, nome, email, funcionario_id, ativo').in('id', ids);
    const lista = ((perfis || []) as { id: string; nome: string | null; email: string | null; funcionario_id: string | null; ativo: boolean | null }[])
      .filter(p => p.ativo !== false);
    const fichaIds = lista.map(p => p.funcionario_id).filter(Boolean) as string[];
    const { data: fichas } = fichaIds.length
      ? await db.from('folha_funcionarios').select('id, nome_completo, celular, email, empresa_id').in('id', fichaIds)
      : { data: [] as any[] };
    const fichaPor = new Map(((fichas || []) as any[]).map(f => [f.id as string, f]));

    const empresas = await carregarNomesEmpresas(db);
    const link = linkChamado(a.chamado.id);
    const titulo = a.chamado.titulo.length > 80 ? `${a.chamado.titulo.slice(0, 77)}…` : a.chamado.titulo;
    const modelo = card.mensagem || 'Olá {{primeiro_nome}}! Chamado #{{numero}} — {{titulo}}\n{{evento}}\n\nAbrir: {{link}}';
    const provedor = canais.includes('WhatsApp') ? await resolverProvedorAutomacao((card.provedor_whatsapp as ProvedorAutomacao) || 'PADRAO') : null;
    const smtp = canais.includes('E-mail') ? await transporteSmtp() : null;
    const transporter = smtp?.transporter ?? null;

    let zap = 0, mail = 0;
    for (const p of lista) {
      const ficha = p.funcionario_id ? fichaPor.get(p.funcionario_id) : null;
      const nome = String(ficha?.nome_completo || p.nome || 'Colaborador').trim();
      const vars: Record<string, string> = {
        primeiro_nome: nome.split(' ')[0],
        nome_completo: nome,
        numero: String(a.chamado.id),
        titulo,
        evento: a.evento,
        link,
        empresa: nomeEmpresaPara(empresas, ficha?.empresa_id ?? a.chamado.empresa_id, null),
      };
      const texto = preencher(modelo, vars);

      await notificarPushParaUsuario(p.id, `Chamado #${a.chamado.id}`, `${titulo} — ${a.evento}`, { tipo: 'SUPORTE_CHAMADO', chamado_id: a.chamado.id })
        .catch(e => console.error('[suporte] push:', e));

      if (provedor && ficha?.celular) {
        const template: TemplateMeta | null = card.meta_template_nome ? {
          nome: card.meta_template_nome,
          idioma: card.meta_template_idioma || 'pt_BR',
          parametros: ((card.meta_template_variaveis as string[]) || ['primeiro_nome']).map(v => paramMeta(vars[v] ?? '')),
        } : null;
        const r = await enviarComJanela(provedor, ficha.celular, texto, template).catch(e => ({ ok: false, erro: String(e) }));
        if (r.ok) zap++; else console.error(`[suporte] WhatsApp para ${nome} falhou:`, r.erro);
      }

      const email = String(ficha?.email || p.email || '').trim();
      if (transporter && email.includes('@')) {
        try {
          await transporter.sendMail({
            from: `"Suporte · Rentech" <${smtp?.remetente}>`,
            to: email,
            subject: `[Chamado #${a.chamado.id}] ${titulo} — ${a.evento}`.slice(0, 180),
            text: `${texto}${a.detalhe ? `\n\n---\n${a.detalhe}` : ''}`,
            html: htmlEmail(vars, a.detalhe),
          });
          mail++;
        } catch (e: any) {
          console.error(`[suporte] e-mail para ${nome} falhou:`, e?.message);
        }
      }
    }

    const agora = new Date().toISOString();
    await db.from('parametros_automacoes').update({ ultima_execucao: agora }).eq('chave', a.chave);
    const envios = [zap && { chave: a.chave, canal: 'WhatsApp', quantidade: zap }, mail && { chave: a.chave, canal: 'E-mail', quantidade: mail }].filter(Boolean);
    if (envios.length) await db.from('parametros_automacoes_envios').insert(envios);
  } catch (e) {
    console.error('[suporte] falha ao avisar chamado:', e);
  }
}

function htmlEmail(v: Record<string, string>, detalhe?: string): string {
  const AZUL = '#0C1D4D';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F0F4F8;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4F8;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;border:1px solid #E2E8F0;">
<tr><td style="padding:20px 24px;border-bottom:1px solid #E2E8F0;">
<div style="font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#64748B;">🛟 Suporte · Chamado #${esc(v.numero)}</div>
<div style="font-size:19px;font-weight:bold;color:${AZUL};margin-top:4px;">${esc(v.titulo)}</div>
</td></tr>
<tr><td style="padding:20px 24px;">
<p style="font-size:14px;margin:0 0 10px;">Olá, ${esc(v.primeiro_nome)}!</p>
<p style="font-size:14px;font-weight:bold;color:${AZUL};margin:0;">${esc(v.evento)}</p>
${detalhe ? `<div style="margin-top:14px;padding:12px 14px;background:#F8FAFC;border-left:4px solid #336699;border-radius:6px;font-size:13px;line-height:1.55;color:#334155;white-space:pre-wrap;">${esc(detalhe.slice(0, 3000))}</div>` : ''}
</td></tr>
<tr><td style="padding:0 24px 24px;"><a href="${esc(v.link)}" style="display:inline-block;background:${AZUL};color:#ffffff;text-decoration:none;font-weight:bold;font-size:13px;padding:12px 20px;border-radius:8px;">Abrir chamado</a></td></tr>
</table>
<div style="font-size:11px;color:#94a3b8;margin-top:12px;">Enviado pelo Rentech WEB. Canais em Parâmetros → Agendamentos e Disparos.</div>
</td></tr></table></body></html>`;
}
