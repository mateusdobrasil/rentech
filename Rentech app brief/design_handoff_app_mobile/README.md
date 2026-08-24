# Handoff: App móvel Rentech (iOS + Android)

## Visão geral

Transformar o Rentech Web (Next.js 16 + Supabase) em um app nativo híbrido para iOS e Android, aproveitando o scaffold Expo que já existe em `mobile/`.

A estratégia é **híbrida**: telas nativas apenas onde o celular ganha do navegador — checklist com câmera e GPS, fila de aprovação em qualquer lugar, simulador na frente do cliente, biometria, push — e WebView autenticada para os módulos pesados do `/admin` (folha, holerite, estoque, assinaturas, OP em lote).

Público: colaborador, equipe de campo/frota, comercial e RH/gestor. As abas visíveis mudam por cargo.

## Sobre os arquivos de design

Os arquivos deste pacote são **referências de design feitas em HTML** — protótipos que mostram aparência e comportamento pretendidos. **Não são código de produção para copiar.** A tarefa é recriar essas telas em React Native / Expo, usando os padrões que já existem em `mobile/` (Expo Router, `AuthContext`, `lib/supabase.ts`, `constants/theme.ts`).

O protótipo roda no navegador e usa dados fictícios. Toda a lógica de dados descrita abaixo é o que precisa ser implementado de verdade contra o Supabase.

## Fidelidade

**Alta fidelidade de estrutura, média de estilo.** Layout, hierarquia, densidade, fluxos, estados e copy estão definitivos e devem ser seguidos. As **cores do protótipo não são as de produção**: o protótipo foi desenhado sobre um tema escuro genérico, e a decisão tomada é **manter a paleta oficial da Rentech** já presente em `mobile/constants/theme.ts`. Ver "Design tokens".

---

## Decisões já tomadas

| Tema | Decisão |
|---|---|
| Paleta | Manter o navy de `constants/theme.ts`. Do protótipo, herdar só estrutura: alvo de toque mínimo 44px, densidade, hierarquia de título, padrão de tag de status. |
| Fila offline | Checklist enfileirado é editável até subir; depois vira somente leitura no app. Correção pós-sincronização só no web, onde existe log de auditoria. |
| Notificações | Push da Expo para o que é do app (retorno de veículo pendente, carga para conferir, OP aguardando aprovação). WhatsApp segue dono do ponto. Nunca o mesmo aviso nos dois canais. |
| Segundo fator | Biometria no momento de aprovar OP, não só no login (`expo-local-authentication`). |
| Numeração offline | Número local provisório (`CKL-VEI-LOC-<n>`), definitivo vindo da sequência do banco na sincronização. Não reservar número antecipadamente. |
| Criar offline | Checklist de **veículo** pode ser criado offline (lista de veículos do cache). Checklist de **carga** exige rede, porque importa itens do modelo padrão e das OS's do evento. |
| Autoridade de permissão | RLS no banco, baseada em `perfis_usuarios` + `normalizarPermissao`. Não replicar no app a checagem de cargo que hoje mora no cliente do `/admin`. |
| Escopo desta leva | **Simuladores fica fora.** Tela 10 e a aba "Simular" não entram nesta primeira leva do app — protótipo e spec ficam guardados para quando entrar. |
| Conferência de carga | Confirmado: o app **cria** divergência direto (upsert em `checklist_divergencias`), o web não precisa decidir depois. |
| Login — duas identidades | O app aceita **duas bases de conta**, que hoje são propositalmente separadas no banco (ver `app/actions.ts:313`): **equipe** (`perfis_usuarios`, e-mail+senha — RH, operacional, comercial, gestores) e **colaborador comum** (`portal_funcionarios_auth`, CPF+senha — mesma conta do Portal do Funcionário, ver `app/portal/login/page.tsx`). Primeiro acesso (CPF+OTP) **continua só no navegador**; no app só entra quem já criou a conta antes. Ver tela 1 e seção "Identidade" abaixo. |
| Meu Ponto (colaborador) | Vira **tela nativa**, porque precisa funcionar offline. Não abre RLS nova em `folha_ponto_diaria`/`folha_ponto_abono`: reaproveita a mesma lógica de `app/portal/actions/actions-ponto.ts` (`montarEspelhoDoMes`) atrás de uma rota de API nova (`GET /api/portal/espelho-ponto`), validada por access token como o Portal já faz hoje. Ver tela 16. |

