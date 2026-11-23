O inventário compara o que está fisicamente no depósito com o que o sistema diz ter e, ao concluir, corrige o estoque. Ele fica em **Estoque → Inventário** (`/admin/estoque/inventario`).

## Antes de começar

O processo tem cinco passos: abrir, contar os produtos por quantidade, ler os patrimônios, conferir as divergências e concluir. Até concluir, nada muda no estoque.

- **Quem pode usar:** Administrador, Diretoria, Gerência, Estoque e Operacional.
- **Quando usar:** no inventário completo da virada do P2S e em contagens parciais (um local ou algumas categorias).
- **O que está com cliente não é contado.** Na abertura, o sistema anota o que está em locação naquele momento. No depósito, espera-se encontrar o saldo menos o que está em locação.
- **Dois tipos de produto:** os de **quantidade** (cabos, estruturas etc.), em que se digita quantos há, e os de **patrimônio** (cada peça tem QR ou número), em que se lê peça por peça.
- **Fase paralela com o P2S:** enquanto o P2S for o sistema oficial, a carga "Carregar saldos do P2S" (em Equipamentos de Locação) sobrescreve o local PRINCIPAL. O inventário vale de vez na virada.
- **Concluir não tem volta pela tela.** Faça os testes num inventário e **cancele** em vez de concluir.

## Passo 1 — Abrir o inventário

Abra o inventário no momento em que a contagem vai começar: nessa hora o sistema tira uma "foto" do estoque, e é contra ela que a contagem será comparada.

1. Clique em **+ Novo inventário**.
2. Preencha:
   - **Nome:** já vem sugerido (ex.: "Inventário nov de 2026"); troque se quiser identificar melhor (ex.: "Contagem painéis LED").
   - **Empresa:** Rentech ou AlfaLight. Cada inventário é de uma empresa só.
   - **Local (opcional):** deixe em **Todos os locais** para contar a empresa inteira, ou escolha um local específico.
   - **Categorias (vazio = todas):** para uma contagem parcial, marque só as categorias que serão contadas.
3. Confirme. Aparece a mensagem "Inventário aberto — saldos do sistema congelados".

A partir daqui, para cada produto, ficam guardados o saldo do sistema, o que está em manutenção e o que está em locação. Movimentações feitas depois da abertura não entram na conta: evite expedir ou receber material enquanto conta.

## Passo 2 — Contar os produtos por quantidade

Na aba **Contar**, digite quantas unidades de cada produto estão no depósito. O valor fica gravado na hora, com quem contou e quando.

1. Abra o inventário na lista e vá à aba **🔢 Contar**.
2. Encontre o produto pela busca (nome ou código) ou pelo filtro de categoria.
3. Digite a quantidade encontrada no campo **qtd**.
4. Use o filtro **Não contados** para ver o que ainda falta.

- **Contagem cega (vem ligada):** esconde quanto o sistema espera de cada produto, para não influenciar quem conta. Desmarque só na hora de conferir.
- **Produto que não existe no depósito:** digite **0**. Produto deixado em branco conta como "não contado" e não é alterado ao concluir.
- **Produtos de patrimônio** não têm campo de quantidade: mostram "lida(s) · ler QR" e são contados no passo 3.
- Várias pessoas podem contar ao mesmo tempo, cada uma no seu celular ou computador, dividindo por categoria.

## Passo 3 — Ler os patrimônios

Na aba **📷 Patrimônios**, leia a etiqueta de cada peça encontrada. A contagem desses produtos é o número de peças lidas.

1. Vá à aba **📷 Patrimônios**.
2. Leia a etiqueta de um destes jeitos:
   - **Leitor USB ou Bluetooth:** aponte para a etiqueta; ele digita o código e dá Enter sozinho.
   - **Câmera do celular** (Chrome no Android): toque em **📷 Câmera** e aponte para o QR.
   - **À mão:** digite o número do patrimônio e aperte Enter.
3. Confira o bipe e a mensagem: bipe curto e mensagem verde = lido; bipe longo e mensagem amarela ou vermelha = aviso ou erro.
4. Leu errado? Clique em **desfazer** na leitura.

