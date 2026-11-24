# Ponto via WhatsApp

## Visão geral

O funcionário bate o ponto, justifica uma batida esquecida, pede abono de um dia ou pede folga pelo WhatsApp da empresa, sem instalar nada. Quem aprova é sempre o RH; a folga também pode ser aprovada pelo gestor do Operacional.

| Canal | Quem usa | O que faz |
| --- | --- | --- |
| WhatsApp | Funcionário | Registrar ponto, justificar batida, abonar o dia, solicitar folga |
| Lembretes automáticos | Funcionário | Recebe no dia seguinte o aviso de ponto incompleto ou sem ponto e responde ali mesmo |
| Portal do Funcionário | Funcionário | Vê o espelho do mês, justifica batida ímpar, pede abono de falta (com atestado) e solicita folga |
| App Rentech (Meu Ponto) | Funcionário | Vê o espelho do mês, também sem internet |
| App Rentech (aba Ponto) | RH e gestores | Aprova ou rejeita solicitações, com aviso por push |
| RH → Ponto | RH | Ledger, fila de aprovação, lançamento manual, abonos, inconsistências e relatório do mês |
| Operacional → Registro de Ponto | Gestores | Consulta do ponto e aprovação de folgas |

**Quem usa o WhatsApp:** só o funcionário com o campo **📲 Bate ponto pelo WhatsApp** marcado na Ficha do RH e o celular preenchido. Quem está com o campo desligado não aparece nos controles do ponto, mesmo com registros antigos.

**Convivência com o Pontomais:** a importação do CSV do Pontomais (RH → Ponto, card 3. Importar Dados) continua funcionando e nunca apaga um dia que já tenha batida ou abono vindo do WhatsApp. Esses dias são mantidos, com aviso na tela.

## Como o funcionário usa o WhatsApp

Qualquer mensagem, sem conversa em andamento, recebe o menu:

> O que você deseja fazer? Responda com o número:
> 1) Registrar ponto
> 2) Justificar batida esquecida
> 3) Abonar o dia (falta/atestado)
> 4) Solicitar folga

Nada é gravado sem confirmação. Em justificar, abonar e folga, **CANCELAR** desiste sem gravar. A conversa expira depois de 5 minutos parada.

### 1) Registrar ponto

As batidas seguem a ordem Entrada, Saída almoço, Volta do almoço e Saída. O bot propõe a próxima e pede SIM ou NÃO.

> Confirma Entrada às 08:03? Responda SIM ou NAO.
> ✅ Ponto registrado: Entrada às 08:03 (NSR 000482).

**Turno noturno:** se a batida cair entre 00:01 e 05:59, o bot pergunta se é **Entrada** (começando o turno de hoje) ou **Saída** (fechando o turno de ontem). Escolhendo Saída, a batida fica no dia de ontem, com o horário real. No relatório aparece o selo **📅 dia seguinte**.

### 2) Justificar batida esquecida

1. Escolha o dia: hoje e os 6 dias anteriores aparecem numerados.
2. Escolha a batida que faltou.
3. Informe o horário (HH:MM) e o motivo.

A justificativa fica **pendente** até o RH aprovar.

### 3) Abonar o dia

1. Escolha o dia (hoje e os 6 anteriores).
2. Informe o motivo (ex.: atestado médico).
3. Envie a foto ou o PDF do atestado, ou responda **SEM ANEXO**.

O abono cobre o dia inteiro e fica pendente até o RH aprovar.

### 4) Solicitar folga

1. Informe a data (DD/MM/AAAA) ou um período (20/08/2026 a 22/08/2026). Não aceita data no passado, e o período vai até 30 dias corridos.
2. Informe o motivo.

A folga pode ser aprovada pelo RH **ou** pelo gestor do Operacional. Quando a automação "Solicitação Folga" está cadastrada, os gestores recebem um aviso no WhatsApp na hora.

### A resposta do RH