## Ordem de implementação

**Fase 1 — fundação.** Login com as duas identidades (equipe e colaborador comum) + biometria, Início, WebView autenticada, Perfil, Meu Ponto nativo. Fecha o ciclo de sessão e já entrega valor (holerite, documentos, espelho de ponto, tudo que existe no web). É aqui que RLS, sessão e a rota nova `/api/portal/espelho-ponto` são validadas: se a fundação estiver errada, aparece barato.

**Fase 2 — o módulo que justifica o app.** Checklist de veículo completo: criação, etapas saída/retorno, câmera, avarias, fila offline.

**Fase 3 — o resto.** Checklist de carga, aprovações de ponto, OP com biometria, push.

---

## Rotas (Expo Router)

```
app/login.tsx                          Login (equipe ou colaborador + biometria)
app/(tabs)/_layout.tsx                 Abas dinâmicas por cargo (já existe)
app/(tabs)/index.tsx                   Início
app/(tabs)/frota/index.tsx             Frota: veículos + checklists em andamento
app/(tabs)/frota/novo.tsx              Novo checklist de veículo
app/(tabs)/frota/[id].tsx              Checklist de veículo (?etapa=SAIDA|RETORNO)
app/(tabs)/frota/[id]/salvo.tsx        Confirmação
app/(tabs)/carga/index.tsx             Checklists de carga
app/(tabs)/carga/novo.tsx              Novo checklist de carga (exige rede)
app/(tabs)/carga/[id].tsx              Conferência de carga
app/(tabs)/ponto/index.tsx             Fila de aprovação (RH)
app/(tabs)/ponto/[id].tsx              Solicitação
app/(tabs)/op/index.tsx                Ordens de pagamento
app/(tabs)/op/[id].tsx                 OP detalhe
app/(tabs)/perfil.tsx                  Perfil (já existe)
app/notificacoes.tsx                   Inbox de push
app/webview.tsx                        WebView autenticada (?url=)
app/meu-ponto.tsx                      Meu Ponto — espelho do mês (nativa, colaborador comum)
```

`app/(tabs)/simuladores.tsx` já existe no scaffold mas **fica fora desta leva** — não remover o arquivo, só não linkar em nenhuma aba/card até a feature entrar de novo em pauta.

### Abas por cargo

Estender `REGRAS_ACESSO` em `app/(tabs)/_layout.tsx`. Cargos normalizados por `lib/permissoes.ts`.

| Perfil | Abas |
|---|---|
| Colaborador comum (`portal_funcionarios_auth`) | Início · Perfil |
| Equipe sem cargo especial (`USUARIO`) | Início · Perfil |
| Campo / Frota (`OPERACIONAL`) | Início · Frota · Carga · Perfil |
| RH / Gestor (`ADMINISTRATIVO`, `ADMINISTRADOR`) | Início · Ponto · OP · Perfil |
| Comercial (`USUARIO` comercial) | Início · Perfil |

Máximo 5 abas. O que não cabe vira card na tela Início. (Simuladores tiraria uma 3ª aba de Colaborador/Comercial — fica de fora enquanto a feature não volta.)

Colaborador comum não tem linha em `perfis_usuarios`, então não passa por `normalizarPermissao`: é tratado como um cargo próprio (`PORTAL`) direto no `AuthContext`, sempre com o conjunto de abas/cards do Colaborador.

---

## Telas

### 1. Login

