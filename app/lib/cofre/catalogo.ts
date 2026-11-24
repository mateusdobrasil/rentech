// app/lib/cofre/catalogo.ts
// O QUE pode ficar no cofre de credenciais (Parâmetros → Empresas → 🔐
// Credenciais). Sem nenhum valor aqui — só nomes e rótulos, então a tela
// também importa este arquivo. `nome` é o mesmo da variável de ambiente que o
// código já lia: enquanto o cofre não tiver o valor, vale a da Vercel
// (e as `alternativas`, nomes antigos da mesma coisa).
//
// Escopo EMPRESA: cada CNPJ tem o seu (certificado, Focus, Itaú, Infosimples).
// Escopo SISTEMA: um só para todas as empresas (WhatsApp, e-mail, P2S…).
// Segredos de infraestrutura (chave do Supabase, chave do próprio cofre,
// CRON_SECRET, MFA) NUNCA entram aqui: ficam só na Vercel.

export type EscopoCofre = 'EMPRESA' | 'SISTEMA';
export type TipoCampoCofre = 'texto' | 'segredo' | 'arquivo';

export interface CampoCofre {
  nome: string;
  rotulo: string;
  tipo: TipoCampoCofre;     // texto: não é segredo (mostra o valor); segredo: mostra só o final
  ajuda?: string;
  alternativas?: string[];  // variáveis de ambiente antigas com o mesmo valor
  aceita?: string;          // arquivo: extensões
}

export interface ServicoCofre {
  id: string;
  titulo: string;
  icone: string;
  escopo: EscopoCofre;
  usadoEm: string;
  campos: CampoCofre[];
  certificadoA1?: boolean;  // tela própria: .pfx + senha juntos, conferidos ao salvar
}

