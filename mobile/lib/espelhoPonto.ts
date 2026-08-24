// Espelho da lógica pura de app/portal/EspelhoPonto.tsx (web/), sem React —
// mesma classificação dia a dia (falta/feriado/DSR/abono) e mesma detecção de
// virada de turno, usadas pela tela nativa app/meu-ponto.tsx. Mantenha os dois
// arquivos em sincronia.

export interface RegistroDia {
  data: string;
  entrada_1: string | null;
  saida_1: string | null;
  entrada_2: string | null;
  saida_2: string | null;
  minutosTrabalhados: number;
  minutosAbonados: number;
  motivoAbono: string | null;
}

export interface LinhaEspelho {
  dataIso: string;
  diaSemana: number;
  reg: RegistroDia | undefined;
  observacao: string;
  alerta: boolean;
}

export const DIAS_SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

export const hhmm = (min: number): string =>
  `${Math.floor((min || 0) / 60).toString().padStart(2, '0')}:${((min || 0) % 60).toString().padStart(2, '0')}`;

export const hhmmBatida = (t: string | null): string => (t ? t.slice(0, 5) : '--:--');

function timeToMinutesLocal(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return (h * 60) + m;
}

// Pra cada uma das 4 batidas (Entrada, Saída Alm., Ret. Alm., Saída), indica
// se ela caiu no dia seguinte à data do registro — detectado comparando com
// a batida anterior: se o horário "voltou pra trás", só pode ser porque
// virou a meia-noite (turno noturno, ex.: entrou 08:13 e só saiu 01:57).
export function diasSeguintesBatidas(
  e1: string | null,
  s1: string | null,
  e2: string | null,
  s2: string | null
): boolean[] {
  let diaAtual = 0;
  let anteriorMin: number | null = null;
  return [e1, s1, e2, s2].map(v => {
    if (!v) return false;
    const mins = timeToMinutesLocal(v);
    if (anteriorMin !== null && mins < anteriorMin) diaAtual += 1;
    anteriorMin = mins;
    return diaAtual > 0;
  });
}

export function mesAtualSaoPaulo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}

export function montarLinhas(
  registros: RegistroDia[],
  feriados: string[],
  dataAdmissao: string | null,
  dataDesligamento: string | null,
  mesReferencia: string
): LinhaEspelho[] {
  const porDia: Record<string, RegistroDia> = {};
  registros.forEach(r => { porDia[r.data] = r; });

  const [ano, mesNum] = mesReferencia.split('-').map(Number);
  const diasNoMes = new Date(ano, mesNum, 0).getDate();
  const hoje = new Date(); hoje.setHours(23, 59, 59, 999);

  const dias: LinhaEspelho[] = [];
  for (let d = 1; d <= diasNoMes; d++) {
    const data = new Date(ano, mesNum - 1, d);
    if (data > hoje) break;
    const dataIso = `${ano}-${String(mesNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (dataAdmissao && dataIso < dataAdmissao) continue;
    if (dataDesligamento && dataIso > dataDesligamento) continue;

    const diaSemana = data.getDay();
    const isFeriado = feriados.includes(dataIso);
    const reg = porDia[dataIso];
    const trabalhados = reg?.minutosTrabalhados || 0;
    const abonados = reg?.minutosAbonados || 0;
    const temRegistro = trabalhados > 0 || abonados > 0;

    let observacao = '';
    let alerta = false;
    if (isFeriado) observacao = temRegistro ? 'Trabalhado (feriado)' : 'Feriado';
    else if (diaSemana === 0) observacao = temRegistro ? 'Trabalhado (DSR)' : 'DSR';
    else if (!temRegistro && diaSemana !== 6) { observacao = 'Falta'; alerta = true; }
    if (abonados > 0) observacao = `Abono ${hhmm(abonados)}${reg?.motivoAbono ? ` — ${reg.motivoAbono}` : ''}`;

    dias.push({ dataIso, diaSemana, reg, observacao, alerta });
  }
  return dias;
}

export function calcularTotais(linhas: LinhaEspelho[]): { trabalhado: number; abonado: number; faltas: number } {
  let trabalhado = 0, abonado = 0, faltas = 0;
  linhas.forEach(l => {
    trabalhado += l.reg?.minutosTrabalhados || 0;
    abonado += l.reg?.minutosAbonados || 0;
    if (l.alerta) faltas++;
  });
  return { trabalhado, abonado, faltas };
}