**Propósito:** autenticar com a mesma conta do sistema web **ou** com a conta do Portal do Funcionário — são duas bases de usuário separadas de propósito no banco (`perfis_usuarios` vs `portal_funcionarios_auth`), então o app precisa saber qual delas usar antes de chamar `signInWithPassword`.

Layout: coluna centrada verticalmente, padding 24px lateral. Logo `logo_pb.png` com 146px de largura, seguido da linha "Ecossistema digital · acesso interno" (12px, opacidade 55%). **Segmented control de dois modos no topo do formulário: "Equipe" / "Colaborador"**, troca o campo de identificação:

- **Equipe** → campo e-mail (como hoje).
- **Colaborador** → campo CPF, com máscara; internamente vira e-mail sintético via `emailSinteticoPortal(cpf)` (mesma função de `app/portal/lib/cpf.ts`) antes de chamar `signInWithPassword`.

Campo senha comum aos dois modos (altura mínima 46px). Dois botões de largura total, 48px de altura: **Entrar** (primário) e **Entrar com biometria** (secundário, com ícone de digital). Link secundário, só no modo Colaborador: "Primeiro acesso? Crie sua conta pelo navegador" — abre o `SITE_URL/portal/login` no navegador do aparelho (`Linking.openURL`); o fluxo de CPF+OTP de primeiro cadastro **não entra no app**. Rodapé explicativo em 12px: "A sessão fica no aparelho. Mesma conta do sistema web ou do Portal do Funcionário — o que você tem define o que aparece no app."

Comportamento: sessão Supabase persistida em AsyncStorage (já implementado em `lib/supabase.ts`) — o modo escolhido não muda o mecanismo de sessão, só qual e-mail vai pro `signInWithPassword`. Biometria via `expo-local-authentication` desbloqueia a sessão guardada; se não houver sessão guardada, cai no e-mail/CPF + senha. Registrar "ACESSO AO SISTEMA" no log de auditoria e atualizar `ultimo_acesso` só para contas de equipe, como o web faz — contas de Portal não têm essa tabela de log hoje.

`AuthContext` resolve o perfil tentando primeiro `perfis_usuarios` (id = `session.user.id`); se não achar, tenta `portal_funcionarios_auth` (`auth_user_id` = `session.user.id`) + `folha_funcionarios` (por `funcionario_nome`) para nome/cargo de exibição, e marca `tipo: 'PORTAL'`. Contas `PORTAL` sempre caem no conjunto de abas/cards do Colaborador (não passam por `normalizarPermissao`, que é regra de `perfis_usuarios`).

### 2. Início

**Propósito:** hub por cargo, com o que precisa de ação hoje.

Três blocos, em ordem:

1. **Cartão de ponto** — hora da entrada em 34px, rótulo "entrada registrada", divisor, e uma linha com ícone de WhatsApp: "Batida e justificativa seguem pelo bot no WhatsApp" + botão "Abrir" que faz deep link para a conversa do bot.
2. **Seus módulos** — grid 2 colunas, cartões de 96px de altura mínima, com ícone (21px, cor de acento), título 14px e nota 11px. Conteúdo varia por cargo.
3. **Precisa de você** — lista de linhas de 56px: tag com contagem, título 14px, nota 11px, chevron. Cada linha navega para o item.

Cards por cargo (nome · nota · destino):

- Colaborador (equipe sem cargo especial ou colaborador comum via Portal): Holerite · último fechamento e assinatura · WebView; Documentos · ASO, ficha, contrato · WebView; Meu ponto · espelho do mês, funciona offline · **nativa** (tela 16).
- Frota: Checklist de veículo · saída e retorno com avaria; Checklist de carga · conferência de equipamento; Holerite · abre no sistema web.
- RH: Aprovações · ponto, abono, justificativa; Ordens de pagamento · aprovar e acompanhar; Assinaturas · Autentique, status ao vivo · WebView; Folha · fechamento no sistema web · WebView.
- Comercial: Estoque · o que está livre na data · WebView; Orçamento · enviar por e-mail; Cases · vídeos para mostrar · WebView.

### 3. Frota — lista