Ao aprovar ou rejeitar, o funcionário recebe no WhatsApp:

- ✅ O RH aprovou a justificativa / o abono / a folga referente à data.
- ❌ O RH não aprovou, com o motivo. Na folga, a mensagem orienta a falar com o gestor.

## Lembretes automáticos do dia seguinte

Dois lembretes saem por WhatsApp no horário marcado na automação, para quem esqueceu algo ontem. A resposta cai direto no bot, já no passo certo.

| Lembrete | Quem recebe | O que o funcionário responde | O que acontece |
| --- | --- | --- | --- |
| Ponto incompleto ontem | Quem bateu só a entrada ou só a saída de um par | Só o horário da batida que faltou (ou SIM para o bot pedir o horário) | Vira justificativa pendente, com o motivo "Batida esquecida — informada pelo lembrete automático" |
| Sem ponto ontem | Quem não bateu nada num dia em que deveria trabalhar | **ABONAR**, depois o motivo e o atestado | Vira abono pendente |

**Quem fica de fora:**

- quem já tem solicitação pendente para aquela batida ou aquele dia, ou já tem abono;
- quem está em conversa com o bot naquele momento;
- quem está de férias ou afastado (no lembrete de sem ponto).

**O lembrete de sem ponto** só vai para contrato que desconta falta. Também precisa ser dia útil sem feriado da empresa. Para quem trabalha por escala, precisa ainda estar escalado ontem.

Respondendo **NÃO**, a conversa termina. Qualquer outra resposta descarta o lembrete e mostra o menu normal. Na segunda-feira, o lembrete olha só o domingo.

**Onde liga:** Parâmetros → Agendamentos, numa automação do tipo Agendamento (Cron). O público é "Ponto incompleto ontem" ou "Sem ponto ontem". A mensagem pode usar {{primeiro_nome}} e {{data}}; no incompleto, também {{batida}}. Pela Meta, fora da janela de 24 horas, o envio precisa de um modelo de mensagem aprovado com essas variáveis.

## Pelo Portal e pelo app

**Portal do Funcionário, aba Espelho de Ponto:** mostra o mês com as batidas, as horas e os abonos. Um dia incompleto ou com falta é clicável.

- **Dia incompleto (batidas em número ímpar):** Justificar, escolhendo a batida que falta, o horário e o motivo.
- **Falta (nenhuma batida):** Pedir abono do dia, ou Justificar com qualquer das 4 batidas.

No abono, o funcionário pode anexar a **foto ou o PDF do atestado** (até 10 MB). O arquivo vai para a mesma pasta privada dos atestados do WhatsApp e só o RH abre, pelo 📎 Ver anexo.

**🏖️ Solicitar folga** (botão no topo da aba): data, ou data e "Até" para um período, e o motivo. Valem as mesmas regras do WhatsApp: a partir de hoje e até 30 dias corridos. Os gestores recebem o mesmo aviso da automação "Solicitação Folga". Abaixo do formulário, **Minhas folgas** mostra as folgas pedidas nos últimos 60 dias, com o status e o motivo de uma recusa.

Tudo entra na mesma fila do WhatsApp, e a resposta do RH chega pelo WhatsApp.

**App Rentech, Meu Ponto:** o espelho do mês para o colaborador, com trabalhado, abonado e faltas. Funciona sem internet com os dados guardados (Perfil → Baixar para uso offline).

**App Rentech, aba Ponto:** para RH e gestores. Lista as solicitações Pendentes e Resolvidas (justificativa, abono e folga). Em cada uma: **Aprovar** ou **Rejeitar** com motivo. Uma solicitação nova chega por push.

## Painel do RH

**Onde fica:** RH → Ponto. A tela tem quatro abas:

| Aba | Para que serve |
| --- | --- |
| 📊 Gestão de Ponto | Mês de competência, card do WhatsApp, importação do Pontomais, consolidado da equipe e Espelho de Ponto Eletrônico para imprimir e assinar |
| 🕒 Registro de Ponto (Dia a Dia) | Lançar Ponto Manual e Descartar o ponto do dia |
| 🗓️ Gestão de Abonos | Abonar um dia inteiro ou parte dele, direto pelo RH |
| ⚠️ Inconsistência no Ponto | Pontos ímpar (batidas incompletas) do mês, com Copiar p/ Grupo |

**Card "2. Ponto via WhatsApp"** (aba Gestão de Ponto):

- **📲 Ledger:** todas as batidas confirmadas no mês, com NSR, colaborador, tipo, horário e o início do hash.
- **Solicitações Pendentes:** justificativas e abonos esperando análise, com motivo e anexo (📎 Ver anexo). **Aprovar** grava o ajuste ou o abono e avisa o funcionário; **Rejeitar** pede o motivo e também avisa.
- **📜 Histórico:** as solicitações já analisadas, com quem decidiu e quando.
- **🏖️ Solicitação Folga:** pendentes e decididas numa lista só. Aprovar cria um abono para cada dia do período; dia de fim de semana ou feriado não soma horas.

**Lançar Ponto Manual:** deixe Retorno e Saída em branco para lançar só Entrada e Saída. Se a saída for menor que a entrada, o sistema pergunta se é virada de turno antes de recusar.

**Descartar o ponto do dia:** para uma batida feita por engano, por exemplo num dia em que a pessoa não deveria trabalhar. O dia fica sem batidas no relatório, mas o ledger do WhatsApp nunca é apagado.

**Gestores do Operacional:** em Operacional → Registro de Ponto, a aba 🕒 Consulta mostra o ponto da equipe. A aba 🏖️ Solicitação Folga aprova ou rejeita as folgas, como no RH.

## Regras do cálculo

- **Par ou ímpar:** quantidade par de batidas no dia está certa; ímpar é inconsistência e aparece em Pontos Ímpar.
- **Dia seguinte:** a batida depois da meia-noite que fecha o turno de ontem mostra o selo 📅 dia seguinte. A ordem dos horários indica isso; não há campo à parte.
- **Abono em dia não útil:** fim de semana ou feriado dentro de um período de folga ou abono não gera crédito de horas.
- **Feriados:** valem os nacionais e os municipais da empresa do funcionário.

## Segurança e conformidade

O registro segue os princípios técnicos da Portaria 671/2021 (REP-P) para ter valor de prova:

- **NSR sequencial:** cada batida recebe um número gerado pelo banco, nunca reaproveitado.
- **Cadeia de hash:** cada registro guarda o hash do anterior; qualquer adulteração quebra a cadeia.
- **Ledger só de inclusão:** o banco recusa alterar ou apagar batidas, mesmo vindo do sistema.
- **Correção por lançamento novo:** uma justificativa aprovada soma um ajuste; nada apaga a batida original.
- **Aprovação por outra pessoa:** o funcionário nunca aprova o próprio pedido.
- **Comprovante na hora:** a resposta do WhatsApp, com NSR e horário, é o recibo do funcionário.

**Atestados:** são dado de saúde (LGPD). Ficam numa pasta privada e só abrem por um link que vale 10 minutos, gerado quando o RH clica em Ver anexo.

**Limite:** isto cobre a integridade técnica do registro. Faltam o registro do programa no INPI e a validação jurídica e contábil do processo completo.

## AFD para a fiscalização (Portaria 671)

**Onde fica:** RH → Ponto, card "2. Ponto via WhatsApp", botão **📄 AFD (Portaria 671)**.

O AFD (Arquivo Fonte de Dados) é o arquivo que o auditor fiscal pede. Ele traz cada marcação original do WhatsApp, na ordem do NSR, no leiaute oficial versão 004 (Anexo V da Portaria 671).

