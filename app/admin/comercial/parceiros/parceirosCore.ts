// app/admin/comercial/parceiros/parceirosCore.ts
// Lógica de negócio do sync de Parceiros e Colaboradores, SEM "use server" —
// importada tanto por actions.ts (que expõe as versões protegidas por
// accessToken pra UI) quanto por app/api/cron/sync-p2s/route.ts (rotina
// agendada, protegida só por CRON_SECRET, sem sessão de usuário). Ficar fora
// de um arquivo "use server" é o que garante que estas funções não viram
// endpoints de Server Action chamáveis direto por qualquer um — só são
// alcançáveis via import server-side. Mesmo padrão de
// app/admin/rh/actions/consignadoCore.ts.
//
// No PrimeStart, Cliente/Fornecedor NÃO são entidades separadas — é uma
// única classe (TCustomParceiro) com flags booleanas (FlagCliente,
// FlagFornecedor, FlagTransportadora, FlagVendedorRep, FlagIntermediador);
// um mesmo parceiro pode ser cliente E fornecedor ao mesmo tempo (confirmado
// testando em produção — oid P,279, "ARQUITRAMA", com as duas flags true).
//
// Diferença crítica em relação ao sync de Produtos: consultar TCustomParceiro
// sem filtro (toda a base) deu TIMEOUT em produção (testado em 2026-08-17) —
// a base é grande e cada registro carrega arrays aninhados pesados (Contatos,
// Endereços, FollowUp, DadosBancarios etc.). Por isso o sync aqui pagina por
// CodigoParceiro (campo sequencial) em janelas pequenas, em vez de uma
// chamada só. Uma janela de teste (CodigoParceiro 0-15) funcionou normal e
// devolveu 14 registros em ~344KB — a base inteira certamente é bem maior.
//
// Só entram os campos escalares relevantes pra um cadastro + duas listas
// aninhadas em versão enxuta (Contatos, Enderecos). NÃO entram: FollowUp
// (histórico de CRM, pesado e fora de escopo), DadosBancarios, Arquivos,
// NotificacoesAlertas, CNAESecundarios, AcessosLojasVirtuais, e as
// referências CondPagtoPadrao*/ContaFinanceiraPadrao*.
//
// Colaboradores: base pequena (121 registros em produção, 2026-08-17) — sync
// numa chamada só, sem a paginação por janela que Parceiros precisa. Não
// inclui a lista aninhada "Horarios" (escala semanal) — é um assunto de
// escala/ponto, não de cadastro, e fica fora de escopo por ora.
import { supabaseAdmin } from '../../../lib/supabase';
import { consultarObjetos, buscarObjeto, criterio, p2sParaData, type AmbienteP2s, type ObjetoP2s } from '../../../lib/p2s';
import { obterCursorIncremental, registrarSincronizacao, calcularProximoCursor, cursorParaSerialP2s } from '../../../lib/syncLog';

type Resultado = { ok: boolean; erro?: string; info?: any };

// Janela de paginação por CodigoParceiro e proteção contra loop infinito
// (500 janelas de 200 códigos = até 100.000 códigos consultados).
const JANELA = 200;
const MAX_JANELAS = 500;
const JANELAS_VAZIAS_PARA_PARAR = 5;

function nomeExibicao(obj: ObjetoP2s | null): string | null {
  if (!obj) return null;
  const nome = (obj.NomeExibicao || obj.NomeCompleto || obj.Nome || obj.NomeItem || '') as string;
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

// Serial fora de uma faixa sã (anos ~1900-2173) é tratado como null — mesma
// defesa usada em app/admin/estoque/produtos/actions.ts.
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

// CPF/CNPJ vazios no PrimeStart não voltam como string vazia — voltam com a
// máscara em branco (ex: ".   .   -" pra CPF, ".   .   /    -" pra CNPJ),
// que o textoOuNull normal trata como texto válido por não ser "". Isso
// causava dois problemas: a tela de Parceiros mostrava esse lixo no lugar do
// CPF/CNPJ real do lado oposto (ex: pessoa física com CNPJ = máscara em
// branco "ganhava" do CPF de verdade no fallback `cnpj || cpf`), e o
// documento nunca virava null de verdade mesmo quando o parceiro não tinha
// aquele campo preenchido. Um valor só é documento de verdade se sobrar
// pelo menos um dígito depois de remover a pontuação da máscara.
function documentoOuNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return /\d/.test(s) ? s : null;
}

function numOuNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? n : null;
}

function boolP2s(v: unknown): boolean {
  return String(v) === 'true';
}

interface ContatoEnxuto {
  nome: string | null;
  cargo: string | null;
  departamento: string | null;
  telefone: string | null;
  email: string | null;
  principal: boolean;
}

interface EnderecoEnxuto {
  tipo: string | null;
  endereco_completo: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  observacoes: string | null;
}

function mapearContatos(lista: unknown): ContatoEnxuto[] | null {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  return lista.map((c: any) => ({
    nome: textoOuNull(c?.NomeExibicao || c?.NomeCompleto),
    cargo: textoOuNull(c?.Cargo),
    departamento: textoOuNull(c?.Departamento),
    telefone: textoOuNull(c?.Telefone1),
    email: textoOuNull(c?.EMail1),
    principal: boolP2s(c?.FlagPrincipal),
  }));
}

function mapearEnderecos(lista: unknown): EnderecoEnxuto[] | null {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  return lista.map((e: any) => ({
    tipo: textoOuNull(e?.Tipo),
    endereco_completo: textoOuNull(e?.EnderecoCompleto),
    cidade: textoOuNull(e?.Cidade),
    estado: textoOuNull(e?.Estado),
    cep: textoOuNull(e?.CEP),
    observacoes: textoOuNull(e?.Observacoes),
  }));
}

export interface SincronizarParceirosOpcoes {
  ambiente?: AmbienteP2s;
}

