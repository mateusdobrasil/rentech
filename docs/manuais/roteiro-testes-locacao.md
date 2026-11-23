## Como usar

A virada só acontece quando as 12 partes abaixo estiverem **Aprovadas** e não houver problema "Bloqueia" em aberto. O roteiro testa o sistema novo nas telas reais, módulo a módulo, enquanto o PrimeStart (P2S) segue oficial. Marque cada passo ao conferir, mude a situação da parte na tabela e anote qualquer diferença no **Registro de problemas**, no fim.

Regras da fase paralela:

- **Nada daqui vale para o cliente.** Pedidos, reservas, cobranças e notas reais continuam no P2S.
- **Propostas e contratos sempre em modo de teste (sandbox)**, enviados para o e-mail ou WhatsApp da própria equipe.
- Use um cliente de teste ou um cliente real com o **seu** e-mail como contato da ficha.
- **Nota de Débito só na série ENSAIO** e **nota fiscal só em homologação** (sem valor fiscal).
- O inventário é ensaio: "Carregar saldos do P2S" volta os saldos ao do P2S depois.
- **Nunca clicar:** Congelar, Migrar ou Concluir na Virada da Chave, nem "Virar a chave" em Títulos a Pagar. A virada é feita junto com o Claude, no dia combinado.
- Ordem de pagamento de teste: conferir e **não salvar** (OP vai para o P2S e para o banco).

| Parte | Quem testa | Situação |
| --- | --- | --- |
| 1. Preparação | Administrador | A testar |
| 2. Comercial: orçamento, proposta e contrato | Comercial | A testar |
| 3. Agenda e indicadores | Comercial e gestão | A testar |
| 4. Ficha de Locação e sublocação | Comercial e operacional | A testar |
| 5. Expedição | Estoque / operacional | A testar |
| 6. Avarias e manutenção | Estoque / operacional | A testar |
| 7. Inventário | Estoque | A testar |
| 8. Faturamento e notas fiscais | Financeiro | A testar |
| 9. Financeiro | Financeiro | A testar |
| 10. Comissões e relatórios | Comercial e gestão | A testar |
| 11. Portal do Cliente | Comercial | A testar |
| 12. Virada da Chave: prévia | Administrador | A testar |

## 1. Preparação (administrador)

Faz uma vez, antes das outras partes.

- [ ] **Permissões:** em Parâmetros → Permissões, liberar o hub `/admin/locacoes` para Comercial, Administrativo, Gerência, Diretoria, Estoque e Operacional (hoje só Administrador). Esperado: esses perfis veem o card Locações no painel.
- [ ] **Dados das empresas:** em Parâmetros → Empresas, preencher endereço, telefone, e-mail e site de Rentech e Alfa Light. Esperado: esses dados aparecem no cabeçalho do PDF da proposta.
- [ ] **Tabelas de preço:** Locações → Tabelas de Preço → Importar do P2S. Abrir a "Padrão Rentech" e simular 4 e 10 dias num produto. Esperado: total com a conta aberta (faixa × diária + diárias extras).
- [ ] **Saldos:** Estoque → Equipamentos de Locação → Carregar saldos do P2S. Esperado: mensagem com produtos e unidades por empresa.
- [ ] **Patrimônios:** escolher 2 ou 3 equipamentos caros, mudar para "Por patrimônio", gerar 3 peças em lote de cada e imprimir as etiquetas numa folha A4 3×8. Esperado: etiquetas com QR, número e nome legíveis.
- [ ] **Kit (opcional):** montar um kit com 2 componentes na aba Kit de um produto.
- [ ] **Acesso de locação por usuário:** em Parâmetros → Permissões, editar cada vendedor, seção Locação: vendedor do P2S, escopo Carteira ou Todas, limite de desconto e quem aprova desconto. Esperado: um vendedor de teste com escopo Carteira e desconto máximo de 5%.
- [ ] **Parâmetros fiscais:** Financeiro → Fiscal → Parâmetros, conferir ambiente em **Homologação**, CEP de saída do MDF-e e produto predominante. Esperado: nada em Produção.
- [ ] **Caixa e bancos:** Financeiro → Caixa e Bancos, conferir as contas financeiras e o saldo inicial de cada uma. Esperado: saldo do Itaú igual ao do extrato no dia do saldo inicial.

