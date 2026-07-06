// lib/autentique.ts
// Cliente isolado da API GraphQL da Autentique. Roda só no servidor.
// O token vai em AUTENTIQUE_API_TOKEN (variável de ambiente do servidor).
//
// A API é GraphQL e o upload do PDF usa multipart (spec graphql-multipart-request).
// Doc: https://docs.autentique.com.br/api

const AUTENTIQUE_URL = 'https://api.autentique.com.br/v2/graphql';

function getToken(): string {
  const token = process.env.AUTENTIQUE_API_TOKEN;
  if (!token) throw new Error('AUTENTIQUE_API_TOKEN não configurado no ambiente do servidor.');
  return token;
}

export interface CriarDocumentoParams {
  nomeDocumento: string;      // ex: "Holerite 06/2026 — João da Silva"
  signatarioNome: string;
  signatarioCpf: string;      // exigido na validação
  signatarioCelular?: string; // formato E.164, ex: +5511990000000 (envio via WhatsApp)
  signatarioEmail?: string;   // alternativa ao celular
  pdfBuffer: Uint8Array;      // conteúdo do PDF do holerite (Buffer é um Uint8Array)
  pdfNomeArquivo: string;     // ex: "holerite-joao-2026-06.pdf"
  sandbox: boolean;           // true = teste, não gasta créditos
}

export interface CriarDocumentoResultado {
  docId: string;
  publicId: string | null;
  linkAssinatura: string | null;
}

// ============================================================================
// CRIAR DOCUMENTO com signatário validado por CPF e envio por WhatsApp/e-mail
// ============================================================================
export async function autentiqueCriarDocumento(p: CriarDocumentoParams): Promise<CriarDocumentoResultado> {
  const token = getToken();

  // Monta o signatário. Prioriza WhatsApp se houver celular; senão e-mail.
  // A validação por CPF vai em configs.cpf (garante que só aquele CPF assina) —
  // NÃO em security_verifications, que é para biometria/documento com foto.
  const signer: any = {
    action: 'SIGN',
    configs: { cpf: p.signatarioCpf }
  };
  if (p.signatarioCelular) {
    signer.phone = p.signatarioCelular;
    signer.delivery_method = 'DELIVERY_METHOD_WHATSAPP';
  } else if (p.signatarioEmail) {
    signer.email = p.signatarioEmail;
  } else {
    // Sem celular nem e-mail: adiciona por nome e retorna o link para envio manual
    signer.name = p.signatarioNome;
  }

  const query = `
    mutation CreateDocument($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
      createDocument(sandbox: ${p.sandbox ? 'true' : 'false'}, document: $document, signers: $signers, file: $file) {
        id
        name
        signatures {
          public_id
          name
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
      signers: [signer],
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

  const assinatura = (doc.signatures || []).find((s: any) => s.action?.name === 'SIGN') || doc.signatures?.[0];

  return {
    docId: doc.id,
    publicId: assinatura?.public_id || null,
    linkAssinatura: assinatura?.link?.short_link || null
  };
}

// ============================================================================
// CONSULTAR DOCUMENTO (status atual + arquivos assinados)
// Uso pontual — o webhook é o caminho principal para status.
// ============================================================================
export async function autentiqueConsultarDocumento(docId: string) {
  const token = getToken();

  const query = `
    query GetDocument($id: UUID!) {
      document(id: $id) {
        id
        name
        files { original signed pades }
        signatures {
          public_id
          name
          email
          created_at
          action { name }
          viewed  { created_at }
          signed  { created_at }
          rejected { created_at }
        }
      }
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