// app/lib/cofre/consignado.ts
// Qual empresa consulta o Consignado GOV.BR (Dataprev) e em que ambiente.
// A empresa é a que tem o campo "Ambiente" do Consignado no cofre (Parâmetros
// → Empresas → Credenciais); o CNPJ é o do cadastro dela e o certificado A1
// é o dela. Sem isso, valem as variáveis antigas da Vercel
// (GOVBR_CONSIGNADO_CNPJ / GOVBR_CONSIGNADO_AMBIENTE).
import { supabaseAdmin } from '../supabase';
import { segredo } from './segredos';

export interface ConfigConsignado { cnpj: string; ambiente: 'producao' | 'homologacao'; empresaId: number | null }

const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const amb = (v: unknown): 'producao' | 'homologacao' => (String(v || '').toLowerCase() === 'producao' ? 'producao' : 'homologacao');

export async function configConsignado(): Promise<ConfigConsignado> {
  const db = supabaseAdmin();
  const { data } = await db.from('parametros_cofre').select('empresa_id').eq('nome', 'GOVBR_CONSIGNADO_AMBIENTE').not('empresa_id', 'is', null);
  const ids = [...new Set((data || []).map(d => d.empresa_id as number))];
  if (ids.length === 1) {
    const { data: e } = await db.from('empresas').select('cnpj').eq('id', ids[0]).maybeSingle();
    return { cnpj: dig(e?.cnpj), ambiente: amb(await segredo('GOVBR_CONSIGNADO_AMBIENTE', ids[0])), empresaId: ids[0] };
  }
  return { cnpj: dig(process.env.GOVBR_CONSIGNADO_CNPJ), ambiente: amb(process.env.GOVBR_CONSIGNADO_AMBIENTE), empresaId: null };
}
