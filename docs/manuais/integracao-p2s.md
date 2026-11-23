## Panorama

O sistema da Rentech usa a API do PrimeStart (P2S) nos dois sentidos: lê cadastros, locação e financeiro, e escreve no ERP contas, classificações, quitações e devoluções. Este documento resume a apresentação feita para a P2S Tecnologia em novembro de 2026.

| Número | O que é |
| --- | --- |
| 6 | sincronizações automáticas de dados do ERP |
| 4 | fluxos que escrevem no PrimeStart sozinhos |
| 12+ | classes do PrimeStart consultadas ou gravadas |
| 2 | ambientes: Sandbox e Produção |

Financeiro, Comercial, Estoque e Operação usam dados do PrimeStart todos os dias e devolvem ao ERP o que acontece fora dele.

## Como a integração funciona

O sistema Rentech (web, Portal e app) fala com a API REST do PrimeStart por um único cliente HTTP no servidor, com Basic Auth. Cada registro do ERP é um objeto identificado por `oid` + `classname`.

- **Operações genéricas:** consulta por critérios (qpo), leitura por oid, criação, atualização e exclusão de objetos.
- **Métodos de negócio:** quando o campo é calculado pelo servidor (status de ficha, quitação, saldo de estoque), chamamos o método dedicado da classe, como o suporte da P2S indicou.

## Leitura: o que o sistema lê do PrimeStart

A rotina roda duas vezes por dia e também pelo botão manual. É incremental onde a classe tem data de alteração.

| Domínio | Classe | Como |
| --- | --- | --- |
| Parceiros | TCustomParceiro | Clientes e fornecedores, paginado por código (a base inteira dava timeout numa chamada só) |
| Colaboradores | TCustomColaborador | Equipe do ERP, com dados sensíveis protegidos |
| Produtos e Estoque | TCustomProduto · TCustomEstoque | Catálogo e saldo, com sync incremental |
| Fichas de Locação | TCustomFichaReservaLocacao | Reservas e locações, com sync incremental |
| Eventos e Feiras | TCustomEvento | Agenda comercial, com local e montadora |
| Contas a Pagar | TCustomContaPagar | Consulta com proxy: de 62 MB para 1,9 MB nos mesmos registros |

Produtos, Parceiros, Colaboradores e Fichas usam a `DataUltimaAlteracaoCadastro` para buscar só o que mudou.

## Escrita: Ordem de Pagamento vira Conta a Pagar

1. O usuário cria a OP no sistema: itens, favorecido (CNPJ/CPF), vencimento e natureza.
2. O sistema busca o parceiro no PrimeStart, na base sincronizada e, se preciso, ao vivo na API. A comparação de documentos usa só os dígitos, para não duplicar cadastro.
3. Se o fornecedor não existe, ele é cadastrado (TCustomParceiro com nome, natureza, documento e flag).
4. A Conta a Pagar é criada com "OP: nº", valor, vencimento, itens, forma e conta.

O ciclo de vida fica sincronizado:

- Editou a OP: a mesma Conta a Pagar é atualizada.
- Reprovou a OP: a Conta a Pagar é excluída.
- Quitou no PrimeStart: a OP baixa sozinha, pelo "OP: nº" na descrição.

## Escrita: classificação financeira automática

A natureza do pagamento é cadastrada uma vez no sistema, com o centro de custo ou receita. Centros e sub-centros (TCustomCentroCusto e TCustomSubCentroCusto) são lidos ao vivo da API, então o cadastro do ERP continua sendo a fonte da verdade. A classificação (TCustomClassificacaoPagtoRec) é gravada como objeto filho da Conta a Pagar, ligada pela referência PagamentoRecebimento.

Cada OP chega ao ERP com a classificação contábil certa, sem retrabalho do Financeiro. Se a natureza não tiver classificação, a conta é criada do mesmo jeito.

## Escrita: baixa automática de Contas a Pagar

1. O PIX é enviado pela integração com o Itaú: lote montado no sistema e aprovado no banco.
2. O Itaú confirma "Efetuado", consultado pela API do banco.
3. O sistema quita a conta no PrimeStart com a data do pagamento: `TCustomContaPagar.PodeMarcarQuitado` checa impedimentos e `TCustomContaPagar.MarcarComoQuitado` (parâmetro AData) quita.

Sem digitação manual, o ERP fica em dia com o que o banco de fato pagou. O formato foi acertado com o suporte da P2S em setembro de 2026.

## Escrita: devolução de locação e baixa da OS

Ao finalizar o Checklist de Carga (conferência do material na volta do evento), o sistema chama `EfetuaRetornoLocacao`, método do objeto gExpedicao (TCustomExpedicao). Todas as Fichas de Locação do evento são devolvidas no PrimeStart (status "F", data de devolução e saldo de estoque) e a Ordem de Serviço é baixada junto. Em produção desde agosto de 2026.

Atualizar o status da ficha direto não funciona, porque o servidor recalcula o campo. O método passa os itens de previsão de movimentação e a quantidade pendente que o próprio PrimeStart mantém.

## Conciliação PrimeStart × Itaú

Serve para contas lançadas só no PrimeStart e pagas direto no banco, fora do fluxo do sistema.

| Etapa | O que faz |
| --- | --- |
| Leitura | Lê ao vivo no PrimeStart as Contas a Pagar em aberto, consultadas por valor |
| Leitura | Cruza com os pagamentos efetivados no Itaú, inclusive os feitos fora do sistema |
| Escrita | Casa valor e favorecido; uma pessoa confirma a quitação (mesmo MarcarComoQuitado) |

## Monitoramento e ambientes

- **Log de cada chamada:** início, fim, volume e erro de toda sincronização, numa tela própria (Parâmetros → Log de Chamadas de API).
- **Teste de conexão:** valida host, porta e credenciais de cada ambiente com um clique.
- **Sandbox e Produção:** testes na Demo pública da P2S; produção com credenciais próprias.

O que aprendemos e virou padrão no cliente da API:

- O filtro por referência usa o número do oid como inteiro.
- Datas vão no formato serial do PrimeStart (dias desde 30/12/1899).
- Texto é enviado sem acentos em produção, por causa da codificação.
