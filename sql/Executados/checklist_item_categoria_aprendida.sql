-- "Importar Itens das OS's" (Checklist de Carga) passa a lembrar a categoria
-- que o usuário escolheu pra cada descrição de item — na próxima importação
-- em que o mesmo texto aparecer (de qualquer OS, qualquer evento), a
-- categoria já vem pré-selecionada em vez de cair em DIVERSOS por padrão.
-- descricao é a própria chave (texto normalizado — maiúsculo/trim, igual ao
-- que já é feito na tela) porque a relação é 1 descrição -> 1 categoria mais
-- recente; não precisa de id numérico separado.
create table if not exists checklist_item_categoria_aprendida (
  descricao text primary key,
  categoria_id text references categorias(id) on delete set null,
  atualizado_em timestamptz not null default now()
);
 