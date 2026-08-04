// Template HTML do e-mail de Ordem de Pagamento — antes vivia como uma string
// gigante (~150 linhas) inline dentro de actions.ts, misturado com a lógica de
// envio via SMTP. Isolado aqui para facilitar manutenção do layout do e-mail
// sem precisar mexer na lógica de disparo.

// Os dados de uma OP vêm de campos de formulário livre (nome do favorecido,
// descrição do item, chave PIX etc.). Sem escaping, um valor como
// `<img src=x onerror=...>` digitado num desses campos seria interpretado
// como HTML por qualquer cliente de e-mail que renderize a mensagem.
function escaparHtml(valor: unknown): string {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function formatarValor(v: number): string {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataVencimento(dataVencimento: string | null | undefined): string {
  if (!dataVencimento) return 'Não informada';
  const partesData = dataVencimento.split('-');
  if (partesData.length === 3) {
    const [ano, mes, dia] = partesData;
    return `${dia}/${mes}/${ano}`;
  }
  return dataVencimento;
}

function blocoBotaoConfirmacao(linkBaixa: string): string {
  return `
    <div style="background-color: #ffffff; padding: 30px 20px; text-align: center; border-top: 1px solid #E2E8F0;">
      <a href="${linkBaixa}" style="background-color: #16A34A; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block; text-transform: uppercase; letter-spacing: 1px;">
        ✅ Confirmar Pagamento (Baixar OP)
      </a>
      <p style="color: #94A3B8; font-size: 11px; margin-top: 12px; margin-bottom: 0;">Clique apenas após efetuar o pagamento. A ação refletirá instantaneamente no sistema.</p>
    </div>
  `;
}

// Monta o HTML completo do e-mail de uma OP. `comBotaoConfirmacao` decide se o
// botão mágico de baixa (enviado só para o Financeiro) aparece ou não.
export function gerarHtmlEmailOP(op: any, comBotaoConfirmacao: boolean): string {
  const dataVencimentoFormatada = formatarDataVencimento(op.data_vencimento);
  const totalGeral = formatarValor(op.total_geral);

  const itensHtml = (op.itens || []).map((it: any) => {
    const unitario = formatarValor(it.valor_unitario);
    const total = formatarValor(it.total);
    return `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; color: #0C1D4D; font-weight: bold; font-size: 12px;">${escaparHtml(it.descricao || it.description)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; text-align: center; color: #64748B; font-size: 12px;">${escaparHtml(it.qtd || it.quantity || 1)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; text-align: right; color: #64748B; font-size: 12px;">${unitario}</td>
        <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; text-align: right; color: #336699; font-weight: bold; font-size: 12px;">${total}</td>
      </tr>
    `;
  }).join('');

  const anexoHtml = op.file_url
    ? `<a href="${escaparHtml(op.file_url)}" style="display: inline-block; padding: 12px 24px; background-color: #336699; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 12px;">📎 Visualizar Comprovante / Anexo</a>`
    : `<span style="color: #94A3B8; font-style: italic; font-size: 12px;">Nenhum anexo enviado.</span>`;

  const htmlBase = `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">

        <div style="background-color: #0C1D4D; padding: 20px; text-align: center; color: white;">
          <h2 style="margin: 0; font-size: 20px; letter-spacing: 1px; text-transform: uppercase;">Ordem de Pagamento</h2>
          <p style="margin: 5px 0 0 0; color: #94A3B8; font-size: 13px;">
            ${op.numero_op ? `Nº da OP: <strong>${escaparHtml(op.numero_op)}</strong> &nbsp;|&nbsp; ` : ''}Nº da OS: <strong>${escaparHtml(op.os_numero || 'S/N')}</strong>
          </p>
        </div>

        <div style="padding: 20px; border-bottom: 1px solid #E2E8F0;">
          <table style="width: 100%; font-size: 13px; line-height: 1.5;">
            <tr>
              <td style="padding-bottom: 10px; width: 50%;">
                <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Solicitante</strong><br/>
                <span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.responsavel_nome)}</span>
              </td>
              <td style="padding-bottom: 10px; width: 50%;">
                <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Natureza</strong><br/>
                <span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.natureza_pagamento || 'Não informada')}</span>
              </td>
            </tr>
          </table>
        </div>

        <div style="padding: 20px; border-bottom: 1px solid #E2E8F0; background-color: #F8FAFC;">
          <h3 style="color: #336699; font-size: 14px; text-transform: uppercase; margin-top: 0; margin-bottom: 15px;">📁 Dados do Projeto / Evento</h3>
          <table style="width: 100%; font-size: 13px; line-height: 1.5;">
            <tr>
              <td style="padding-bottom: 10px; width: 50%;"><strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Cliente</strong><br/><span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.os_cliente || 'Não informado')}</span></td>
              <td style="padding-bottom: 10px; width: 50%;"><strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Evento</strong><br/><span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.os_evento || 'Não informado')}</span></td>
            </tr>
            <tr>
              <td colspan="2" style="padding-bottom: 10px;"><strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Período</strong><br/><span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.os_periodo || 'Não informado')}</span></td>
            </tr>
          </table>
        </div>

        <div style="padding: 20px; border-bottom: 1px solid #E2E8F0;">
          <h3 style="color: #336699; font-size: 14px; text-transform: uppercase; margin-top: 0; margin-bottom: 15px;">🏢 Dados do Favorecido</h3>
          <table style="width: 100%; font-size: 13px; line-height: 1.5;">
            <tr>
              <td style="padding-bottom: 10px; width: 50%;"><strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Empresa / Nome</strong><br/><span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.empresa_recebedora)}</span></td>
              <td style="padding-bottom: 10px; width: 50%;"><strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">CNPJ / CPF</strong><br/><span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.cnpj_cpf_recebedora || 'Não informado')}</span></td>
            </tr>
            <tr>
              <td colspan="2" style="padding-bottom: 10px;"><strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Endereço</strong><br/><span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.endereco_recebedora || 'Não informado')}</span></td>
            </tr>
            <tr>
              <td style="padding-bottom: 10px; width: 50%;"><strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">CPF do Signatário</strong><br/><span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.cpf_signatario || 'Não informado')}</span></td>
              <td style="padding-bottom: 10px; width: 50%;"><strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Celular do Signatário</strong><br/><span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.telefone_recebedora || 'Não informado')}</span></td>
            </tr>
          </table>
        </div>

        <div style="padding: 20px; border-bottom: 1px solid #E2E8F0;">
          <h3 style="color: #336699; font-size: 14px; text-transform: uppercase; margin-top: 0; margin-bottom: 15px;">💳 Informações de Pagamento</h3>
          <table style="width: 100%; font-size: 13px; line-height: 1.5;">
            <tr>
              <td style="padding-bottom: 10px; width: 50%;"><strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Forma / Banco</strong><br/><span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.tipo_pagamento)} - ${escaparHtml(op.dados_pagamento)}</span></td>
              <td style="padding-bottom: 10px; width: 50%;"><strong style="color:red; font-size: 10px; text-transform: uppercase;">Data de Vencimento</strong><br/><span style="color:red; font-weight: bold;">${dataVencimentoFormatada}</span></td>
            </tr>
            <tr>
              <td colspan="2" style="padding-bottom: 10px;"><strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Chave PIX</strong><br/><span style="color:#0C1D4D; font-weight: bold;">${escaparHtml(op.chave_pix || 'Não informada')}</span></td>
            </tr>
          </table>
        </div>

        <div style="padding: 20px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px;">
            <thead>
              <tr style="background-color: #F8FAFC; color: #64748B; text-transform: uppercase;">
                <th style="padding: 10px; text-align: left; font-size: 10px;">Descrição</th>
                <th style="padding: 10px; text-align: center; font-size: 10px;">Qtd</th>
                <th style="padding: 10px; text-align: right; font-size: 10px;">Unitário</th>
                <th style="padding: 10px; text-align: right; font-size: 10px;">Total</th>
              </tr>
            </thead>
            <tbody>${itensHtml}</tbody>
          </table>

          <div style="background-color: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0;">
            ${anexoHtml}
          </div>

          ${op.observacao ? `
          <div style="margin-top: 15px; background-color: #FEFCE8; padding: 15px; border-radius: 8px; border: 1px solid #FDE68A;">
            <strong style="color:#92400E; font-size: 10px; text-transform: uppercase;">📝 Observações</strong><br/>
            <span style="color:#78350F; font-size: 12px;">${escaparHtml(op.observacao)}</span>
          </div>
          ` : ''}
        </div>

        <div style="background-color: #E0F2FE; padding: 25px 20px; text-align: right; border-top: 2px solid #BAE6FD;">
          <span style="color: #0369A1; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Valor Total a Pagar</span><br/>
          <strong style="color: #0C1D4D; font-size: 28px;">${totalGeral}</strong>
        </div>

        {{BOTAO_MÁGICO}}

        <div style="padding: 15px; text-align: center; background-color: #F1F5F9; color: #94A3B8; font-size: 10px;">
          <p style="margin:0;">Este é um e-mail automático gerado pelo Sistema Rentech.</p>
        </div>
      </div>
  `;

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const linkBaixa = `${baseUrl}/api/baixar-op?id=${op.id || op.numero_op}`;

  return htmlBase.replace('{{BOTAO_MÁGICO}}', comBotaoConfirmacao ? blocoBotaoConfirmacao(linkBaixa) : '');
}
