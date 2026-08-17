'use server';

// app/admin/estoque/produtos/actions.ts
// Sincronização de Produtos (TCustomProduto) direto da API do PrimeStart —
// tela em /admin/estoque/produtos, sem planilha/import manual anterior.
// Grava na tabela produtos (ver sql/produtos.sql), upsert por p2s_oid.
//
// Mapeamento validado empiricamente contra o servidor de produção em
// 2026-08-10 (515 produtos reais inspecionados, catálogo inteiro):
// - A classe real tem 115 campos escalares (bem mais que o "recorte" do
//   dicionário da P2S) — TODOS viram coluna própria aqui, a pedido do
//   usuário ("todos os atributos").
// - Tem também 12 campos array aninhados. Só 2 têm dado de verdade:
//   Precos (preço por tabela — 465/515 produtos, média 6,8 preços cada) e
//   InfosItemEstoque (custo médio/localização por estoque físico) — ambos
//   viram jsonb, com TabelaPreco/Estoque resolvidos por nome (só 19 e 9
//   valores únicos respectivamente, nada caro de resolver). Os outros 10
//   arrays (Fornecedores, Componentes/kit, ConfigLojasVirtuais etc.) estão
//   vazios ou quase nunca usados no catálogo real — não entram.
// - A maioria dos campos fiscais (COFINS_*, PIS_*, ICMS_PctICMS,
//   SituacaoTributaria...) está vazia em ~100% do catálogo, mas entram
//   como coluna mesmo assim (a pedido do usuário) — só ficam NULL.
// - Catálogo é pequeno (515 produtos, ~3,2MB sem proxy) — sincroniza tudo
//   de uma vez, sem paginação/janela de datas como as outras integrações.
import { supabaseAdmin } from '../../../lib/supabase';
import { consultarObjetos, buscarObjeto, criterio, p2sParaData, type AmbienteP2s, type ObjetoP2s } from '../../../lib/p2s';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/estoque/produtos';

// TCustomEstoque não segue o padrão NomeExibicao/NomeCompleto/Nome — seu
// campo de nome é NomeEstoque (confirmado testando P,538 → "LOCACAO -
// RENTECH", que vinha sem resolver antes desse fallback).
function nomeExibicao(obj: ObjetoP2s | null): string | null {
  if (!obj) return null;
  const nome = (obj.NomeExibicao || obj.NomeCompleto || obj.Nome || obj.NomeItem || obj.NomeEstoque || '') as string;
  return nome || null;
}

async function resolverNomes(ambiente: AmbienteP2s, oids: (string | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(oids.filter((oid): oid is string => !!oid && oid !== 'null'))];
  const mapa = new Map<string, string>();
  const TAMANHO_LOTE = 8;
  for (let i = 0; i < unicos.length; i += TAMANHO_LOTE) {
    const lote = unicos.slice(i, i + TAMANHO_LOTE);
    const objetos = await Promise.all(lote.map(oid => buscarObjeto(ambiente, oid).catch(() => null)));
    objetos.forEach((obj, idx) => {
      const nome = nomeExibicao(obj);
      if (nome) mapa.set(lote[idx], nome);
    });
  }
  return mapa;
}

// Serial fora de uma faixa sã (anos ~1900–2173) é tratado como null — mesma
// defesa usada em app/admin/financeiro/contas-pagar/actions.ts.
function paraDataISO(serial: unknown): string | null {
  const n = Number(serial);
  if (!n || n < 1 || n > 100_000) return null;
  const data = p2sParaData(n);
  return data ? data.toISOString().slice(0, 10) : null;
}

function refOuTexto(v: unknown): string | null {
  const s = v ? String(v) : '';
  return s && s !== 'null' ? s : null;
}

function textoOuNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

function numOuNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? n : null;
}

export interface SincronizarProdutosOpcoes {
  ambiente?: AmbienteP2s;
}

