# 13º Salário

## Visão geral

**Onde fica:** Painel → RH → **13º Salário**.

No topo, escolha a **empresa** (Rentech ou Alfa Light; nunca as duas juntas, e a Rentech vem selecionada) e o **ano**. A tela mostra todos os colaboradores ativos da empresa em três listas:

| Lista | Quem entra | O que o RH faz |
| --- | --- | --- |
| 💰 **Via Empresa** | Contrato com "Recebe 13º Salário pela empresa?" marcado | Define as parcelas, fecha, envia para assinatura e paga pelo lote PIX |
| 🏢 **Via Contabilidade** | Contrato com "Entra na separação dos PDFs de holerite da contabilidade?" marcado (e que não é Via Empresa) | Importa os 2 holerites da contabilidade e lê o valor; o pagamento sai pelo lote |
| 🚫 **Sem 13º Salário** | Quem não cai em nenhuma das duas | Confere se está certo: se alguém ali deveria receber, corrige o contrato |

Na tela, a seção Via Empresa ainda aparece com o título **"Via Rentech"**.

**Onde se configura:** RH → Parâmetros, no Modelo de Contrato:

- **Recebe 13º Salário pela empresa?** só fica habilitada com **Recebe holerite (contabilidade)?** desmarcada. As duas juntas pagariam o 13º duas vezes; por isso, se você marcar o holerite da contabilidade, o 13º pela empresa é desmarcado na hora.
- **Entra na separação dos PDFs de holerite da contabilidade?** coloca o contrato na Via Contabilidade.

## Via Empresa: definir as parcelas

Cada linha mostra o colaborador, o cargo e o **📄 Contrato** (o valor do contrato da ficha, só para consulta), além de avos, bruto, 1ª parcela, INSS, IRRF e 2ª parcela.

**Valor sugerido:** sem digitar nada, a linha mostra o cálculo da CLT:

- Bruto = salário ÷ 12 × avos do ano. O salário é o da folha ou, se ele estiver vazio, o do contrato.
- 1ª parcela = 50% do bruto, sem desconto (prazo legal: 30/11).
- 2ª parcela = bruto − 1ª parcela − INSS − IRRF (prazo legal: 20/12).

**Digitar as parcelas:** os campos **1ª Parcela** e **2ª Parcela** aceitam o valor que a empresa vai pagar (ex.: `1.500,50`).

- O valor digitado é **exatamente o que se paga**, sem INSS e sem IRRF. O bruto vira 1ª + 2ª.
- Digite **as duas**: com uma só preenchida, a outra conta como zero e a linha não fecha.
- Campos vazios = vale o valor sugerido (em cinza dentro do campo).

## Via Empresa: fechar, assinar e pagar

1. **🔒 Fechar Todos** congela os valores de todas as linhas em aberto. Depois de fechado, mudança de salário ou de dependentes não altera mais nada.
2. **Valor zerado não fecha:** a linha com a 1ª ou a 2ª parcela em zero aparece como **⛔ Valor zerado** e fica de fora. O aviso ao fechar diz quantas e quais ficaram de fora.
3. Com a linha fechada, cada parcela tem os botões:
   - **📤 Assinatura**: gera o recibo da parcela e envia pela Autentique. A ficha precisa ter CPF e celular ou e-mail. Parcela zerada não é enviada.
   - **✓ Marcar paga**: para pagamento feito fora do lote (TED manual, por exemplo). Dá para desfazer, menos quando foi paga pelo lote.
4. **🧪 Teste / ⚠ Real:** em Teste (o padrão), o envio para assinatura não gasta documento do plano Autentique. Mude para Real só quando os valores estiverem conferidos.
5. **↺ Reabrir** pede o motivo e só funciona se nenhuma das parcelas estiver paga. A linha volta ao valor sugerido; digite de novo as parcelas, se for o caso.

**Recibo:** com parcelas digitadas, o recibo mostra só as parcelas, sem linhas de INSS e IRRF.

**Pagamento:** em Financeiro → RH, monte o lote com a fonte **13º Integral — 1ª Parcela** ou **13º Integral — 2ª Parcela** (grupo Avulsos). Cada parcela some do lote depois de paga, e parcela zerada não entra.

**Acompanhar as assinaturas:** RH → Assinaturas, aba **13º Salário**.

## Via Contabilidade: importar os holerites

A contabilidade manda **dois holerites**, um para cada parcela. Importe cada um separadamente:

1. Em RH → Holerites → **Separar Holerites** (ou em Financeiro → RH), escolha o tipo **Décimo Terceiro (13º)**.
2. Informe o **Ano** e a **Parcela** (1ª ou 2ª). Uma parcela não substitui a outra.
3. Envie o PDF, confira o nome de cada página e salve, como nos outros holerites.

Na tela do 13º, cada colaborador mostra a **1ª Parcela** e a **2ª Parcela**:

- O valor lido do holerite, ou **⏳ aguardando leitura** se o valor ainda não foi lido.
- **⚠ Não importado** quando o holerite daquela parcela ainda não entrou.
- **👁 Ver** abre o PDF.

**🔍 Ler valores (OCR)** lê de uma vez os holerites das duas parcelas que ainda estão sem valor. **🔄 Reler tudo** lê de novo, inclusive os que já tinham valor. As falhas aparecem numa lista vermelha; nesse caso, confira o PDF e digite o valor no lote do Financeiro RH.

**Pagamento:** em Financeiro → RH, marque a fonte **13º Salário (contabilidade)**. Aparece o campo **13º (contabilidade) — parcela**: escolha a 1ª ou a 2ª. Cada lote paga uma parcela. Esse item não some sozinho depois de pago, então confira o histórico de lotes antes de gerar outro da mesma parcela.

**No holerite mensal:** o Resumo de Recebimentos mostra a 1ª parcela no holerite de competência **novembro** e a 2ª no de **dezembro**.

## Sem 13º Salário

Lista os colaboradores ativos da empresa que não estão em nenhuma das duas listas, com o motivo:

- **Sem Modelo de Contrato na ficha.** Preencha o contrato na ficha do funcionário.
- **Modelo de Contrato não existe em Parâmetros.** O nome na ficha não bate com nenhum contrato cadastrado. Corrija a ficha ou cadastre o contrato.
- **"Recebe 13º pela empresa" sem efeito.** O contrato tem a opção marcada, mas também recebe holerite da contabilidade. Escolha um dos dois em Parâmetros.
- **O contrato não tem nenhuma das duas opções.** Normal para quem não tem direito ao 13º (freelancer, PJ). Se a pessoa deveria receber, ajuste o contrato em Parâmetros.

Quando ninguém fica de fora, a lista mostra **"✓ Todos os colaboradores ativos desta empresa estão em Via Empresa ou Via Contabilidade"**.

## Dúvidas comuns

- **O colaborador não aparece em nenhuma lista.** A tela mostra só os ativos da empresa escolhida no topo. Confira se a ficha está ativa e na empresa certa.
- **Digitei a parcela errada e já fechei.** Use **↺ Reabrir** (só antes de qualquer parcela paga), digite de novo e feche.
- **Importei o holerite na parcela errada.** Importe de novo o PDF certo em cada parcela: a nova importação substitui a da mesma parcela.
- **Holerites do 13º importados antes de 28/11/2026 não aparecem.** Eles foram gravados no formato antigo (só o ano). Importe de novo escolhendo a parcela.
- **A assinatura não saiu: "CPF ausente ou inválido".** Preencha o CPF, e o celular ou o e-mail, na ficha do funcionário e envie de novo.
