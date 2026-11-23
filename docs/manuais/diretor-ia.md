## O que é o Diretor (IA)

O Diretor (IA) acompanha cada empresa do grupo todos os dias e avisa o que fugiu do normal, sem ninguém precisar pedir. Ele lê os dados do Rentech WEB e do PrimeStart (P2S), escreve relatórios, manda alertas e responde perguntas sobre a empresa. Desde 22/11/2026 ele roda no modelo Claude Haiku 5.5, mais barato, com o mesmo conteúdo.

O que ele faz:

- Relatórios diário, semanal, mensal e anual de cada empresa, com o que aconteceu e o que pede atenção.
- Alertas de exceção duas vezes por dia: pagamento suspeito, cliente grande atrasado, material ou veículo que não voltou, caixa apertado, meta estourada, NF-e sem MDF-e e falta na agenda.
- Locação: orçamentos em aberto, conversão, faltas na agenda, devoluções atrasadas, o que falta faturar, avarias e manutenção. Entra nos relatórios depois que a empresa congela o P2S na virada da chave.
- Projeção de caixa de 30, 60 e 90 dias.
- Acompanhamento de metas mensais.
- Um chat para perguntar qualquer coisa sobre os dados ("quanto recebemos este mês?").

O que ele não faz: não aprova, não paga, não altera nem envia nada no sistema. Ele só lê. Toda decisão continua com a diretoria.

Como os números são feitos: todo número que aparece (valores, totais, porcentagens) é calculado pelo próprio sistema, do mesmo jeito que as telas de origem. A IA só interpreta esses números, compara com o histórico e escreve. Por isso o número do relatório é o mesmo da tela de Contas a Pagar, OPs ou Fichas.

Quem pode usar: perfis Administrador e Diretoria, com verificação em duas etapas (2FA). Cada pessoa só vê as empresas às quais está vinculada.

## Como acessar

No menu inicial do /admin, clique no cartão **Diretor (IA)** (ícone 🧭). O endereço direto é /admin/diretoria. Os links que chegam por e-mail já abrem a empresa, o tipo de relatório e a data certos.

Se aparecer "Acesso Restrito", o perfil não tem a rota liberada em Parâmetros → Permissões, ou falta concluir a verificação em duas etapas.

No topo da tela:

1. **Empresa:** os botões com o nome de cada empresa (Rentech, Alfa Light…). Tudo o que aparece abaixo é da empresa selecionada.
2. **Abas:** Relatórios, Alertas, Caixa, Perguntar e Parâmetros.
3. **Tipo de relatório:** dentro de Relatórios, escolha Diário, Semanal, Mensal ou Anual.
4. **Botão de gerar:** "Gerar o de ontem agora" (ou o da última semana, mês ou ano) refaz o relatório na hora, sem mandar e-mail. Leva de 1 a 2 minutos.

| Aba | Para que serve |
| --- | --- |
| Relatórios | Ler os relatórios do Diretor, do mais recente ao mais antigo |
| Alertas | Ver as exceções que o Diretor encontrou e quando foram avisadas |
| Caixa | Projeção de entradas e saídas para os próximos 90 dias |
| Perguntar | Conversar com o Diretor sobre os dados |
| Parâmetros | Metas mensais e valores de corte dos alertas |

## Relatórios

São quatro relatórios por empresa, gerados sozinhos e enviados por e-mail. Ficam guardados na aba Relatórios para consulta.

| Relatório | Quando sai | O que analisa |
| --- | --- | --- |
| Diário | Todo dia, 10h | O dia anterior + a agenda dos próximos dias |
| Semanal | Segunda, 8h | A semana anterior (segunda a domingo), comparada com as 4 semanas antes |
| Mensal | Dia 1, 8h | O mês anterior, comparado com os 5 meses antes e com o mesmo mês do ano anterior |
| Anual | 1º de janeiro, 8h | O ano anterior mês a mês, com recomendações para o orçamento do ano que começa |

Na lista à esquerda, a bolinha mostra a situação do período: verde = normal, amarelo = atenção (algo pede ação nos próximos dias), vermelho = crítico (risco imediato de caixa, operação parada ou prazo legal estourando), cinza = a IA não conseguiu escrever.

Como ler um relatório, de cima para baixo:

1. **Manchete:** o resumo do período numa frase. Se for ler só uma coisa, é essa.
2. **Números do período:** os cartões com recebido, a receber, vencido, pago, a pagar, OPs, fichas, expedição e frota. Cartão com borda vermelha pede atenção. Estes números são do sistema, não da IA.
3. **Metas:** barra de progresso de cada meta cadastrada, com o traço do ritmo esperado até a data.
4. **Pontos de atenção:** até 6, do mais grave ao menos grave, cada um com a ação sugerida e o botão Abrir para ir à tela da área.
5. **Por área:** Financeiro, Comercial, Expedição, Frota e RH, com os fatos do período.
6. **Pendências:** o que o Diretor está cobrando e desde quando. Ele lembra de um dia para o outro e marca como resolvida quando os números mostram que resolveu.
7. **Sobre os dados:** limitações daquele período (sincronização atrasada, dado incompleto).

No semanal, mensal e anual aparecem também as tendências, a agenda da semana ou as prioridades e recomendações, e um resumo do caixa.

Para refazer um relatório (por exemplo, depois de corrigir um dado no P2S), use o botão de gerar: ele substitui o daquele período.

## Alertas

O Diretor procura exceções e manda as novas num e-mail só por empresa, às 12h e às 18h. Cada ocorrência é avisada uma vez; o que continua igual não volta a ser enviado.

| Alerta | Quando dispara |
| --- | --- |
| Favorecido novo | Primeira OP para aquele CPF/CNPJ (ou nome) |
| Conta compartilhada | A chave Pix ou conta da OP já recebeu em nome de outra pessoa |
| OP de valor alto | OP nova a partir do valor de corte (inicial: R$ 10.000) |
| Cliente atrasou | Título a receber a partir do corte (inicial: R$ 20.000) venceu e não foi pago, nos últimos 30 dias |
| Material não voltou | Checklist de expedição com saída conferida e sem retorno 3 dias depois do fim do evento |
| Veículo fora | Checklist de veículo em andamento há mais de 3 dias |
| Caixa apertado | Saídas previstas nos próximos 7 dias maiores que as entradas previstas (no máximo 1 vez por semana) |
| Teto de OPs | OPs criadas no mês passaram de 80% e de 100% do teto cadastrado |
| Teto de inadimplência | Vencido a receber (até 1 ano) acima do teto cadastrado |
| MDF-e pendente 🚚 | NF-e dos últimos 30 dias para fora de SP, em operação de transporte, sem MDF-e ativo uma hora depois de emitida |
| Falta na agenda 📦 | Equipamento com mais reservado do que estoque em algum dia dos próximos 7 dias |

Na aba Alertas aparecem todos os alertas da empresa, com o detalhe, quando foram detectados e se já foram enviados. O botão **Verificar agora** procura na hora; o que for novo sai no próximo envio das 12h ou 18h.

Comparar favorecidos tolera nome abreviado e erro de uma letra ("JULIA NOGUEIRA" e "JULIA NOGUEIRA SOUSA" contam como a mesma pessoa). "Conta compartilhada" não é acusação: pode ser um parente ou uma empresa que recebe por outra. É um pedido de conferência antes de aprovar.

## Caixa

A aba Caixa mostra quanto o caixa deve subir ou cair a partir de hoje, nos próximos 30, 60 e 90 dias, com o que já está lançado.

- **Entradas previstas:** contas a receber em aberto, pela data de vencimento.
- **Saídas previstas:** contas a pagar em aberto no P2S + OPs pendentes que ainda não foram para o P2S. OP já enviada ao P2S vira conta a pagar lá e não é contada duas vezes. OP pendente já vencida entra na primeira semana.

O que tem na tela:

1. **Três cartões (30, 60 e 90 dias):** saldo previsto, entradas e saídas. Saldo em vermelho = sai mais do que entra.
2. **Gráfico semanal:** barras azuis para cima = entradas; laranjas para baixo = saídas. Passe o mouse numa semana para ver os valores. "Ver tabela" mostra os mesmos números em lista.
3. **Saldo acumulado:** a linha mostra como o saldo previsto evolui semana a semana.
4. **Maiores entradas e saídas dos próximos 30 dias** e **saídas por centro financeiro**.

Cuidados ao ler:

- Não considera o saldo em banco: é a variação prevista, não o saldo.
- Só entra o que já está lançado. Folha, impostos e contas recorrentes ainda não lançadas no P2S, e vendas ainda não faturadas, não aparecem. Por isso 60 e 90 dias tendem a parecer mais folgados do que serão.
- Títulos vencidos a receber ficam fora da projeção e aparecem à parte, como "pode entrar".

## Perguntar

Na aba Perguntar você conversa com o Diretor como faria com um analista: escreve a pergunta, ele consulta os dados e responde em cerca de 10 a 30 segundos. Embaixo de cada resposta aparece o que ele consultou (ex.: "Contas a receber · Rentech").

Como usar:

1. Clique em **+ Nova conversa** ou numa das sugestões.
2. Escreva a pergunta e tecle Enter (Shift+Enter quebra a linha).
3. Continue na mesma conversa para aprofundar: ele lembra do que já foi dito ("e quanto disso foi da MC Brazil?").

Sem empresa na pergunta, ele usa a que está selecionada no topo da tela. Para comparar, peça: "compare Rentech e Alfa Light".

Exemplos que funcionam bem:

- Quanto recebemos este mês e quem mais pagou?
- Quais OPs estão pendentes há mais de 30 dias?
- Quem são os maiores devedores com atraso de até 90 dias?
- Que locações começam nos próximos 7 dias?
- Tem TV 55 livre de 10 a 12 de fevereiro?
- Quanto falta faturar de locação?
- Qual material ainda não voltou de evento?
- Quanto gastamos com freelancers em outubro?
- Como fica o caixa nos próximos 30 dias?
- Estamos no ritmo da meta de faturamento?
- Compare outubro com setembro.

O que ele consulta: resumo do dia, da semana, do mês e do ano, contas a receber e a pagar, OPs, fichas de locação, disponibilidade da agenda, locação (orçamentos, faltas, a faturar, avarias), expedição, frota, RH, metas, projeção de caixa e o histórico dos próprios relatórios e alertas.

O que ele não faz:

- Não aprova, paga nem altera nada. Se pedir, ele explica onde fazer no sistema.
- Não mostra CPF, salário, dados bancários nem chave Pix.
- Não inventa: se o dado não existe no sistema, ele diz.

Cada conversa é só de quem a criou e aceita até 25 perguntas. Quando o Diretor ganha consultas novas numa atualização do sistema, as conversas antigas ficam só para leitura e é preciso começar uma nova.

## Parâmetros e metas

A aba Parâmetros tem duas partes: as metas mensais da empresa selecionada e os valores de corte dos alertas, que valem para todas as empresas.

### Metas mensais

| Meta | O que mede | Leitura |
| --- | --- | --- |
| Faturamento | Fichas de reserva emitidas no mês, sem as canceladas | Maior é melhor |
| Recebimento | Recebido no mês pelo contas a receber do P2S | Maior é melhor |
| Teto de OPs | Valor das OPs criadas no mês, sem as reprovadas | Menor é melhor; alerta em 80% e 100% |
| Teto de inadimplência | Vencido a receber de até 1 ano, na data | Menor é melhor; alerta ao passar |

Para cadastrar:

1. Selecione a empresa no topo e abra Parâmetros.
2. Escolha o ano.
3. Digite os valores em reais (ex.: 3.500.000). Deixe em branco o que não tiver meta.
4. "copiar ↓" repete as metas daquele mês nos meses seguintes.
5. Clique em **Salvar**. As células alteradas ficam azuis até salvar.

Nos relatórios, cada meta mostra o realizado, a % da meta, quanto falta (ou, nos tetos, quanto ainda cabe) e se está no ritmo. O ritmo esperado é proporcional aos dias corridos do mês: no dia 15 de um mês de 30 dias, espera-se metade da meta.

### Valores de corte dos alertas

| Parâmetro | Inicial |
| --- | --- |
| OP de valor alto a partir de | R$ 10.000 |
| Título a receber atrasado a partir de | R$ 20.000 |
| Considerar títulos vencidos há no máximo | 30 dias |
| Material sem retorno após o fim do evento | 3 dias |
| Veículo fora há mais de | 3 dias |
| Caixa: avisar quando saídas superarem entradas em mais de | R$ 0 |

Altere o valor e clique em Salvar ao lado. Vale a partir da próxima verificação de alertas.

## Avisos por e-mail