## 2. Comercial: orçamento, proposta e contrato

Locações → Orçamentos e Reservas.

- [ ] **Novo orçamento:** cliente, evento, datas (montagem, início, fim, desmontagem) e o **seu** e-mail como contato. Esperado: dias cobrados = dias do evento.
- [ ] **Itens:** adicionar 3 equipamentos (um deles por patrimônio), 1 serviço e 1 frete. Esperado: preço dos equipamentos sai sozinho da tabela, com a conta embaixo do item.
- [ ] **Preço manual:** alterar o valor de um item. Esperado: fica marcado como "preço manual"; o ↺ volta ao da tabela.
- [ ] **Desconto acima do limite:** com o vendedor de teste da parte 1, dar 10% de desconto. Esperado: ficha marcada como desconto pendente; Enviar proposta e Reservar ficam bloqueados até alguém com permissão clicar ✔ Aprovar desconto.
- [ ] **Comissão prevista:** conferir a comissão prevista no editor antes e depois do desconto. Esperado: o % cai conforme a faixa de desconto do vendedor.
- [ ] **Painel de LED:** incluir um painel de LED e informar largura × altura. Esperado: quantidade em m² com gabinetes inteiros e o grid de gabinetes na ficha; a proposta traz a ficha técnica do painel.
- [ ] **Itens divididos:** conferir que os itens aparecem em Equipamentos e em Serviços / Extras, cada grupo com subtotal.
- [ ] **Disponibilidade:** Verificar disponibilidade. Esperado: estoque, já reservado, livre e falta por equipamento.
- [ ] **Falta:** colocar quantidade maior que o estoque num item e verificar de novo. Esperado: linha vermelha com a falta.
- [ ] **PDF:** salvar e clicar em Baixar PDF, com e sem "valor por item". Esperado: proposta com logo, dados da empresa, itens, totais e condições.
- [ ] **Assinatura:** Enviar para assinatura com **envio de teste (sandbox)** marcado, para o seu WhatsApp ou e-mail. Assinar. Esperado: proposta "Assinada" no painel e no histórico; a ficha **não** é aprovada nem reservada, porque foi teste.
- [ ] **Reserva:** Aprovar e reservar. Esperado: status Reservada; nos itens por patrimônio aparece quais peças foram reservadas.
- [ ] **Editar reservada:** trocar uma quantidade e salvar. Esperado: reserva refeita; se faltar equipamento, aviso de que a reserva anterior foi mantida.
- [ ] **Contrato:** com a ficha reservada, ✍ Enviar contrato para assinatura em **sandbox**, incluindo + Testemunha e + Representante com e-mails da equipe. Esperado: PDF com as cláusulas padrão e os nomes no bloco de assinaturas; status Parcial até todos assinarem, depois Assinado e "PDF assinado" disponível.
- [ ] **Escopo da carteira:** entrar com o vendedor de teste. Esperado: ele só vê fichas e clientes da própria carteira; a tela Fichas de Reserva (P2S) fica bloqueada para ele.
- [ ] **Concorrência:** outro orçamento para as mesmas datas e o mesmo equipamento por patrimônio, tentando reservar todas as peças. Esperado: falta apontada; nenhuma peça reservada duas vezes.
- [ ] **Perdido / cancelar / reabrir / duplicar:** testar em um terceiro orçamento. Esperado: motivo obrigatório e tudo no histórico.

## 3. Agenda e indicadores