export async function sincronizarProdutosP2sAction(opcoes: SincronizarProdutosOpcoes, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const ambiente = opcoes.ambiente || 'PRODUCAO';

  try {
    // Catálogo pequeno o suficiente (algumas centenas de produtos) pra
    // trazer tudo numa chamada só — sem paginação por data como as outras
    // integrações. "Codigo ge 0" é um filtro sempre-verdadeiro (Codigo é
    // sequencial a partir de 1) que serve só pra satisfazer o corpo
    // obrigatório da API.
    const resultado = await consultarObjetos(ambiente, 'TCustomProduto', [
      criterio('Codigo', 'ge', 'int', 0),
    ], { order: 'Codigo' });

    if (resultado.objectlist.length === 0) {
      return { ok: true, info: { processados: 0, totalEncontradas: 0 } };
    }

    const refsPrincipais = resultado.objectlist.flatMap(o => [refOuTexto(o.Categoria), refOuTexto(o.SubCategoria), refOuTexto(o.Marca)]);
    const refsTabelaPreco = resultado.objectlist.flatMap(o => (Array.isArray(o.Precos) ? o.Precos : []).map((p: any) => refOuTexto(p?.TabelaPreco)));
    const refsEstoque = resultado.objectlist.flatMap(o => (Array.isArray(o.InfosItemEstoque) ? o.InfosItemEstoque : []).map((e: any) => refOuTexto(e?.Estoque)));

    const mapaNomes = await resolverNomes(ambiente, [
      ...refsPrincipais, ...refsTabelaPreco, ...refsEstoque,
    ].map(v => v || undefined));

    const registros = resultado.objectlist.map(o => {
      const precos = (Array.isArray(o.Precos) ? o.Precos : []).map((p: any) => {
        const tabelaOid = refOuTexto(p?.TabelaPreco);
        return {
          tabela: tabelaOid ? (mapaNomes.get(tabelaOid) || tabelaOid) : null,
          preco: numOuNull(p?.Preco),
        };
      });
      const estoques = (Array.isArray(o.InfosItemEstoque) ? o.InfosItemEstoque : []).map((e: any) => {
        const estoqueOid = refOuTexto(e?.Estoque);
        return {
          estoque: estoqueOid ? (mapaNomes.get(estoqueOid) || estoqueOid) : null,
          custo_medio: numOuNull(e?.CustoMedio),
          localizacao: textoOuNull(e?.DescricaoLocalizacao),
        };
      });

      const categoriaOid = refOuTexto(o.Categoria);
      const subCategoriaOid = refOuTexto(o.SubCategoria);
      const marcaOid = refOuTexto(o.Marca);

      return {
        p2s_oid: o.oid,
        altura: numOuNull(o.Altura),
        bloqueia_edicao_ficha_detalha_comp_kit: String(o.BloqueiaEdicaoFichaDetalhaCompKit) === 'true',
        cest: textoOuNull(o.CEST),
        cnpj_fabricante: textoOuNull(o.CNPJFabricante),
        cofins_cst_padrao: textoOuNull(o.COFINS_CSTPadrao),
        cofins_cst_padrao_exp: textoOuNull(o.COFINS_CSTPadraoExp),
        cofins_cst_padrao_exp_sn: textoOuNull(o.COFINS_CSTPadraoExp_SN),
        cofins_cst_padrao_imp: textoOuNull(o.COFINS_CSTPadrao_Imp),
        cofins_cst_padrao_sn: textoOuNull(o.COFINS_CSTPadrao_SN),
        cofins_pct_aliquota_padrao: numOuNull(o.COFINS_PctAliquotaPadrao),
        cofins_pct_aliquota_padrao_exp: numOuNull(o.COFINS_PctAliquotaPadraoExp),
        cofins_tipo_calculo_padrao: numOuNull(o.COFINS_TipoCalculoPadrao),
        cofins_tipo_calculo_padrao_exp: numOuNull(o.COFINS_TipoCalculoPadraoExp),
        campo_adicional1: textoOuNull(o.CampoAdicional1),
        campo_adicional2: textoOuNull(o.CampoAdicional2),
        categoria: categoriaOid,
        categoria_especial: refOuTexto(o.CategoriaEspecial),
        centro_custo_compra: refOuTexto(o.CentroCustoCompra),
        centro_custo_rel_compra_nfe: refOuTexto(o.CentroCustoRelCompraNFe),
        centro_receita_locacao: refOuTexto(o.CentroReceitaLocacao),
        centro_receita_venda: refOuTexto(o.CentroReceitaVenda),
        classificacao_fiscal: textoOuNull(o.ClassificacaoFiscal),
        codigo: numOuNull(o.Codigo),
        codigo_anvisa: textoOuNull(o.CodigoAnvisa),
        codigo_barras: textoOuNull(o.CodigoBarras),
        codigo_exibicao: textoOuNull(o.CodigoExibicao),
        codigo_fabricante: textoOuNull(o.CodigoFabricante),
        codigo_formatado: textoOuNull(o.CodigoFormatado),
        comprimento: numOuNull(o.Comprimento),
        custo_reposicao: numOuNull(o.CustoReposicao),
        custo_reposicao_dolar: numOuNull(o.CustoReposicaoDolar),
        data_cadastro: paraDataISO(o.DataCadastro),
        data_ult_mov_entrada_compra: paraDataISO(o.DataUltMovEntradaCompra),
        data_ultima_alteracao_cadastro: paraDataISO(o.DataUltimaAlteracaoCadastro),
        data_validade_codigo_anvisa: paraDataISO(o.DataValidadeCodigoAnvisa),
        depr_disponibiliza_como_kit: String(o.Depr_DisponibilizaComoKit) === 'true',
        descricao_detalhada: textoOuNull(o.DescricaoDetalhada),
        disponibilizar_como_kit: String(o.DisponibilizarComoKit) === 'true',
        excecao_fiscal: numOuNull(o.ExcecaoFiscal),
        fator_conversao: numOuNull(o.FatorConversao),
        fatura_como_servico: String(o.FaturaComoServico) === 'true',
        flag_amostrador: String(o.FlagAmostrador) === 'true',
        flag_em_desuso: String(o.FlagEmDesuso) === 'true',
        foto: textoOuNull(o.Foto),
        grade_gerada: String(o.GradeGerada) === 'true',
        habilitado_para_locacao: String(o.HabilitadoParaLocacao) === 'true',
        habilitado_para_venda: String(o.HabilitadoParaVenda) === 'true',
        icms_base_calculo_icms: textoOuNull(o.ICMS_BaseCalculoICMS),
        icms_csosn_padrao: textoOuNull(o.ICMS_CSOSNPadrao),
        icms_csosn_padrao_exp: textoOuNull(o.ICMS_CSOSNPadrao_Exp),
        icms_csosn_padrao_imp: textoOuNull(o.ICMS_CSOSNPadrao_Imp),
        icms_cst_padrao: textoOuNull(o.ICMS_CSTPadrao),
        icms_cst_padrao_exp: textoOuNull(o.ICMS_CSTPadrao_Exp),
        icms_cst_padrao_imp: textoOuNull(o.ICMS_CSTPadrao_Imp),
        icms_ipi_entra_na_base_de_calculo: String(o.ICMS_IPIEntraNaBaseDeCalculo) === 'true',
        icms_ipi_entra_na_base_de_calculo_st: String(o.ICMS_IPIEntraNaBaseDeCalculo_ST) === 'true',
        icms_modalidade_bc: numOuNull(o.ICMS_ModalidadeBC),
        icms_modalidade_bc_exp: numOuNull(o.ICMS_ModalidadeBC_Exp),
        icms_modalidade_bc_st: numOuNull(o.ICMS_ModalidadeBC_ST),
        icms_modalidade_bc_st_exp: numOuNull(o.ICMS_ModalidadeBC_ST_Exp),
        icms_pct_cred_sn: numOuNull(o.ICMS_PctCredSN),
        icms_pct_icms: numOuNull(o.ICMS_PctICMS),
        icms_pct_icms_imp: numOuNull(o.ICMS_PctICMS_Imp),
        icms_pct_margem_valor_adic_st: numOuNull(o.ICMS_PctMargemValorAdic_ST),
        icms_pct_margem_valor_adic_st_exp: numOuNull(o.ICMS_PctMargemValorAdic_ST_Exp),
        icms_sujeito_fcp: String(o.ICMS_SujeitoFCP) === 'true',
        icms_usa_pct_cred_sn_especifica: String(o.ICMS_UsaPctCredSNEspecifica) === 'true',
        ii_pct_ii: numOuNull(o.II_PctII),
        ipi_cst_padrao: textoOuNull(o.IPI_CSTPadrao),
        ipi_cst_padrao_imp: textoOuNull(o.IPI_CSTPadrao_Imp),
        ipi_pct_ipi: numOuNull(o.IPI_PctIPI),
        item_estoque_pai_grade: refOuTexto(o.ItemEstoquePaiGrade),
        largura: numOuNull(o.Largura),
        login_cadastro: textoOuNull(o.LoginCadastro),
        login_ultima_alteracao_cadastro: textoOuNull(o.LoginUltimaAlteracaoCadastro),
        marca: marcaOid,
        modelo: textoOuNull(o.Modelo),
        motivo_isencao_anvisa: textoOuNull(o.MotivoIsencaoAnvisa),
        nome_estoque_ult_mov_entrada_compra: textoOuNull(o.NomeEstoqueUltMovEntradaCompra),
        nome_item: textoOuNull(o.NomeItem),
        num_dias_indisponivel_apos_ret_loc: numOuNull(o.NumDiasIndisponivelAposRetLoc),
        num_dimensoes_grade: numOuNull(o.NumDimensoesGrade),
        observacoes: textoOuNull(o.Observacoes),
        origem_nfe: numOuNull(o.OrigemNFe),
        pis_cst_padrao: textoOuNull(o.PIS_CSTPadrao),
        pis_cst_padrao_exp: textoOuNull(o.PIS_CSTPadraoExp),
        pis_cst_padrao_exp_sn: textoOuNull(o.PIS_CSTPadraoExp_SN),
        pis_cst_padrao_imp: textoOuNull(o.PIS_CSTPadrao_Imp),
        pis_cst_padrao_sn: textoOuNull(o.PIS_CSTPadrao_SN),
        pis_pct_aliquota_padrao: numOuNull(o.PIS_PctAliquotaPadrao),
        pis_pct_aliquota_padrao_exp: numOuNull(o.PIS_PctAliquotaPadraoExp),
        pis_tipo_calculo_padrao: numOuNull(o.PIS_TipoCalculoPadrao),
        pis_tipo_calculo_padrao_exp: numOuNull(o.PIS_TipoCalculoPadraoExp),
        permite_recarga_controle_ind_fracionado: String(o.PermiteRecargaControleIndFracionado) === 'true',
        peso_unitario: numOuNull(o.PesoUnitario),
        possui_excecao_fiscal: String(o.PossuiExcecaoFiscal) === 'true',
        produzido_escala_relevante: textoOuNull(o.ProduzidoEscalaRelevante),
        situacao_tributaria: textoOuNull(o.SituacaoTributaria),
        situacao_tributaria_pdv: textoOuNull(o.SituacaoTributariaPDV),
        sub_categoria: subCategoriaOid,
        sub_centro_custo_compra: refOuTexto(o.SubCentroCustoCompra),
        sub_centro_custo_rel_compra_nfe: refOuTexto(o.SubCentroCustoRelCompraNFe),
        sub_centro_receita_locacao: refOuTexto(o.SubCentroReceitaLocacao),
        sub_centro_receita_venda: refOuTexto(o.SubCentroReceitaVenda),
        tem_controle_ind_fracionado: String(o.TemControleIndFracionado) === 'true',
        tem_controle_individual: String(o.TemControleIndividual) === 'true',
        tem_seguro: numOuNull(o.TemSeguro),
        unidade: textoOuNull(o.Unidade),
        unidade_exportacao: textoOuNull(o.UnidadeExportacao),
        usa_csts_do_cadastro_nfe_importacao: String(o.UsaCSTsDoCadastroNFeImportacao) === 'true',
        utiliza_unidade_diferente_nf_exportacao: String(o.UtilizaUnidadeDiferenteNFExportacao) === 'true',
        categoria_nome: categoriaOid ? (mapaNomes.get(categoriaOid) || null) : null,
        sub_categoria_nome: subCategoriaOid ? (mapaNomes.get(subCategoriaOid) || null) : null,
        marca_nome: marcaOid ? (mapaNomes.get(marcaOid) || null) : null,
        precos: precos.length ? precos : null,
        estoques: estoques.length ? estoques : null,
        updated_at: new Date().toISOString(),
      };
    });

    const db = supabaseAdmin();
    const TAMANHO_LOTE = 250;
    let processados = 0;
    for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
      const lote = registros.slice(i, i + TAMANHO_LOTE);
      const { error } = await db.from('produtos').upsert(lote, { onConflict: 'p2s_oid' });
      if (error) throw new Error(error.message);
      processados += lote.length;
    }

    return { ok: true, info: { processados, totalEncontradas: resultado.count } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
