-- Troca os 5 setores fixos do Banco de Talentos (nivel_led, nivel_videowall,
-- nivel_tv, nivel_audio, nivel_luz — colunas em public.freelancers) por um
-- cadastro dinâmico POR EMPRESA: a Rentech loca equipamento diferente da
-- AlfaLight, então cada uma tem sua própria lista de setores — e também sua
-- própria escala de níveis (não é uma escala única compartilhada).
--
-- Gerenciável pela aba "Parâmetros" nova em app/admin/freelance/page.tsx.
-- O formulário público (app/freelance/page.tsx) passa a montar os campos de
-- setor dinamicamente a partir da empresa escolhida pelo próprio freelancer.

CREATE TABLE IF NOT EXISTS public.freelancers_setores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id int NOT NULL REFERENCES public.empresas(id),
  nome text NOT NULL,
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.freelancers_niveis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id int NOT NULL REFERENCES public.empresas(id),
  nome text NOT NULL,
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Um freelancer só pode ter UM nível por setor (não faz sentido repetir).
CREATE TABLE IF NOT EXISTS public.freelancers_setor_nivel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id uuid NOT NULL REFERENCES public.freelancers(id) ON DELETE CASCADE,
  setor_id uuid NOT NULL REFERENCES public.freelancers_setores(id),
  nivel_id uuid NOT NULL REFERENCES public.freelancers_niveis(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (freelancer_id, setor_id)
);

