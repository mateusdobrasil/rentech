-- Registra a notificação de escala (botão "📣 Notificar Colaboradores" em
-- /admin/operacional/escala) como uma automação em folha_automacoes — não
-- pra ela ser disparada pelo Cron (continua sendo o coordenador quem aperta
-- o botão), mas pra aparecer no painel de /admin/parametros/agendamentos,
-- contar no total de "WhatsApp Enviados este mês", e o interruptor
-- Ativo/Inativo virar um kill-switch de verdade do botão
-- (notificarColaboradoresAction, em actions-escala.ts, consulta esta linha
-- antes de mandar qualquer mensagem). O nome/idioma do Message Template
-- também passam a vir daqui em vez de fixos no código — editáveis pela tela
-- sem precisar de deploy.
--
-- Cada colaborador recebe local/horário diferentes (dados da escala do dia),
-- então o disparo em si continua sendo código dedicado — o campo `mensagem`
-- abaixo é só documentação legível na tela, não é usado pra montar o texto
-- de fato enviado (ver notificarColaboradoresAction).
--
-- Roda uma vez no SQL Editor do Supabase.
-- Usa WHERE NOT EXISTS em vez de ON CONFLICT (chave): folha_automacoes não
-- tem constraint única em `chave` no banco (a tela de Agendamentos garante
-- unicidade só na aplicação, ver gerarChaveUnica em
-- app/admin/parametros/agendamentos/actions.ts) — ON CONFLICT exigiria essa
-- constraint e falharia sem ela.
insert into folha_automacoes (
  chave, nome, descricao, tipo, gatilho, canais, publico_alvo, empresa_id,
  destinatarios, mensagem, horario, dias_semana,
  provedor_whatsapp, meta_template_nome, meta_template_idioma, meta_template_variaveis,
  publico_dinamico, ativo
)
select
  'escala-notificacao-diaria',
  'Notificação de Escala Diária',
  'Avisa cada colaborador, por WhatsApp individual, do local e horário da escala dele no dia. Disparada manualmente pelo botão "Notificar Colaboradores" em Operacional → Escala — não roda pelo Cron.',
  'WEBHOOK',
  'Botão "Notificar Colaboradores" na tela de Escala',
  array['WhatsApp'],
  'Colaboradores alocados na escala do dia',
  null,
  array[]::text[],
  'Olá {{primeiro_nome}}! Sua escala de {{data_extenso}} já está definida: 📍 {{local}} às {{horario}}.',
  null,
  array[1, 2, 3, 4, 5],
  'PADRAO',
  'escala_notificacao_diaria',
  'pt_BR',
  '["primeiro_nome", "data_extenso", "local", "horario"]'::jsonb,
  'PADRAO',
  true
where not exists (select 1 from folha_automacoes where chave = 'escala-notificacao-diaria');
