// Catálogos fixos usados pela tela Agendamentos e Disparos (fonte_dados e
// evento_sistema de folha_automacoes). Ficam num módulo à parte — sem
// "use server" — porque actions.ts é um arquivo de Server Actions e só pode
// exportar funções async; um `const` (valor em runtime) exportado de lá
// quebra o build ("A 'use server' file can only export async functions").
// page.tsx importa estes catálogos diretamente daqui; actions.ts os importa
// só para validar o payload recebido do cliente.

// Catálogo fixo de "listas dinâmicas" que o motor de Cron sabe calcular
// (app/api/cron/motor/route.ts, mapa FONTES_DADOS) — só para automações tipo
// CRON. Escolhido por dropdown na tela, em vez de depender da `chave`
// (gerada do nome digitado) bater com um literal escondido no código: dá pra
// reaproveitar a mesma fonte em quantas automações quiser (horários/públicos
// diferentes), e renomear/recriar a automação não quebra mais nada.
export const FONTES_DADOS_DISPONIVEIS = [
  { valor: 'FROTA_VENCIMENTOS', label: 'Frota com documentação vencida (CRLV/Seguro)', variaveis: ['lista', 'quantidade'] },
  { valor: 'DOCUMENTOS_VENCIDOS', label: 'Documentos vencidos (RH e Empresa)', variaveis: ['lista', 'quantidade'] },
  { valor: 'ANIVERSARIANTES_SEMANA', label: 'Aniversariantes da semana (RH)', variaveis: ['lista', 'quantidade'] },
] as const;
export type FonteDados = typeof FONTES_DADOS_DISPONIVEIS[number]['valor'];

// Catálogo fixo de eventos de sistema que já disparam automações (só para
// tipo WEBHOOK) — mesmo espírito do catálogo acima: escolha explícita por
// dropdown em vez de o disparo depender de a `chave` bater com o literal
// espalhado pelo código (app/admin/op/actions.ts, consignadoCore.ts,
// pontoWhatsapp.ts). Um evento novo, que o sistema ainda não sabe detectar,
// sempre vai exigir um desenvolvedor plugar uma chamada nova em algum lugar
// do código — mas, uma vez feito, qualquer automação (inclusive várias) pode
// reagir a ele sem tocar em código de novo.
export const EVENTOS_SISTEMA_DISPONIVEIS = [
  { valor: 'NOVA_OP', label: 'Nova Ordem de Pagamento criada', variaveis: ['numero_op', 'os_numero', 'solicitante', 'favorecido', 'valor', 'link'] },
  { valor: 'NOVO_EMPRESTIMO_CONSIGNADO', label: 'Novo empréstimo consignado identificado', variaveis: ['quantidade', 'funcionarios', 'competencia'] },
  { valor: 'SOLICITACAO_FOLGA', label: 'Solicitação de folga (Ponto via WhatsApp)', variaveis: ['solicitante', 'periodo', 'motivo'] },
] as const;
export type EventoSistema = typeof EVENTOS_SISTEMA_DISPONIVEIS[number]['valor'];