- [ ] **Importação do P2S:** em Orçamentos e Reservas, Importar do P2S agora. Esperado: quantidade de fichas importadas; elas aparecem com o selo P2S e só para leitura.
- [ ] **Agenda:** Locações → Agenda de Disponibilidade, 30 dias. Esperado: células coloridas pelo que sobra livre; a reserva da parte 2 aparece nas datas certas, contando os dias de preparo e retorno.
- [ ] **Detalhe do dia:** clicar numa célula ocupada. Esperado: fichas que ocupam o dia; clicar abre a ficha.
- [ ] **Faltas:** marcar "só com falta". Esperado: lista de equipamentos acima do estoque. Conferir 2 ou 3 casos com o P2S e anotar se é saldo errado lá (vai para o inventário da virada).
- [ ] **Indicadores:** Locações → Indicadores, 30 e 90 dias. Esperado: utilização, ociosos e alta demanda coerentes com o que a equipe conhece; exportar o Excel.

## 4. Ficha de Locação e sublocação

Use a OS reservada da parte 2. A Ficha de Locação (FL) registra o que saiu e o que voltou; a sublocação cobre o que falta no estoque.

- [ ] **Gerar a FL:** no editor da OS, 🚚 Ficha de locação. Esperado: FL-xxxxx/A criada com os itens da OS.
- [ ] **Saída parcial:** na FL, 📤 Registrar saída de parte dos itens, lendo o QR das peças por patrimônio. Esperado: OS passa a Em locação; a saída aparece em Movimentações.
- [ ] **Assinatura na tela:** Ver a OS antes de assinar (PDF), depois ✍ Assinar com o dedo no celular ou tablet. Esperado: OS de saída assinada em "OS e comprovantes". Testar também "Assinar depois".
- [ ] **Troca:** 🔁 Troca de uma peça por outra do mesmo equipamento. Esperado: troca registrada; a peça nova fica ocupada e a antiga livre.
- [ ] **Prorrogação:** no editor da OS (Comercial), 📅 Prorrogar 2 dias. Esperado: aparece em Prorrogações; a agenda ocupa os dias novos; o saldo a faturar sobe.
- [ ] **Complemento:** ➕ Complemento com 1 item a mais. Esperado: FL /B ligada à mesma OS.
- [ ] **Devolução:** 📥 Registrar devolução parcial e depois total. Esperado: o devolvido libera na agenda depois dos dias de retorno; com tudo devolvido, a OS fica Finalizada.
- [ ] **Extravio:** numa FL de teste, Encerrar ficha com uma peça sem voltar. Esperado: peça extraviada e título de Reposição em Títulos a Receber; cancelar a reposição deixa só o histórico.
- [ ] **Sublocar o que falta:** numa OS com falta (passo Falta da parte 2), 🤝 Sublocar o que falta e escolher um parceiro. Esperado: pedido de sublocação com os itens faltantes em Locações → Sublocações.
- [ ] **Parceiro confirmou:** ✔ Parceiro confirmou. Esperado: a falta some e a OS consegue reservar.
- [ ] **Entrada e devolução ao parceiro:** 📥 Entrada do parceiro e depois 📤 Devolver ao parceiro. Esperado: tudo devolvido encerra a sublocação; o equipamento do parceiro não ocupa o estoque próprio.
- [ ] **Pagamento e avaria do parceiro:** abrir a Ordem de pagamento pré-preenchida e conferir parceiro, valor e natureza (**não salvar**); registrar ⚠ Avaria com custo cobrado pelo parceiro. Esperado: margem da OS recalculada com o custo.

## 5. Expedição

Estoque → Expedição. Use um evento que tenha fichas aprovadas ou em locação no P2S, e também o evento da ficha reservada na parte 2.