| O que aparece | O que significa |
| --- | --- |
| ✔ número — produto | Peça encontrada e contada. |
| "já foi contado neste inventário" | Essa peça já foi lida (aparece quem leu). Não conta duas vezes. |
| "não é de nenhum patrimônio cadastrado" | Etiqueta desconhecida. Fica anotada; cadastre a peça em Equipamentos de Locação. |
| "estava EXTRAVIADO: volta a ativo ao concluir" | A peça tinha sumido e foi achada. |
| "está BAIXADO" | Peça dada como baixa no cadastro. Verifique com o responsável. |

Peça de um produto fora das categorias escolhidas também é aceita: o produto entra no inventário como "fora do escopo, achado na leitura".

## Passo 4 — Conferir as divergências

Antes de concluir, revise a aba **⚠ Divergências** e reconte o que parecer estranho: o que estiver aqui vai virar ajuste de estoque.

1. Veja os quatro números do topo: **Produtos com falta**, **Produtos com sobra**, **Diferença em valor (reposição)** e **Ainda não contados**.
2. Marque **Só com diferença** para ver apenas o que não bateu. A lista vem com as maiores diferenças em valor primeiro.
3. Para cada linha, compare **Esperado** (saldo menos em locação) com **Contado**. Diferença negativa (vermelha) = falta; positiva (azul) = sobra.
4. Confira as duas listas de baixo:
   - **Patrimônios não lidos:** peças que deveriam estar no depósito e não foram lidas. Se o produto tem peças em locação, parte pode estar com cliente; as marcadas "em manutenção" podem estar no conserto.
   - **Códigos desconhecidos:** etiquetas lidas sem cadastro. Cadastre em Equipamentos de Locação.
5. Reconte o que precisar: volte à aba **Contar** ou **Patrimônios** e corrija.
6. Para guardar o resultado, clique em **⬇ Excel**: a planilha tem, por produto, saldo do sistema, em locação, esperado no depósito e contado.

## Passo 5 — Concluir e aplicar

Concluir é o passo que muda o estoque de verdade e não tem volta pela tela. Só conclua depois de conferir as divergências.

1. Clique em **✔ Concluir e aplicar**.
2. Leia o resumo da janela: quantos produtos foram contados, quantos não foram e quantos patrimônios ficaram sem leitura.
3. Decida a caixa **Marcar como EXTRAVIADO** (explicada abaixo).
4. Confirme. Aparece "Inventário concluído" com quantos saldos foram ajustados, e o inventário passa a ser só de consulta.

| Situação | O que acontece ao concluir |
| --- | --- |
| Produto de quantidade contado | Saldo novo = contado + em locação. Sem local escolhido, o ajuste vai para o local PRINCIPAL. |
| Produto não contado (em branco) | Fica como está. |
| Patrimônio lido que estava EXTRAVIADO | Volta a ATIVO. |
| Patrimônio ativo não lido, com a caixa marcada | Vira EXTRAVIADO, exceto os de produtos com peças em locação (podem estar com cliente) e os em manutenção (podem estar no conserto). |
| Patrimônio não lido, com a caixa desmarcada | Fica como está. |

Na dúvida sobre os extraviados, deixe a caixa desmarcada: dá para procurar as peças e fazer um novo inventário só daquelas categorias.

## Cancelar, erros comuns e dicas

**Cancelar** encerra o inventário sem mexer em nada no estoque: use em testes, em contagens interrompidas ou quando a contagem saiu errada e vai ser refeita. Depois de cancelado ou concluído, o inventário fica só para consulta.

| Problema | O que fazer |
| --- | --- |
| Digitei a quantidade errada | Corrija no mesmo campo, enquanto o inventário estiver aberto. |
| Li a peça errada | Clique em **desfazer** na leitura. |
| A câmera não aparece | Use o Chrome no Android, um leitor USB/Bluetooth ou digite o número. |
| Muitos patrimônios não lidos | Confira se estão com cliente, no conserto ou em outro local antes de marcar como extraviados. |
| Concluí um teste sem querer | Avise o administrador do sistema: o ajuste só é desfeito direto no banco. |

**Dicas para o inventário completo da virada do P2S:**

- Combine um horário sem expedição nem retorno de material, e abra o inventário só quando a equipe estiver pronta para contar.
- Divida a equipe por categorias ou corredores, cada um no seu celular, todos no mesmo inventário.
- Deixe a **Contagem cega** ligada durante a contagem; desligue só na conferência.
- Antes de concluir, exporte o **Excel** e guarde: é o registro do inventário.
- Depois da virada, o P2S deixa de sobrescrever os saldos e o inventário passa a valer de vez.