Duas tags no topo: total de veículos e quantos com pendência. Depois **Checklists em andamento** (destaque com fundo de acento, mostrando `CKL-VEI-######` + placa + "Retorno pendente · saiu ontem 06:40", tag "Retorno") e o botão primário **Novo checklist de saída**. Abaixo, a lista de veículos: placa 16px, modelo 12px, tag de estado à direita, e uma linha de metadados 11px com CRLV, seguro e km.

Dados: `frota_veiculos` filtrado por `exibir_na_frota = true`, ordenado por `apelido`. Estado do veículo derivado de `crlv_vencimento`, `seguro_vigencia_fim` e `status`. Checklists em andamento: `frota_checklists` com `status = 'EM_ANDAMENTO'`.

### 4. Novo checklist de veículo

Seleção de veículo em lista de rádio (linhas de 56px, marca circular à direita). Ao escolher, **KM inicial vem preenchido de `frota_veiculos.km_atual`** e permanece editável. Motorista preenchido da sessão, somente leitura. Destino em texto livre. Combustível em cinco chips: Cheio · 3/4 · 1/2 · 1/4 · Reserva. Nota final sobre numeração (muda conforme rede). Botão **Criar e começar a vistoria**.

Grava em `frota_checklists`: `veiculo_id`, `motorista_nome`, `destino`, `km_inicial`, `combustivel_saida`, `status = 'EM_ANDAMENTO'`, `saida_em = now()`. Em seguida copia o modelo de itens para `frota_checklist_itens` com `etapa = 'SAIDA'` e `marcado = false`.

Offline: cria com id local e número provisório, enfileira, e a lista de veículos vem do cache.

### 5. Checklist de veículo (saída e retorno)

Uma tela só, com seletor de etapa em dois chips: **Saída** / **Retorno**. Etapa RETORNO só habilitada quando o checklist já existe com status `EM_ANDAMENTO`.

Ordem dos blocos:

1. **GPS** — cartão com ícone de pin, local e coordenadas + horário da captura. `expo-location`, capturado uma vez ao abrir.
2. **KM + Motorista** — dois campos lado a lado. Rótulo muda por etapa: "KM inicial" / "KM final".
3. **Combustível** — cinco chips.
4. **Destino** — texto.
5. **Itens · etapa X** — cabeçalho com contador "n de N" e barra de progresso de 3px. Cada item é uma linha de 48px com caixa de seleção de 22px à esquerda e descrição 14px. Um toque alterna `marcado`.
6. **Avarias** — lista de cartões com miniatura de 58px, descrição 13.5px e linha "ETAPA · hora". Botão tracejado de 48px: **Registrar avaria com foto**.
7. **Observações** da etapa, texto longo.
8. Botão primário: "Salvar saída e liberar veículo" / "Finalizar checklist" / "Salvar no aparelho" quando offline.

Itens sugeridos (`frota_checklist_itens`, ordenados por `ordem`):

- SAIDA: CRLV no veículo · Pneus e estepe · Nível de óleo · Água do radiador · Luzes e setas · Freios · Extintor e triângulo · Cintas e catracas
- RETORNO: KM final anotado · Combustível conforme saída · Sem avaria nova · Carga descarregada · Cintas devolvidas · Cabine limpa · Chave devolvida

Avaria grava em `frota_checklist_avarias`: `checklist_id`, `etapa`, `descricao`, `foto_url`. Foto vai para o bucket `frota` no Storage; offline fica no `FileSystem` do aparelho e sobe na sincronização.

Salvar saída → `status` permanece `EM_ANDAMENTO`. Finalizar retorno → `status = 'FINALIZADO'`, `retorno_em = now()`, `km_final`, `combustivel_retorno`, e atualiza `frota_veiculos.km_atual`.

### 6. Checklist salvo (confirmação)

Ícone de check em 46px, título e parágrafo explicativo, cartão-resumo com Checklist / Veículo / Status / Avarias, e botão secundário "Voltar para a frota".

Copy por situação:

- Offline: "Guardado no aparelho" — "Fica na fila e sobe sozinha quando o sinal voltar. Você pode seguir para o próximo veículo."
- Saída: "Saída registrada" — "Status EM_ANDAMENTO no sistema web. O retorno reabre este mesmo checklist para a etapa RETORNO."
- Retorno: "Checklist finalizado" — "Status FINALIZADO. KM do veículo atualizado e as avarias ficam na ficha, com foto no storage."

### 7. Carga — lista

Tags de abertos e de divergências. Botão primário **Novo checklist de carga**, **desabilitado quando offline** (opacidade 45%, cursor bloqueado) com a explicação abaixo: "Criar carga precisa de rede: os itens vêm do modelo padrão e das OS's do evento, que só existem na base. Conferir um checklist já aberto funciona offline."

Cada linha: `CKL-######`, tag de status (Rascunho / Saída conferida / Finalizado), nome do evento em 15px e metadados (local, período, contagem de itens).

Dados: `checklists` filtrado pelas empresas do usuário (`perfis_usuarios_empresas`), status em `RASCUNHO | SAIDA_CONFERIDA | FINALIZADO`.

### 8. Novo checklist de carga

Empresa em dois chips (Rentech / AlfaLight — obrigatório, virá em `empresa_id`), evento/feira, cliente, local, início e fim. Aviso: "Os N itens do modelo padrão entram automaticamente. Importar das OS's fica no sistema web." Botão **Criar checklist**.

Grava em `checklists` e copia `checklist_modelo_itens` com `ativo = true`, ordenado por `ordem`, para `checklist_itens`. **Importar das fichas de reserva do evento não entra no app** — depende de cruzamento de dados que só faz sentido no desktop.

### 9. Conferência de carga

Cabeçalho com número, evento e "local · período". Seletor de etapa Saída / Retorno. Quando alguma quantidade difere do previsto, aparece a faixa de acento: "N item(ns) com quantidade diferente do previsto — vira registro em `checklist_divergencias` ao salvar."

Itens agrupados por seção (Painéis LED, Estrutura, Processamento…). Cada linha: caixa de seleção, descrição 13.5px, "previsto N" em 10.5px, e um stepper − / quantidade / + à direita (botões de 34×38px). A quantidade fica na cor de acento quando diverge do previsto.

Grava `checklist_itens.saida_ok` / `saida_qtd` (ou `retorno_ok` / `retorno_qtd`). Divergência vira upsert em `checklist_divergencias` com `onConflict: 'item_id,tipo'`, e some quando a quantidade volta a bater. Salvar como saída conferida → `status = 'SAIDA_CONFERIDA'`.

### 10. Simuladores — FORA DO ESCOPO NESTA LEVA

Não implementar agora. Spec mantida abaixo como referência para quando a feature voltar a entrar em pauta; não criar a rota nem o card na Início.

Três chips de tipo (Videowall / Tela / Grid). Dois steppers de largura e altura em metros (passo 0,5). Três chips de pitch: P2.6 (192px por cabinet) · P3.9 (128px) · P4.8 (104px).

Cartão de resultado com pré-visualização do grid (células quadradas de 6–15px, gap 2px, dimensionadas para caber) e seis métricas em grid 2×3: Painéis 50×50 (`total (cols×rows)`), Resolução (`cols × pitch`), Área, Peso (8,5 kg por painel), Consumo médio (0,15 kW por painel), Diária estimada.

Cálculo: `cols = round(largura / 0.5)`, `rows = round(altura / 0.5)`. Confirmar os coeficientes de peso, consumo e diária com o comercial — no protótipo são estimativas. Reaproveitar a lógica de `app/simulador/` e, no futuro, mover para `packages/calc` compartilhado com o web.

Botão **Enviar para orçamento**: usa o mesmo caminho de e-mail do site (`enviarOrcamento`).

### 11. Aprovações de ponto (RH)

