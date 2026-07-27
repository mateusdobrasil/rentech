![Rentech](../public/logo.png)

# Manual de Acesso, Configuração e Funcionalidades — Rentech Web

> Documento gerado a partir de revisão completa do código-fonte em 12/07/2026.
> Cobre: como acessar, como configurar e o que cada parte do sistema faz.
>
> Também disponível em PDF: [`Manual-Rentech-Web.pdf`](Manual-Rentech-Web.pdf) (mesma pasta `docs/`).

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Como rodar o projeto localmente](#2-como-rodar-o-projeto-localmente)
3. [Variáveis de ambiente (configuração)](#3-variáveis-de-ambiente-configuração)
4. [Estrutura de pastas](#4-estrutura-de-pastas)
5. [Autenticação e controle de acesso](#5-autenticação-e-controle-de-acesso)
6. [Site público — páginas e funções](#6-site-público--páginas-e-funções)
7. [Área administrativa (`/admin`)](#7-área-administrativa-admin)
   - 7.1 [Dashboard e permissões](#71-dashboard-e-permissões)
   - 7.2 [Estoque](#72-estoque)
   - 7.3 [Permissões de usuários](#73-permissões-de-usuários)
   - 7.4 [Log de auditoria](#74-log-de-auditoria)
   - 7.5 [Conteúdo do site (CMS)](#75-conteúdo-do-site-cms)
   - 7.6 [Downloads (admin)](#76-downloads-admin)
   - 7.7 [Freelancers (admin)](#77-freelancers-admin)
   - 7.8 [Integrações](#78-integrações)
   - 7.9 [Agendamentos e disparos (automações WhatsApp)](#79-agendamentos-e-disparos-automações-whatsapp)
   - 7.10 [OP — Ordens de Pagamento](#710-op--ordens-de-pagamento)
   - 7.11 [RH — Recursos Humanos / Folha](#711-rh--recursos-humanos--folha)
8. [Rotas de API e Webhooks](#8-rotas-de-api-e-webhooks)
9. [Integrações externas](#9-integrações-externas)
10. [Deploy e infraestrutura (Vercel)](#10-deploy-e-infraestrutura-vercel)
11. [Segurança — observações e recomendações](#11-segurança--observações-e-recomendações)
12. [Pontos de atenção / pendências encontradas](#12-pontos-de-atenção--pendências-encontradas)
13. [Glossário](#13-glossário)

---

## 1. Visão geral

O **Rentech Web** é o site institucional + sistema de gestão interna da Rentech (locadora de equipamentos audiovisuais — LED, videowall, TV, som, luz). É uma aplicação **Next.js 16** (App Router) full-stack: o mesmo projeto serve tanto o site público quanto o painel administrativo (RH, financeiro, estoque, automações).

**Stack principal:**

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16.2.6 (App Router, Server Actions) |
| UI | React 19.2.4 + Tailwind CSS v4 |
| Linguagem | TypeScript |
| Banco de dados / Auth / Storage | Supabase (Postgres + Auth + Storage) |
| E-mail | Nodemailer (SMTP) |
| Geração/manipulação de PDF | pdf-lib |
| OCR de documentos | AWS Textract |
| Assinatura eletrônica | Autentique (API GraphQL) |
| WhatsApp (bot de ponto + disparos) | Z-API |
| Hospedagem | Vercel (com Vercel Cron) |
| Analytics | Vercel Analytics |

> ⚠️ **Nota técnica importante:** este projeto usa o Next.js 16, que trouxe mudanças de convenção em relação a versões anteriores. Um exemplo já usado no projeto: o middleware não se chama mais `middleware.ts`/`middleware()`, e sim **`proxy.ts`/`proxy()`** (ver seção 5). O arquivo `AGENTS.md` do projeto já alerta qualquer desenvolvedor (humano ou IA) sobre isso.

---

## 2. Como rodar o projeto localmente

Pré-requisitos: Node.js instalado e as variáveis de ambiente configuradas (seção 3).

```bash
npm install       # instala as dependências
npm run dev       # inicia o servidor de desenvolvimento (http://localhost:3000)
npm run build     # gera o build de produção
npm run start     # roda o build de produção localmente
npm run lint      # roda o ESLint
```

O projeto é publicado automaticamente na Vercel (ver seção 10).

---

## 3. Variáveis de ambiente (configuração)

Ficam no arquivo `.env.local` (não versionado no Git). **Nenhum valor de segredo é reproduzido aqui — apenas os nomes das chaves e para que servem.** Quem precisar dos valores reais deve pegá-los com quem administra cada serviço (Supabase, AWS, Autentique, Z-API, e-mail).

### Supabase
| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase (pública) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública/anônima (usada no navegador) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço — acesso total ao banco, ignora as regras de segurança (RLS). **Uso exclusivo no servidor.** Nunca deve aparecer no código do navegador. |

### E-mail (SMTP)
| Variável | Uso |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Credenciais do servidor de e-mail usado para enviar orçamentos e notificações de Ordem de Pagamento |

### Site
| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | URL base do site, usada para montar links em e-mails (ex.: link de confirmação de pagamento de OP, link do recibo) |

### Portal de Downloads
| Variável | Uso |
|---|---|
| `DOWNLOADS_PASSWORD` | Senha única que libera o acesso à página pública `/downloads` |

### Autentique (assinatura eletrônica)
| Variável | Uso |
|---|---|
| `AUTENTIQUE_API_TOKEN` | Token de acesso à API GraphQL da Autentique |

### AWS (OCR de documentos)
| Variável | Uso |
|---|---|
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credenciais AWS usadas pelo Textract para ler/extrair texto de PDFs contábeis no módulo Financeiro do RH |

### Z-API (WhatsApp) e Cron
| Variável | Uso |
|---|---|
| `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `API_CLIENT_TOKEN` | Credenciais da instância Z-API usada para enviar/receber mensagens de WhatsApp |
| `CRON_SECRET` | Token que protege a rota `/api/cron/motor` (só a Vercel Cron deve conhecê-lo) |
| `ZAPI_WEBHOOK_SECRET` | Segredo enviado como `?token=` na URL do webhook de ponto (`/api/webhooks/zapi-ponto`), configurado no painel da Z-API |

**Como configurar em produção:** as mesmas variáveis precisam ser cadastradas no painel da Vercel (Project Settings → Environment Variables), pois o `.env.local` só vale para desenvolvimento local.

---

## 4. Estrutura de pastas

```
app/
├── page.tsx                 → Home institucional
├── layout.tsx                → Layout raiz (Navbar + metadata)
├── login/                    → Login administrativo
├── freelance/                → Cadastro público de freelancers
├── downloads/                → Portal de downloads (protegido por senha)
├── simulador/                → Simuladores comerciais (videowall, tela, grid, curvatura)
├── admin/                    → Painel administrativo (ver seção 7)
├── api/                       → Rotas de API e webhooks (ver seção 8)
├── lib/                      → Bibliotecas internas (Supabase, Autentique, Z-API, PDF, automações)
├── actions.ts                 → Server actions globais (orçamento, downloads, auditoria)
└── imgs/                      → Imagens usadas como módulo (logo)

components/                  → Componentes de UI compartilhados (Navbar, Carrossel de vídeo, Contato)
public/                       → Arquivos estáticos (logos, imagens de cases, vídeos)
proxy.ts                      → Middleware (proteção de rota /admin/op)
vercel.json                   → Configuração da Vercel (Cron Job)
docs/MANUAL.md                 → Este manual
```

---

## 5. Autenticação e controle de acesso

O login é feito via **Supabase Auth** (e-mail/senha) na página `/login`. Ao autenticar, o sistema grava o cookie `sb-access-token` e registra o acesso no log de auditoria.

Existem **duas camadas de proteção**, e é importante entender que elas não são iguais:

1. **`proxy.ts` (middleware, roda no edge, antes da página carregar):** protege **apenas** as rotas `/admin/op/*`. Se não houver o cookie de sessão, redireciona para `/login`.
2. **Verificação no `app/admin/layout.tsx` (roda no navegador, depois da página já ter sido carregada):** protege o restante do `/admin/**` (RH, estoque, permissões, etc.), checando a sessão do Supabase no cliente e redirecionando se não houver sessão.

> A camada 2 é mais fraca que a camada 1 porque o código já chegou ao navegador antes da checagem acontecer (ver observação na seção 11).

### Níveis de permissão

O sistema normaliza o texto de permissão cadastrado no perfil do usuário (tabela de perfis) em uma destas categorias (função `normalizarPermissao`, repetida em várias telas do admin):

| Categoria | Reconhecida a partir de (contém) |
|---|---|
| `ADMINISTRADOR` | "ADMIN", "DIR" (diretoria), "GEREN" (gerência) |
| `ADMINISTRATIVO` | — |
| `FINANCEIRO` | "FINAN" |
| `OPERACIONAL` | "OPER" |
| `ESTOQUE` | "ESTOQ" |
| `EDITOR` | "EDIT" |
| `USUARIO` | qualquer coisa que não se encaixe acima (padrão) |

A gestão de quem tem qual permissão é feita na tela **Permissões** (seção 7.3), que lê a tabela `setores_permissao` no Supabase.

---

## 6. Site público — páginas e funções

| Página | Função |
|---|---|
| **`/`** (Home) | Página institucional: hero, carrossel de vídeos, cases de serviços e formulário de orçamento/contato. Todo o conteúdo (textos, imagens, vídeos) vem do Supabase (tabela `SiteConfig`), editável pelo admin em **Conteúdo** (7.5). O formulário de orçamento envia e-mail via `enviarOrcamento`. |
| **`/login`** | Login administrativo (e-mail/senha via Supabase Auth). |
| **`/freelance`** | Cadastro público de freelancers (nome, CPF, chave PIX, nível de habilidade em LED/videowall/TV/áudio/luz), com termo de consentimento LGPD. Gravado direto no Supabase. |
| **`/downloads`** | Portal de arquivos protegido por senha única (`DOWNLOADS_PASSWORD`). Lista arquivos/imagens/vídeos armazenados no Supabase Storage. |
| **`/simulador`** e subpáginas (`/videowall`, `/tela`, `/grid`, `/curvatura`) | Conjunto de simuladores técnicos/comerciais usados pela equipe de vendas para dimensionar telas de LED, videowall, TV e calcular curvatura/grid de painéis. |

---

## 7. Área administrativa (`/admin`)

Acesso: `/admin` (requer login). O layout comum (`app/admin/layout.tsx`) confere a sessão, registra "ACESSO AO SISTEMA" no log de auditoria (uma vez por sessão de navegador) e atualiza o campo `ultimo_acesso` do usuário.

### 7.1 Dashboard e permissões
`/admin` — hub central com a lista de módulos disponíveis, cujo acesso varia conforme a permissão do usuário logado (ver seção 5).

### 7.2 Estoque
`/admin/estoque` — cadastro e gestão de equipamentos (categorias e itens) da locadora.

### 7.3 Permissões de usuários
`/admin/permissoes` — gestão de usuários, papéis e setores (tabela `setores_permissao`). É aqui que se define quem é ADMINISTRADOR, FINANCEIRO, OPERACIONAL etc.

### 7.4 Log de auditoria
`/admin/log` — visualizador do histórico de ações do sistema (tabela `logs_auditoria`): logins, acessos, disparos de automação, mudanças de status de OP, etc. Praticamente toda ação sensível do sistema grava um registro aqui via `registrarLogAuditoria`.

### 7.5 Conteúdo do site (CMS)
`/admin/conteudo` — editor tipo CMS para a home pública: textos do hero, imagens, WhatsApp e e-mail de contato exibidos no site. Grava na tabela `SiteConfig`.

### 7.6 Downloads (admin)
`/admin/downloads` — gestão dos arquivos exibidos no portal público `/downloads`: upload e remoção de arquivos (via `uploadArquivoDownload` / `removerArquivoDownload`).

### 7.7 Freelancers (admin)
`/admin/freelance` — revisão dos cadastros enviados pelo formulário público `/freelance`.

### 7.8 Integrações
`/admin/integracao` — tela de status das integrações externas: cadastro de parceiros/bancos/assinatura eletrônica (tabela `folha_integracoes`), verificação se o token da Autentique está configurado (com estatísticas de uso) e status das conexões de WhatsApp (Z-API e Meta Cloud API, com estatísticas de envio). **Nunca expõe segredos**, apenas indicadores (configurado/não configurado, contadores).

**WhatsApp: Z-API vs Meta Cloud API.** O sistema suporta os dois provedores ao mesmo tempo, com um roteamento (linha `WHATSAPP_ROTEAMENTO` em `folha_integracoes`, lida/gravada por `obterRoteamentoWhatsAppAction`/`salvarRoteamentoWhatsAppAction` e aplicada por `resolverProvedor` em `app/lib/whatsapp.ts`) que decide qual API é usada em cada frente:
- **Envio** — mensagens dos nós de agendadores/lembretes (`app/lib/automacoes.ts`).
- **Recebimento** — mensagens dos colaboradores/funcionários no fluxo de Ponto via WhatsApp; controla qual dos dois webhooks (`app/api/webhooks/zapi-ponto` ou `app/api/webhooks/meta-ponto`) efetivamente processa a conversa (o outro responde `ignorado: true` sem agir).
- **Modo Global** — um único provedor vale para envio e recebimento; no modo Independente, cada um pode usar um provedor diferente.

Sem essa linha cadastrada (ou com o config incompleto), o sistema assume Z-API nos dois casos — o comportamento de antes da integração com a Meta.

Credenciais da Meta Cloud API (variáveis de ambiente, nunca lidas/gravadas pela tela): `META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_APP_SECRET` (valida a assinatura `x-hub-signature-256` do webhook) e `META_WEBHOOK_VERIFY_TOKEN` (handshake `GET` de verificação do webhook). Passo a passo para obtê-las: criar um App em developers.facebook.com (tipo Business) → adicionar o produto WhatsApp → em *API Setup*, copiar o Phone Number ID → gerar um token permanente via *Business Settings → System Users* (permissões `whatsapp_business_messaging` e `whatsapp_business_management`) → em *App Settings → Basic*, copiar o App Secret → escolher uma string própria para o Verify Token → em *WhatsApp → Configuration*, cadastrar o Webhook com Callback URL `https://SEU-DOMINIO/api/webhooks/meta-ponto`, o mesmo Verify Token, e assinar o campo `messages`.

**Modo Development vs Live do App da Meta.** Enquanto o App estiver em análise (App Review) ou em modo Development, só é possível enviar/receber para os números cadastrados em "Recipient numbers" (até 5) — isso vale mesmo já usando um número de telefone de produção verificado, porque a restrição é do App, não do número. Não trocar o roteamento (Envio/Recebimento/Global) para Meta em produção antes do App virar Live, sob risco de o fluxo de Ponto via WhatsApp parar de responder para quem não estiver nessa lista de teste.

**Texto livre vs Message Templates (HSM) na Meta.** A Meta só entrega mensagens de texto livre business-iniciado dentro de uma janela de 24h que abre quando o destinatário manda mensagem — fora dela, a API aceita a chamada (devolve um `wamid`) mas a mensagem nunca chega, e a falha só aparece depois via webhook de status (não na resposta síncrona). Isso afeta:
- **Notificações de aprovação/rejeição de ponto** (`notificarPontoWhatsApp` em `app/lib/whatsapp.ts`, chamada por `aprovarSolicitacaoAction`/`rejeitarSolicitacaoAction` em `actions-ponto-whatsapp.ts`): resolvido — a tabela `folha_whatsapp_janela` guarda a última mensagem recebida por celular (atualizada a cada mensagem processada em `processarMensagemPontoWhatsApp`, dos dois webhooks); se a janela estiver aberta, manda texto livre; senão, usa um dos dois Message Templates aprovados no Business Manager: `ponto_solicitacao_aprovada` (`"O RH aprovou {{1}} referente a {{2}}."`) e `ponto_solicitacao_rejeitada` (`"O RH não aprovou {{1}} referente a {{2}}. Motivo: {{3}}. Fale com o RH se tiver dúvidas."`), categoria Utility, idioma pt_BR.
- **Automações de Agendamentos e Disparos** (`dispararAutomacaoWhatsApp` em `app/lib/automacoes.ts`): cada automação tem, opcionalmente, um Message Template mapeado (campos `meta_template_nome`/`meta_template_idioma`/`meta_template_variaveis` em `folha_automacoes`, editáveis na tela de Agendamentos e Disparos). Mesma lógica de janela: se aberta, texto livre; senão, o template configurado (se houver — sem template, tenta texto livre mesmo assim, melhor esforço). Templates mapeados hoje: `lembrete_ponto_entrada` (automação `lembrete-ponto`), `lembrete_ponto_saida` (`lembrete-ponto2`), `frota_documentos_vencidos` (`frota-vencimentos`) e `documentos_vencidos_rh` (`documentos-vencidos`), todos usando só `{{primeiro_nome}}`, categoria Utility, idioma pt_BR.

**Provedor por automação.** Além do interruptor global (Envio/Recebimento/Global), cada automação pode fixar seu próprio provedor via o campo `provedor_whatsapp` (`'PADRAO' | 'ZAPI' | 'META'`, seletor na tela de Agendamentos e Disparos) — `'PADRAO'` segue o global (`resolverProvedor('ENVIO')`), os outros dois forçam aquele provedor específico só para essa automação, ignorando o global. Resolvido por `resolverProvedorAutomacao` em `app/lib/whatsapp.ts`; útil para testar/fixar uma automação num provedor sem afetar as demais.

### 7.9 Agendamentos e disparos (automações WhatsApp)
`/admin/agendamentos` — CRUD de automações de disparo de WhatsApp (tabela `folha_automacoes`), que podem ser do tipo:
- **CRON**: disparadas automaticamente em horário programado (verificado a cada 5 min pela rota `/api/cron/motor`, seção 8);
- **WEBHOOK**: disparadas por evento.

Cada automação tem um **"kill switch"** (campo `ativo`) — é a chave geral que o motor de cron verifica antes de disparar qualquer coisa. Desligar uma automação aqui impede que ela dispare, mesmo que esteja agendada.

### 7.10 OP — Ordens de Pagamento
Módulo de gestão de pagamentos a fornecedores/terceiros:

| Tela | Função |
|---|---|
| `/admin/op` | Lista e gerencia as Ordens de Pagamento; permite disparar e-mail de notificação (`dispararEmailOP`). |
| `/admin/op/nova` | Cria uma nova OP. |
| `/admin/op/responsavel` | Visão da lista de OPs filtrada para o "responsável" designado. |
| `/admin/op/financeiro` | Visão financeira das OPs. |
| `/admin/op/assinaturas` | Painel de assinatura digital do recibo via Autentique: envia o recibo em PDF para o favorecido assinar (CPF + celular obrigatórios, cadastrados na criação da OP), consulta status, reenvia e baixa o documento assinado. |

Fluxo típico: OP criada (com CPF e celular do signatário) → e-mail disparado ao responsável/pagador → pagador confirma pagamento pelo link em `/api/baixar-op` (seção 8) → recibo é enviado para assinatura via Autentique em `/admin/op/assinaturas`, que valida o signatário por CPF e envia o link automaticamente por WhatsApp.

### 7.11 RH — Recursos Humanos / Folha
`/admin/rh` — **o módulo mais complexo do sistema**, cobrindo o ciclo de folha de pagamento, ponto, benefícios e documentos dos funcionários.

| Tela | Função |
|---|---|
| **Funcionário** (`funcionario/`) | Cadastro (CRUD) dos funcionários. |
| **Holerite** (`holerite/`) | Fechamento e reabertura de folha em lote; envio dos holerites para assinatura eletrônica (Autentique). |
| **Ponto** (`ponto/`) | Tela de controle de ponto: importação de batidas/abonos, acompanhamento do livro-razão de ponto via bot de WhatsApp (ver `pontoWhatsapp.ts`), fila de justificativas/abonos pendentes de aprovação pelo RH. Inclui a ferramenta **"Separar Holerites"**, que divide um PDF contábil de várias páginas em um arquivo por funcionário (usando `pdf-lib`/`pdf.js`, tudo no navegador) antes de salvar. |
| **Benefícios** (`beneficios/`) | Catálogo e atribuição de benefícios (VR/VT/benefícios "flash"), incluindo geração de cargas para o cartão Flash. |
| **Parâmetros** (`parametros/`) | Cadastro de feriados e regras/catálogos usados nos cálculos da folha. |
| **Documentos** (`documentos/`) | Cofre de documentos dos funcionários — categorias, upload, controle de validade/vencimento. |
| **Assinaturas** (`assinaturas/`) | Painel de acompanhamento das assinaturas eletrônicas via Autentique: listar, consultar status, reenviar individualmente, baixar documento assinado, atualizar status de todos de uma vez. |
| **Relatórios** (`relatorios/`) | Relatórios (ex.: grade de benefícios). |
| **Financeiro** (`financeiro/`) | Montagem do lote de pagamento de salários: leitura de PDFs contábeis com **OCR via AWS Textract**, preparação do arquivo bancário (remessa). **O envio efetivo ao banco ainda é um stub/placeholder — depende de credenciais/certificado ainda não configurados** (ver seção 12). |

**Importante sobre aprovações de ponto:** o bot de WhatsApp registra as solicitações (ponto, justificativa, abono) num livro-razão apenas de inserção (append-only), mas **nunca aprova nada sozinho** — toda justificativa/abono precisa ser aprovada manualmente pelo RH na tela Ponto.

---

## 8. Rotas de API e Webhooks

| Rota | Método | Função | Proteção |
|---|---|---|---|
| `/api/baixar-op` | GET | Link enviado por e-mail: confirma o pagamento de uma OP (muda status para `PAGO`) e mostra uma página de sucesso. | — (link direto, sem senha) |
| `/api/videos` | GET | Lista os arquivos de vídeo (`.mp4/.webm/.mov`) presentes em `public/videos`, para uso no carrossel. | — |
| `/api/cron/motor` | GET | **Alvo do Vercel Cron** (roda a cada 5 minutos, ver `vercel.json`). Verifica as automações do tipo CRON ativas cujo horário/dia bate com o horário atual (fuso Brasil) e dispara as mensagens de WhatsApp correspondentes. | Cabeçalho `Authorization: Bearer <CRON_SECRET>` |
| `/api/webhooks/autentique` | POST / GET | Recebe notificações da Autentique quando um documento é enviado/visualizado/assinado/rejeitado, e atualiza o status no banco. GET é apenas um "health check" que a Autentique às vezes chama ao configurar o webhook. | Formato de payload validado; sem segredo explícito |
| `/api/webhooks/zapi-ponto` | POST / GET | Recebe as mensagens de WhatsApp enviadas pelos funcionários para o bot de ponto (PONTO / JUSTIFICAR / ABONAR) e responde automaticamente. | Parâmetro `?token=<ZAPI_WEBHOOK_SECRET>` na URL (a Z-API não assina requisições, então esse token é a única proteção) |

Apenas `/api/cron/motor` está registrada no `vercel.json` como cron job; as demais são chamadas pelo próprio site ou configuradas manualmente como webhook nos painéis da Autentique/Z-API.

---

## 9. Integrações externas

| Serviço | Para que serve no sistema | Onde é configurado |
|---|---|---|
| **Supabase** | Banco de dados (Postgres), autenticação de usuários administrativos, armazenamento de arquivos (Storage) | Painel do Supabase → variáveis `NEXT_PUBLIC_SUPABASE_*` e `SUPABASE_SERVICE_ROLE_KEY` |
| **SMTP (e-mail)** | Envio de e-mails de orçamento e de notificação de Ordens de Pagamento | Provedor de e-mail → variáveis `SMTP_*` |
| **AWS Textract** | OCR (leitura automática) de PDFs contábeis no fechamento da folha/financeiro | Console AWS (IAM) → variáveis `AWS_*` |
| **Autentique** | Assinatura eletrônica de holerites e recibos | Painel Autentique → `AUTENTIQUE_API_TOKEN` + webhook apontando para `/api/webhooks/autentique` |
| **Z-API** | Envio e recebimento de mensagens de WhatsApp (bot de ponto e automações de disparo) | Painel Z-API → `ZAPI_*`, `API_CLIENT_TOKEN` + webhook apontando para `/api/webhooks/zapi-ponto?token=<ZAPI_WEBHOOK_SECRET>` |
| **Vercel Cron** | Dispara o motor de automações a cada 5 minutos | `vercel.json` + `CRON_SECRET` |
| **Vercel Analytics** | Métricas de uso do site | Automático via pacote `@vercel/analytics` |

---

## 10. Deploy e infraestrutura (Vercel)

- O projeto é hospedado na **Vercel**. Cada push/deploy precisa ter as mesmas variáveis de ambiente da seção 3 cadastradas em **Project Settings → Environment Variables** na Vercel (o `.env.local` não vai para produção).
- **Cron job**: configurado em `vercel.json`, chama `GET /api/cron/motor` a cada 5 minutos.
- **Git LFS**: dois arquivos binários grandes são versionados via Git LFS (`.gitattributes`): `public/cases/corporativo.gif` e `public/videos/video2.mp4`. É preciso ter o Git LFS instalado para clonar o repositório corretamente com esses arquivos.
- **Limite de upload em Server Actions**: configurado em `next.config.ts` para 10 MB (necessário para os uploads de PDF/arquivos usados no RH e nos downloads).

---

## 11. Segurança — observações e recomendações

Estas são observações levantadas na revisão, para conhecimento de quem administra o sistema:

1. **Proteção de rota assimétrica**: apenas `/admin/op/*` é protegida no middleware (`proxy.ts`), que roda antes da página carregar. As demais seções do admin (RH, Estoque, Permissões, Conteúdo, etc.) dependem exclusivamente de uma checagem feita **no navegador**, depois que a página já foi enviada. Na prática, o conteúdo da página chega a ser carregado no cliente antes do redirecionamento acontecer. Recomenda-se, se for reforçar a segurança, ampliar o matcher do `proxy.ts` para cobrir todo `/admin/:path*`.
2. **Segredo do webhook de ponto via query string**: `/api/webhooks/zapi-ponto` usa `?token=` na URL como única proteção, já que a Z-API não assina as requisições. Isso é aceitável, mas o token fica potencialmente exposto em logs de acesso — deve ser tratado como segredo e trocado caso vaze.
3. **Chave de serviço do Supabase (`SUPABASE_SERVICE_ROLE_KEY`)** é a credencial mais sensível do projeto — dá acesso irrestrito ao banco, ignorando as regras de segurança (RLS). É usada apenas em código de servidor (`supabaseAdmin()`), o que está correto; deve **nunca** ser exposta em código que rode no navegador.
4. Nenhum valor de segredo foi incluído neste manual — apenas nomes de variáveis e finalidade.

---

## 12. Pontos de atenção / pendências encontradas

- **README.md** ainda é o texto padrão gerado pelo `create-next-app` — não documenta o projeto. Este manual (`docs/MANUAL.md`) supre essa lacuna.
- **Envio bancário no módulo Financeiro do RH** (`/admin/rh/financeiro`) está implementado como stub/placeholder — a submissão real ao banco depende de credenciais/certificado que ainda não foram configurados.
- **`components/Contato.jsx`** parece ser um formulário de contato "de exemplo", não conectado (simula envio com 1.5s de espera) — o formulário de orçamento real da Home usa outra lógica (`app/page.tsx` + `app/actions.ts`).
- **`.vscode/launch.json`** aponta para a porta `8080`, mas o Next.js roda por padrão na porta `3000` — provavelmente configuração antiga/não usada.
- Ícones padrão do Next.js (`file.svg`, `globe.svg`, `next.svg`, `window.svg`, `vercel.svg`) continuam em `public/` e aparentam não estar em uso — candidatos a limpeza.

---

## 13. Glossário

| Termo | Significado |
|---|---|
| **OP** | Ordem de Pagamento |
| **RH** | Recursos Humanos (módulo de folha de pagamento) |
| **RLS** | Row Level Security — regras de segurança por linha do Postgres/Supabase |
| **OCR** | Reconhecimento óptico de caracteres (leitura automática de texto em PDF/imagem) |
| **CMS** | Sistema de gestão de conteúdo (aqui, o editor da Home em `/admin/conteudo`) |
| **Kill switch** | Campo `ativo` que liga/desliga uma automação sem precisar apagá-la |
| **LGPD** | Lei Geral de Proteção de Dados (consentimento coletado no formulário de freelancer) |
| **Webhook** | URL que um serviço externo (Autentique, Z-API) chama automaticamente quando algo acontece |
| **Server Action** | Função que roda no servidor, chamada diretamente a partir de um formulário/componente React (recurso do Next.js) |
| **Middleware / proxy.ts** | Código que roda antes da página, podendo bloquear/redirecionar o acesso |

---

*Este manual reflete o estado do código na data de geração. Recomenda-se atualizá-lo sempre que módulos forem adicionados, removidos ou tiverem seu funcionamento alterado.*
