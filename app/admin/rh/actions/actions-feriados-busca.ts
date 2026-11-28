'use server';

// app/admin/rh/actions/actions-feriados-busca.ts
// Botão "Buscar feriados do ano" de RH → Parâmetros → Feriados (2026-11-28).
// 1) buscarFeriadosAnoAction: nacionais pela BrasilAPI + (opcional) estaduais e
//    municipais das cidades das empresas pela IA com pesquisa na web. Devolve
//    uma prévia, já marcando o que está cadastrado — não grava nada.
// 2) importarFeriadosAction: grava só as linhas que o usuário marcou, com a
//    mesma regra do cadastro manual (salvarFeriadoAction).
//
// empresa_id null = feriado de todas as empresas (nacional e estadual quando
// todas ficam no mesmo estado); preenchido = vale só para aquela empresa.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { feriadosNacionais, feriadosLocaisIA, normalizar, MODELO_FERIADOS } from '../../../lib/feriados/buscarFeriados';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/rh/parametros';

export interface LinhaFeriadoSugerido {
  chave: string;
  data: string;                 // AAAA-MM-DD
  descricao: string;
  esfera: 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL';
  empresa_id: number | null;    // null = todas
  local: string | null;         // "SP" ou "Osasco/SP"
  base_legal: string | null;
  fonte_url: string | null;
  confianca: 'ALTA' | 'MEDIA' | 'BAIXA' | null;
  observacao: string | null;
  situacao: 'NOVO' | 'JA_CADASTRADO' | 'COBERTO_POR_TODAS';
  cadastradoComo: string | null; // descrição do que já existe nessa data
}

// Nacionais que, pela lei federal, são só ponto facultativo — o RH decide
const PONTO_FACULTATIVO = /carnaval|corpus christi/i;