Dois chips de filtro: Pendentes / Resolvidas. Lista de solicitações: nome 15px, tag de tipo (Abono / Justificativa / Ponto), resumo 12.5px, e metadados de dia e origem ("WhatsApp · bot de ponto" ou "App · geolocalizado"). Estado vazio: "Nada pendente. As próximas chegam por push."

Detalhe: tag de tipo, nome, "cargo · dia", cartão de campos rótulo/valor (Pedido, Data, Batidas, Anexo, Texto, Recebido), nota fixa "Aprovar grava no livro-razão de ponto e avisa o colaborador pelo WhatsApp. Nada é aprovado automaticamente.", e dois botões de 48px: **Rejeitar** (secundário) e **Aprovar** (primário). Rejeitar exige motivo.

Reaproveitar `aprovarSolicitacaoAction` / `rejeitarSolicitacaoAction` e `notificarPontoWhatsApp`. A regra de janela de 24h da Meta e os templates continuam valendo — o app não muda nada disso.

### 12. Ordens de pagamento

Lista com tags de total em aberto e valor somado. Cada linha: código em 11px, tag de status, favorecido 15px, valor 17px e "vence dd/mm".

Detalhe: código, favorecido, valor em 28px, cartão de campos (Serviço, Solicitante, Forma, Recibo, Anexos), nota sobre Autentique ("Recibo vai para assinatura na Autentique e o link segue por WhatsApp."), e dois botões: **Ver no sistema** (abre WebView) e **Aprovar pagamento**.

**Aprovar exige biometria** antes de efetivar. Depois: status `Aprovada`, e-mail ao pagador e recibo para assinatura.

### 13. Notificações

Lista simples: ponto de 7px (acento quando não lida, neutro quando lida), título 14px, horário 10.5px à direita, corpo 12.5px.

Push da Expo. Tipos: aprovação de ponto pendente, CRLV/seguro vencido (espelha a automação `frota-vencimentos`), checklist enviado, recibo assinado, OP aguardando aprovação.

### 14. Perfil

Avatar circular de 54px com iniciais, nome 17px, cargo 12.5px. Tags de permissão normalizada e matrícula. Lista de linhas de 52px com divisor: Entrar com biometria (Ativado/Desativado) · Notificações · Abrir o sistema web (`/admin`) · Baixar para uso offline · Suporte. Botão secundário "Sair da conta" e rodapé de versão.

### 15. WebView autenticada

Pílula de URL com ícone de cadeado, faixa explicativa "Módulo do sistema web, aberto com a sessão do app. Sem segunda senha.", e o conteúdo.

Passar o token da sessão Supabase para a WebView de forma que o Next.js reconheça o cookie `sb-access-token`. Módulos previstos: holerite, documentos, folha, assinaturas, estoque, OP em lote.

### 16. Meu Ponto (nativa)

**Propósito:** colaborador ver o espelho de ponto do mês sem depender de rede — mesma leitura que existe hoje em `app/portal/EspelhoPonto.tsx`, mas em tela nativa porque precisa funcionar offline.

Layout: seletor de mês no topo (chevron esquerda/direita + rótulo "agosto de 2026", limitado ao mês atual pra frente). Lista de dias do mês, um cartão de 56px por dia: data + dia da semana à esquerda, total do dia (`hh:mm`) à direita, e abaixo as 4 batidas (Entrada · Saída Alm. · Ret. Alm. · Saída) em `hh:mm` ou `--:--`, com tag "dia seguinte" nos casos de virada de turno (mesma lógica de `diasSeguintesBatidas` do protótipo web). Observação por linha (Falta, Feriado, DSR, Abono + motivo) em vermelho quando é falta. Rodapé fixo com três totais do mês: trabalhado, abonado, faltas — mesmos cálculos de `EspelhoPonto.tsx`.

Sem botão de baixar PDF nesta leva (fica só no web).

