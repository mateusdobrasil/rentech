-- folha_automacoes (tela Agendamentos e Disparos) não diferenciava pra qual
-- empresa uma automação dispara — uma rotina "Todos os funcionários ativos"
-- mandava mensagem pra Rentech E AlfaLight juntas. Agora cada automação pode
-- ser presa a uma empresa; NULL continua significando "todas" (mesmo critério
-- já usado no resto do sistema), preservando o comportamento das automações
-- já cadastradas.
ALTER TABLE public.folha_automacoes
  ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

CREATE INDEX IF NOT EXISTS idx_folha_automacoes_empresa_id
  ON public.folha_automacoes(empresa_id);

-- Conferência.
SELECT id, nome, empresa_id FROM public.folha_automacoes ORDER BY id;