export async function sincronizarParceirosCore(opcoes: SincronizarParceirosOpcoes = {}): Promise<Resultado> {
  const ambiente = opcoes.ambiente || 'PRODUCAO';
  const iniciadoEm = new Date();
  const cursorData = await obterCursorIncremental('parceiros', ambiente);

  try {
    const todosObjetos: ObjetoP2s[] = [];

    if (cursorData) {
      // Incremental: só o que mudou desde a última sincronização — o
      // resultado tende a ser pequeno (dezenas/centenas), então dá pra
      // buscar numa chamada só, sem a paginação por código abaixo (que é só
      // pra aguentar o payload pesado de uma carga completa). IMPORTANTE:
      // não dá pra combinar esse filtro de data com o loop de janelas por
      // CodigoParceiro usando o mesmo critério de parada de "N janelas
      // vazias seguidas" — um parceiro alterado pode estar em qualquer
      // faixa de código, então "janela vazia" deixaria de significar "não
      // tem mais nada", e o loop poderia parar cedo demais e perder
      // alterações em códigos mais altos.
      const resultado = await consultarObjetos(ambiente, 'TCustomParceiro', [
        criterio('DataUltimaAlteracaoCadastro', 'ge', 'dbl', cursorParaSerialP2s(cursorData)),
      ], { order: 'CodigoParceiro' });
      todosObjetos.push(...resultado.objectlist);
    } else {
      // Carga completa (primeira sincronização) — paginação por
      // CodigoParceiro em janelas, pois consulta sem filtro deu timeout em
      // produção (base grande + arrays aninhados pesados por registro). Ver
      // nota no topo do arquivo.
      let codigoCursor = 0;
      let janelasVazias = 0;
      for (let janela = 0; janela < MAX_JANELAS && janelasVazias < JANELAS_VAZIAS_PARA_PARAR; janela++) {
        const resultado = await consultarObjetos(ambiente, 'TCustomParceiro', [
          criterio('CodigoParceiro', 'gt', 'int', codigoCursor),
          criterio('CodigoParceiro', 'le', 'int', codigoCursor + JANELA),
        ], { order: 'CodigoParceiro' });

        if (resultado.objectlist.length === 0) {
          janelasVazias++;
        } else {
          janelasVazias = 0;
          todosObjetos.push(...resultado.objectlist);
        }
        codigoCursor += JANELA;
      }
    }

    if (todosObjetos.length === 0) {
      await registrarSincronizacao({
        integracao: 'parceiros', ambiente, tipo: cursorData ? 'incremental' : 'completa',
        cursorDesde: cursorData, cursorAte: calcularProximoCursor(iniciadoEm),
        encontrados: 0, processados: 0, status: 'sucesso', iniciadoEm,
      });
      return { ok: true, info: { processados: 0, totalEncontradas: 0 } };
    }

    const refsGrupo = todosObjetos.map(o => refOuTexto(o.GrupoParceiro) || undefined);
    const mapaNomes = await resolverNomes(ambiente, refsGrupo);

    const registros = todosObjetos.map(o => {
      const grupoOid = refOuTexto(o.GrupoParceiro);

      return {
        p2s_oid: o.oid,
        codigo_parceiro: numOuNull(o.CodigoParceiro),
        nome_completo: textoOuNull(o.NomeCompleto),
        nome_exibicao: textoOuNull(o.NomeExibicao),
        natureza: textoOuNull(o.Natureza),
        cpf: documentoOuNull(o.CPF),
        cnpj: documentoOuNull(o.CNPJ),
        inscricao_estadual: textoOuNull(o.InscricaoEstadual),
        inscricao_municipal: textoOuNull(o.InscricaoMunicipal),

        flag_cliente: boolP2s(o.FlagCliente),
        flag_fornecedor: boolP2s(o.FlagFornecedor),
        flag_transportadora: boolP2s(o.FlagTransportadora),
        flag_vendedor_rep: boolP2s(o.FlagVendedorRep),
        flag_intermediador: boolP2s(o.FlagIntermediador),
        status_parceiro: textoOuNull(o.StatusParceiro),

        grupo_parceiro: grupoOid,
        grupo_parceiro_nome: grupoOid ? (mapaNomes.get(grupoOid) || null) : null,

        endereco1: textoOuNull(o.Endereco1), numero1: textoOuNull(o.Numero1), complemento1: textoOuNull(o.Complemento1),
        bairro1: textoOuNull(o.Bairro1), cidade1: textoOuNull(o.Cidade1), estado1: textoOuNull(o.Estado1),
        cep1: textoOuNull(o.CEP1), pais1: textoOuNull(o.Pais1),
        endereco2: textoOuNull(o.Endereco2), numero2: textoOuNull(o.Numero2), complemento2: textoOuNull(o.Complemento2),
        bairro2: textoOuNull(o.Bairro2), cidade2: textoOuNull(o.Cidade2), estado2: textoOuNull(o.Estado2),
        cep2: textoOuNull(o.CEP2), pais2: textoOuNull(o.Pais2),
        endereco3: textoOuNull(o.Endereco3), numero3: textoOuNull(o.Numero3), complemento3: textoOuNull(o.Complemento3),
        bairro3: textoOuNull(o.Bairro3), cidade3: textoOuNull(o.Cidade3), estado3: textoOuNull(o.Estado3),
        cep3: textoOuNull(o.CEP3), pais3: textoOuNull(o.Pais3),

        telefone1: textoOuNull(o.Telefone1), telefone2: textoOuNull(o.Telefone2),
        telefone3: textoOuNull(o.Telefone3), telefone4: textoOuNull(o.Telefone4),
        email1: textoOuNull(o.EMail1), email2: textoOuNull(o.EMail2), site: textoOuNull(o.Site),

        pct_comissao_locacao: numOuNull(o.PctComissaoLocacao),
        pct_comissao_produtos: numOuNull(o.PctComissaoProdutos),
        pct_comissao_servicos: numOuNull(o.PctComissaoServicos),
        pct_desconto_padrao: numOuNull(o.PctDescontoPadrao),
        valor_maximo_a_receber_em_aberto: numOuNull(o.ValorMaximoAReceberEmAberto),
        valor_maximo_por_locacao: numOuNull(o.ValorMaximoPorLocacao),

        data_cadastro: paraDataISO(o.DataCadastro),
        data_ultima_alteracao_cadastro: paraDataISO(o.DataUltimaAlteracaoCadastro),
        login_cadastro: textoOuNull(o.LoginCadastro),
        observacoes: textoOuNull(o.Observacoes),
        motivo_bloqueio: textoOuNull(o.MotivoBloqueio),
        como_conheceu: textoOuNull(o.ComoConheceu),

        contatos: mapearContatos(o.Contatos),
        enderecos: mapearEnderecos(o.Enderecos),

        updated_at: new Date().toISOString(),
      };
    });

    const db = supabaseAdmin();
    const TAMANHO_LOTE = 250;
    let processados = 0;
    for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
      const lote = registros.slice(i, i + TAMANHO_LOTE);
      const { error } = await db.from('parceiros').upsert(lote, { onConflict: 'p2s_oid' });
      if (error) throw new Error(error.message);
      processados += lote.length;
    }

    await registrarSincronizacao({
      integracao: 'parceiros', ambiente, tipo: cursorData ? 'incremental' : 'completa',
      cursorDesde: cursorData, cursorAte: calcularProximoCursor(iniciadoEm),
      encontrados: todosObjetos.length, processados, status: 'sucesso', iniciadoEm,
    });
    return { ok: true, info: { processados, totalEncontradas: todosObjetos.length } };
  } catch (e: any) {
    await registrarSincronizacao({
      integracao: 'parceiros', ambiente, tipo: cursorData ? 'incremental' : 'completa',
      cursorDesde: cursorData, cursorAte: null,
      encontrados: 0, processados: 0, status: 'erro', erro: e.message, iniciadoEm,
    });
    return { ok: false, erro: e.message };
  }
}