CREATE INDEX IF NOT EXISTS idx_freelancers_setores_empresa ON public.freelancers_setores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_freelancers_niveis_empresa ON public.freelancers_niveis(empresa_id);
CREATE INDEX IF NOT EXISTS idx_freelancers_setor_nivel_freelancer ON public.freelancers_setor_nivel(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_freelancers_setor_nivel_setor ON public.freelancers_setor_nivel(setor_id);

-- Seed Rentech (id 12) com os mesmos 5 setores e 5 níveis que já existiam
-- fixos no código — AlfaLight nasce sem nenhum, cadastrado do zero na aba
-- Parâmetros. Nomes dos níveis são os mesmos rótulos canônicos que
-- normalizarNivel() (app/admin/freelance/page.tsx) já usava.
INSERT INTO public.freelancers_setores (empresa_id, nome, ordem) VALUES
  (12, 'Painel de LED', 1),
  (12, 'Video Wall', 2),
  (12, 'Televisores', 3),
  (12, 'Áudio / Sonorização', 4),
  (12, 'Iluminação', 5);

INSERT INTO public.freelancers_niveis (empresa_id, nome, ordem) VALUES
  (12, 'Ajudante', 1),
  (12, 'Instalador', 2),
  (12, 'Instala e Configura', 3),
  (12, 'Instalador, Configura e Opera', 4),
  (12, 'Coordenador', 5);

-- Backfill: reaplica a mesma lógica de normalizarNivel() (match exato nos
-- rótulos canônicos; senão heurística por substring) em cada uma das 5
-- colunas antigas, e insere a linha correspondente em freelancers_setor_nivel
-- quando o resultado não for nulo/"Não trabalho com o Item". Função
-- temporária (pg_temp), some sozinha no fim da sessão.
CREATE OR REPLACE FUNCTION pg_temp.normalizar_nivel_freelancer(v text) RETURNS text AS $$
  SELECT CASE
    WHEN v IS NULL OR btrim(v) = '' THEN NULL
    WHEN v = 'Não trabalho com o Item' THEN NULL
    WHEN v IN ('Ajudante', 'Instalador', 'Instala e Configura', 'Instalador, Configura e Opera', 'Coordenador') THEN v
    WHEN lower(v) LIKE '%coordena%' THEN 'Coordenador'
    WHEN lower(v) LIKE '%opera%' THEN 'Instalador, Configura e Opera'
    WHEN lower(v) LIKE '%configura%' THEN 'Instala e Configura'
    WHEN lower(v) LIKE '%instala%' THEN 'Instalador'
    WHEN lower(v) LIKE '%ajudante%' THEN 'Ajudante'
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE;

INSERT INTO public.freelancers_setor_nivel (freelancer_id, setor_id, nivel_id)
SELECT f.id, s.id, n.id
FROM public.freelancers f
CROSS JOIN LATERAL (VALUES
  (f.nivel_led, 'Painel de LED'),
  (f.nivel_videowall, 'Video Wall'),
  (f.nivel_tv, 'Televisores'),
  (f.nivel_audio, 'Áudio / Sonorização'),
  (f.nivel_luz, 'Iluminação')
) AS cols(valor_bruto, setor_nome)
JOIN public.freelancers_setores s ON s.empresa_id = 12 AND s.nome = cols.setor_nome
JOIN public.freelancers_niveis n ON n.empresa_id = 12 AND n.nome = pg_temp.normalizar_nivel_freelancer(cols.valor_bruto)
WHERE pg_temp.normalizar_nivel_freelancer(cols.valor_bruto) IS NOT NULL
ON CONFLICT (freelancer_id, setor_id) DO NOTHING;

-- Colunas antigas somem de vez — não fica compat nenhuma, a partir daqui o
-- código só lê/grava via freelancers_setor_nivel.
ALTER TABLE public.freelancers
  DROP COLUMN IF EXISTS nivel_led,
  DROP COLUMN IF EXISTS nivel_videowall,
  DROP COLUMN IF EXISTS nivel_tv,
  DROP COLUMN IF EXISTS nivel_audio,
  DROP COLUMN IF EXISTS nivel_luz;

ALTER TABLE public.freelancers_setores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freelancers_niveis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freelancers_setor_nivel ENABLE ROW LEVEL SECURITY;

-- Formulário público (app/freelance/page.tsx) precisa ler os catálogos pra
-- montar os campos — só o que estiver ativo.
DROP POLICY IF EXISTS freelancers_setores_leitura_publica ON public.freelancers_setores;
CREATE POLICY freelancers_setores_leitura_publica ON public.freelancers_setores
  FOR SELECT TO anon USING (ativo = true);

DROP POLICY IF EXISTS freelancers_niveis_leitura_publica ON public.freelancers_niveis;
CREATE POLICY freelancers_niveis_leitura_publica ON public.freelancers_niveis
  FOR SELECT TO anon USING (ativo = true);

-- Equipe logada só vê/edita o catálogo da(s) própria(s) empresa(s). Sem o
-- "OR empresa_id IS NULL" das outras migrações — aqui empresa_id é sempre
-- obrigatório (não existe setor/nível "sem empresa").
DROP POLICY IF EXISTS freelancers_setores_isolamento ON public.freelancers_setores;
CREATE POLICY freelancers_setores_isolamento ON public.freelancers_setores
  FOR ALL TO authenticated
  USING (empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  WITH CHECK (empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador());

DROP POLICY IF EXISTS freelancers_niveis_isolamento ON public.freelancers_niveis;
CREATE POLICY freelancers_niveis_isolamento ON public.freelancers_niveis
  FOR ALL TO authenticated
  USING (empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  WITH CHECK (empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador());

-- freelancers_setor_nivel: cadastro público só grava (mesma confiança já
-- dada à própria tabela freelancers em sql/freelancers_empresa_id.sql — não
-- pode ler/editar/apagar). Equipe logada só vê/edita via join à empresa do
-- freelancer (mesmo padrão de checklist_itens em
-- sql/checklists_expedicao_empresa_id.sql).
DROP POLICY IF EXISTS freelancers_setor_nivel_cadastro_publico ON public.freelancers_setor_nivel;
CREATE POLICY freelancers_setor_nivel_cadastro_publico ON public.freelancers_setor_nivel
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS freelancers_setor_nivel_isolamento ON public.freelancers_setor_nivel;
CREATE POLICY freelancers_setor_nivel_isolamento ON public.freelancers_setor_nivel
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.freelancers f
    WHERE f.id = freelancers_setor_nivel.freelancer_id
      AND (f.empresa_id IS NULL OR f.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.freelancers f
    WHERE f.id = freelancers_setor_nivel.freelancer_id
      AND (f.empresa_id IS NULL OR f.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ));

-- Conferência.
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('freelancers_setores', 'freelancers_niveis', 'freelancers_setor_nivel');
SELECT count(*) AS freelancers_com_ao_menos_1_setor FROM (
  SELECT DISTINCT freelancer_id FROM public.freelancers_setor_nivel
) t;
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'freelancers' AND column_name LIKE 'nivel_%';
