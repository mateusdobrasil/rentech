// lib/autentique.ts
// Cliente isolado da API GraphQL da Autentique. Roda só no servidor.
// O token (AUTENTIQUE_API_TOKEN) vem do cofre Sistema (Parâmetros → Empresas →
// Credenciais) ou, sem ele, da Vercel.
//
// A API é GraphQL e o upload do PDF usa multipart (spec graphql-multipart-request).
// Doc: https://docs.autentique.com.br/api

import { segredo } from './cofre/segredos';

const AUTENTIQUE_URL = 'https://api.autentique.com.br/v2/graphql';

/** Token da Autentique (cofre → Vercel); undefined = não configurado. */
export async function tokenAutentique(): Promise<string | undefined> {
  return segredo('AUTENTIQUE_API_TOKEN');
}

async function getToken(): Promise<string> {
  const token = await tokenAutentique();
  if (!token) throw new Error('Token da Autentique não configurado: preencha em Parâmetros → Empresas → Sistema → Credenciais.');
  return token;
}

export interface CriarDocumentoParams {
  nomeDocumento: string;      // ex: "Holerite 06/2026 — João da Silva"
  signatarioNome: string;
  signatarioCpf?: string;     // trava a assinatura a este CPF (RH/OP). Omitido = sem trava (ex.: proposta para cliente PJ)
  signatarioCelular?: string; // formato E.164, ex: +5511990000000 (envio via WhatsApp)
  signatarioEmail?: string;   // alternativa ao celular
  pdfBuffer: Uint8Array;      // conteúdo do PDF do holerite (Buffer é um Uint8Array)
  pdfNomeArquivo: string;     // ex: "holerite-joao-2026-06.pdf"
  sandbox: boolean;           // true = teste, não gasta créditos
  // Vários signatários (ex.: contrato de locação: cliente + representante da
  // locadora). Quando vem, substitui o signatário único acima.
  signatarios?: { nome: string; cpf?: string; celular?: string; email?: string }[];
}

export interface CriarDocumentoResultado {
  docId: string;
  publicId: string | null;
  linkAssinatura: string | null;
  /** Um por signatário, na ordem enviada (link individual de cada um). */
  assinaturas: { publicId: string | null; nome: string | null; email: string | null; link: string | null }[];
}

