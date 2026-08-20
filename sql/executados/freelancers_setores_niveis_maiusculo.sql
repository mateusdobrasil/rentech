-- Padroniza em maiúsculo os nomes já cadastrados de setores e níveis do
-- Banco de Talentos (aba Parâmetros de /admin/freelance) — daqui pra frente
-- a tela só deixa escrever em maiúsculo, mas isso não conserta o que já foi
-- gravado antes dessa regra existir.
UPDATE public.freelancers_setores SET nome = upper(nome) WHERE nome <> upper(nome);
UPDATE public.freelancers_niveis SET nome = upper(nome) WHERE nome <> upper(nome);

-- Conferência.
SELECT id, nome FROM public.freelancers_setores ORDER BY empresa_id, ordem;
SELECT id, nome FROM public.freelancers_niveis ORDER BY empresa_id, ordem;