Dados: nova rota `GET /api/portal/espelho-ponto?mes=YYYY-MM`, com `Authorization: Bearer <access_token>`, reaproveitando `montarEspelhoDoMes` de `app/portal/actions/actions-ponto.ts` — não é Server Action chamada direto (protocolo do Next não é feito pra isso fora do próprio app web), é uma Route Handler nova que faz a mesma consulta. Sem RLS nova em `folha_ponto_diaria`/`folha_ponto_abono`/`folha_feriados`: a rota valida o access token com service role, do jeito que o Portal já faz.

Offline: ao entrar com rede, busca o mês corrente e cacheia a resposta (AsyncStorage, chave por `funcionarioNome + mês`). Sem rede, mostra o último cache com uma nota "Dados de `<hora da última sincronização>` — sem rede pra atualizar." Navegar para um mês sem cache e sem rede mostra estado vazio explicando que precisa de conexão pra esse mês.

Disponível só para quem loga como Colaborador (`tipo: 'PORTAL'` ou `USUARIO` sem cargo especial) — não aparece para RH/Frota/Comercial nesta leva.

---

## Cabeçalho e navegação

Cabeçalho próprio (não o do Expo Router): botão voltar de 34px quando há tela-pai, título 19px, subtítulo 11px, e botão redondo de notificações de 38px com ponto de acento quando há não lidas.

Hierarquia de volta: checklist → frota, conferência → carga, solicitação → ponto, OP detalhe → OP, notificações → início, webview → perfil.

Faixa de offline logo abaixo do cabeçalho, com ícone de wi-fi cortado: "Sem rede — N na fila, sobe quando voltar".

Tab bar: fundo de superfície, hairline no topo, itens de 52px com ícone de 21px e rótulo de 10px; ativo na cor de acento.

---

## Estado

| Estado | Onde vive |
|---|---|
| Sessão + perfil | `AuthContext` (já existe) |
| Rede online/offline | Hook global; controla criação de carga, rótulos de botão e faixa de aviso |
| Fila de sincronização | AsyncStorage ou `expo-sqlite`: checklists de veículo criados/editados offline, com fotos no `FileSystem` |
| Checklist aberto | Local na tela: etapa, marcações por item, avarias, km, combustível |
| Conferência de carga | Local: quantidades por item, marcação, etapa |
| Espelho de ponto (Meu Ponto) | AsyncStorage por `funcionarioNome + mês`; refetch quando online, mostra cache com aviso quando offline |
| Filas de aprovação | Query com refetch ao voltar para a tela; aprovar/rejeitar remove o item da lista |

Regra de fila: item enfileirado é editável até subir; depois, somente leitura no app.

---

## Dependências a adicionar

```
expo-camera  ou  expo-image-picker     fotos de avaria
expo-location                          GPS do checklist
expo-local-authentication              biometria (login + aprovar OP)
expo-notifications                     push (requer projeto EAS + APNs/FCM)
expo-file-system                       fotos pendentes de upload
expo-sqlite                            fila offline (alternativa: AsyncStorage)
react-native-webview                   módulos do /admin
```

Instalar sempre com `npx expo install --fix -w mobile` para casar com o SDK.

## RLS — o bloqueador

O app usa a chave anon com a sessão do usuário. Boa parte do `/admin` hoje passa por service role no servidor, e a checagem de cargo mora no cliente. No app isso não serve: **o banco tem que ser a autoridade.**

Tabelas que precisam de policy antes da fase 2:

```
frota_veiculos              leitura para autenticado
frota_checklists            leitura/escrita para OPERACIONAL, ADMINISTRATIVO, ADMINISTRADOR
frota_checklist_itens       segue o checklist pai
frota_checklist_avarias     segue o checklist pai
frota_documentos            leitura quando visivel_frota = true
checklists                  leitura/escrita nas empresas do usuário (perfis_usuarios_empresas)
checklist_itens             segue o checklist pai
checklist_modelo_itens      leitura para autenticado
checklist_divergencias      escrita junto com o item
storage: bucket frota       upload autenticado, leitura pelo dono do checklist
```

