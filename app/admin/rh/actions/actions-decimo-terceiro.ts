'use server';

// app/admin/rh/actions/actions-decimo-terceiro.ts
// Tela única do 13º Salário — pedido do usuário (28/11/2026): tudo sobre o
// 13º fica aqui, integral ou não.
// - "Via Empresa" (decimo_terceiro_integral=true no Modelo de Contrato):
//   fechar/assinatura Autentique/lote PIX — mesmo padrão de folha_rescisoes:
//   uma linha por (funcionário, ano), parcelas rastreadas (pago_em/
//   pago_lote_id próprios), reabrir só antes de qualquer parcela paga,
//   assinatura reaproveitando folha_holerite_assinaturas com marcador
//   sintético "13-{ano}-P{parcela}". A 1ª e a 2ª parcela podem ser DIGITADAS
//   antes de fechar (valoresParcelasDigitadas) — o digitado é o que se paga,
//   sem INSS/IRRF; sem digitação, vale o cálculo sugerido (salário cadastrado,
//   avos, INSS/IRRF).
// - "Via Contabilidade" (recebe_holerite_contabilidade=true e não integral):
//   só leitura — o valor é exatamente o do holerite importado em
//   /admin/rh/holerite → Separar Holerites (folha_documentos_contabeis.
//   valor_ocr, tipo DECIMO_TERCEIRO), um documento por parcela
//   (mes_referencia "AAAA-P1"/"AAAA-P2"). Sem cálculo nosso, sem assinatura
//   por aqui; o pagamento roda pela fonte "DECIMO_TERCEIRO" do lote de
//   Financeiro RH, escolhendo a parcela.
import { supabaseAdmin } from '../../../lib/supabase';
import { filtrarFicha } from '../../../lib/funcionarioRef';
import { validarAcesso, validarAcessoAlgumaRota, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { consultarAssinaturaAction, baixarAssinadoAction } from './actions-assinatura';
import { autentiqueCriarDocumento } from '../../../lib/autentique';
import { gerarRecibo13Pdf } from '../../../lib/gerarRecibo13Pdf';
import { calcular13Integral, calcular13ComParcelasDigitadas, itensCalculo13, type ResultadoCalculo13 } from '../../../lib/calculo13Salario';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/rh/decimo-terceiro';
const ROTAS_PERMITIDAS = [ROTA, '/admin/rh/assinaturas'];

async function validarAcessoDecimo13(accessToken: string) {
  return validarAcessoAlgumaRota(accessToken, ROTAS_PERMITIDAS);
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

const normalizarCelularBR = (celular?: string | null): string | null => {
  if (!celular) return null;
  const digits = celular.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const comPais = digits.startsWith('55') ? digits : `55${digits}`;
  return `+${comPais}`;
};

async function nomeEmpresaDoFuncionario(db: ReturnType<typeof supabaseAdmin>, empresaId: number | null | undefined): Promise<string> {
  if (!empresaId) return 'RENTECH';
  const { data } = await db.from('empresas').select('nome').eq('id', empresaId).maybeSingle();
  return data?.nome || 'RENTECH';
}

// Marcador sintético usado como "mes_referencia" em folha_holerite_assinaturas
// (mesmo mecanismo de RESCISAO-{id}/AVULSO-{mes}-... já usado nesta tabela).
const marcadorAssinatura13 = (ano: number, parcela: 1 | 2) => `13-${ano}-P${parcela}`;

// ============================================================================
// PAINEL — duas listas no mesmo ano:
// 1) "linhas" — contrato com decimo_terceiro_integral=true: cálculo nosso
//    (ao vivo ou snapshot congelado), fechar/assinatura/lote PIX, como antes.
// 2) "linhasContabilidade" — contrato com recebe_holerite_contabilidade=true
//    (e NÃO integral): só leitura, valor = exatamente o valor_ocr do
//    documento DECIMO_TERCEIRO importado em /admin/rh/holerite → Separar
//    Holerites para o ano. Sem cálculo, sem assinatura por aqui — o
//    pagamento já roda pela fonte "DECIMO_TERCEIRO" do lote de Financeiro RH.
// ============================================================================
export async function painelDecimoTerceiroAction(payload: { ano: number; empresaId: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { ano, empresaId } = payload;

  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    // Tela exige escolher UMA empresa (Rentech ou AlfaLight) — pedido do
    // usuário 2026-11-28, "não pode ser ambas". Revalidado aqui, nunca só
    // filtro de exibição.
    if (!empresaPermitida(empresasPermitidas, empresaId)) return { ok: false, erro: 'Você não tem permissão para ver o 13º desta empresa.' };

    const { data: regras } = await db.from('folha_parametros').select('nome_regra, decimo_terceiro_integral, recebe_holerite_contabilidade, recebe_holerite');
    // Via Empresa só com "Recebe holerite (contabilidade)?" desmarcado (null
    // conta como marcado, igual à tela de Parâmetros) — contrato antigo com
    // as duas marcadas cai na contabilidade, nunca paga o 13º duas vezes.
    const regrasIntegral = new Set((regras || []).filter(r => r.decimo_terceiro_integral === true && r.recebe_holerite === false).map(r => r.nome_regra));
    const regrasContabilidade = new Set((regras || []).filter(r => r.recebe_holerite_contabilidade === true && !regrasIntegral.has(r.nome_regra)).map(r => r.nome_regra));
    const semRegraConfigurada = regrasIntegral.size === 0;

    const { data: funcsTodos, error: erroFuncs } = await db.from('folha_funcionarios')
      .select('id, nome_completo, cargo, tipo_contrato, salario_folha, salario_contrato, data_admissao, data_desligamento, cpf, celular, email, empresa_id')
      .eq('ativo', true).eq('empresa_id', empresaId).order('nome_completo');
    if (erroFuncs) throw new Error(erroFuncs.message);

    const elegiveis = (funcsTodos || []).filter(f => regrasIntegral.has(f.tipo_contrato));
    const elegiveisContabilidade = (funcsTodos || []).filter(f => regrasContabilidade.has(f.tipo_contrato));

    // "Sem 13º Salário" — ativos que não caem em nenhuma das duas listas, com
    // o motivo, pro RH conferir que ninguém ficou de fora por engano (pedido
    // do usuário 2026-11-28).
    const regraPorNome: Record<string, any> = {};
    (regras || []).forEach(r => { regraPorNome[r.nome_regra] = r; });
    const linhasSem13 = (funcsTodos || [])
      .filter(f => !regrasIntegral.has(f.tipo_contrato) && !regrasContabilidade.has(f.tipo_contrato))
      .map(f => {
        const regra = f.tipo_contrato ? regraPorNome[f.tipo_contrato] : null;
        const motivo = !f.tipo_contrato
          ? 'Sem Modelo de Contrato na ficha'
          : !regra
            ? `Modelo de Contrato "${f.tipo_contrato}" não existe em Parâmetros`
            : regra.decimo_terceiro_integral === true
              ? 'Marcado "Recebe 13º pela empresa", mas o contrato também recebe holerite da contabilidade — a opção fica sem efeito'
              : 'Contrato não recebe 13º pela empresa nem entra na separação dos PDFs da contabilidade';
        return { func: { nome_completo: f.nome_completo, cargo: f.cargo, empresa_id: f.empresa_id, tipo_contrato: f.tipo_contrato }, motivo };
      });

    const linhasContabilidade: any[] = [];
    if (elegiveisContabilidade.length > 0) {
      const nomesContab = elegiveisContabilidade.map(f => f.nome_completo);
      // A contabilidade manda 2 holerites do 13º (1ª e 2ª parcela): Separar
      // Holerites grava mes_referencia "AAAA-P1"/"AAAA-P2" (ver
      // referenciaDocumento em actions-financeiro.ts).
      const { data: docs } = await db.from('folha_documentos_contabeis')
        .select('funcionario_nome, mes_referencia, valor_ocr, storage_path')
        .eq('tipo', 'DECIMO_TERCEIRO').in('mes_referencia', [`${ano}-P1`, `${ano}-P2`]).in('funcionario_nome', nomesContab);
      const docsPorNome: Record<string, { mesReferencia: string; valorOcr: number | null }[]> = {};
      (docs || []).forEach(d => {
        (docsPorNome[d.funcionario_nome] ||= []).push({ mesReferencia: d.mes_referencia, valorOcr: d.valor_ocr != null ? Number(d.valor_ocr) : null });
      });
      elegiveisContabilidade.forEach(f => {
        const documentos = (docsPorNome[f.nome_completo] || []).sort((a, b) => a.mesReferencia.localeCompare(b.mesReferencia));
        linhasContabilidade.push({
          func: f, documentos,
          totalValor: documentos.reduce((s, d) => s + (d.valorOcr || 0), 0)
        });
      });
    }

    if (elegiveis.length === 0) return { ok: true, info: { linhas: [], linhasContabilidade, linhasSem13, semRegraConfigurada } };

    const nomes = elegiveis.map(f => f.nome_completo);

    const [{ data: deps }, { data: fechados }, { data: assinaturas }] = await Promise.all([
      db.from('folha_dependentes').select('funcionario_nome').in('funcionario_nome', nomes),
      db.from('folha_decimo_terceiro').select('*').eq('ano', ano).in('funcionario_nome', nomes),
      db.from('folha_holerite_assinaturas').select('funcionario_nome, status, mes_referencia')
        .in('mes_referencia', [marcadorAssinatura13(ano, 1), marcadorAssinatura13(ano, 2)])
        .in('funcionario_nome', nomes)
    ]);

    const depsPorNome: Record<string, number> = {};
    (deps || []).forEach(d => { depsPorNome[d.funcionario_nome] = (depsPorNome[d.funcionario_nome] || 0) + 1; });

    const fechadoPorNome: Record<string, any> = {};
    (fechados || []).forEach(f => { fechadoPorNome[f.funcionario_nome] = f; });

    const assinaturaPorChave: Record<string, string> = {};
    (assinaturas || []).forEach(a => {
      const parcela = a.mes_referencia.endsWith('-P1') ? 1 : 2;
      assinaturaPorChave[`${a.funcionario_nome}::${parcela}`] = a.status;
    });

    const linhas = elegiveis.map(f => {
      const fechamento = fechadoPorNome[f.nome_completo] || null;
      let dados: ResultadoCalculo13;
      if (fechamento) {
        dados = {
          ano: fechamento.ano, mesesAvos: fechamento.meses_avos, salarioBase: Number(fechamento.salario_base),
          valorBruto: Number(fechamento.valor_bruto), parcela1Valor: Number(fechamento.parcela1_valor),
          inssValor: Number(fechamento.inss_valor), irrfValor: Number(fechamento.irrf_valor),
          parcela2Valor: Number(fechamento.parcela2_valor), calculadoEm: fechamento.fechado_em
        };
      } else {
        const salarioBase = f.salario_folha > 0 ? f.salario_folha : f.salario_contrato;
        dados = calcular13Integral({
          salarioBase, dataAdmissao: f.data_admissao, dataDesligamento: f.data_desligamento,
          ano, numeroDependentesIrrf: depsPorNome[f.nome_completo] || 0
        });
      }
      return {
        func: f, dados,
        fechamento: fechamento ? {
          id: fechamento.id, fechadoEm: fechamento.fechado_em, fechadoPor: fechamento.fechado_por,
          parcela1PagoEm: fechamento.parcela1_pago_em, parcela1PagoLoteId: fechamento.parcela1_pago_lote_id,
          parcela2PagoEm: fechamento.parcela2_pago_em, parcela2PagoLoteId: fechamento.parcela2_pago_lote_id,
        } : null,
        statusAssinaturaP1: assinaturaPorChave[`${f.nome_completo}::1`] || null,
        statusAssinaturaP2: assinaturaPorChave[`${f.nome_completo}::2`] || null,
        // Só usado no cliente pra recalcular o split (INSS/IRRF) ao vivo
        // quando o usuário digita o bruto manualmente, antes de fechar.
        numeroDependentesIrrf: depsPorNome[f.nome_completo] || 0,
      };
    });

    return { ok: true, info: { linhas, linhasContabilidade, linhasSem13, semRegraConfigurada } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// FECHAR — congela o cálculo de um ou mais funcionários pro ano. Não
// sobrescreve quem já tem alguma parcela paga (proteção, embora a tela só
// deva oferecer "fechar" pra quem ainda está aberto).
// ============================================================================
export async function fecharDecimoTerceiroLoteAction(payload: {
  ano: number; nomes: string[]; usuarioNome: string;
  // 1ª/2ª parcela digitadas na tela (Via Empresa), por nome. Quando presentes
  // substituem o cálculo sugerido: o digitado é o que se paga, sem INSS/IRRF.
  valoresParcelasDigitadas?: Record<string, { parcela1: number; parcela2: number }>;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { ano, nomes, usuarioNome, valoresParcelasDigitadas } = payload;
  if (!nomes.length) return { ok: false, erro: 'Nenhum funcionário selecionado.' };

  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);

    const { data: funcs } = await db.from('folha_funcionarios')
      .select('id, nome_completo, salario_folha, salario_contrato, data_admissao, data_desligamento, empresa_id')
      .in('nome_completo', nomes);
    const foraDoEscopo = (funcs || []).filter(f => !empresaPermitida(empresasPermitidas, f.empresa_id));
    if (foraDoEscopo.length > 0) return { ok: false, erro: 'Você não tem permissão para fechar o 13º de um ou mais desses funcionários.' };

    const { data: deps } = await db.from('folha_dependentes').select('funcionario_nome').in('funcionario_nome', nomes);
    const depsPorNome: Record<string, number> = {};
    (deps || []).forEach(d => { depsPorNome[d.funcionario_nome] = (depsPorNome[d.funcionario_nome] || 0) + 1; });

    const { data: existentes } = await db.from('folha_decimo_terceiro').select('funcionario_nome, parcela1_pago_em, parcela2_pago_em').eq('ano', ano).in('funcionario_nome', nomes);
    const bloqueadosPagos = new Set((existentes || []).filter(e => e.parcela1_pago_em || e.parcela2_pago_em).map(e => e.funcionario_nome));

    let fechados = 0;
    const ignorados: string[] = [];
    const zerados: string[] = [];
    for (const f of funcs || []) {
      if (bloqueadosPagos.has(f.nome_completo)) { ignorados.push(f.nome_completo); continue; }
      const salarioBase = f.salario_folha > 0 ? f.salario_folha : f.salario_contrato;
      const digitadas = valoresParcelasDigitadas?.[f.nome_completo];
      const dados = digitadas
        ? calcular13ComParcelasDigitadas({
            parcela1Valor: Number(digitadas.parcela1) || 0, parcela2Valor: Number(digitadas.parcela2) || 0,
            salarioBase, dataAdmissao: f.data_admissao, dataDesligamento: f.data_desligamento, ano
          })
        : calcular13Integral({
            salarioBase, dataAdmissao: f.data_admissao, dataDesligamento: f.data_desligamento,
            ano, numeroDependentesIrrf: depsPorNome[f.nome_completo] || 0
          });
      // Parcela zerada (sem salário cadastrado, 0 avos ou nada digitado) nunca
      // é fechada — senão viraria recibo/assinatura/lote de R$ 0,00.
      if (!(dados.parcela1Valor > 0) || !(dados.parcela2Valor > 0)) { zerados.push(f.nome_completo); continue; }
      const { error } = await db.from('folha_decimo_terceiro').upsert({
        funcionario_id: f.id, funcionario_nome: f.nome_completo, empresa_id: f.empresa_id, ano,
        meses_avos: dados.mesesAvos, salario_base: dados.salarioBase, valor_bruto: dados.valorBruto,
        parcela1_valor: dados.parcela1Valor, inss_valor: dados.inssValor, irrf_valor: dados.irrfValor,
        parcela2_valor: dados.parcela2Valor, dados: itensCalculo13(dados),
        fechado_em: new Date().toISOString(), fechado_por: usuarioNome, atualizado_em: new Date().toISOString()
      }, { onConflict: 'funcionario_nome,ano' });
      if (error) throw new Error(`${f.nome_completo}: ${error.message}`);
      fechados++;
    }

    await registrarLogAuditoria({
      usuario_nome: usuarioNome, acao: `FECHOU 13º SALÁRIO INTEGRAL ${ano}: ${fechados} funcionário(s)`,
      setor: 'RECURSOS HUMANOS / 13º SALÁRIO'
    });

    return { ok: true, info: { fechados, ignorados, zerados } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// REABRIR — só permitido se NENHUMA parcela foi paga ainda (nem manual, nem
// via lote bancário). Mesmo raciocínio de reabrirFolhaAction: apaga o
// snapshot, a tela recalcula ao vivo de novo.
// ============================================================================
export async function reabrirDecimoTerceiroAction(payload: {
  id: number; usuarioNome: string; descricao: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r } = await db.from('folha_decimo_terceiro').select('*').eq('id', payload.id).maybeSingle();
    if (!r) return { ok: false, erro: '13º não encontrado.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: '13º não encontrado.' };
    if (r.parcela1_pago_em || r.parcela2_pago_em) {
      return { ok: false, erro: 'Não é possível reabrir: uma ou as duas parcelas já foram pagas. Desfaça a marcação de pago antes (se foi manual) ou isso não pode ser revertido.' };
    }

    const { error } = await db.from('folha_decimo_terceiro').delete().eq('id', payload.id);
    if (error) throw new Error(error.message);

    await registrarLogAuditoria({
      usuario_nome: payload.usuarioNome, acao: `REABRIU 13º SALÁRIO INTEGRAL ${r.ano}: ${r.funcionario_nome} — ${payload.descricao}`,
      setor: 'RECURSOS HUMANOS / 13º SALÁRIO'
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// MARCAR/DESMARCAR PARCELA PAGA MANUALMENTE — mesmo campo pago_em que o lote
// PIX do Financeiro grava automaticamente (ver actions-financeiro.ts). Serve
// pra pagamento feito por fora do lote (TED manual, etc.). Desmarcar só é
// permitido se foi marcada manualmente (pago_lote_id nulo).
// ============================================================================
export async function marcarParcela13PagaAction(payload: {
  id: number; parcela: 1 | 2; pago: boolean; usuarioNome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const campoPago = payload.parcela === 1 ? 'parcela1_pago_em' : 'parcela2_pago_em';
  const campoLote = payload.parcela === 1 ? 'parcela1_pago_lote_id' : 'parcela2_pago_lote_id';

  try {
    const { data: r } = await db.from('folha_decimo_terceiro').select(`funcionario_nome, empresa_id, ano, ${campoPago}, ${campoLote}`).eq('id', payload.id).maybeSingle();
    if (!r) return { ok: false, erro: '13º não encontrado.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, (r as any).empresa_id)) return { ok: false, erro: '13º não encontrado.' };

    if (payload.pago) {
      if ((r as any)[campoPago]) return { ok: true }; // idempotente
      const { error } = await db.from('folha_decimo_terceiro')
        .update({ [campoPago]: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', payload.id);
      if (error) throw new Error(error.message);
      await registrarLogAuditoria({
        usuario_nome: payload.usuarioNome, acao: `MARCOU ${payload.parcela}ª PARCELA DO 13º (${(r as any).ano}) COMO PAGA MANUALMENTE: ${(r as any).funcionario_nome}`,
        setor: 'RECURSOS HUMANOS / 13º SALÁRIO'
      });
    } else {
      if ((r as any)[campoLote]) return { ok: false, erro: 'Esta parcela foi paga via lote bancário do Financeiro — não é possível desmarcar por aqui.' };
      if (!(r as any)[campoPago]) return { ok: true }; // idempotente
      const { error } = await db.from('folha_decimo_terceiro')
        .update({ [campoPago]: null, atualizado_em: new Date().toISOString() }).eq('id', payload.id);
      if (error) throw new Error(error.message);
      await registrarLogAuditoria({
        usuario_nome: payload.usuarioNome, acao: `DESFEZ MARCAÇÃO DE PAGA DA ${payload.parcela}ª PARCELA DO 13º (${(r as any).ano}): ${(r as any).funcionario_nome}`,
        setor: 'RECURSOS HUMANOS / 13º SALÁRIO'
      });
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ENVIAR PARA ASSINATURA (Autentique) — uma parcela por vez. Reaproveita a
// MESMA tabela/integração usada pelos holerites e pela rescisão
// (folha_holerite_assinaturas), com marcador próprio (13-{ano}-P{parcela}).
// ============================================================================
export async function enviarDecimoTerceiroAssinaturaAction(payload: {
  id: number; parcela: 1 | 2; usuarioNome: string; sandbox: boolean;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { id, parcela, usuarioNome, sandbox } = payload;

  try {
    const { data: r } = await db.from('folha_decimo_terceiro').select('*').eq('id', id).maybeSingle();
    if (!r) return { ok: false, erro: '13º não encontrado.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: '13º não encontrado.' };

    const marcador = marcadorAssinatura13(r.ano, parcela);
    const { data: existente } = await db.from('folha_holerite_assinaturas').select('status').eq('funcionario_nome', r.funcionario_nome).eq('mes_referencia', marcador).maybeSingle();
    if (existente?.status === 'ASSINADO') return { ok: false, erro: 'Esta parcela já foi assinada. Não é possível reenviar.' };

    const { data: func } = await filtrarFicha(db.from('folha_funcionarios').select('cpf, celular, email, cargo, empresa_id'), { funcionarioId: r.funcionario_id, funcionarioNome: r.funcionario_nome }).maybeSingle();
    const cpfLimpo = (func?.cpf || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) return { ok: false, erro: `CPF de ${r.funcionario_nome} ausente ou inválido. Preencha o CPF na ficha antes de enviar.` };
    const celularE164 = normalizarCelularBR(func?.celular);
    if (!celularE164 && !func?.email) return { ok: false, erro: `Informe celular ou e-mail de ${r.funcionario_nome} na ficha para enviar o link de assinatura.` };

    const nomeEmpresa = await nomeEmpresaDoFuncionario(db, func?.empresa_id ?? r.empresa_id);
    const valorPago = parcela === 1 ? Number(r.parcela1_valor) : Number(r.parcela2_valor);
    if (!(valorPago > 0)) return { ok: false, erro: `A ${parcela}ª parcela de ${r.funcionario_nome} está zerada — reabra, corrija o valor e feche de novo antes de enviar.` };
    // Parcelas digitadas (Via Empresa) fecham com INSS e IRRF zerados — no
    // cálculo sugerido o INSS nunca é zero com bruto > 0, então isso basta
    // pra saber qual recibo montar.
    const manual = Number(r.inss_valor) === 0 && Number(r.irrf_valor) === 0;
    const detalhamento = manual
      ? (parcela === 1
          ? [{ descricao: '1ª parcela do 13º salário', valor: Number(r.parcela1_valor) }]
          : [
              { descricao: '13º salário (1ª + 2ª parcela)', valor: Number(r.valor_bruto) },
              { descricao: '1ª parcela já paga', valor: Number(r.parcela1_valor) },
              { descricao: '2ª parcela do 13º salário', valor: Number(r.parcela2_valor) },
            ])
      : parcela === 1
      ? [
          { descricao: '13º salário integral (bruto)', valor: Number(r.valor_bruto) },
          { descricao: '1ª parcela — 50% do bruto, sem desconto', valor: Number(r.parcela1_valor) },
        ]
      : [
          { descricao: '13º salário integral (bruto)', valor: Number(r.valor_bruto) },
          { descricao: '1ª parcela já paga', valor: Number(r.parcela1_valor) },
          { descricao: 'INSS sobre o 13º (tributação exclusiva)', valor: Number(r.inss_valor) },
          { descricao: 'IRRF sobre o 13º (tributação exclusiva)', valor: Number(r.irrf_valor) },
          { descricao: '2ª parcela líquida', valor: Number(r.parcela2_valor) },
        ];

    const pdfBytes = await gerarRecibo13Pdf({
      nome: r.funcionario_nome, cpf: func?.cpf || null, cargo: func?.cargo || null,
      ano: r.ano, parcela, valorPago, detalhamento, calculadoEm: r.fechado_em, empresaNome: nomeEmpresa
    });

    const doc = await autentiqueCriarDocumento({
      nomeDocumento: `13º Salário ${parcela}ª Parcela ${r.ano} — ${r.funcionario_nome}`,
      signatarioNome: r.funcionario_nome,
      signatarioCpf: cpfLimpo,
      signatarioCelular: celularE164 || undefined,
      signatarioEmail: func?.email || undefined,
      pdfBuffer: pdfBytes,
      pdfNomeArquivo: `13o-salario-${parcela}a-parcela-${r.ano}-${slug(r.funcionario_nome)}.pdf`,
      sandbox
    });

    const { error } = await db.from('folha_holerite_assinaturas').upsert({
      funcionario_nome: r.funcionario_nome, empresa_id: r.empresa_id, mes_referencia: marcador,
      cpf: cpfLimpo, autentique_doc_id: doc.docId, public_id: doc.publicId, link_assinatura: doc.linkAssinatura,
      status: 'ENVIADO', sandbox, enviado_por: usuarioNome || null, enviado_em: new Date().toISOString(), atualizado_em: new Date().toISOString()
    }, { onConflict: 'funcionario_nome,mes_referencia' });
    if (error) throw new Error(`Documento criado na Autentique (${doc.docId}), mas falha ao gravar o controle: ${error.message}`);

    await registrarLogAuditoria({
      usuario_nome: usuarioNome || 'Sistema', acao: `ENVIOU ${parcela}ª PARCELA DO 13º (${r.ano}) PARA ASSINATURA (AUTENTIQUE)`,
      setor: 'RECURSOS HUMANOS / 13º SALÁRIO', equipamento_nome: r.funcionario_nome,
    });

    return { ok: true, info: { docId: doc.docId, link: doc.linkAssinatura, sandbox } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function consultarAssinatura13Action(payload: { id: number; parcela: 1 | 2 }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoDecimo13(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const db = supabaseAdmin();
  const { data: r } = await db.from('folha_decimo_terceiro').select('funcionario_id, funcionario_nome, empresa_id, ano').eq('id', payload.id).maybeSingle();
  if (!r) return { ok: false, erro: '13º não encontrado.' };
  const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: '13º não encontrado.' };
  return consultarAssinaturaAction({ funcionarioId: r.funcionario_id, funcionarioNome: r.funcionario_nome, mesReferencia: marcadorAssinatura13(r.ano, payload.parcela) }, accessToken);
}

export async function baixarAssinado13Action(payload: { id: number; parcela: 1 | 2 }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoDecimo13(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const db = supabaseAdmin();
  const { data: r } = await db.from('folha_decimo_terceiro').select('funcionario_id, funcionario_nome, empresa_id, ano').eq('id', payload.id).maybeSingle();
  if (!r) return { ok: false, erro: '13º não encontrado.' };
  const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: '13º não encontrado.' };
  return baixarAssinadoAction({ funcionarioId: r.funcionario_id, funcionarioNome: r.funcionario_nome, mesReferencia: marcadorAssinatura13(r.ano, payload.parcela) }, accessToken);
}

// ============================================================================
// LISTAGEM PARA A ABA "13º SALÁRIO" DE /admin/rh/assinaturas
// ============================================================================
export async function listarAssinaturas13Action(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoDecimo13(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let q = db.from('folha_holerite_assinaturas').select('*').like('mes_referencia', '13-%').order('enviado_em', { ascending: false });
    if (empresasPermitidas) q = q.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const linhas = (data || []).map(a => {
      const m = String(a.mes_referencia).match(/^13-(\d+)-P([12])$/);
      return { ...a, ano13: m ? Number(m[1]) : null, parcela13: m ? Number(m[2]) : null };
    });

    const pares = linhas.filter(l => l.ano13 != null).map(l => ({ nome: l.funcionario_nome, ano: l.ano13 as number }));
    const idsPorChave: Record<string, number> = {};
    if (pares.length > 0) {
      const anos = Array.from(new Set(pares.map(p => p.ano)));
      const nomes = Array.from(new Set(pares.map(p => p.nome)));
      const { data: linhas13 } = await db.from('folha_decimo_terceiro').select('id, funcionario_nome, ano').in('ano', anos).in('funcionario_nome', nomes);
      (linhas13 || []).forEach(l => { idsPorChave[`${l.funcionario_nome}::${l.ano}`] = l.id; });
    }

    const resultado = linhas.map(l => ({
      ...l,
      decimoTerceiroId: l.ano13 != null ? (idsPorChave[`${l.funcionario_nome}::${l.ano13}`] ?? null) : null
    }));

    return { ok: true, info: { assinaturas: resultado } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