Os relatórios e os alertas chegam por e-mail, com o conteúdo completo: situação, manchete, resumo, pontos de atenção, prioridades, pendências e o botão para abrir o relatório no sistema. Cada rotina tem um card em Parâmetros → Agendamentos e Disparos, onde você liga e desliga a rotina e escolhe quem recebe.

| Card | Envio | Assunto do e-mail |
| --- | --- | --- |
| Relatório Diário do Diretor (IA) | Todo dia, 10h | \[Situação\] Empresa · Relatório diário — manchete |
| Relatório Semanal do Diretor (IA) | Segunda, 8h | \[Situação\] Empresa · Relatório semanal — manchete |
| Relatório Mensal do Diretor (IA) | Dia 1, 8h | \[Situação\] Empresa · Fechamento do mês — manchete |
| Relatório Anual do Diretor (IA) | 1º de janeiro, 8h | \[Situação\] Empresa · Fechamento do ano — manchete |
| Alertas do Diretor (IA) | 12h e 18h | \[Alertas\] Empresa · N novo(s) — primeiro alerta |

Regras importantes:

- **Desligar o card desliga a rotina inteira** (geração e envio), não só o e-mail. Para só parar de receber, tire o seu nome dos destinatários ou desmarque o canal E-mail.
- **O e-mail sai da Ficha do Funcionário** de cada destinatário (RH → Funcionários). Sem e-mail na ficha, não chega.
- **Lista de destinatários vazia não envia para ninguém.** Nos outros cards do sistema, lista vazia significa "todos os funcionários"; nos cards do Diretor isso é bloqueado de propósito.
- Cada empresa gera um e-mail separado para cada destinatário.
- O texto do campo "mensagem" do card não é usado: o corpo do e-mail é montado pelo sistema com o relatório.

O resultado do envio aparece no rodapé de cada relatório (ex.: "Envio: E-mail enviado para 1.") e em cada alerta, na aba Alertas.

## Empresas e PrimeStart

No P2S, cada título e cada ficha pertence a um "Centro", e cada centro tem um CNPJ. O sistema decide de qual empresa é o registro pelo CNPJ do centro, não pelo nome.

| Centro no P2S | CNPJ | Empresa no sistema |
| --- | --- | --- |
| Rentech | 22.618.891/0001-87 | Rentech |
| ELITE | 10.353.694/0001-02 | Alfa Light |
| ALFA LIGHT | 34.075.821/0001-09 | Alfa Light |

O CNPJ do cadastro da empresa sempre vale. Quando uma empresa tem mais de um centro no P2S (caso da Alfa Light), os CNPJs extras ficam em Parâmetros → Empresas do Grupo → **Outros CNPJs no PrimeStart**, separados por vírgula.

Na mesma tela, **Fonte dos recebimentos** diz de onde vêm os recebimentos da empresa:

- **PrimeStart (P2S):** recebido, a receber e inadimplência saem do contas a receber do P2S.
- **Sistema (depois da virada da chave):** a partir da data de corte, o Diretor lê títulos e fichas do próprio sistema; o que veio antes do corte continua saindo do espelho do P2S. Dados de ensaio criados antes do congelamento são ignorados.
- **Outra fonte (não integrada):** o Diretor ignora o contas a receber do P2S daquela empresa e não comenta inadimplência dela.

Para incluir uma empresa nova do grupo:

1. Cadastre a empresa em Empresas do Grupo, com o CNPJ.
2. Se ela tiver outro centro no P2S, acrescente o CNPJ em "Outros CNPJs no PrimeStart".
3. Confira a fonte dos recebimentos.
4. Vincule os usuários que podem vê-la em Permissões.

Na sincronização seguinte, os títulos passam para a empresa nova e o Diretor começa a gerar relatórios dela. As fichas antigas só mudam quando forem alteradas no P2S.

## Contas a Receber no Financeiro

A tela Financeiro → **Contas a Receber** (/admin/financeiro/contas-receber) mostra os mesmos títulos que o Diretor usa, para consulta e cobrança. Funciona como a de Contas a Pagar, com a separação por empresa.

No topo, quatro cartões (clique para filtrar a lista):

| Cartão | O que soma |
| --- | --- |
| A vencer | Títulos em aberto com vencimento de hoje em diante (e quanto vence nos próximos 7 dias) |
| Vencido até 1 ano | Inadimplência real: em aberto, vencidos há até 365 dias |
| Vencido há mais de 1 ano | Quase sempre baixa pendente no P2S; serve como lista de limpeza para o financeiro |
| Recebido no mês | Títulos quitados desde o dia 1 |