- [ ] **OS para separar:** no topo da Expedição, o painel OS para separar. Esperado: a OS aprovada da parte 2 aparece com o prazo de saída e o botão para criar o checklist; o app da operação recebe aviso quando uma ficha é aprovada.
- [ ] **Conferência de Montagem/Desmontagem:** gerar o relatório do evento. Esperado: uma folha por OS dos checklists, com colunas de montagem e desmontagem.
- [ ] **Importar das OS's:** abrir um checklist do evento e importar. Esperado: itens com produto e quantidade exatos, separados por ficha; fichas ainda em orçamento ficam de fora com aviso.
- [ ] **Conferir por QR — saída:** salvar o checklist, abrir "Conferir por QR" em Saída e ler as etiquetas impressas na parte 1 (leitor USB ou câmera do celular Android). Esperado: bip, contagem sobe na linha do produto, saída marcada ao chegar no previsto.
- [ ] **Leitura repetida:** ler a mesma etiqueta de novo. Esperado: aviso de que já foi lida.
- [ ] **Peça presa:** em outro checklist, ler na saída uma peça que ainda não voltou do primeiro. Esperado: recusa dizendo em qual checklist ela está.
- [ ] **Retorno:** em Retorno, ler parte das peças. Esperado: lista "saíram e não voltaram" com as que faltam.
- [ ] **Avaria no retorno:** numa peça lida no retorno, clicar "⚠ avaria", tirar foto pelo celular e marcar "abrir OS". Esperado: avaria registrada e OS de manutenção aberta.
- [ ] **Salvar:** salvar o checklist. Esperado: quantidades de saída e retorno gravadas.

## 6. Avarias e manutenção

Estoque → Avarias e Manutenção.

- [ ] **OS da parte 5:** abrir a OS gerada pela avaria. Esperado: peça em manutenção; na agenda e na verificação de disponibilidade ela não conta como livre.
- [ ] **Avançar a OS:** Em execução → Concluída, com serviço, custo de peças e mão de obra. Esperado: peça volta a Ativo; custo entra em "Custo no mês".
- [ ] **OS por quantidade:** abrir OS de 2 unidades de um item por quantidade. Esperado: "em manutenção" do saldo sobe 2. Tentar uma OS maior que o saldo livre. Esperado: recusa.
- [ ] **Sem conserto:** numa OS de teste, marcar Sem conserto. Esperado: peça baixada (ou quantidade sai do saldo).
- [ ] **Avaria manual com perda total:** registrar uma avaria "Perda total". Esperado: valor sugerido pela indenização, cobrança "Cobrar", peça baixada.
- [ ] **Previsão atrasada:** OS com previsão no passado. Esperado: aparece em vermelho e no card Atrasadas.

## 7. Inventário (ensaio)

Estoque → Inventário. Faça parcial: uma ou duas categorias pequenas.

- [ ] **Abrir:** novo inventário com 1 ou 2 categorias. Esperado: produtos do escopo listados, contagem cega ligada.
- [ ] **Contar por quantidade:** digitar as contagens no celular ou tablet, no depósito. Esperado: linha verde com o nome de quem contou.
- [ ] **Contar por patrimônio:** na aba Patrimônios, ler as etiquetas pelo QR e depois digitar o número de uma peça já lida. Esperado: a digitada é recusada como já contada.
- [ ] **Código desconhecido:** ler ou digitar um código que não existe. Esperado: aparece em "códigos desconhecidos".
- [ ] **Divergências:** conferir faltas, sobras e a diferença em valor. Exportar o Excel.
- [ ] **Concluir:** concluir e aplicar com "marcar extraviados" desligado. Esperado: saldos ajustados = contado + em locação.
- [ ] **Voltar ao P2S:** em Equipamentos de Locação, Carregar saldos do P2S de novo (fase paralela).

## 8. Faturamento e notas fiscais

Nota de Débito só na série ENSAIO; NF-e e MDF-e só em homologação. Use a OS finalizada da parte 4.

