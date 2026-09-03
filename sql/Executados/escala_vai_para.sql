-- "Ir para": local pra onde o pessoal segue DEPOIS de sair do local
-- principal daquele dia (ex: sai da Empresa às 8h, pega o caminhão e segue
-- pro Anhembi). É só informativo — não cria um segundo turno/alocação (isso
-- já existe via múltiplos turnos, pra quando o horário ou a tarefa é
-- realmente distinta, ver sql/Executados/escala_multiplos_turnos.sql).
-- Fica no contexto do local no dia (escala_locais_dia), igual horário
-- padrão/tipo/evento/responsável.
alter table escala_locais_dia
  add column if not exists vai_para_local_id uuid references escala_locais(id) on delete set null,
  add column if not exists vai_para_local_nome text;
