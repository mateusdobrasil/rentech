// app/lib/ponto/afdCore.ts
// Geração do AFD a partir do ledger do ponto via WhatsApp
// (folha_ponto_whatsapp_registros). Só servidor, SEM checagem de acesso — quem
// chama é app/admin/rh/actions/actions-afd.ts.
//
// Cada marcação vira uma linha tipo "7" CONGELADA em folha_ponto_afd_registros
// na primeira geração: o CPF entra no hash, então se a ficha mudar depois o
// AFD já entregue continua idêntico. O encadeamento do hash segue o NSR do
// ledger inteiro (é um REP-P só), e um buraco no NSR trava a geração.
// O AFD só traz as marcações originais: ajuste manual, abono e "descartar o
// dia" ficam fora (tratamento é outro arquivo, o AEJ).
import type { supabaseAdmin } from '../supabase';
import {
  linhaCabecalho, linhaMarcacao, linhaTrailer, linhaAssinatura, nomeArquivoAfd, montarArquivoAfd, campoD,
  type ColetorAfd, type RepPAfd,
} from './afd';
import { assinarCadesDestacado, infoCertificado, type CertificadoA1 } from './assinaturaCades';

type Db = ReturnType<typeof supabaseAdmin>;
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const LOTE = 1000;

export interface ParametrosAfd { inpiRegistro: string; desenvolvedorDocumento: string; coletor: ColetorAfd; semSql?: boolean }

export async function lerParametrosAfd(db: Db): Promise<ParametrosAfd> {
  const { data, error } = await db.from('parametros_ponto_afd').select('inpi_registro, desenvolvedor_documento, coletor').eq('id', 1).maybeSingle();
  if (error) return { inpiRegistro: '', desenvolvedorDocumento: '', coletor: '01', semSql: true };
  return { inpiRegistro: data?.inpi_registro || '', desenvolvedorDocumento: data?.desenvolvedor_documento || '', coletor: (data?.coletor || '01') as ColetorAfd };
}

/** Certificado A1 da empresa: o .pfx do ambiente vale se o CNPJ dele for o da empresa. */
export function certificadoDaEmpresa(cnpjEmpresa: string): { cert: CertificadoA1; titular: string; validoAte: string } | null {
  const e = process.env;
  const opcoes: [string | undefined, string | undefined][] = [
    [e.AFD_CERT_PFX_BASE64, e.AFD_CERT_SENHA],
    [e.GOVBR_CONSIGNADO_CERT_PFX_BASE64, e.GOVBR_CONSIGNADO_CERT_SENHA],
    [e.INFOSIMPLES_PFX_BASE64, e.INFOSIMPLES_PFX_SENHA],
  ];
  for (const [pfxBase64, senha] of opcoes) {
    if (!pfxBase64 || !senha) continue;
    try {
      const cert = { pfxBase64, senha };
      const info = infoCertificado(cert);
      // e-CNPJ ICP-Brasil: o CN termina em ":<CNPJ>"
      if (dig(info.titular.split(':').pop()) === dig(cnpjEmpresa)) return { cert, ...info };
    } catch { /* .pfx ilegível: tenta o próximo */ }
  }
  return null;
}

interface LinhaLedger { nsr: number; funcionario_nome: string; empresa_id: number | null; data_hora_batida: string; criado_em: string }
interface LinhaCongelada { nsr: number; empresa_id: number | null; funcionario_nome: string; cpf: string; data_marcacao: string; hash: string; linha: string }

async function ledgerDesde(db: Db, depoisDoNsr: number): Promise<LinhaLedger[]> {
  const todas: LinhaLedger[] = [];
  for (let de = 0; ; de += LOTE) {
    const { data, error } = await db.from('folha_ponto_whatsapp_registros')
      .select('nsr, funcionario_nome, empresa_id, data_hora_batida, criado_em')
      .gt('nsr', depoisDoNsr).order('nsr').range(de, de + LOTE - 1);
    if (error) throw new Error(error.message);
    todas.push(...((data || []) as LinhaLedger[]));
    if (!data || data.length < LOTE) break;
  }
  return todas;
}

