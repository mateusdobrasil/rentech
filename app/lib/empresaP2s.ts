// app/lib/empresaP2s.ts
// Qual empresa do sistema é dona de um registro do PrimeStart, pelo "Centro"
// (TCustomCentro) do registro — casando pelo CNPJ.
//
// Contexto (2026-11-15): no P2S há três centros — "Rentech" (22.618.891/0001-87),
// "ELITE" (10.353.694/0001-02, o CNPJ cadastrado da nossa Alfa Light) e
// "ALFA LIGHT" (34.075.821/0001-09, onde está o movimento atual da Alfa). O
// usuário confirmou que os DOIS últimos são da nossa Alfa Light. Antes a
// ligação era só pelo nome, e a ELITE ficava sem empresa.
//
// Regra:
// 1) CNPJ do Centro = CNPJ do cadastro da empresa, ou um dos "CNPJs no P2S"
//    extras dela (empresas.cnpjs_p2s, editável em Empresas do Grupo) → essa empresa;
// 2) sem casar por CNPJ → pelo nome (empresaIdPorNomeCentro), como antes;
// 3) nada casou → null (fica fora dos relatórios por empresa).
import { buscarObjeto, type AmbienteP2s } from './p2s';
import { empresaIdPorNomeCentro, type LinhaEmpresa } from './empresa';

export interface CentroP2s { nome: string | null; cnpj: string | null }

const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export async function resolverCentrosP2s(ambiente: AmbienteP2s, oids: (string | undefined)[]): Promise<Map<string, CentroP2s>> {
  const unicos = [...new Set(oids.filter((o): o is string => !!o && o !== 'null'))];
  const mapa = new Map<string, CentroP2s>();
  // São poucos centros (3 em 2026-11) — um GET por centro, em paralelo.
  const objetos = await Promise.all(unicos.map(oid => buscarObjeto(ambiente, oid).catch(() => null)));
  objetos.forEach((o, i) => {
    if (!o) return;
    const cnpj = digitos(o.CNPJ || o.ClientDummyCPF_CNPJ);
    mapa.set(unicos[i], {
      nome: String(o.NomeExibicao || o.NomeCompleto || o.Nome || '').trim() || null,
      cnpj: cnpj.length === 14 ? cnpj : null,
    });
  });
  return mapa;
}

export function cnpjsDaEmpresa(e: LinhaEmpresa): string[] {
  return [e.cnpj, ...(e.cnpjs_p2s || [])].map(digitos).filter(c => c.length === 14);
}

export function empresaIdDoCentroP2s(centro: CentroP2s | undefined | null, empresas: LinhaEmpresa[]): number | null {
  if (!centro) return null;
  if (centro.cnpj) {
    const porCnpj = empresas.find(e => cnpjsDaEmpresa(e).includes(centro.cnpj!));
    if (porCnpj) return porCnpj.id;
  }
  return empresaIdPorNomeCentro(centro.nome, empresas);
}