Na lista:

1. Escolha a empresa (ou Todas) nos botões coloridos.
2. Busque por cliente, descrição, número do documento, evento ou centro.
3. Escolha a situação: em aberto, a vencer, vencidas (até 1 ano, mais de 1 ano ou todas), recebidas ou todas.
4. Filtre por período. Em "Recebidas" o período é a data do recebimento; nas outras, o vencimento.

O total do filtro (quantidade e valor) aparece ao lado do título da lista. A coluna Situação diz há quantos dias o título está vencido; atraso acima de 1 ano aparece em cinza.

Os títulos são lidos do P2S às 9h30, 11h e 17h. O botão **Sincronizar agora** lê na hora (cerca de 1 minuto). Baixa de recebimento é feita no P2S; esta tela só mostra.

Quem acessa: Administrador, Financeiro e Gerência, com verificação em duas etapas. O hub Financeiro também ganhou os cartões "A Receber Vencido (até 1 ano)" e "A Receber (7 dias)".

## Limitações dos dados

O Diretor só enxerga o que está no Rentech WEB e no P2S. Dado que falta ou está errado lá vira relatório incompleto aqui. Quando isso acontece, ele avisa em "Sobre os dados".

| Limitação | Efeito |
| --- | --- |
| O P2S é lido às 9h30, 11h e 17h | O que mudar no P2S depois das 9h30 não entra no relatório das 10h |
| Contas a pagar vencidas em aberto não são lidas | O sistema não diz "não há contas vencidas": ele não sabe |
| Recebimentos e pagamentos: só cerca de 13 meses de histórico | Comparação com o mesmo mês do ano anterior pode sair incompleta e vem marcada |
| Fichas: histórico completo só a partir de 19/05/2026 | Períodos anteriores vêm marcados e não são comparados |
| Títulos vencidos há mais de 1 ano | Tratados como baixa pendente no P2S, não como dívida real |
| Status das fichas são códigos do P2S (RE, EN, EP, X, A, E, SB, CA) | O Diretor traduz os códigos para nomes (reservada, enviada, em locação…) antes de comentar |
| Saldo em banco não é lido | A projeção de caixa é variação prevista, não saldo |
| Km de viagem acima de 3.000 é descartado | Considerado digitação errada; aparece como registro a corrigir |
| Alfa Light fora do RH do sistema até 2027 | Zeros de RH da Alfa Light são esperados |

Na dúvida sobre um número, abra a tela de origem (Contas a Pagar, OPs, Fichas, Expedição): os valores são calculados do mesmo jeito.

## Problemas comuns

| Situação | O que fazer |
| --- | --- |
| "Acesso Restrito" ao abrir | Liberar a rota /admin/diretoria para o perfil em Permissões e concluir a verificação em duas etapas |
| Não vejo uma das empresas | Vincular o usuário à empresa em Permissões |
| Relatório com bolinha cinza / "A IA não conseguiu escrever" | Os números continuam certos; clique no botão de gerar para tentar de novo. Se repetir, ver o motivo no aviso vermelho (créditos da IA, limite de uso) |
| Não chegou o e-mail | Ver o rodapé do relatório ("Envio: …"). Conferir se o card está ligado, com o canal E-mail marcado, e se o destinatário tem e-mail na Ficha do Funcionário. Olhar também a caixa de spam |
| Um número parece errado | Abrir a tela de origem e conferir. Se o erro estiver no P2S, corrigir lá e gerar o relatório de novo depois da próxima sincronização (11h ou 17h) |
| Recebeu um alerta de algo já resolvido | O alerta é enviado uma vez; ele não volta. Se acontecer de novo no futuro, é uma ocorrência nova |
| Muitos alertas de "favorecido novo" | É esperado em semana de evento com freelancers novos (3 a 4 por semana, em média). Se incomodar, peça para limitar por valor |
| Conversa antiga não aceita pergunta nova | O Diretor ganhou consultas novas; comece uma nova conversa. A antiga continua para leitura |
| Empresa nova não aparece nos relatórios | Conferir CNPJ no cadastro (e "Outros CNPJs no PrimeStart") e esperar a próxima sincronização |