/** CPF e empresa de cada funcionário do ledger (pelo nome da ficha). Falta de CPF trava. */
async function fichasPorNome(db: Db, nomes: string[]): Promise<Map<string, { cpf: string; empresa_id: number | null }>> {
  const mapa = new Map<string, { cpf: string; empresa_id: number | null }>();
  const unicos = [...new Set(nomes)];
  for (let i = 0; i < unicos.length; i += 200) {
    const { data, error } = await db.from('folha_funcionarios').select('nome_completo, cpf, empresa_id, ativo').in('nome_completo', unicos.slice(i, i + 200));
    if (error) throw new Error(error.message);
    // readmissão (duas fichas com o mesmo nome): a ativa primeiro
    for (const f of (data || []).sort((a, b) => Number(!!b.ativo) - Number(!!a.ativo))) {
      const cpf = dig(f.cpf);
      const chave = norm(f.nome_completo);
      if (cpf.length === 11 && !mapa.has(chave)) mapa.set(chave, { cpf, empresa_id: f.empresa_id ?? null });
    }
  }
  return mapa;
}

/**
 * Transforma as marcações ainda não congeladas em linhas tipo "7", encadeando
 * o hash a partir da última congelada. `gravar=false` só calcula (simulação).
 */
export async function congelarMarcacoes(db: Db, coletor: ColetorAfd, gravar = true): Promise<{ novas: LinhaCongelada[]; ultimoNsr: number }> {
  const { data: ult, error: eUlt } = await db.from('folha_ponto_afd_registros').select('nsr, hash').order('nsr', { ascending: false }).limit(1);
  if (eUlt && gravar) throw new Error(/folha_ponto_afd_registros/.test(eUlt.message) ? 'Falta rodar o SQL do AFD (.sql/Pendentes/ponto_afd_portaria_671.sql).' : eUlt.message);
  let nsrAnterior = Number(ult?.[0]?.nsr || 0);
  let hashAnterior: string | null = ult?.[0]?.hash || null;

  const pendentes = await ledgerDesde(db, nsrAnterior);
  if (!pendentes.length) return { novas: [], ultimoNsr: nsrAnterior };

  const fichas = await fichasPorNome(db, pendentes.map(p => p.funcionario_nome));
  const semCpf = [...new Set(pendentes.filter(p => !fichas.has(norm(p.funcionario_nome))).map(p => p.funcionario_nome))];
  if (semCpf.length) throw new Error(`Sem CPF válido na Ficha do RH (o AFD exige o CPF de cada marcação): ${semCpf.join(', ')}.`);

  const novas: LinhaCongelada[] = [];
  for (const p of pendentes) {
    if (Number(p.nsr) !== nsrAnterior + 1) throw new Error(`Buraco no NSR do ledger: depois do ${nsrAnterior} veio o ${p.nsr}. Fale com o suporte antes de gerar o AFD.`);
    const ficha = fichas.get(norm(p.funcionario_nome))!;
    const { linha, hash } = linhaMarcacao({ nsr: Number(p.nsr), marcacao: p.data_hora_batida, gravacao: p.criado_em, cpf: ficha.cpf, coletor }, hashAnterior);
    novas.push({ nsr: Number(p.nsr), empresa_id: p.empresa_id ?? ficha.empresa_id, funcionario_nome: p.funcionario_nome, cpf: ficha.cpf, data_marcacao: campoD(p.data_hora_batida), hash, linha });
    nsrAnterior = Number(p.nsr);
    hashAnterior = hash;
  }

  if (gravar) {
    for (let i = 0; i < novas.length; i += 500) {
      const { error } = await db.from('folha_ponto_afd_registros').insert(novas.slice(i, i + 500));
      if (error) {
        if (/duplicate key/i.test(error.message)) throw new Error('Outro AFD estava sendo gerado ao mesmo tempo. Gere de novo.');
        throw new Error(error.message);
      }
    }
  }
  return { novas, ultimoNsr: nsrAnterior };
}

