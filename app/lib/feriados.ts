// Feriados aplicáveis a um funcionário, considerando a empresa dele.
//
// `folha_feriados.empresa_id` NULL = feriado geral (nacional, ou estadual — as
// duas empresas são de SP). Preenchido = feriado municipal daquela empresa:
// Rentech fica em São Paulo/SP e Alfa Light em Osasco/SP, então o municipal de
// uma não pode entrar no cálculo da outra.
//
// Só funções puras aqui, sobre as linhas já lidas: quem consulta usa o client
// que tem em mãos (supabaseAdmin no servidor, supabase no browser) e passa o
// resultado. Assim o mesmo helper serve Server Action e componente client.

export interface LinhaFeriado {
  data_feriado: string;
  // Opcional porque a coluna entra por migração e os chamadores usam
  // select('*'): antes do SQL rodar, o campo simplesmente não vem e tudo é
  // tratado como feriado geral — que é o comportamento de hoje.
  empresa_id?: number | null;
}

export interface IndiceFeriados {
  gerais: Set<string>;
  porEmpresa: Map<number, Set<string>>;
}

export function indexarFeriados(linhas: LinhaFeriado[] | null | undefined): IndiceFeriados {
  const gerais = new Set<string>();
  const porEmpresa = new Map<number, Set<string>>();

  for (const f of linhas || []) {
    if (!f?.data_feriado) continue;
    const empresaId = f.empresa_id ?? null;
    if (empresaId === null) {
      gerais.add(f.data_feriado);
      continue;
    }
    let doGrupo = porEmpresa.get(empresaId);
    if (!doGrupo) { doGrupo = new Set<string>(); porEmpresa.set(empresaId, doGrupo); }
    doGrupo.add(f.data_feriado);
  }

  return { gerais, porEmpresa };
}

// Datas que valem para a empresa informada: os gerais + os municipais dela.
// Sem empresa (funcionário histórico sem vínculo), só os gerais — nunca os
// municipais de outra empresa.
export function feriadosDaEmpresa(indice: IndiceFeriados, empresaId: number | null | undefined): Set<string> {
  const daEmpresa = empresaId ? indice.porEmpresa.get(empresaId) : undefined;
  if (!daEmpresa || daEmpresa.size === 0) return indice.gerais;
  return new Set([...indice.gerais, ...daEmpresa]);
}

// Atalho para laços que percorrem funcionários de empresas diferentes no mesmo
// lote (fechamento, relatórios), sem precisar montar um Set por funcionário.
export function ehFeriado(indice: IndiceFeriados, dataIso: string, empresaId: number | null | undefined): boolean {
  if (indice.gerais.has(dataIso)) return true;
  if (!empresaId) return false;
  return indice.porEmpresa.get(empresaId)?.has(dataIso) ?? false;
}