export async function buscarFeriadosAnoAction(payload: { ano: number; incluirLocais: boolean }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const ano = Number(payload.ano);
  if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) return { ok: false, erro: 'Ano inválido.' };

  try {
    const db = supabaseAdmin();
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: empresasTodas, error: eEmp } = await db.from('empresas').select('id, nome, cidade, uf').eq('ativo', true).order('id');
    if (eEmp) throw new Error(eEmp.message);
    const empresas = ((empresasTodas || []) as { id: number; nome: string; cidade: string | null; uf: string | null }[])
      .filter(e => empresasPermitidas === null || empresasPermitidas.includes(e.id));
    if (empresas.length === 0) return { ok: false, erro: 'Nenhuma empresa liberada para o seu usuário.' };

    // Quem enxerga todas as empresas grava "todas" (null); quem só enxerga
    // algumas grava uma linha por empresa (salvarFeriadoAction não deixa
    // gravar "todas" nesse caso).
    const alvoTodas = (ids: number[]): (number | null)[] =>
      empresasPermitidas === null && ids.length === (empresasTodas || []).length ? [null] : ids;

    const avisos: string[] = [];
    let nacionais: Awaited<ReturnType<typeof feriadosNacionais>> = [];
    try { nacionais = await feriadosNacionais(ano); } catch (e: any) { avisos.push(`Feriados nacionais indisponíveis agora (BrasilAPI): ${e.message}`); }

    const sugeridos: Omit<LinhaFeriadoSugerido, 'chave' | 'situacao' | 'cadastradoComo'>[] = [];
    for (const n of nacionais) {
      for (const empresa_id of alvoTodas(empresas.map(e => e.id))) {
        sugeridos.push({
          data: n.data, descricao: n.nome, esfera: 'NACIONAL', empresa_id, local: 'Brasil',
          base_legal: null, fonte_url: 'https://brasilapi.com.br', confianca: 'ALTA',
          observacao: PONTO_FACULTATIVO.test(n.nome) ? 'Ponto facultativo pela lei federal — a empresa decide se é folga.' : null,
        });
      }
    }

    let ia: { buscas: number; tokensEntrada: number; tokensSaida: number; modelo: string } | null = null;
    if (payload.incluirLocais) {
      const comCidade = empresas.filter(e => e.cidade && e.uf);
      const semCidade = empresas.filter(e => !e.cidade || !e.uf);
      if (semCidade.length) avisos.push(`Sem cidade/UF no cadastro (Parâmetros → Empresas): ${semCidade.map(e => e.nome).join(', ')} — municipais não pesquisados.`);
      const locais = [...new Map(comCidade.map(e => [`${normalizar(e.cidade!)}|${e.uf!.toUpperCase()}`, { cidade: e.cidade!, uf: e.uf!.toUpperCase() }])).values()];
      if (locais.length) {
        const r = await feriadosLocaisIA(ano, locais, nacionais);
        if (!r.ok) avisos.push(`Estaduais e municipais: ${r.erro}`);
        else {
          avisos.push(...r.avisos.map(a => `IA: ${a}`));
          ia = { buscas: r.buscas, tokensEntrada: r.tokensEntrada, tokensSaida: r.tokensSaida, modelo: MODELO_FERIADOS };
          for (const f of r.feriados) {
            const ids = f.esfera === 'ESTADUAL'
              ? comCidade.filter(e => e.uf!.toUpperCase() === f.uf.toUpperCase()).map(e => e.id)
              : comCidade.filter(e => e.uf!.toUpperCase() === f.uf.toUpperCase() && normalizar(e.cidade!) === normalizar(f.cidade || '')).map(e => e.id);
            const alvos = f.esfera === 'ESTADUAL' ? alvoTodas(ids) : ids;
            for (const empresa_id of alvos) {
              sugeridos.push({
                data: f.data, descricao: f.nome, esfera: f.esfera, empresa_id,
                local: f.esfera === 'ESTADUAL' ? f.uf.toUpperCase() : `${f.cidade}/${f.uf.toUpperCase()}`,
                base_legal: f.base_legal || null, fonte_url: f.fonte_url || null, confianca: f.confianca, observacao: f.observacao,
              });
            }
          }
          registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: `BUSCOU FERIADOS ${ano} COM IA (${r.feriados.length} estaduais/municipais, ${r.buscas} buscas na web)`, setor: 'RH' });
        }
      }
    }

    // O que já está cadastrado no ano
    const { data: existentes, error: eFer } = await db.from('folha_feriados').select('data_feriado, descricao, empresa_id')
      .gte('data_feriado', `${ano}-01-01`).lte('data_feriado', `${ano}-12-31`);
    if (eFer) throw new Error(eFer.message);
    const existe = new Map<string, string>();
    ((existentes || []) as any[]).forEach(f => existe.set(`${f.data_feriado}|${f.empresa_id ?? 'T'}`, f.descricao || ''));

    const vistos = new Set<string>();
    const linhas: LinhaFeriadoSugerido[] = [];
    for (const s of sugeridos) {
      const chave = `${s.data}|${s.empresa_id ?? 'T'}`;
      if (vistos.has(chave)) continue; // mesma data e alvo vinda de duas fontes: fica a primeira (nacional)
      vistos.add(chave);
      let situacao: LinhaFeriadoSugerido['situacao'] = 'NOVO';
      let cadastradoComo: string | null = null;
      if (existe.has(chave)) { situacao = 'JA_CADASTRADO'; cadastradoComo = existe.get(chave) || null; }
      else if (s.empresa_id !== null && existe.has(`${s.data}|T`)) { situacao = 'COBERTO_POR_TODAS'; cadastradoComo = existe.get(`${s.data}|T`) || null; }
      linhas.push({ ...s, chave, situacao, cadastradoComo });
    }
    linhas.sort((a, b) => a.data.localeCompare(b.data) || String(a.empresa_id ?? 0).localeCompare(String(b.empresa_id ?? 0)));

    return { ok: true, info: { ano, linhas, avisos, ia, empresas: empresas.map(e => ({ id: e.id, nome: e.nome, cidade: e.cidade, uf: e.uf })) } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function importarFeriadosAction(payload: { itens: { data: string; descricao: string; empresa_id: number | null }[] }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const itens = (payload.itens || []).slice(0, 300);
  if (itens.length === 0) return { ok: false, erro: 'Nenhum feriado marcado.' };

  try {
    const db = supabaseAdmin();
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let gravados = 0, jaExistiam = 0;
    const erros: string[] = [];
    for (const it of itens) {
      const empresaId = it.empresa_id ?? null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(it.data))) { erros.push(`Data inválida: ${it.data}`); continue; }
      if (empresasPermitidas !== null && (empresaId === null || !empresasPermitidas.includes(empresaId))) {
        erros.push(`${it.data}: sem permissão para esta empresa.`); continue;
      }
      const { error } = await db.from('folha_feriados').insert({
        data_feriado: it.data,
        descricao: String(it.descricao || '').toUpperCase().trim().slice(0, 120) || null,
        empresa_id: empresaId,
      });
      if (!error) gravados++;
      else if (error.code === '23505') jaExistiam++;
      else erros.push(`${it.data}: ${error.message}`);
    }
    if (gravados) registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: `CADASTROU ${gravados} FERIADO(S) PELA BUSCA DO ANO`, setor: 'RH' });
    return { ok: true, info: { gravados, jaExistiam, erros } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
