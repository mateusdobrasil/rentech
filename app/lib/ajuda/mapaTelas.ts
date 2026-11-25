// GERADO por scripts/gerar-mapa-telas.mts (npm run manuais) — não editar à mão.
// Caminho de menu de cada tela, tirado dos cards do Painel e dos hubs.
export interface TelaMapa { rota: string; caminho: string; descricao: string }
export const MAPA_TELAS: TelaMapa[] = [
  {
    "rota": "/admin/freelance",
    "caminho": "Painel → Banco de Talentos",
    "descricao": "Acesso à lista de colaboradores Freelance, especialidades e chaves PIX."
  },
  {
    "rota": "/admin/comercial",
    "caminho": "Painel → Comercial",
    "descricao": "Documentos da empresa e da frota, parceiros e cadastro de eventos/feiras."
  },
  {
    "rota": "/admin/comercial/carteira",
    "caminho": "Painel → Comercial → Carteira de Clientes",
    "descricao": "Vendedor responsável por cliente. O vendedor padrão só vê as fichas dos clientes da carteira dele."
  },
  {
    "rota": "/admin/comercial/comissoes",
    "caminho": "Painel → Comercial → Comissões de Vendas",
    "descricao": "Comissão por vendedor sobre o que o cliente pagou (locação e serviços), fechamento mensal e % de cada vendedor."
  },
  {
    "rota": "/admin/comercial/documentos",
    "caminho": "Painel → Comercial → Documentos da Empresa",
    "descricao": "Consulte e baixe certidões, cartão CNPJ, contrato social e demais documentos da Rentech."
  },
  {
    "rota": "/admin/comercial/frota",
    "caminho": "Painel → Comercial → Documentos da Frota",
    "descricao": "Ficha dos veículos e documentos dos veículos da empresa."
  },
  {
    "rota": "/admin/comercial/eventos-feiras",
    "caminho": "Painel → Comercial → Eventos/Feiras",
    "descricao": "Cadastro de eventos e feiras com local padrão, usado para localizar o calendário operacional."
  },
  {
    "rota": "/admin/comercial/parceiros",
    "caminho": "Painel → Comercial → Parceiros",
    "descricao": "Cadastro de clientes, fornecedores e colaboradores sincronizado direto do PrimeStart (P2S)."
  },
  {
    "rota": "/admin/diretoria",
    "caminho": "Painel → Diretor (IA)",
    "descricao": "Relatório diário de cada empresa: recebimentos, pagamentos, locações, expedição, frota, RH e o que pede atenção."
  },
  {
    "rota": "/admin/estoque",
    "caminho": "Painel → Estoque",
    "descricao": "Controle de estoque, expedição, produtos e marcas."
  },
  {
    "rota": "/admin/estoque/manutencao",
    "caminho": "Painel → Estoque → Avarias e Manutenção",
    "descricao": "OS de manutenção (interna ou fornecedor) com custo e prazo, avarias com fotos e cobrança do cliente."
  },
  {
    "rota": "/admin/estoque/controle",
    "caminho": "Painel → Estoque → Controle de Estoque",
    "descricao": "Gestão de entrada, saída e manutenção de equipamentos cadastrados."
  },
  {
    "rota": "/admin/estoque/equipamentos",
    "caminho": "Painel → Estoque → Equipamentos de Locação",
    "descricao": "Controle por patrimônio ou quantidade, saldos por empresa, patrimônios com etiqueta QR, kits e carga de saldos do P2S."
  },
  {
    "rota": "/admin/estoque/expedicao",
    "caminho": "Painel → Estoque → Expedição",
    "descricao": "Saída e retorno de equipamentos por evento, vinculado às fichas de reserva."
  },
  {
    "rota": "/admin/estoque/inventario",
    "caminho": "Painel → Estoque → Inventário",
    "descricao": "Contagem geral ou parcial do estoque (quantidade e QR por patrimônio), divergências em valor e ajuste dos saldos."
  },
  {
    "rota": "/admin/estoque/marcas",
    "caminho": "Painel → Estoque → Marcas",
    "descricao": "Marcas dos produtos sincronizados do PrimeStart, agrupadas com a contagem de itens de cada uma."
  },
  {
    "rota": "/admin/estoque/produtos",
    "caminho": "Painel → Estoque → Produtos",
    "descricao": "Catálogo de produtos sincronizado direto do PrimeStart (P2S) — todos os atributos, preços por tabela e estoque por local."
  },
  {
    "rota": "/admin/financeiro",
    "caminho": "Painel → Financeiro",
    "descricao": "Lotes de pagamento, Ordens de Pagamento, Consignado, contas a pagar e integração bancária."
  },
  {
    "rota": "/admin/financeiro/caixa",
    "caminho": "Painel → Financeiro → Caixa e Bancos",
    "descricao": "Contas financeiras com saldo do dia, extrato, transferências e lançamentos avulsos. Na transição, os pagamentos e recebimentos do P2S entram sozinhos."
  },
  {
    "rota": "/admin/financeiro/conciliacao",
    "caminho": "Painel → Financeiro → Conciliação Bancária",
    "descricao": "Importe o extrato OFX do banco: o que bate com o sistema concilia sozinho; o resto você casa (inclusive lote SISPAG com vários pagamentos), lança ou ignora."
  },
  {
    "rota": "/admin/financeiro/contas-pagar",
    "caminho": "Painel → Financeiro → Contas a Pagar",
    "descricao": "Contas a pagar da locadora sincronizadas direto do PrimeStart (P2S) — em aberto, vencidas e quitadas."
  },
  {
    "rota": "/admin/financeiro/titulos-pagar",
    "caminho": "Painel → Financeiro → Contas a Pagar (Sistema)",
    "descricao": "Contas lançadas (boletos, impostos, fornecedores), recorrentes (aluguel, luz, internet) e as OPs — pagamento, parcelas e a virada da chave do P2S."
  },
  {
    "rota": "/admin/financeiro/contas-receber",
    "caminho": "Painel → Financeiro → Contas a Receber",
    "descricao": "Títulos a receber sincronizados do PrimeStart (P2S) — a vencer, inadimplência por empresa e recebidos."
  },
  {
    "rota": "/admin/financeiro/consignado",
    "caminho": "Painel → Financeiro → Crédito Consignado",
    "descricao": "Gestão de Empréstimos Consignados no GOV.BR."
  },
  {
    "rota": "/admin/financeiro/faturamento",
    "caminho": "Painel → Financeiro → Faturamento",
    "descricao": "Notas de Débito das locações devolvidas: fila a faturar, emissão individual ou em lote, parcelas e envio por e-mail, WhatsApp e Portal do Cliente."
  },
  {
    "rota": "/admin/financeiro/fiscal",
    "caminho": "Painel → Financeiro → Fiscal (NF-e / NFS-e)",
    "descricao": "Notas fiscais pela Focus NFe: NFS-e de serviço ou de locação sob pedido, NF-e de remessa/retorno de equipamento e de venda. DANFE, XML, cancelamento e carta de correção."
  },
  {
    "rota": "/admin/financeiro/fluxo",
    "caminho": "Painel → Financeiro → Fluxo de Caixa e DRE",
    "descricao": "Saldo projetado (realizado × previsto a pagar/receber) por dia, semana ou mês e DRE gerencial pelo plano de contas, em caixa ou competência."
  },
  {
    "rota": "/admin/financeiro/integracao",
    "caminho": "Painel → Financeiro → Integração Bancária",
    "descricao": "Consulta direta às APIs dos bancos integrados (Itaú SISPAG) para conciliação."
  },
  {
    "rota": "/admin/financeiro/rh",
    "caminho": "Painel → Financeiro → Lotes de Pagamento",
    "descricao": "Lotes de pagamento, OCR de comprovantes e arquivos bancários (CNAB)."
  },
  {
    "rota": "/admin/financeiro/ops",
    "caminho": "Painel → Financeiro → Ordens de Pagamento",
    "descricao": "Painel geral para aprovação, baixa e conferência de todas as Ordens de Pagamento."
  },
  {
    "rota": "/admin/financeiro/relatorios",
    "caminho": "Painel → Financeiro → Relatórios e Dashboard",
    "descricao": "OPs, Lotes de Pagamento e Consignado consolidados para decisão e auditoria."
  },
  {
    "rota": "/admin/financeiro/titulos-receber",
    "caminho": "Painel → Financeiro → Títulos a Receber (Locação)",
    "descricao": "Títulos das fichas de reserva (parcelas), das avarias cobradas e avulsos — baixa, vencidos e recebido no mês. Ensaio enquanto o P2S for oficial."
  },
  {
    "rota": "/admin/locacoes",
    "caminho": "Painel → Locações",
    "descricao": "Fichas de reserva e de locação: orçamentos, reservas, disponibilidade de equipamentos e tabelas de preço."
  },
  {
    "rota": "/admin/locacoes/agenda",
    "caminho": "Painel → Locações → Agenda de Disponibilidade",
    "descricao": "Calendário por equipamento: quanto sobra livre em cada dia, com as reservas do P2S e as daqui, e as faltas em destaque."
  },
  {
    "rota": "/admin/locacoes/fichas-locacao",
    "caminho": "Painel → Locações → Fichas de Locação",
    "descricao": "Saídas e devoluções das OSs, trocas, extravios, prorrogação e complemento — com a OS assinada pelo cliente na tela. Inclui o histórico do P2S."
  },
  {
    "rota": "/admin/locacoes/fichas-reserva",
    "caminho": "Painel → Locações → Fichas de Reserva (P2S)",
    "descricao": "Consulta, importação e sincronização das fichas de reserva do PrimeStart (P2S), vinculadas aos eventos e feiras."
  },
  {
    "rota": "/admin/locacoes/indicadores",
    "caminho": "Painel → Locações → Indicadores de Utilização",
    "descricao": "Taxa de utilização, ociosidade, receita e retorno sobre o valor do estoque por equipamento — o que comprar e o que está parado."
  },
  {
    "rota": "/admin/locacoes/reservas",
    "caminho": "Painel → Locações → Orçamentos e Reservas",
    "descricao": "Fichas de reserva próprias: orçamento com preço pela tabela, checagem de disponibilidade e reserva dos equipamentos."
  },
  {
    "rota": "/admin/locacoes/sublocacoes",
    "caminho": "Painel → Locações → Sublocação",
    "descricao": "Equipamento de parceiros quando falta no estoque: pedido, entrada e devolução, avaria, pagamento por OP, margem e ranking de parceiros."
  },
  {
    "rota": "/admin/locacoes/tabelas-preco",
    "caminho": "Painel → Locações → Tabelas de Preço",
    "descricao": "Preços de locação por faixa de dias (1, 3, 5…), diária extra e mensal — tabelas padrão, por cliente e por evento, com vigência."
  },
  {
    "rota": "/admin/manuais",
    "caminho": "Painel → Manuais",
    "descricao": "Manuais do sistema com as telas reais: locação, inventário, suporte, Diretor (IA), ponto e roteiros de teste."
  },
  {
    "rota": "/admin/operacional",
    "caminho": "Painel → Operacional",
    "descricao": "Controle de frota, documentos de veículos, relatórios operacionais e registro de ponto."
  },
  {
    "rota": "/admin/operacional/frota",
    "caminho": "Painel → Operacional → Controle de Frota",
    "descricao": "Ficha dos veículos, documentos, seguros, vencimentos e manutenções."
  },
  {
    "rota": "/admin/operacional/escala",
    "caminho": "Painel → Operacional → Escala de Trabalho",
    "descricao": "Monta a escala diária dos colaboradores por local e horário de chegada."
  },
  {
    "rota": "/admin/operacional/multas",
    "caminho": "Painel → Operacional → Multas e Débitos",
    "descricao": "Multas, IPVA e licenciamento da frota consultados no Detran-SP, condutor, desconto em folha e OP."
  },
  {
    "rota": "/admin/operacional/registro-ponto",
    "caminho": "Painel → Operacional → Registro de Ponto",
    "descricao": "Consulta (somente leitura) se cada colaborador já registrou o ponto do dia."
  },
  {
    "rota": "/admin/operacional/relatorios",
    "caminho": "Painel → Operacional → Relatórios Operacionais",
    "descricao": "Relatório completo da frota e controle de estoque, com indicadores e gráficos."
  },
  {
    "rota": "/admin/op",
    "caminho": "Painel → Ordens de Pagamentos",
    "descricao": "Solicite novas Ordens de Pagamento, acompanhe as suas e gerencie assinaturas de contratos."
  },
  {
    "rota": "/admin/op/assinaturas",
    "caminho": "Painel → Ordens de Pagamentos → Gestão de Assinaturas",
    "descricao": "Gestão de Assinaturas de contratos e documentos."
  },
  {
    "rota": "/admin/op/responsavel",
    "caminho": "Painel → Ordens de Pagamentos → Minhas OPs",
    "descricao": "Acompanhe o status ou edite as Ordens de Pagamento solicitadas por você."
  },
  {
    "rota": "/admin/op/naturezas",
    "caminho": "Painel → Ordens de Pagamentos → Natureza & Classificação Financeira",
    "descricao": "Naturezas de pagamento disponíveis na Nova OP e a Classificação Financeira enviada ao PrimeStart."
  },
  {
    "rota": "/admin/op/nova",
    "caminho": "Painel → Ordens de Pagamentos → Solicitar Nova OP",
    "descricao": "Preencha o formulário para enviar um pagamento para análise da diretoria."
  },
  {
    "rota": "/admin/parametros",
    "caminho": "Painel → Parâmetros",
    "descricao": "Controle de acesso, conteúdo do site, integrações, agendamentos, empresas do grupo e log de auditoria."
  },
  {
    "rota": "/admin/parametros/agendamentos",
    "caminho": "Painel → Parâmetros → Agendamentos e Disparos",
    "descricao": "Automações de lembretes e rotinas diárias via WhatsApp e e-mail."
  },
  {
    "rota": "/admin/parametros/empresas",
    "caminho": "Painel → Parâmetros → Cadastro de Empresas",
    "descricao": "Empresas do Grupo Rentech (CNPJs) usadas para vincular funcionários e restringir acesso."
  },
  {
    "rota": "/admin/parametros/conteudo",
    "caminho": "Painel → Parâmetros → Conteúdo do Site",
    "descricao": "Textos, imagens e vídeos do site institucional exibidos em tempo real."
  },
  {
    "rota": "/admin/parametros/permissoes",
    "caminho": "Painel → Parâmetros → Controle de Acesso e Diretórios",
    "descricao": "Usuários, setores de permissão e mapeamento de rotas protegidas do sistema."
  },
  {
    "rota": "/admin/parametros/historico-p2s",
    "caminho": "Painel → Parâmetros → Histórico do P2S",
    "descricao": "Importação de todo o histórico de locações e financeiro do PrimeStart, mês a mês, com o progresso."
  },
  {
    "rota": "/admin/parametros/integracao",
    "caminho": "Painel → Parâmetros → Integrações",
    "descricao": "Bancos e parceiros para pagamentos, assinaturas e envio de informações."
  },
  {
    "rota": "/admin/parametros/log",
    "caminho": "Painel → Parâmetros → Log de Auditoria",
    "descricao": "Histórico completo de ações realizadas no sistema: acessos, edições e alterações."
  },
  {
    "rota": "/admin/parametros/virada",
    "caminho": "Painel → Parâmetros → Virada da Chave",
    "descricao": "Tira o P2S de cena empresa por empresa: congela a integração, migra as OS em andamento e as contas em aberto e liga o Financeiro e o Faturamento oficiais."
  },
  {
    "rota": "/admin/downloads",
    "caminho": "Painel → Portal de Downloads",
    "descricao": "Faça upload e gerencie os arquivos, softwares e manuais públicos da Rentech."
  },
  {
    "rota": "/admin/relatorios",
    "caminho": "Painel → Relatórios",
    "descricao": "Vendas, conversão de orçamentos, financeiro e equipamentos — por período e empresa, com Excel e PDF."
  },
  {
    "rota": "/admin/relatorios/avarias",
    "caminho": "Painel → Relatórios → Avarias e Extravios",
    "descricao": "Ocorrências, custo de reposição e cobrado × recebido × perdoado, por cliente e equipamento."
  },
  {
    "rota": "/admin/relatorios/clientes",
    "caminho": "Painel → Relatórios → Clientes (Curva ABC)",
    "descricao": "Ranking por receita (classes A, B e C), ticket, clientes novos, recompra e quem parou de alugar."
  },
  {
    "rota": "/admin/relatorios/comissao",
    "caminho": "Painel → Relatórios → Comissão de Vendedores",
    "descricao": "Vendido × recebido e a comissão de cada vendedor (fechada e em aberto), pela regra de Comissões."
  },
  {
    "rota": "/admin/relatorios/equipamentos",
    "caminho": "Painel → Relatórios → Equipamentos e Operação",
    "descricao": "Mais e menos alugados, receita por equipamento e categoria, saídas e devoluções, devoluções atrasadas."
  },
  {
    "rota": "/admin/relatorios/eventos",
    "caminho": "Painel → Relatórios → Eventos e Feiras",
    "descricao": "Receita, OS e clientes por evento, comparando com a edição anterior."
  },
  {
    "rota": "/admin/relatorios/faturamento",
    "caminho": "Painel → Relatórios → Faturamento",
    "descricao": "Notas de Débito emitidas, o que falta faturar e o prazo da devolução até a nota."
  },
  {
    "rota": "/admin/relatorios/financeiro",
    "caminho": "Painel → Relatórios → Financeiro",
    "descricao": "Recebido × pago por mês, a receber e a pagar, inadimplência por idade, maiores devedores e despesas por categoria."
  },
  {
    "rota": "/admin/relatorios/notas-fiscais",
    "caminho": "Painel → Relatórios → Notas Fiscais",
    "descricao": "NF-e e NFS-e emitidas por tipo e período: autorizadas, canceladas e com erro."
  },
  {
    "rota": "/admin/relatorios/ocupacao",
    "caminho": "Painel → Relatórios → Ocupação e Retorno",
    "descricao": "Ocupação do estoque por equipamento e categoria, o que ficou parado e a receita sobre o valor do bem."
  },
  {
    "rota": "/admin/relatorios/orcamentos",
    "caminho": "Painel → Relatórios → Orçamentos e Conversão",
    "descricao": "Emitidos × aprovados × perdidos, taxa de conversão por vendedor, prazo até aprovar, motivos de perda e orçamentos em aberto."
  },
  {
    "rota": "/admin/relatorios/sublocacao",
    "caminho": "Painel → Relatórios → Sublocação",
    "descricao": "Custo com parceiros, margem na OS, avarias de parceiro e o que mais faltou."
  },
  {
    "rota": "/admin/relatorios/vendas",
    "caminho": "Painel → Relatórios → Vendas",
    "descricao": "Locações confirmadas por período, vendedor, cliente e evento; ticket médio e comparação com o ano anterior."
  },
  {
    "rota": "/admin/academy",
    "caminho": "Painel → Rentech Academy",
    "descricao": "Gerencie os artigos de dicas técnicas de TV, LED, som e luz publicados em /academy."
  },
  {
    "rota": "/admin/rh",
    "caminho": "Painel → RH",
    "descricao": "Funcionários, holerites, ponto, benefícios, documentos, férias, rescisões e relatórios de RH."
  },
  {
    "rota": "/admin/rh/ponto",
    "caminho": "Painel → RH → Controle de Ponto",
    "descricao": "Importação de registros, cálculo de horas extras e espelhos."
  },
  {
    "rota": "/admin/rh/ferias-afastamentos",
    "caminho": "Painel → RH → Férias e Afastamentos",
    "descricao": "Prazos de férias por período aquisitivo e controle de atestados/licenças."
  },
  {
    "rota": "/admin/rh/assinaturas",
    "caminho": "Painel → RH → Gestão de Assinaturas",
    "descricao": "Gestão de Assinaturas de contratos e documentos."
  },
  {
    "rota": "/admin/rh/beneficios",
    "caminho": "Painel → RH → Gestão de Benefícios",
    "descricao": "Transporte, refeição, alimentação e outros benefícios."
  },
  {
    "rota": "/admin/rh/documentos",
    "caminho": "Painel → RH → Gestão de Documentos",
    "descricao": "Gestão de RG, CPF, CTPS, comprovante de residência, contrato, ASO admissional/periódico, CNH, certificados, advertência e outros"
  },
  {
    "rota": "/admin/rh/funcionario",
    "caminho": "Painel → RH → Gestão de Funcionários",
    "descricao": "Gestão de cadastro e gerenciamento dos os funcionários."
  },
  {
    "rota": "/admin/rh/holerite",
    "caminho": "Painel → RH → Gestão de Holerites",
    "descricao": "Visualizaçao de holerites, fechamentos e envio de assinaturas."
  },
  {
    "rota": "/admin/rh/parametros",
    "caminho": "Painel → RH → Parâmetros de Contrato",
    "descricao": "Motor de regras de cálculo (CLT, PJ, Temporário, etc)."
  },
  {
    "rota": "/admin/rh/relatorios",
    "caminho": "Painel → RH → Relatórios e Dashboards",
    "descricao": "Relatórios financeiros e analíticos."
  },
  {
    "rota": "/admin/rh/rescisao",
    "caminho": "Painel → RH → Rescisão de Funcionário",
    "descricao": "Registro e cálculo de rescisões CLT, com upload do TRCT para casos de folha na contabilidade."
  },
  {
    "rota": "/admin/suporte",
    "caminho": "Painel → Suporte e Chamados",
    "descricao": "Abra chamados para TI, Financeiro, Operacional, RH e outras áreas e acompanhe até a solução."
  }
];
