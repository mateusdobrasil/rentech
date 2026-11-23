## Resumo

Recomendamos contratar a **Focus NFe, plano Start** (R$ 119,90/mês, até 3 CNPJs), com custo estimado de **R$ 180 a R$ 200 por mês** no nosso volume. Ela é a única opção com preço público completo que inclui NF-e, NFS-e e MDF-e em todos os planos, e o ambiente de homologação é gratuito.

A contratação depende de uma resposta da contabilidade. Com a reforma tributária, a **locação de bens móveis passou a gerar IBS/CBS e entrou na NFS-e**, o que pode mudar quais notas emitimos em cada locação. As perguntas estão na seção "Perguntas para a contabilidade".

## Contexto

O sistema próprio de locação vai substituir o PrimeStart (P2S), e as notas fiscais que o P2S emite hoje passam a sair por um emissor contratado via API. Hoje o P2S emite, para Rentech e Alfa Light:

- fatura/recibo de locação;
- NFS-e dos serviços (montagem, operação técnica, frete);
- NF-e de remessa e de retorno dos equipamentos;
- MDF-e (manifesto de carga).

O P2S segue como sistema oficial até a virada, então há tempo para validar as regras com a contabilidade e testar em homologação antes de emitir qualquer nota real. Pelo volume atual (cerca de 250 locações confirmadas por mês), a estimativa é de umas 850 notas mensais somando os quatro tipos.

## Comparativo de emissores

A Focus NFe é a melhor relação entre preço conhecido, cobertura de documentos e risco. Preços em reais por mês, consultados em novembro de 2026.