- [ ] **Fila a faturar:** Financeiro → Faturamento. Esperado: a OS finalizada aparece em "a faturar" com saldo = OS + prorrogações − títulos já gerados.
- [ ] **Faturar:** Faturar a OS. Esperado: Nota de Débito série ENSAIO, PDF com itens e vencimentos, parcelas em Títulos a Receber.
- [ ] **Enviar:** e-mail, WhatsApp e link. Esperado: ENSAIO só vai para o seu e-mail; o link abre o PDF sem login.
- [ ] **Cancelar:** cancelar uma Nota de Débito sem nada recebido e tentar cancelar outra com parcela recebida. Esperado: a primeira cancela as parcelas em aberto; a segunda é recusada.
- [ ] **NF-e de remessa:** na FL da parte 4, 🏛️ NF-e de remessa. Esperado: NF-e autorizada com selo "homologação" e DANFE em Financeiro → Fiscal.
- [ ] **Retorno, correção e cancelamento:** em Fiscal, Retorno na remessa; Corrigir (carta de correção) numa nota; cancelar outra com justificativa. Esperado: retorno referencia a remessa; CC-e baixável; nota cancelada.
- [ ] **MDF-e fora de SP:** remessa para cliente de outro estado. Esperado: botão amarelo "MDF-e obrigatório" e aviso na aba MDF-e. Emitir com o caminhão e o motorista, baixar o DAMDFE, ➕ Motorista e Encerrar. Esperado: "✓ MDF-e" na nota.
- [ ] **MDF-e dentro de SP:** remessa para cliente em SP. Esperado: botão comum "MDF-e" (opcional), sem aviso.
- [ ] **NFS-e:** não testar por enquanto (bloqueada pela Focus no erro 1002 de São Paulo).

## 9. Financeiro

Exige 2FA. Use a ficha reservada da parte 2 com condição de pagamento "50% + 50%".

- [ ] **Gerar pela ficha:** no painel Faturamento da ficha, 💵 Só gerar títulos. Esperado: 2 parcelas sugeridas, a 1ª em 3 dias e a 2ª no fim do evento; total igual ao da ficha.
- [ ] **Faturar demais:** tentar gerar de novo com valor maior que o saldo. Esperado: recusa.
- [ ] **Avaria:** na avaria "Cobrar" da parte 6, Gerar título a receber. Esperado: título criado e avaria "Cobrado".
- [ ] **Receber:** Financeiro → Títulos a Receber, registrar o recebimento de uma parcela com juros. Esperado: "Pago" e entra em "Recebido no mês"; o título da avaria pago muda a avaria para "Pago".
- [ ] **Estornar e cancelar:** estornar uma baixa e cancelar um título com motivo. Esperado: avaria volta a "Cobrar" quando o título dela é cancelado.
- [ ] **Avulso e Excel:** criar um título avulso e exportar o Excel.
- [ ] **Caixa e Bancos:** ⇄ Transferência entre duas contas e um + Lançamento avulso; depois excluir os dois. Esperado: extrato com saldo correto antes e depois.
- [ ] **Conciliação OFX:** Financeiro → Conciliação, ⬆ Importar OFX do Itaú da última semana e ⚡ Conciliar automaticamente. Esperado: maioria conciliada; o lote SISPAG casa com vários movimentos pela conciliação manual; saldo banco × sistema bate.
- [ ] **Contas recorrentes:** Títulos a Pagar, + Nova recorrente (ex.: aluguel mensal). Esperado: vencimentos dos próximos 45 dias gerados. Pagar um e estornar; depois cancelar a recorrente. **Não clicar Virar a chave.**
- [ ] **Fluxo de caixa:** por semana e por mês, regime de caixa. Esperado: realizado × previsto coerente com o banco e com o P2S.
- [ ] **DRE:** mês passado, caixa e competência. Esperado: receita e despesas próximas das do P2S para o mesmo mês; investimentos e movimentações financeiras fora do resultado operacional.

## 10. Comissões e relatórios

