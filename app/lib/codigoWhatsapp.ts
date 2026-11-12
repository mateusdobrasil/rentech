// app/lib/codigoWhatsapp.ts
// Envio de código de verificação pelo WhatsApp — Portal do Funcionário
// (primeiro acesso / esqueci a senha) e "Esqueci minha senha" do /login do
// admin. Configuração (provedor Z-API/Meta + Template de Autenticação) vem do
// card "Portal Acesso OTP" em /admin/parametros/agendamentos.
// Fica em lib, SEM 'use server', de propósito: como Server Action exportada
// viraria um endpoint pra mandar WhatsApp pra qualquer número.
import { supabaseAdmin } from './supabase';
import { resolverProvedorAutomacao, enviarComJanela, type ProvedorAutomacao, type TemplateMeta } from './whatsapp';
import { carregarNomesEmpresas, nomeEmpresaPara } from './empresa';

// Card correspondente em /admin/agendamentos — crie uma automação WEBHOOK
// chamada exatamente "Portal Acesso OTP" (o `chave` abaixo é gerado por slug
// do nome) pra poder escolher o provedor (Z-API/Meta) e, depois de aprovado,
// o Template de Autenticação da Meta, sem precisar mexer em código.
const CHAVE_AUTOMACAO_OTP = 'portal-acesso-otp';
// Sem citar empresa: este texto só entra se o card do OTP não existir ou não
// tiver mensagem, e aí não há empresa confiável pra citar. A mensagem real
// (card "Portal Acesso OTP") usa {{empresa}}.
const MENSAGEM_PADRAO_OTP = 'Seu código de acesso ao Portal do Funcionário é {{codigo}}. Válido por 10 minutos. Não compartilhe este código.';

interface ConfigAutomacaoOtp {
  ativo: boolean;
  mensagem: string | null;
  provedor_whatsapp: 'PADRAO' | 'ZAPI' | 'META';
  meta_template_nome: string | null;
  meta_template_idioma: string | null;
  meta_template_variaveis: string[] | null;
  empresa_id: number | null;
}

// ============================================================================
// ENVIO DO CÓDIGO — configuração (provedor Z-API/Meta + Template de Autenticação
// da Meta, quando aprovado) vem do card "Portal Acesso OTP" em
// /admin/agendamentos (tabela parametros_automacoes), igual a qualquer outra
// automação de WhatsApp do sistema. Sem o card criado ainda, cai no padrão
// (provedor PADRAO + mensagem de texto livre abaixo) — nada quebra.
// ============================================================================
// mensagem: texto próprio (com {{codigo}} / {{empresa}}) pra quando o envio
// sai como texto livre — o Template de Autenticação da Meta, se configurado no
// card, é genérico e vale pra qualquer código (portal ou login do admin).
export async function enviarCodigoAcessoWhatsApp(celular: string, codigo: string, empresaId: number | null, mensagem?: string): Promise<{ ok: boolean; erro?: string }> {
  const db = supabaseAdmin();
  const { data: automacao } = await db
    .from('parametros_automacoes')
    .select('ativo, mensagem, provedor_whatsapp, meta_template_nome, meta_template_idioma, meta_template_variaveis, empresa_id')
    .eq('chave', CHAVE_AUTOMACAO_OTP)
    .maybeSingle<ConfigAutomacaoOtp>();

  if (automacao && automacao.ativo === false) {
    return { ok: false, erro: 'Envio de código por WhatsApp está temporariamente desativado. Tente novamente mais tarde.' };
  }

  // {{empresa}} cita a empresa do próprio funcionário — quem é da AlfaLight
  // não deve receber um código "da Rentech".
  const empresas = await carregarNomesEmpresas(db);
  const vars: Record<string, string> = {
    codigo,
    empresa: nomeEmpresaPara(empresas, empresaId, automacao?.empresa_id ?? null),
  };
  const texto = (mensagem || automacao?.mensagem || MENSAGEM_PADRAO_OTP).replace(/\{\{(\w+)\}\}/g, (m, chave) => vars[chave] ?? m);

  const provedor = await resolverProvedorAutomacao((automacao?.provedor_whatsapp as ProvedorAutomacao) || 'PADRAO');

  const nomesVariaveis = automacao?.meta_template_variaveis?.length ? automacao.meta_template_variaveis : ['codigo'];
  const templateMeta: TemplateMeta | null = automacao?.meta_template_nome ? {
    nome: automacao.meta_template_nome,
    idioma: automacao.meta_template_idioma || 'pt_BR',
    parametros: nomesVariaveis.map(v => vars[v] ?? ''),
    // O template de Autenticação aprovado tem botão "Copiar código" —
    // precisa do mesmo código também como parâmetro do botão (ver
    // enviarWhatsAppMetaTemplate em app/lib/metaWhatsapp.ts).
    botaoCodigo: codigo,
  } : null;

  const res = await enviarComJanela(provedor, celular, texto, templateMeta);
  // A resposta pro cliente (solicitarAcessoAction) é sempre genérica de propósito
  // (anti-enumeração de CPF) — sem isto aqui, uma falha de envio (credencial
  // errada, template rejeitado pela Meta etc.) fica invisível pra sempre.
  // Confira os logs do servidor se o código não chegar no teste.
  if (!res.ok) console.error(`[Código WhatsApp] Falha ao enviar código via ${provedor}:`, res.erro);
  return res;
}
