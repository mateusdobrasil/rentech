"use server";

// Hub Manuais (2026-11-23). O conteúdo vem de ./conteudo (gerado por
// `npm run manuais`) e só sai daqui depois de checar a rota /admin/manuais e,
// para manual restrito, a permissão do usuário.
import { validarAcesso } from '../../lib/serverAuth';
import { manualPorSlug, podeVerManual } from './catalogo';
import { CONTEUDO, type ConteudoManual } from './conteudo';

const ROTA = '/admin/manuais';
type Resultado = { ok: boolean; erro?: string; info?: ConteudoManual };

export async function abrirManualAction(slug: string, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const m = manualPorSlug(String(slug || ''));
  const carregar = m ? CONTEUDO[m.slug] : null;
  if (!m || !carregar) return { ok: false, erro: 'Manual não encontrado.' };
  if (!podeVerManual(m, acesso.perfil.permissaoNormalizada)) return { ok: false, erro: 'Este manual é restrito à diretoria.' };
  try {
    const c = await carregar();
    return { ok: true, info: { html: c.html, sumario: c.sumario, pdf: c.pdf } };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao abrir o manual.' };
  }
}
