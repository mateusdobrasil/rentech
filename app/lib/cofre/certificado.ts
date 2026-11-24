// app/lib/cofre/certificado.ts
// Certificado digital A1 (e-CNPJ) de uma empresa: .pfx + senha SEMPRE do
// mesmo lugar (o par do cofre da empresa, ou o par da Vercel) — nunca um
// arquivo de um lado e a senha do outro.
import { supabaseAdmin } from '../supabase';
import { resolverSegredo } from './segredos';

export interface CertificadoA1Cofre { pfxBase64: string; senha: string; origem: 'COFRE' | 'VERCEL' }

const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Certificado da empresa (empresaId) ou, sem id, o único cadastrado / o da Vercel. */
export async function certificadoA1(empresaId?: number | null): Promise<CertificadoA1Cofre | null> {
  const pfx = await resolverSegredo('CERT_A1_PFX_BASE64', empresaId);
  const senha = await resolverSegredo('CERT_A1_SENHA', empresaId);
  if (!pfx.valor || !senha.valor) return null;
  const doCofre = (o: typeof pfx.origem) => o === 'EMPRESA' || o === 'SISTEMA' || o === 'OUTRA_EMPRESA';
  if (doCofre(pfx.origem) !== doCofre(senha.origem)) return null; // par misturado: não usar
  return { pfxBase64: pfx.valor.replace(/\s/g, ''), senha: senha.valor, origem: doCofre(pfx.origem) ? 'COFRE' : 'VERCEL' };
}

/** Certificado pelo CNPJ da empresa (acha a empresa no cadastro). */
export async function certificadoA1PorCnpj(cnpj: string): Promise<CertificadoA1Cofre | null> {
  const d = dig(cnpj);
  if (d.length !== 14) return certificadoA1(null);
  const { data } = await supabaseAdmin().from('empresas').select('id').eq('cnpj', d).limit(1);
  return certificadoA1(data?.[0]?.id ?? null);
}