Escrever uma função SQL de cargo normalizado uma vez (espelho de `normalizarPermissao`) e reaproveitar em todas as policies, em vez de repetir a expressão.

`folha_ponto_diaria` / `folha_ponto_abono` / `folha_feriados` / `folha_funcionarios` **não entram nesta lista**: a tela Meu Ponto (16) lê por uma rota de API validada por access token (mesmo padrão do Portal hoje), não por RLS + query direta do cliente.

## Design tokens

**Produção — paleta oficial, `mobile/constants/theme.ts`:**

```
background      #000000
surface         #0C1D4D
surfaceBorder   rgba(40, 75, 140, 0.3)
primary         #284B8C
accent          #336699
white           #FFFFFF
textSecondary   #B3B3B3
textMuted       #999999
textSubtle      #666666
danger          #c0392b
```

O acento do protótipo (`#9184d9`) **não vai para produção** — onde o protótipo usa acento, use `accent` (#336699); onde usa fundo tingido de acento, use `surface` (#0C1D4D) com `surfaceBorder`.

**Escala herdada do protótipo (esta sim vai):**

```
raio             4 / 8 / 14
espaçamento      3 / 6 / 8 / 11 / 17 / 22
toque mínimo     44px (48px em ações principais, 52px em linhas de lista)
tipografia       título de tela 19 · título de seção 10 em caixa alta com 0.1em
                 corpo 14 · secundário 12.5 · meta 11 · micro 10.5
                 número em destaque 17–34
peso             400 no corpo, 500 em títulos — nunca acima de 500
```

Tags de status: 11px, padding 3×10, raio 6. Três variantes — acento (ação necessária), contorno (em trânsito), neutra (concluído/informativo).

Ícones: Phosphor, traço de 1.6, tamanhos 17 / 18 / 21.

## Assets

- `assets/rentech-logo.png` — `public/logo_pb.png` do repositório web, usado no login com 146px de largura. A versão colorida (`logo.png`) tem fundo branco e não serve em tela escura.
- Ícones desenhados como SVG inline no protótipo; em React Native, usar Phosphor.
- Nenhuma fotografia no app.

## Arquivos deste pacote

| Arquivo | O que é |
|---|---|
| `App Rentech.dc.html` | O protótipo navegável completo, 17 telas |
| `ios-frame.jsx`, `android-frame.jsx`, `frame.jsx` | Molduras de aparelho usadas pelo protótipo |
| `styles.css` | Folha de estilo do tema do protótipo (referência de escala, não de cor) |
| `rentech-logo.png` | Logo usado no login |
| `screenshots/` | 18 capturas do protótipo, uma por tela (01 a 17 no iPhone, 18 mostrando a mesma tela de Início no Android) |

As capturas mostram o topo de cada tela; onde o conteúdo é mais longo que o aparelho, a especificação escrita acima é a fonte da verdade para o que vem depois da dobra.

Para abrir o protótipo, mantenha-o na raiz do projeto de design (ele referencia `_ds/.../styles.css` e `assets/`). Nesta pasta os arquivos estão como referência de leitura.

## Perguntas abertas

Resolvidas em 2026-08-23: Simuladores fica fora desta leva (perguntas 1 e 2 do simulador ficam em suspenso até a feature voltar); conferência de carga cria divergência direto no app; Meu Ponto é tela nativa (tela 16).

Em aberto:

1. Colaborador comum sem conta nenhuma (nem `perfis_usuarios`, nem `portal_funcionarios_auth`) — o app só orienta a criar a conta no navegador, ou vale a pena trazer o fluxo de CPF+OTP de primeiro acesso pro app numa leva futura?
2. `folha_funcionarios` casa com o funcionário pelo nome (`funcionario_nome` como string) tanto no Portal quanto na leitura de ponto — vale a pena, nesta fase, também expor "Meu Ponto" pra contas de equipe (`perfis_usuarios`) cujo nome bata com um `folha_funcionarios`? Hoje a spec da tela 16 deixa de fora RH/Frota/Comercial.