async function congeladasDoPeriodo(db: Db, empresaId: number, inicio: string, fim: string): Promise<LinhaCongelada[]> {
  const todas: LinhaCongelada[] = [];
  for (let de = 0; ; de += LOTE) {
    const { data, error } = await db.from('folha_ponto_afd_registros')
      .select('nsr, empresa_id, funcionario_nome, cpf, data_marcacao, hash, linha')
      .eq('empresa_id', empresaId).gte('data_marcacao', inicio).lte('data_marcacao', fim)
      .order('nsr').range(de, de + LOTE - 1);
    if (error) throw new Error(error.message);
    todas.push(...((data || []) as LinhaCongelada[]));
    if (!data || data.length < LOTE) break;
  }
  return todas;
}

export interface ResultadoAfd {
  nomeBase: string;
  txt: Buffer;
  p7s: Buffer | null;
  marcacoes: number;
  funcionarios: number;
  primeiroNsr: number | null;
  ultimoNsr: number | null;
  certificado: { titular: string; validoAte: string } | null;
  avisos: string[];
}

/** Monta o AFD da empresa no período. `simular=true` não grava nada (calcula o congelamento em memória). */
export async function gerarAfd(db: Db, opts: { empresaId: number; inicio: string; fim: string; simular?: boolean; agora?: Date }): Promise<ResultadoAfd> {
  const agora = opts.agora || new Date();
  const params = await lerParametrosAfd(db);
  if (params.semSql && !opts.simular) throw new Error('Falta rodar o SQL do AFD (.sql/Pendentes/ponto_afd_portaria_671.sql).');

  const { data: emp, error: eEmp } = await db.from('empresas').select('id, razao_social, nome, cnpj').eq('id', opts.empresaId).maybeSingle();
  if (eEmp) throw new Error(eEmp.message);
  if (!emp) throw new Error('Empresa não encontrada.');
  const cnpj = dig(emp.cnpj);
  if (cnpj.length !== 14) throw new Error('A empresa está sem CNPJ válido no cadastro.');

  const { novas } = await congelarMarcacoes(db, params.coletor, !opts.simular);
  // simulação: as já congeladas do período (se o SQL existe) + as novas calculadas em memória
  const linhas = opts.simular
    ? [
      ...(params.semSql ? [] : await congeladasDoPeriodo(db, opts.empresaId, opts.inicio, opts.fim)),
      ...novas.filter(n => n.empresa_id === opts.empresaId && n.data_marcacao >= opts.inicio && n.data_marcacao <= opts.fim),
    ].sort((a, b) => a.nsr - b.nsr)
    : await congeladasDoPeriodo(db, opts.empresaId, opts.inicio, opts.fim);

  const rep: RepPAfd = { inpiRegistro: params.inpiRegistro, desenvolvedorDocumento: params.desenvolvedorDocumento || cnpj };
  const conteudo = [
    linhaCabecalho({ documento: cnpj, razaoSocial: emp.razao_social || emp.nome }, rep, { inicio: opts.inicio, fim: opts.fim }, agora),
    ...linhas.map(l => l.linha),
    linhaTrailer({ t7: linhas.length }),
    linhaAssinatura(),
  ];
  const txt = montarArquivoAfd(conteudo);

  const avisos: string[] = [];
  if (!params.inpiRegistro) avisos.push('Sem o número de registro no INPI: o cabeçalho e o nome do arquivo saem com zeros.');
  if (!linhas.length) avisos.push('Nenhuma marcação desta empresa no período.');
  const cert = certificadoDaEmpresa(cnpj);
  let p7s: Buffer | null = null;
  if (cert) p7s = assinarCadesDestacado(txt, cert.cert, agora).p7s;
  else avisos.push('Sem certificado digital (e-CNPJ A1) desta empresa: o .p7s não foi gerado.');

  return {
    nomeBase: nomeArquivoAfd(rep, cnpj),
    txt, p7s,
    marcacoes: linhas.length,
    funcionarios: new Set(linhas.map(l => l.cpf)).size,
    primeiroNsr: linhas[0]?.nsr ?? null,
    ultimoNsr: linhas.at(-1)?.nsr ?? null,
    certificado: cert ? { titular: cert.titular, validoAte: cert.validoAte } : null,
    avisos,
  };
}