- [ ] **Carteira:** Comercial → Carteira. Esperado: cada cliente com um vendedor; cliente sem dono entra na carteira de quem fez a 1ª ficha.
- [ ] **Regra de comissão:** Comercial → Comissões, Regra de comissão por vendedor: % cheia e faixas de desconto e de prazo. Esperado: a comissão prevista da parte 2 segue essas faixas.
- [ ] **Mês em aberto:** escolher o mês passado. Esperado: recebimentos do P2S e do sistema ligados às fichas; título com mais de uma ficha rateado. Conferir 3 vendedores com a planilha usada hoje.
- [ ] **Fechar e reabrir:** Marcar paga num vendedor e depois Reabrir. Esperado: lançamento gravado e desfeito.
- [ ] **Relatórios:** abrir os 12 relatórios em 90 dias e baixar o Excel de cada um. Esperado: nenhum erro; vendedor de teste vê só a carteira em Clientes, Eventos e Comissão.
- [ ] **Bate com o P2S:** comparar faturamento do mês passado e os 5 maiores clientes do ano com o P2S. Esperado: diferença explicada ou zero.

## 11. Portal do Cliente

Abrir `/cliente` (ou o menu Ferramentas → Portal do Cliente) numa aba anônima, como se fosse o cliente.

- [ ] **Entrar:** digitar o e-mail usado como contato da ficha da parte 2 (o seu). Esperado: código de 6 dígitos chega por e-mail e dá acesso.
- [ ] **E-mail de fora:** pedir código para um e-mail que não é de cliente. Esperado: a mesma mensagem genérica, e nenhum código chega.
- [ ] **Código errado:** errar o código 5 vezes. Esperado: bloqueio pedindo um novo.
- [ ] **Propostas e reservas:** conferir que a ficha aparece na aba certa, com itens, totais e os PDFs. Fichas do P2S **não** aparecem.
- [ ] **Pedir orçamento:** enviar um pedido pelo portal. Esperado: aviso verde "pedidos do Portal do Cliente" em Orçamentos e Reservas; "Converter em orçamento" cria a ficha com cliente, datas e o pedido nas observações internas.
- [ ] **Notas de Débito:** conferir a aba de notas. Esperado: a Nota de Débito ENSAIO da parte 8 **não** aparece (o portal só mostra as oficiais).
- [ ] **Sair:** sair e tentar voltar. Esperado: pede o e-mail de novo.

## 12. Virada da Chave: prévia (sem executar)

Só Administrador, em Parâmetros → Virada da Chave, uma empresa por vez. Aqui só se olha: **não clicar Congelar, Migrar nem Concluir.**

- [ ] **Conferido pelo sistema:** abrir a Rentech. Esperado: itens verdes ou com motivo claro (ex.: OS em locação sem leitura recente).
- [ ] **Conferido por você:** ler cada item manual e anotar o que falta (inventário, numeração da NF-e e do RPS na Focus, equipe treinada).
- [ ] **Prévia das OS:** conferir 5 OS por amostra com o P2S: cliente, itens, datas e faturado no P2S. Esperado: tudo igual.
- [ ] **Prévia das contas em aberto:** ver a prévia por ano de contas a receber e a pagar e escolher a data de corte com o financeiro. Esperado: data de corte anotada aqui.
- [ ] **Alfa Light:** repetir os quatro passos acima.

## Critério para liberar a virada

A virada é marcada quando os quatro itens abaixo estiverem cumpridos:

- [ ] As 12 partes estão **Aprovadas** na tabela do início.
- [ ] Nenhum problema "Bloqueia" em aberto no registro abaixo.
- [ ] Inventário completo agendado para a semana da virada.
- [ ] Data de corte das contas e dia da virada combinados com o financeiro e o comercial.
- [ ] No dia da virada, antes de congelar: Parâmetros → Virada da Chave → **Limpar o ensaio** (cancela os orçamentos, reservas, títulos, Notas de Débito, avarias, OS de manutenção e sublocações de teste; o checklist mostra "Ensaio da fase paralela limpo").

## Registro de problemas

Uma linha por problema, com a parte e o passo do roteiro. "Bloqueia" = não dá para seguir; "Atrapalha" = dá para contornar; "Detalhe" = texto, visual ou sugestão.

| Data | Parte / passo | O que aconteceu | Quem | Gravidade | Status |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  | Aberto |
|  |  |  |  |  | Aberto |
|  |  |  |  |  | Aberto |
