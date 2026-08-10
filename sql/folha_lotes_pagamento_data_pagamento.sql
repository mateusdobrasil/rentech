-- Guarda a data de pagamento escolhida na tela de montagem do lote
-- (/admin/financeiro/rh) direto na linha do lote, pra exibir no Histórico de
-- lotes. Antes esse valor só existia de forma efêmera no front (usado pra
-- montar o CNAB) ou, pra lotes enviados via API do Itaú, gravado dentro de
-- cada item em folha_lotes_pagamento.itens[].data_pagamento — nunca no lote
-- como um todo.
--
-- Nullable: lotes já gerados antes desta coluna existir ficam sem essa data.

alter table folha_lotes_pagamento
  add column if not exists data_pagamento date;
