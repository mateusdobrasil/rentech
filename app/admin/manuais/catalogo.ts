// Catálogo do hub Manuais (2026-11-23). Lista o que existe; o conteúdo de
// cada manual fica em ./conteudo/<slug>.ts, GERADO por
// `npm run manuais` (scripts/gerar-manuais.mts) a partir das fontes em
// docs/manuais/ — Markdown exportado do documento do Claude + telas — ou de um
// PDF. Para atualizar um manual: troque a fonte, ajuste `atualizadoEm` aqui e
// rode o script de novo.
//
// `restrito`: só essas permissões (normalizadas) abrem o manual, além do
// Administrador. A página da lista esconde; a action recusa.

export type GrupoManual = 'SISTEMA' | 'TESTES' | 'TECNICO' | 'ANTIGO';

export interface ManualCatalogo {
  slug: string;
  titulo: string;
  descricao: string;
  grupo: GrupoManual;
  icone: string;
  atualizadoEm: string; // AAAA-MM-DD
  fonte?: string;       // Markdown em docs/ (vira página)
  pdf?: string;         // PDF em docs/ (vira download / leitor de PDF)
  restrito?: string[];
  aviso?: string;
}

export const GRUPOS: { grupo: GrupoManual; titulo: string; descricao: string }[] = [
  { grupo: 'SISTEMA', titulo: 'Manuais do sistema', descricao: 'Como usar cada parte do Rentech WEB no dia a dia.' },
  { grupo: 'TESTES', titulo: 'Testes', descricao: 'Roteiros para conferir o sistema antes de uma mudança grande.' },
  { grupo: 'TECNICO', titulo: 'Documentos técnicos', descricao: 'Integrações e decisões para a diretoria e a contabilidade.' },
  { grupo: 'ANTIGO', titulo: 'Versões antigas', descricao: 'Material anterior, mantido para consulta.' },
];

const SO_GESTAO = ['ADMINISTRADOR', 'DIRETORIA'];

export const MANUAIS: ManualCatalogo[] = [
  {
    slug: 'locacao', titulo: 'Sistema de Locação', grupo: 'SISTEMA', icone: '🎛️', atualizadoEm: '2026-11-23',
    descricao: 'O ciclo completo com as telas reais: cliente, pedido e orçamento, reserva, agenda, saída, retorno, faturamento, cobrança e recebimento.',
    fonte: 'docs/manuais/locacao.md',
  },
  {
    slug: 'inventario-estoque', titulo: 'Inventário de Estoque', grupo: 'SISTEMA', icone: '📦', atualizadoEm: '2026-11-19',
    descricao: 'Passo a passo da contagem do depósito: abrir o inventário, contar por quantidade, ler os patrimônios, conferir as divergências e aplicar.',
    fonte: 'docs/manuais/inventario-estoque.md',
  },
  {
    slug: 'suporte-chamados', titulo: 'Suporte e Chamados', grupo: 'SISTEMA', icone: '🎧', atualizadoEm: '2026-11-17',
    descricao: 'Como abrir, acompanhar e fechar um chamado, prioridades e prazos, e o que faz quem atende.',
    fonte: 'docs/manuais/suporte-chamados.md',
  },
  {
    slug: 'diretor-ia', titulo: 'Diretor (IA)', grupo: 'SISTEMA', icone: '🧭', atualizadoEm: '2026-11-23',
    descricao: 'Relatórios, alertas, caixa, chat e parâmetros do Diretor (IA), com as fontes antes e depois da virada da chave.',
    fonte: 'docs/manuais/diretor-ia.md', restrito: SO_GESTAO, // mesma audiência da tela /admin/diretoria
  },
  {
    slug: 'ponto-whatsapp', titulo: 'Ponto via WhatsApp', grupo: 'SISTEMA', icone: '🕒', atualizadoEm: '2026-07-12',
    descricao: 'Registro de ponto, justificativa de batida esquecida e abono pelo WhatsApp, o painel do RH e a segurança do registro (NSR e hash).',
    aviso: 'Versão de julho de 2026. Depois dela entraram a opção Folga e os lembretes de ponto incompleto.',
    pdf: 'docs/Manual - Ponto via WhatsApp.pdf',
  },
  {
    slug: 'roteiro-testes-locacao', titulo: 'Roteiro de testes da locação', grupo: 'TESTES', icone: '✅', atualizadoEm: '2026-11-22',
    descricao: 'As 12 partes que precisam estar aprovadas antes da virada da chave, com as regras da fase paralela.',
    fonte: 'docs/manuais/roteiro-testes-locacao.md',
  },
  {
    slug: 'integracao-p2s', titulo: 'Integração Rentech + PrimeStart via API', grupo: 'TECNICO', icone: '🔌', atualizadoEm: '2026-11-12',
    descricao: 'O que o sistema lê e escreve no PrimeStart: sincronizações, OP para Conta a Pagar, baixas, devolução e conciliação.',
    fonte: 'docs/manuais/integracao-p2s.md', restrito: SO_GESTAO,
  },
  {
    slug: 'emissor-fiscal', titulo: 'Emissor fiscal para a locação', grupo: 'TECNICO', icone: '🧾', atualizadoEm: '2026-11-17',
    descricao: 'Recomendação do emissor de notas e os pontos para confirmar com a contabilidade.',
    fonte: 'docs/manuais/emissor-fiscal.md', restrito: SO_GESTAO,
  },
  {
    slug: 'rentech-web-2026-07', titulo: 'Manual Rentech WEB (julho de 2026)', grupo: 'ANTIGO', icone: '📘', atualizadoEm: '2026-07-12',
    descricao: 'Acesso, configuração e funcionalidades do sistema, gerado a partir do código em julho de 2026.',
    fonte: 'docs/MANUAL.md', pdf: 'docs/Manual-Rentech-Web.pdf', restrito: SO_GESTAO,
    aviso: 'Versão de julho de 2026: várias partes do sistema mudaram desde então. Para o dia a dia, prefira os manuais do sistema.',
  },
];

export const manualPorSlug = (slug: string) => MANUAIS.find(m => m.slug === slug) || null;

export function podeVerManual(m: ManualCatalogo, permissaoNormalizada: string): boolean {
  if (!m.restrito?.length) return true;
  return permissaoNormalizada === 'ADMINISTRADOR' || m.restrito.includes(permissaoNormalizada);
}