export const SERVICOS_COFRE: ServicoCofre[] = [
  {
    id: 'CERTIFICADO_A1', titulo: 'Certificado digital A1 (e-CNPJ)', icone: '🔏', escopo: 'EMPRESA', certificadoA1: true,
    usadoEm: 'Assinatura do AFD, Consignado GOV.BR e consulta de multas (login gov.br).',
    campos: [
      { nome: 'CERT_A1_PFX_BASE64', rotulo: 'Arquivo .pfx', tipo: 'arquivo', aceita: '.pfx,.p12', alternativas: ['GOVBR_CONSIGNADO_CERT_PFX_BASE64', 'INFOSIMPLES_PFX_BASE64'] },
      { nome: 'CERT_A1_SENHA', rotulo: 'Senha do certificado', tipo: 'segredo', alternativas: ['GOVBR_CONSIGNADO_CERT_SENHA', 'INFOSIMPLES_PFX_SENHA'] },
    ],
  },
  {
    id: 'FOCUS_NFE', titulo: 'Focus NFe (notas fiscais)', icone: '🧾', escopo: 'EMPRESA',
    usadoEm: 'Emissão de NF-e, NFS-e e MDF-e.',
    campos: [
      { nome: 'FOCUSNFE_TOKEN_HOMOLOGACAO', rotulo: 'Token de homologação', tipo: 'segredo' },
      { nome: 'FOCUSNFE_TOKEN_PRODUCAO', rotulo: 'Token de produção', tipo: 'segredo' },
    ],
  },
  {
    id: 'ITAU', titulo: 'Itaú (API SISPAG)', icone: '🏦', escopo: 'EMPRESA',
    usadoEm: 'Pagamentos em lote e conciliação bancária.',
    campos: [
      { nome: 'ITAU_API_CLIENT_ID_PRODUCAO', rotulo: 'Client ID (produção)', tipo: 'texto' },
      { nome: 'ITAU_API_CLIENT_SECRET_PRODUCAO', rotulo: 'Client Secret (produção)', tipo: 'segredo' },
      { nome: 'ITAU_API_CERT_PEM_BASE64_PRODUCAO', rotulo: 'Certificado .crt/.pem (produção)', tipo: 'arquivo', aceita: '.pem,.crt,.cer' },
      { nome: 'ITAU_API_CERT_KEY_BASE64_PRODUCAO', rotulo: 'Chave privada .key (produção)', tipo: 'arquivo', aceita: '.key,.pem' },
      { nome: 'ITAU_API_CLIENT_ID_SANDBOX', rotulo: 'Client ID (sandbox)', tipo: 'texto' },
      { nome: 'ITAU_API_CLIENT_SECRET_SANDBOX', rotulo: 'Client Secret (sandbox)', tipo: 'segredo' },
      { nome: 'ITAU_API_CERT_PEM_BASE64_SANDBOX', rotulo: 'Certificado .crt/.pem (sandbox)', tipo: 'arquivo', aceita: '.pem,.crt,.cer' },
      { nome: 'ITAU_API_CERT_KEY_BASE64_SANDBOX', rotulo: 'Chave privada .key (sandbox)', tipo: 'arquivo', aceita: '.key,.pem' },
    ],
  },
  {
    id: 'INFOSIMPLES', titulo: 'Infosimples (multas e débitos)', icone: '🚗', escopo: 'EMPRESA',
    usadoEm: 'Consulta de multas no Detran-SP e boletos da Prefeitura de SP.',
    campos: [
      { nome: 'INFOSIMPLES_TOKEN', rotulo: 'Token da API', tipo: 'segredo' },
      { nome: 'INFOSIMPLES_ENCRYPTION_KEY', rotulo: 'Chave de criptografia', tipo: 'segredo', ajuda: 'Usada para enviar o certificado A1 cifrado à Infosimples.' },
      { nome: 'INFOSIMPLES_DETRAN_SP_CPF', rotulo: 'CPF gov.br (sem certificado)', tipo: 'texto' },
      { nome: 'INFOSIMPLES_DETRAN_SP_SENHA', rotulo: 'Senha gov.br', tipo: 'segredo' },
      { nome: 'INFOSIMPLES_PREF_SP_LOGIN', rotulo: 'Login Prefeitura de SP', tipo: 'texto' },
      { nome: 'INFOSIMPLES_PREF_SP_SENHA', rotulo: 'Senha Prefeitura de SP', tipo: 'segredo' },
    ],
  },
  {
    id: 'ZAPI', titulo: 'WhatsApp — Z-API', icone: '💬', escopo: 'SISTEMA',
    usadoEm: 'Envio e recebimento de WhatsApp (ponto, lembretes, avisos).',
    campos: [
      { nome: 'ZAPI_INSTANCE', rotulo: 'Instância', tipo: 'texto' },
      { nome: 'ZAPI_TOKEN', rotulo: 'Token da instância', tipo: 'segredo' },
      { nome: 'API_CLIENT_TOKEN', rotulo: 'Client-Token da conta', tipo: 'segredo' },
      { nome: 'ZAPI_WEBHOOK_SECRET', rotulo: 'Segredo do webhook', tipo: 'segredo', ajuda: 'O mesmo valor configurado na URL do webhook na Z-API.' },
    ],
  },
  {
    id: 'META_WHATSAPP', titulo: 'WhatsApp — Meta (API oficial)', icone: '🟢', escopo: 'SISTEMA',
    usadoEm: 'Envio com modelos aprovados e recebimento pelo webhook da Meta.',
    campos: [
      { nome: 'META_WHATSAPP_TOKEN', rotulo: 'Token de acesso', tipo: 'segredo' },
      { nome: 'META_WHATSAPP_PHONE_NUMBER_ID', rotulo: 'Phone Number ID', tipo: 'texto' },
      { nome: 'META_APP_SECRET', rotulo: 'App Secret', tipo: 'segredo' },
      { nome: 'META_WEBHOOK_VERIFY_TOKEN', rotulo: 'Verify Token do webhook', tipo: 'segredo' },
    ],
  },
  {
    id: 'SMTP', titulo: 'E-mail (SMTP)', icone: '✉️', escopo: 'SISTEMA',
    usadoEm: 'Todo e-mail que o sistema envia (avisos, notas de débito, diretor, suporte).',
    campos: [
      { nome: 'SMTP_HOST', rotulo: 'Servidor', tipo: 'texto' },
      { nome: 'SMTP_PORT', rotulo: 'Porta', tipo: 'texto', ajuda: '465 = SSL; 587 = STARTTLS.' },
      { nome: 'SMTP_USER', rotulo: 'Usuário (remetente)', tipo: 'texto' },
      { nome: 'SMTP_PASS', rotulo: 'Senha', tipo: 'segredo' },
    ],
  },
  {
    id: 'P2S', titulo: 'PrimeStart (P2S)', icone: '🔗', escopo: 'SISTEMA',
    usadoEm: 'Sincronização com o P2S até a virada da chave.',
    campos: [
      { nome: 'P2S_API_HOST', rotulo: 'Servidor', tipo: 'texto' },
      { nome: 'P2S_API_PORTA', rotulo: 'Porta', tipo: 'texto' },
      { nome: 'P2S_API_PROTOCOLO', rotulo: 'Protocolo (http/https)', tipo: 'texto' },
      { nome: 'P2S_API_USUARIO', rotulo: 'Usuário', tipo: 'texto' },
      { nome: 'P2S_API_SENHA', rotulo: 'Senha', tipo: 'segredo' },
    ],
  },
  {
    id: 'AUTENTIQUE', titulo: 'Autentique (assinatura eletrônica)', icone: '✍️', escopo: 'SISTEMA',
    usadoEm: 'Contratos, propostas, holerites, rescisões e OPs para assinar.',
    campos: [{ nome: 'AUTENTIQUE_API_TOKEN', rotulo: 'Token da API', tipo: 'segredo' }],
  },
  {
    id: 'ANTHROPIC', titulo: 'Claude (IA)', icone: '🤖', escopo: 'SISTEMA',
    usadoEm: 'Diretor (IA) e leitura automática de notificações de multa.',
    campos: [{ nome: 'ANTHROPIC_API_KEY', rotulo: 'Chave da API', tipo: 'segredo' }],
  },
];

export const CAMPOS_COFRE: Map<string, { campo: CampoCofre; servico: ServicoCofre }> = new Map(
  SERVICOS_COFRE.flatMap(s => s.campos.map(c => [c.nome, { campo: c, servico: s }] as const)),
);

export type NomeSegredo = string;
