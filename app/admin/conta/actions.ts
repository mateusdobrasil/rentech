'use server';

// app/admin/conta/actions.ts
// Preferências do próprio usuário em /admin/conta. Página aberta a qualquer
// usuário autenticado, então só exige sessão válida (sem rota) — e só mexe na
// linha do próprio usuário. perfis_usuarios não aceita update do navegador
// (.sql/Executados/permissoes_escrita_so_servidor.sql), por isso passa aqui.
import { supabaseAdmin } from '../../lib/supabase';
import { obterPerfilValidado } from '../../lib/serverAuth';

export async function salvarTemaTelaAction(tema: string, accessToken: string): Promise<{ ok: boolean; erro?: string }> {
  if (tema !== 'claro' && tema !== 'escuro') return { ok: false, erro: 'Tema inválido.' };
  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) return { ok: false, erro: 'Sessão expirada. Entre novamente.' };

  const { error } = await supabaseAdmin().from('perfis_usuarios').update({ tema_tela: tema }).eq('id', perfil.id);
  if (error) {
    // coluna ainda não criada (.sql/Pendentes/perfis_usuarios_tema_tela.sql)
    if (/tema_tela/.test(error.message)) return { ok: false, erro: 'Tema aplicado só neste navegador — falta rodar o SQL perfis_usuarios_tema_tela.' };
    return { ok: false, erro: error.message };
  }
  return { ok: true };
}
