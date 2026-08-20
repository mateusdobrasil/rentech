-- freelancers (Banco de Talentos) não tinha nenhuma dimensão de empresa nem
-- RLS — a tela /admin/freelance lê pelo cliente anon direto (sem Server
-- Action), então hoje QUALQUER pessoa com a chave anon consegue ler CPF,
-- endereço e chave PIX de todos os freelancers cadastrados, de qualquer
-- empresa. Esta migração resolve as duas coisas de uma vez: adiciona
-- empresa_id (escolhida pelo próprio freelancer no cadastro público, ver
-- app/freelance/page.tsx) e liga RLS de verdade.
--
-- Cuidado ao rodar: /freelance é auto-cadastro público (sem login) e insere
-- direto com o cliente anon — precisa continuar podendo INSERT depois desta
-- migração, só não pode mais ler/editar/apagar (isso passa a ser exclusivo
-- de quem está logado e tem acesso à própria empresa).

ALTER TABLE public.freelancers
  ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

CREATE INDEX IF NOT EXISTS idx_freelancers_empresa_id
  ON public.freelancers(empresa_id);

-- Todo o cadastro existente é anterior ao campo "Empresa de Cadastro", então
-- é da Rentech (id 12) — mesmo raciocínio já usado em
-- frota_veiculos/equipamentos/fichas_reserva/checklists.
UPDATE public.freelancers
SET empresa_id = 12
WHERE empresa_id IS NULL;

ALTER TABLE public.freelancers ENABLE ROW LEVEL SECURITY;

-- Auto-cadastro público (app/freelance/page.tsx) continua funcionando: só
-- INSERT, sem poder ler/editar/apagar o que já está na tabela.
DROP POLICY IF EXISTS freelancers_cadastro_publico ON public.freelancers;
CREATE POLICY freelancers_cadastro_publico ON public.freelancers
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Equipe logada (app/admin/freelance/page.tsx) só vê/edita freelancers da(s)
-- própria(s) empresa(s).
DROP POLICY IF EXISTS freelancers_isolamento_autenticado ON public.freelancers;
CREATE POLICY freelancers_isolamento_autenticado ON public.freelancers
  FOR ALL
  TO authenticated
  USING (empresa_id IS NULL OR empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  WITH CHECK (empresa_id IS NULL OR empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador());

-- Conferência.
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'freelancers';
SELECT count(*) AS total, count(*) FILTER (WHERE empresa_id = 12) AS foram_pro_fallback_rentech
FROM public.freelancers;
