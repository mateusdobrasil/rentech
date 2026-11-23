## A regra que não pode falhar

O inventário da virada é feito **depois de migrar as OS** (Passo 3 da Virada da chave) e **antes de concluir** (Passo 6). Na tela da virada ele é o **Passo 4 — Inventário da virada**, e a virada não conclui sem ele.

O motivo é a conta que o inventário faz ao concluir:

| O que o sistema faz | Quando |
| --- | --- |
| Tira a "foto" do estoque e do que está **em locação** | Ao abrir o inventário |
| Calcula o esperado no depósito = saldo − em locação | Durante a contagem |
| Grava o saldo novo = **contado no depósito + em locação** | Ao concluir |

Antes da migração, o que está com cliente pelo P2S **não aparece** como "em locação" no sistema. Um inventário aberto antes disso tiraria do estoque tudo o que está na rua.

## Antes do dia (preparação)

- [ ] **Data e horário combinados**, sem saída nem devolução de material durante a contagem. Quanto menos material na rua, mais rápido.
- [ ] **Equipes definidas** por categoria ou corredor, cada pessoa com o celular logado no sistema. Leitores USB ou Bluetooth carregados.
- [ ] **Equipamentos conferidos** em Estoque → Equipamentos de Locação: controle certo (por quantidade ou por patrimônio) e valor de indenização ou custo de reposição preenchido.
- [ ] **Patrimônios cadastrados e etiquetados** (QR) nos produtos controlados por patrimônio. Imprima as etiquetas que faltarem.
- [ ] **Produto sem cadastro** (comprado depois, nunca lançado): cadastre em Estoque → Produtos antes do dia.
- [ ] **Material de parceiros** (sublocação) separado e identificado: não é nosso e não entra na contagem.
- [ ] **Material no conserto fora da empresa**: faça uma lista. Ele é nosso e entra na contagem.
- [ ] **Limpar o ensaio** feito no Passo 1 da Virada da chave.

## No dia, passo a passo

1. **Última leitura do P2S** — Virada da chave, Passo 1: rode as quatro leituras (fichas de reserva, fichas de locação, contas a receber, contas a pagar).
2. **Congelar o P2S** — Passo 2. A partir daqui, nada novo é lançado no P2S.
3. **Migrar as OS em andamento** — Passo 3. Antes de migrar, confira na prévia a coluna **Na rua**: ela tem que bater com o que a equipe sabe que está com clientes.
4. **Abrir o inventário** — Estoque → Inventário → **+ Novo inventário**:
    - **Nome:** "Inventário da virada — Rentech" (ou Alfa Light);
    - **Empresa:** a que está virando. Cada empresa tem o seu inventário;
    - **Local:** **Todos os locais**;
    - **Categorias:** **nenhuma marcada** (todas).

    Inventário parcial (um local ou algumas categorias) não vale para a virada.
5. **Contar** — aba **Contar** para os produtos por quantidade (digite 0 para o que não existe) e aba **Patrimônios** para ler as etiquetas. Deixe a **Contagem cega** ligada.
6. **Conferir as divergências** — aba **Divergências**: reconte as maiores diferenças em valor primeiro. Patrimônio não lido pode estar com cliente (produto com peças em locação) ou no conserto.
7. **Exportar o Excel** e guardar: é o registro oficial da contagem da virada.
8. **Concluir e aplicar.** Na primeira vez, deixe **desmarcado** "Marcar como EXTRAVIADO"; procure as peças que faltaram e, se não aparecerem, faça um inventário parcial só daquelas categorias.
9. **Voltar à Virada da chave**: o Passo 4 fica verde. Siga para o Passo 5 (contas em aberto) e o Passo 6 (concluir).

## Durante a contagem

- **Nada sai nem volta** entre abrir e concluir o inventário: o "em locação" foi fotografado na abertura. Se uma saída ou devolução for inevitável, termine antes a contagem daquele produto e registre a movimentação só depois de concluir.
- **Várias pessoas ao mesmo tempo** no mesmo inventário, cada uma na sua categoria.
- **Errou a quantidade?** Corrija no mesmo campo. **Leu a peça errada?** Clique em desfazer.
- **Etiqueta desconhecida:** fica anotada. Cadastre o patrimônio em Equipamentos de Locação.

## O que muda depois

- O saldo de cada produto passa a ser o contado no depósito mais o que está em locação.
- **Carregar saldos do P2S** (Equipamentos de Locação) fica bloqueado para a empresa que virou: o P2S não sobrescreve mais o estoque.
- A agenda de disponibilidade passa a usar só o estoque e as reservas do sistema.

## Problemas comuns

| Situação | O que fazer |
| --- | --- |
| Abri o inventário antes de migrar as OS | Cancele e abra outro depois do Passo 3. A tela da virada avisa. |
| A prévia da migração mostra menos "na rua" do que a equipe sabe | Rode de novo a leitura "Fichas de locação" no Passo 1 (antes de congelar) ou confira as OS com aviso na tabela da prévia. |
| A contagem foi interrompida | O inventário continua aberto: retome depois. Se a contagem ficou comprometida, cancele e recomece. |
| Concluí com um erro grande | Avise o administrador do sistema: o ajuste só é desfeito direto no banco. |
| Rentech e Alfa Light viram no mesmo dia | Faça um inventário para cada empresa, depois da migração das OS de cada uma. |