1. Escolha a **empresa** e o **período**.
2. **⬇ Gerar AFD** baixa dois arquivos: o .txt e o .p7s com a assinatura digital (e-CNPJ A1 da empresa). O nome segue a Portaria: AFD + número do INPI + CNPJ + REP_P.
3. **👁 Prévia (não congela)** gera o mesmo arquivo com "_PREVIA" no nome, sem fixar nada. Use para a contabilidade conferir.

| Regra | Como funciona |
| --- | --- |
| O que entra | Só as marcações originais. Ajuste manual, abono e dia descartado não entram (são tratamento) |
| Congelamento | A primeira vez que uma marcação entra num AFD oficial, a linha dela fica fixa (CPF e hash). O mesmo período gera sempre as mesmas linhas |
| Hash | Cada marcação leva o SHA-256 encadeado ao da anterior, desde a primeira batida |
| CPF | Vem da Ficha do RH. Sem CPF, o AFD não é gerado e a tela diz de quem falta |
| Assinatura | Arquivo .p7s (CAdES), com o certificado cujo CNPJ é o da empresa. Sem certificado, sai só o .txt, com aviso |

**Dados do REP-P** (no mesmo modal, botão Editar):

- **Nº de registro no INPI:** vazio até o programa ser registrado; o cabeçalho sai com zeros e a tela avisa.
- **CNPJ/CPF do desenvolvedor:** vazio = o CNPJ da própria empresa.
- **Coletor da marcação:** 01 (aplicativo mobile) para o WhatsApp. Mudar vale só para as marcações que ainda não entraram em nenhum AFD.

**Para conferir a assinatura:** envie o .txt e o .p7s ao verificador do ITI (validar.iti.gov.br).

## Configuração

1. **Habilitar o funcionário:** RH → Ficha do Funcionário, preencher o Celular e marcar **📲 Bate ponto pelo WhatsApp**. Sem isso, o número não é reconhecido.
2. **Provedor do WhatsApp:** Parâmetros → Integração. Escolha a Z-API ou a Meta (API oficial). Pode ser um provedor só, ou um para envio e outro para recebimento. O bot de ponto usa o de recebimento.
3. **Modelos da Meta:** fora da janela de 24 horas, a Meta só entrega mensagem com modelo aprovado. Os avisos de aprovação e rejeição usam os modelos ponto_solicitacao_aprovada e ponto_solicitacao_rejeitada; cada lembrete usa o modelo indicado na automação.
4. **Aviso de folga aos gestores:** em Parâmetros → Agendamentos, crie uma automação com o nome exato **Solicitação Folga**. Os destinatários precisam ter ficha ativa no RH com celular.
5. **Lembretes do dia seguinte:** veja a seção dos lembretes.

## Dúvidas frequentes

**Mandei mensagem e o bot não respondeu.** Confira na ficha se o celular está certo e se o 📲 está marcado. Pela Meta, veja também se o modelo de mensagem está aprovado.

**Bati o ponto errado.** Não dá para apagar uma batida do ledger. Peça ao RH: ele descarta o ponto do dia ou lança o certo manualmente.

**Esqueci de bater ontem.** Responda o lembrete com o horário, ou use a opção 2) Justificar batida esquecida. Vale para hoje e os 6 dias anteriores.

**Saí depois da meia-noite.** Bata normalmente e escolha 2) Saída (fechando o turno de ontem).

**Dá para pedir folga ou mandar o atestado sem o WhatsApp?** Sim, pelo Portal do Funcionário, aba Espelho de Ponto: o botão 🏖️ Solicitar folga, e o atestado no pedido de abono do dia.

**Preciso de folga de mais de 30 dias.** Fale com o RH; férias e afastamentos têm tela própria (RH → Férias e Afastamentos).

**O auditor pediu o AFD.** RH → Ponto, botão 📄 AFD (Portaria 671): escolha a empresa e o período e entregue os dois arquivos (.txt e .p7s).

**Abono de meio período.** Pelo WhatsApp o abono é do dia todo. Abono parcial é lançado pelo RH em Gestão de Abonos.