| Emissor | Preço de entrada | NF-e / NFS-e / MDF-e | Pontos de atenção |
| --- | --- | --- | --- |
| [Focus NFe](https://focusnfe.com.br/precos/) (recomendada) | Start R$ 119,90: 3 CNPJs, 100 notas por CNPJ, excedente R$ 0,11 por nota | Os três inclusos em todos os planos | Preço público completo; API REST em JSON; webhooks; homologação grátis; NFS-e Nacional e mais de 3.000 municípios |
| [PlugNotas (TecnoSpeed)](https://tecnospeed.com.br/en/plugdfe/plugnotas/) | Sob consulta; terceiros citam R$ 250 a R$ 500+ com possível fidelidade anual | Os três; MDF-e é módulo pago à parte | Muito usado por fabricantes de software; IBS/CBS já em homologação |
| [NFE.io](https://nfe.io/precos/emissao-nfse/) | NFS-e: R$ 190 para 250 notas; NF-e com preço à parte | Os três, em produtos separados | Forte em NFS-e; somar produtos encarece |
| Nuvem Fiscal | Não confirmado (site fora do ar na consulta) | MDF-e em plano pago | Cerca de 2.000 municípios, segundo terceiros |
| [Notaas](https://www.notaas.com.br/blog/post/comparativo-apis-emissao-nfe-nfse-nfce/) | Grátis até 20 notas; R$ 99 a R$ 249 | Os três | A mais barata, mas nova; o único comparativo que a favorece foi escrito por ela mesma |

**Custo estimado na Focus:** o Start inclui 300 notas (100 por CNPJ) e cobra R$ 0,11 por nota excedente. Com cerca de 850 notas por mês, são 550 excedentes (R$ 60,50), total perto de **R$ 180/mês**. Os 3 CNPJs cobrem Rentech, Alfa Light e o CNPJ "Elite", que no P2S também pertence à Alfa Light.

## Reforma tributária e a locação

A locação de bens móveis passou a gerar IBS e CBS (sem ISS) e ganhou um grupo próprio na NFS-e, ligado ao código de serviço 99.04.01 ([NotaGateway](https://notagateway.com.br/blog/nfs-e-nacional-passa-a-abranger-locacao-de-bens-moveis-e-imoveis/), [IOB](https://noticias.iob.com.br/reforma-tributaria-nfs-e-locacao/), [Ozai](https://www.ozai.com.br/obrigatoriedade-de-emissao-de-nfs-e-na-locacao-de-bens-moveis-e-imoveis/)). Na prática, a antiga fatura de locação pode ter que virar NFS-e.

Há divergência sobre São Paulo. Uma leitura diz que o contribuinte paulistano não precisa emitir nota municipal sobre locação de bens ([TAGD](https://tagdlaw.com.br/contribuinte-paulistano-nao-precisa-emitir-nota-sobre-locacao-de-bens/)). E a própria NFS-e paulistana está em transição:

- a prefeitura aderiu ao padrão nacional, mas manteve o sistema próprio (Nota Paulistana), já com os campos de IBS/CBS desde janeiro de 2026 ([Prefeitura SP](https://prefeitura.sp.gov.br/web/fazenda/w/nfs-e_orientacoes));
- em junho de 2026, anunciou a adoção gradual do emissor nacional ([EY](https://www.ey.com/content/dam/ey-unified-site/ey-com/pt-br/campaigns/reforma-tributaria/documents/ey-serie-reforma-tributaria-layouts-da-nfs-e-2026.pdf)).

A Focus NFe atende os dois caminhos (sistema municipal e emissor nacional). A escolha de qual usar, e para quais operações, é da contabilidade.

## Perguntas para a contabilidade

Precisamos dessas respostas, para cada CNPJ, antes de contratar o emissor e configurar as regras. A coluna de resposta pode ser preenchida aqui mesmo.

| # | Pergunta | Por que importa | Resposta |
| --- | --- | --- | --- |
| 1 | A locação de equipamentos deve sair em NFS-e com o código 99.04.01 e IBS/CBS? Em qual município e por qual sistema (Nota Paulistana ou emissor nacional)? | Define se a fatura de locação vira nota fiscal |  |
| 2 | Montagem, operação técnica e frete saem em NFS-e com ISS? Quais códigos de serviço e alíquotas? | Configura a nota dos serviços cobrados à parte |  |
| 3 | Quando emitir NF-e de remessa e de retorno dos equipamentos, e com quais CFOPs (5.949/1.949 ou outros)? | Acompanha o transporte até o evento e a volta |  |
| 4 | Em quais entregas o MDF-e é obrigatório (veículo próprio, mais de uma NF-e, entre estados)? | Define quando o sistema gera o manifesto |  |
| 5 | Qual o regime tributário de cada CNPJ (Rentech, Alfa Light, Elite)? | Muda tributos e campos de todas as notas |  |
| 6 | Avarias e indenizações cobradas do cliente exigem nota? Qual? | Hoje entram como título a receber, sem nota |  |
| 7 | Na transição de 2026, os campos de IBS/CBS já devem ser preenchidos ou ainda são facultativos? | Define o que o emissor envia desde a primeira nota |  |

## Próximos passos

Nenhuma nota real será emitida antes da virada: tudo roda em homologação até lá.

- [ ] Contabilidade: responder as 7 perguntas acima.
- [ ] Sócios: aprovar a contratação da Focus NFe, plano Start (estimativa de R$ 180/mês).
- [ ] Empresa: abrir a conta de homologação na Focus NFe (gratuita) e repassar o token de homologação.
- [ ] Empresa: confirmar se o certificado A1 já usado na consulta de multas é o e-CNPJ de cada empresa; se não, providenciar um A1 por CNPJ.
- [ ] Desenvolvimento: integrar a emissão (a partir da ficha de locação, cancelamento, PDF/XML arquivados, retorno automático) seguindo as regras da contabilidade.
- [ ] Contabilidade + empresa: conferir as primeiras notas em homologação antes de liberar produção.

## Fontes

Consultadas em novembro de 2026. Preços de PlugNotas e Nuvem Fiscal não são públicos; os valores citados vêm de terceiros e devem ser confirmados com o comercial de cada um.

- [Focus NFe — preços](https://focusnfe.com.br/precos/)
- [Focus NFe — NFS-e Nacional](https://focusnfe.com.br/produtos/nfse-nacional/)
- [TecnoSpeed — PlugNotas](https://tecnospeed.com.br/en/plugdfe/plugnotas/)
- [NFE.io — preços de NFS-e](https://nfe.io/precos/emissao-nfse/)
- [Notaas — comparativo de APIs de emissão](https://www.notaas.com.br/blog/post/comparativo-apis-emissao-nfe-nfse-nfce/)
- [NotaGateway — NFS-e Nacional passa a abranger locação de bens](https://notagateway.com.br/blog/nfs-e-nacional-passa-a-abranger-locacao-de-bens-moveis-e-imoveis/)
- [IOB — reforma tributária, NFS-e e locação](https://noticias.iob.com.br/reforma-tributaria-nfs-e-locacao/)
- [Ozai — obrigatoriedade de NFS-e na locação de bens](https://www.ozai.com.br/obrigatoriedade-de-emissao-de-nfs-e-na-locacao-de-bens-moveis-e-imoveis/)
- [TAGD — contribuinte paulistano e nota sobre locação](https://tagdlaw.com.br/contribuinte-paulistano-nao-precisa-emitir-nota-sobre-locacao-de-bens/)
- [Prefeitura de São Paulo — orientações NFS-e](https://prefeitura.sp.gov.br/web/fazenda/w/nfs-e_orientacoes)
- [EY — layouts da NFS-e 2026](https://www.ey.com/content/dam/ey-unified-site/ey-com/pt-br/campaigns/reforma-tributaria/documents/ey-serie-reforma-tributaria-layouts-da-nfs-e-2026.pdf)
