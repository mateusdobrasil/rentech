// Utilitários compartilhados entre as telas do módulo de Ordem de Pagamento.

export interface ItemOPNormalizado {
  descricao: string;
  qtd: number;
  valor_unitario: number;
  total: number;
}

// OPs antigas foram salvas com os campos em inglês (description/quantity);
// as novas usam os campos em português (descricao/qtd/valor_unitario). Esta
// função resolve os dois formatos num só, num único lugar — antes essa mesma
// lógica estava copiada dentro de "responsavel" e "financeiro".
export function normalizarItensOP(itens: any[]): ItemOPNormalizado[] {
  if (!Array.isArray(itens)) return [];

  return itens.map((it) => {
    const quantidade = Number(it.qtd || it.quantity || 1);
    const total = Number(it.total || 0);
    const unitario = Number(it.valor_unitario || (total / quantidade) || 0);
    return {
      descricao: it.descricao || it.description || '',
      qtd: quantidade,
      valor_unitario: unitario,
      total,
    };
  });
}

// Validação server-side dos itens de uma OP — antes só existia no cliente
// (nova/page.tsx checava "pelo menos um item válido" antes de montar o
// payload), então uma chamada direta à Server Action, sem passar pela tela,
// conseguia gravar itens vazios ou com valores inválidos.
export function validarItensOP(itens: any[]): string | null {
  if (!Array.isArray(itens) || itens.length === 0) {
    return 'A OP precisa ter pelo menos um item.';
  }

  for (const item of itens) {
    if (!item?.descricao || !String(item.descricao).trim()) {
      return 'Todo item precisa ter uma descrição.';
    }
    if (!(Number(item.qtd) > 0)) {
      return 'Todo item precisa ter quantidade maior que zero.';
    }
    if (!(Number(item.valor_unitario) >= 0)) {
      return 'Todo item precisa ter um valor unitário válido.';
    }
  }

  return null;
}

interface DadosOPValidaveis {
  empresa_recebedora?: string;
  tipo_pagamento?: string;
  data_vencimento?: string;
  itens?: any[];
  total_geral?: number;
  cpf_signatario?: string;
  telefone_recebedora?: string;
}

// Validação server-side dos dados essenciais de uma OP (usada por criarOP).
// Reflete as mesmas exigências que o formulário de "Nova OP" já impõe no
// cliente (data de vencimento obrigatória, ao menos um item válido, etc.) —
// só que agora garantidas no servidor também.
export function validarNovaOP(data: DadosOPValidaveis): string | null {
  if (!data.empresa_recebedora || !data.empresa_recebedora.trim()) {
    return 'Informe o nome do favorecido.';
  }
  if (!data.tipo_pagamento || !data.tipo_pagamento.trim()) {
    return 'Selecione a forma de pagamento.';
  }
  if (!data.data_vencimento || !/^\d{4}-\d{2}-\d{2}$/.test(data.data_vencimento)) {
    return 'Informe uma data de vencimento válida.';
  }

  const erroItens = validarItensOP(data.itens || []);
  if (erroItens) return erroItens;

  if (!(Number(data.total_geral) > 0)) {
    return 'O valor total da OP deve ser maior que zero.';
  }

  // CPF e celular do signatário são obrigatórios: sem eles não dá para
  // enviar o recibo para assinatura digital via Autentique (que valida o
  // signatário por CPF e envia o link automaticamente por WhatsApp).
  const cpfLimpo = (data.cpf_signatario || '').replace(/\D/g, '');
  if (cpfLimpo.length !== 11) {
    return 'Informe um CPF válido do signatário (obrigatório para assinatura digital).';
  }
  const celularLimpo = (data.telefone_recebedora || '').replace(/\D/g, '');
  if (celularLimpo.length < 10) {
    return 'Informe um celular válido do signatário (obrigatório para assinatura digital).';
  }

  return null;
}