export interface SincronizarColaboradoresOpcoes {
  ambiente?: AmbienteP2s;
}

export async function sincronizarColaboradoresCore(opcoes: SincronizarColaboradoresOpcoes = {}): Promise<Resultado> {
  const ambiente = opcoes.ambiente || 'PRODUCAO';
  const iniciadoEm = new Date();
  const cursor = await obterCursorIncremental('colaboradores', ambiente);

  try {
    // "CodigoColaborador ge 0" é um filtro sempre-verdadeiro (só pra
    // satisfazer o corpo obrigatório da API) — mesmo truque de produtos.ts.
    // Usado só na primeira sincronização; depois disso, filtra por
    // DataUltimaAlteracaoCadastro (ver app/lib/syncLog.ts).
    const criterios = cursor
      ? [criterio('DataUltimaAlteracaoCadastro', 'ge', 'dbl', cursorParaSerialP2s(cursor))]
      : [criterio('CodigoColaborador', 'ge', 'int', 0)];

    const resultado = await consultarObjetos(ambiente, 'TCustomColaborador', criterios, { order: 'CodigoColaborador' });

    if (resultado.objectlist.length === 0) {
      await registrarSincronizacao({
        integracao: 'colaboradores', ambiente, tipo: cursor ? 'incremental' : 'completa',
        cursorDesde: cursor, cursorAte: calcularProximoCursor(iniciadoEm),
        encontrados: 0, processados: 0, status: 'sucesso', iniciadoEm,
      });
      return { ok: true, info: { processados: 0, totalEncontradas: 0 } };
    }

    const refsFuncao = resultado.objectlist.map(o => refOuTexto(o.FuncaoColaboradorPadrao) || undefined);
    const mapaNomes = await resolverNomes(ambiente, refsFuncao);

    const registros = resultado.objectlist.map(o => {
      const funcaoOid = refOuTexto(o.FuncaoColaboradorPadrao);

      return {
        p2s_oid: o.oid,
        codigo_colaborador: numOuNull(o.CodigoColaborador),
        nome_completo: textoOuNull(o.NomeCompleto),
        nome_exibicao: textoOuNull(o.NomeExibicao),
        natureza: textoOuNull(o.Natureza),
        cpf: documentoOuNull(o.CPF),
        rg: textoOuNull(o.RG), rg_orgao_emissor: textoOuNull(o.RG_OrgaoEmissor), rg_data_expedicao: paraDataISO(o.RG_DataExpedicao),
        pis_num: textoOuNull(o.PIS_Num),
        ctps_num: textoOuNull(o.CTPS_Num), ctps_serie: textoOuNull(o.CTPS_Serie), ctps_estado: textoOuNull(o.CTPS_Estado),
        titulo_eleitor_num: textoOuNull(o.TituloEleitor_Num), titulo_eleitor_zona: textoOuNull(o.TituloEleitor_Zona), titulo_eleitor_secao: textoOuNull(o.TituloEleitor_Secao),
        id_estrangeiro: textoOuNull(o.IdEstrangeiro),

        data_admissao: paraDataISO(o.DataAdmissao),
        data_demissao: paraDataISO(o.DataDemissao),
        status_colaborador: textoOuNull(o.StatusColaborador),
        tipo_funcionario: textoOuNull(o.TipoFuncionario),
        funcao_padrao: funcaoOid,
        funcao_padrao_nome: funcaoOid ? (mapaNomes.get(funcaoOid) || null) : null,
        custo_hora_referencia: numOuNull(o.CustoHoraReferencia),
        valor_unitario_funcao_padrao: numOuNull(o.ValorUnitarioFuncaoPadrao),
        flag_vendedor_rep: boolP2s(o.FlagVendedorRep),
        flag_responsavel_prop_job: boolP2s(o.FlagResponsavelPropJob),
        flag_recurso: boolP2s(o.FlagRecurso),

        data_nascimento_entidade: paraDataISO(o.DataNascimentoEntidade),
        estado_civil: textoOuNull(o.EstadoCivil),
        sexo_colab: textoOuNull(o.SexoColab),
        raca_cor: textoOuNull(o.RacaCor),
        pessoa_com_deficiencia: boolP2s(o.PessoaComDeficiencia),
        tipo_sanguineo: textoOuNull(o.TipoSanguineo),
        nivel_escolaridade: textoOuNull(o.NivelEscolaridade),
        nacionalidade: textoOuNull(o.Nacionalidade),
        naturalidade_cidade: textoOuNull(o.NaturalidadeCidade),
        naturalidade_estado: textoOuNull(o.NaturalidadeEstado),
        nome_mae: textoOuNull(o.NomeMae),
        nacionalidade_mae: textoOuNull(o.NacionalidadeMae),
        nome_pai: textoOuNull(o.NomePai),
        numero_dependentes: numOuNull(o.NumeroDependentes),
        numero_filhos: numOuNull(o.NumeroFilhos),

        endereco1: textoOuNull(o.Endereco1), numero1: textoOuNull(o.Numero1), complemento1: textoOuNull(o.Complemento1),
        bairro1: textoOuNull(o.Bairro1), cidade1: textoOuNull(o.Cidade1), estado1: textoOuNull(o.Estado1),
        cep1: textoOuNull(o.CEP1), pais1: textoOuNull(o.Pais1),
        telefone1: textoOuNull(o.Telefone1), telefone2: textoOuNull(o.Telefone2),
        telefone3: textoOuNull(o.Telefone3), telefone4: textoOuNull(o.Telefone4),
        email1: textoOuNull(o.EMail1), email2: textoOuNull(o.EMail2), site: textoOuNull(o.Site),

        dados_bancarios_obs: textoOuNull(o.DadosBancarios_Obs),
        pct_comissao_locacao: numOuNull(o.PctComissaoLocacao),
        pct_comissao_produtos: numOuNull(o.PctComissaoProdutos),
        pct_comissao_servicos: numOuNull(o.PctComissaoServicos),
        valor_maximo_a_receber_em_aberto: numOuNull(o.ValorMaximoAReceberEmAberto),
        valor_maximo_por_locacao: numOuNull(o.ValorMaximoPorLocacao),

        login_cadastro: textoOuNull(o.LoginCadastro),
        login_ultima_alteracao_cadastro: textoOuNull(o.LoginUltimaAlteracaoCadastro),
        login_usuario_associado: textoOuNull(o.LoginUsuarioAssociado),
        assinatura_email: textoOuNull(o.AssinaturaEMail),
        flag_signatario_assinatura_eletronica: boolP2s(o.FlagSignatarioAssinaturaEletronica),
        data_cadastro: paraDataISO(o.DataCadastro),
        data_ultima_alteracao_cadastro: paraDataISO(o.DataUltimaAlteracaoCadastro),
        observacoes: textoOuNull(o.Observacoes),

        updated_at: new Date().toISOString(),
      };
    });

    const db = supabaseAdmin();
    const TAMANHO_LOTE = 250;
    let processados = 0;
    for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
      const lote = registros.slice(i, i + TAMANHO_LOTE);
      const { error } = await db.from('colaboradores').upsert(lote, { onConflict: 'p2s_oid' });
      if (error) throw new Error(error.message);
      processados += lote.length;
    }

    await registrarSincronizacao({
      integracao: 'colaboradores', ambiente, tipo: cursor ? 'incremental' : 'completa',
      cursorDesde: cursor, cursorAte: calcularProximoCursor(iniciadoEm),
      encontrados: resultado.count, processados, status: 'sucesso', iniciadoEm,
    });
    return { ok: true, info: { processados, totalEncontradas: resultado.count } };
  } catch (e: any) {
    await registrarSincronizacao({
      integracao: 'colaboradores', ambiente, tipo: cursor ? 'incremental' : 'completa',
      cursorDesde: cursor, cursorAte: null,
      encontrados: 0, processados: 0, status: 'erro', erro: e.message, iniciadoEm,
    });
    return { ok: false, erro: e.message };
  }
}