// ============================================================================
// CRIAR DOCUMENTO com signatário validado por CPF e envio por WhatsApp/e-mail
// ============================================================================
export async function autentiqueCriarDocumento(p: CriarDocumentoParams): Promise<CriarDocumentoResultado> {
  const token = await getToken();

  // Monta o signatário. Prioriza WhatsApp se houver celular; senão e-mail.
  // A validação por CPF vai em configs.cpf (garante que só aquele CPF assina) —
  // NÃO em security_verifications, que é para biometria/documento com foto.
  const montarSigner = (x: { nome: string; cpf?: string; celular?: string; email?: string }) => {
    const signer: any = { action: 'SIGN' };
    if (x.cpf) signer.configs = { cpf: x.cpf };
    if (x.celular) {
      signer.phone = x.celular;
      signer.delivery_method = 'DELIVERY_METHOD_WHATSAPP';
    } else if (x.email) {
      signer.email = x.email;
    } else {
      // Sem celular nem e-mail: adiciona por nome e retorna o link para envio manual
      signer.name = x.nome;
    }
    return signer;
  };
  const listaSigners = p.signatarios?.length
    ? p.signatarios.map(montarSigner)
    : [montarSigner({ nome: p.signatarioNome, cpf: p.signatarioCpf, celular: p.signatarioCelular, email: p.signatarioEmail })];

  const query = `
    mutation CreateDocument($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
      createDocument(sandbox: ${p.sandbox ? 'true' : 'false'}, document: $document, signers: $signers, file: $file) {
        id
        name
        signatures {
          public_id
          name
          email
          action { name }
          link { short_link }
        }
      }
    }
  `;

  const operations = JSON.stringify({
    query,
    variables: {
      document: { name: p.nomeDocumento },
      signers: listaSigners,
      file: null
    }
  });

  // Node's Buffer é um Uint8Array, mas o construtor Blob (lib DOM) tipa o
  // BlobPart como ArrayBuffer "puro". Criamos uma view ArrayBuffer limpa do
  // conteúdo para satisfazer o tipo e evitar SharedArrayBuffer/offset issues.
  const bytes = new Uint8Array(p.pdfBuffer.byteLength);
  bytes.set(p.pdfBuffer);
  const pdfBlob = new Blob([bytes], { type: 'application/pdf' });

  // Multipart: 'operations' + 'map' + o arquivo em '0'
  const form = new FormData();
  form.append('operations', operations);
  form.append('map', JSON.stringify({ '0': ['variables.file'] }));
  form.append('0', pdfBlob, p.pdfNomeArquivo);

  const resp = await fetch(AUTENTIQUE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Autentique retornou HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  }

  const json = await resp.json();
  if (json.errors?.length) {
    throw new Error(`Autentique: ${json.errors.map((e: any) => e.message).join('; ')}`);
  }

  const doc = json.data?.createDocument;
  if (!doc?.id) throw new Error('Autentique não retornou o id do documento.');

  const sigs = (doc.signatures || []).filter((s: any) => s.action?.name === 'SIGN');
  const assinatura = sigs[0] || doc.signatures?.[0];

  return {
    docId: doc.id,
    publicId: assinatura?.public_id || null,
    linkAssinatura: assinatura?.link?.short_link || null,
    assinaturas: sigs.map((s: any) => ({ publicId: s.public_id || null, nome: s.name || null, email: s.email || null, link: s.link?.short_link || null })),
  };
}

// ============================================================================
// CONSULTAR DOCUMENTO (status atual + arquivos assinados)
// Uso pontual — o webhook é o caminho principal para status.
// ============================================================================
export async function autentiqueConsultarDocumento(docId: string) {
  const token = await getToken();

  const query = `
    query GetDocument($id: UUID!) {
      document(id: $id) {
        id
        name
        created_at
        files { original signed pades }
        signatures {
          public_id
          name
          email
          created_at
          action { name }
          email_events { sent opened delivered }
          viewed { ...event }
          signed { ...event }
          rejected { ...event }
        }
      }
    }
    fragment event on Event {
      ip
      created_at
      reason
    }
  `;

  const resp = await fetch(AUTENTIQUE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: docId } })
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Autentique retornou HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  }

  const json = await resp.json();
  if (json.errors?.length) {
    throw new Error(`Autentique: ${json.errors.map((e: any) => e.message).join('; ')}`);
  }

  return json.data?.document;
}

// ============================================================================
// CANCELAR DOCUMENTO (bloquear assinatura, sem apagar do painel da Autentique)
// A mutation deleteDocument NÃO garante bloquear quem já recebeu o link —
// documentado pela própria Autentique como equivalente a mover pra lixeira,
// não a travar a assinatura. A forma oficial de bloquear é antecipar o prazo
// (deadline_at) para agora: o link para de aceitar assinatura imediatamente.
// Doc: https://docs.autentique.com.br/api/mutations/editing-a-document
// ============================================================================
export async function autentiqueCancelarDocumento(docId: string): Promise<void> {
  const token = await getToken();

  const query = `
    mutation CancelDocument($id: UUID!, $document: UpdateDocumentInput!) {
      updateDocument(id: $id, document: $document) {
        id
        deadline_at
      }
    }
  `;

  const resp = await fetch(AUTENTIQUE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { id: docId, document: { deadline_at: new Date().toISOString() } }
    })
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Autentique retornou HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  }

  const json = await resp.json();
  if (json.errors?.length) {
    throw new Error(`Autentique: ${json.errors.map((e: any) => e.message).join('; ')}`);
  }
}