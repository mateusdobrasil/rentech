'use server';

// app/admin/parametros/permissoes/actions.ts
// Escritas da tela de Permissões. Antes eram feitas direto do navegador
// (supabase-js com a chave anon), protegidas só pela RLS — e a tela grava
// justamente o nível de permissão de cada usuário e quem acessa cada rota.
// Agora passam por aqui (validarAcesso na rota da tela) e
// .sql/Pendentes/permissoes_escrita_so_servidor.sql tira do navegador o
// direito de gravar nessas tabelas (mesmo caminho já feito em
// perfis_usuarios_empresas — ver vincularEmpresasUsuarioAction em app/actions.ts).
// Tour de melhorias 2026-11-11, item 2.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { normalizarPermissao } from '../../../lib/permissoes';
import { registrarLogAuditoria } from '../../../actions';

type Resultado = { ok: boolean; erro?: string };

const ROTA = '/admin/parametros/permissoes';

// ---------------------------------------------------------------------------
// USUÁRIOS: nível de permissão e conta ativa/bloqueada
// ---------------------------------------------------------------------------
export async function atualizarAcessoUsuarioAction(payload: {
  perfilId: string; permissao: string; ativo: boolean; usuarioNome: string;
  // Colaborador (ficha do RH) a que o usuário pertence — o celular da ficha é
  // usado no "Esqueci minha senha" por WhatsApp. undefined = não mexe;
  // null = desvincula. (.sql/Pendentes/perfis_usuarios_funcionario.sql)
  funcionarioId?: string | null;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: atual } = await db.from('perfis_usuarios').select('nome, permissao, ativo, funcionario_id').eq('id', payload.perfilId).maybeSingle();
    if (!atual) return { ok: false, erro: 'Usuário não encontrado.' };

    const permissao = (payload.permissao || '').trim();
    if (!permissao) return { ok: false, erro: 'Escolha o setor de permissão.' };
    // Setor novo precisa existir no cadastro (o atual, mesmo legado, pode ficar)
    if (permissao !== atual.permissao) {
      const { data: setor } = await db.from('parametros_setores_permissao').select('nome').eq('nome', permissao).maybeSingle();
      if (!setor) return { ok: false, erro: `Setor "${permissao}" não existe. Cadastre na aba Setores.` };
    }
    // Trava contra se trancar pra fora
    if (payload.perfilId === acesso.perfil.id && !payload.ativo) {
      return { ok: false, erro: 'Você não pode bloquear a sua própria conta.' };
    }

    // Vínculo com o colaborador (ficha do RH): a ficha precisa existir e não
    // pode já pertencer a outro usuário.
    const mudarVinculo = payload.funcionarioId !== undefined && (payload.funcionarioId || null) !== (atual.funcionario_id || null);
    let nomeColaborador: string | null = null;
    if (mudarVinculo && payload.funcionarioId) {
      const { data: ficha } = await db.from('folha_funcionarios').select('nome_completo').eq('id', payload.funcionarioId).maybeSingle();
      if (!ficha) return { ok: false, erro: 'Colaborador não encontrado. Recarregue a página.' };
      const { data: outro } = await db.from('perfis_usuarios').select('nome').eq('funcionario_id', payload.funcionarioId).neq('id', payload.perfilId).maybeSingle();
      if (outro) return { ok: false, erro: `${ficha.nome_completo} já está vinculado ao usuário ${outro.nome}.` };
      nomeColaborador = ficha.nome_completo;
    }

    const { error } = await db.from('perfis_usuarios')
      .update({ permissao, ativo: !!payload.ativo, ...(mudarVinculo ? { funcionario_id: payload.funcionarioId || null } : {}) })
      .eq('id', payload.perfilId);
    if (error) throw new Error(error.message);

    const acoes: string[] = [];
    if (atual.permissao !== permissao) acoes.push(`PERMISSÃO: ${atual.permissao} → ${permissao}`);
    if (atual.ativo !== !!payload.ativo) acoes.push(payload.ativo ? 'CONTA REATIVADA' : 'CONTA BLOQUEADA');
    if (mudarVinculo) acoes.push(nomeColaborador ? `COLABORADOR VINCULADO: ${nomeColaborador}` : 'COLABORADOR DESVINCULADO');
    if (acoes.length) {
      await registrarLogAuditoria({
        usuario_nome: payload.usuarioNome || acesso.perfil.nome,
        acao: 'ALTEROU ACESSO DE USUÁRIO',
        setor: 'PERMISSÕES',
        equipamento_id: payload.perfilId,
        equipamento_nome: `${atual.nome} — ${acoes.join(' | ')}`,
      });
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ---------------------------------------------------------------------------
// PÁGINAS / ROTAS: quem acessa cada rota e se exige 2FA
// ---------------------------------------------------------------------------
export async function salvarPaginaPermissaoAction(payload: {
  id?: number | null; nome_pagina: string; endereco_route: string; permissoes_permitidas: string[]; usuarioNome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const nome_pagina = (payload.nome_pagina || '').toUpperCase().trim();
  const endereco_route = (payload.endereco_route || '').toLowerCase().trim();
  const permissoes_permitidas = [...new Set((payload.permissoes_permitidas || []).map(p => String(p).trim()).filter(Boolean))];
  if (!nome_pagina || !endereco_route) return { ok: false, erro: 'Nome da página e Endereço (URL) são obrigatórios.' };
  if (!endereco_route.startsWith('/')) return { ok: false, erro: 'O endereço precisa começar com "/" (ex.: /admin/rh).' };
  // Trava contra se trancar pra fora desta própria tela
  if (endereco_route === ROTA && !permissoes_permitidas.includes(acesso.perfil.permissaoNormalizada)) {
    return { ok: false, erro: `Você tiraria o seu próprio acesso a esta tela. Mantenha "${acesso.perfil.permissaoNormalizada}" marcado.` };
  }

  const db = supabaseAdmin();
  try {
    const dados = { nome_pagina, endereco_route, permissoes_permitidas };
    const { error } = payload.id
      ? await db.from('parametros_paginas_permissoes').update(dados).eq('id', payload.id)
      : await db.from('parametros_paginas_permissoes').insert([dados]);
    if (error) {
      if (error.code === '23505') return { ok: false, erro: 'Já existe uma página mapeada para este endereço (URL).' };
      throw new Error(error.message);
    }
    await registrarLogAuditoria({
      usuario_nome: payload.usuarioNome || acesso.perfil.nome,
      acao: payload.id ? 'ATUALIZOU PERMISSÃO DE ROTA' : 'CADASTROU ROTA DE SISTEMA',
      setor: 'PERMISSÕES',
      equipamento_nome: `${nome_pagina} → [${permissoes_permitidas.join(', ')}]`,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function removerPaginaPermissaoAction(payload: { id: number; usuarioNome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: pagina } = await db.from('parametros_paginas_permissoes').select('nome_pagina, endereco_route').eq('id', payload.id).maybeSingle();
    if (!pagina) return { ok: false, erro: 'Rota não encontrada.' };
    if (pagina.endereco_route === ROTA) return { ok: false, erro: 'A rota desta própria tela não pode ser removida.' };

    const { error } = await db.from('parametros_paginas_permissoes').delete().eq('id', payload.id);
    if (error) throw new Error(error.message);
    await registrarLogAuditoria({
      usuario_nome: payload.usuarioNome || acesso.perfil.nome,
      acao: 'REMOVEU ROTA DE SISTEMA',
      setor: 'PERMISSÕES',
      equipamento_nome: `${pagina.nome_pagina} (${pagina.endereco_route})`,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function alternar2faPaginaAction(payload: { id: number; requer2fa: boolean; usuarioNome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: pagina } = await db.from('parametros_paginas_permissoes').select('nome_pagina, endereco_route').eq('id', payload.id).maybeSingle();
    if (!pagina) return { ok: false, erro: 'Rota não encontrada.' };
    const { error } = await db.from('parametros_paginas_permissoes').update({ requer_2fa: !!payload.requer2fa }).eq('id', payload.id);
    if (error) throw new Error(error.message);
    await registrarLogAuditoria({
      usuario_nome: payload.usuarioNome || acesso.perfil.nome,
      acao: payload.requer2fa ? 'ATIVOU EXIGÊNCIA DE 2FA' : 'DESATIVOU EXIGÊNCIA DE 2FA',
      setor: 'PERMISSÕES',
      equipamento_nome: `${pagina.nome_pagina} (${pagina.endereco_route})`,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ---------------------------------------------------------------------------
// SETORES DE PERMISSÃO
// ---------------------------------------------------------------------------
export async function adicionarSetorPermissaoAction(payload: { nome: string; usuarioNome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const nome = (payload.nome || '').toUpperCase().trim();
  if (!nome) return { ok: false, erro: 'Digite o nome do setor.' };
  const db = supabaseAdmin();
  try {
    const { error } = await db.from('parametros_setores_permissao').insert([{ nome }]);
    if (error) {
      if (error.code === '23505') return { ok: false, erro: 'Esse setor já está cadastrado.' };
      throw new Error(error.message);
    }
    await registrarLogAuditoria({ usuario_nome: payload.usuarioNome || acesso.perfil.nome, acao: 'CADASTROU SETOR DE PERMISSÃO', setor: 'PERMISSÕES', equipamento_nome: nome });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function removerSetorPermissaoAction(payload: { id: number; usuarioNome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: setor } = await db.from('parametros_setores_permissao').select('nome').eq('id', payload.id).maybeSingle();
    if (!setor) return { ok: false, erro: 'Setor não encontrado.' };
    if (normalizarPermissao(setor.nome) === acesso.perfil.permissaoNormalizada && setor.nome === acesso.perfil.permissaoBruta) {
      return { ok: false, erro: 'Você não pode remover o seu próprio setor.' };
    }
    const { error } = await db.from('parametros_setores_permissao').delete().eq('id', payload.id);
    if (error) throw new Error(error.message);
    await registrarLogAuditoria({ usuario_nome: payload.usuarioNome || acesso.perfil.nome, acao: 'REMOVEU SETOR DE PERMISSÃO', setor: 'PERMISSÕES', equipamento_nome: setor.nome });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
