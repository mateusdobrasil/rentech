// app/lib/ponto/assinaturaCades.ts
// Assinatura digital DESTACADA (arquivo .p7s) no padrão CAdES-BES, com
// certificado ICP-Brasil A1 (.pfx). Usada no AFD do REP-P (Portaria 671:
// a última linha do AFD diz "ASSINATURA_DIGITAL_EM_ARQUIVO_P7S").
//
// O CMS SignedData é montado à mão com o ASN.1 do node-forge porque o
// pkcs7 pronto dele só sabe gravar contentType/messageDigest/signingTime, e o
// CAdES exige também o signingCertificateV2 (RFC 5035) — o "certificado que
// assinou", para ninguém trocar o certificado depois. Hash SHA-256, RSA PKCS#1
// v1.5. Conferência: `openssl cms -verify -binary -inform DER -in X.p7s
// -content X.txt -noverify` e o verificador do ITI (validar.iti.gov.br).
import { createHash, createSign } from 'node:crypto';
import forge from 'node-forge';

const { asn1 } = forge;
const U = asn1.Class.UNIVERSAL;
const T = asn1.Type;

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
};

const seq = (v: forge.asn1.Asn1[]) => asn1.create(U, T.SEQUENCE, true, v);
const set = (v: forge.asn1.Asn1[]) => asn1.create(U, T.SET, true, v);
const oid = (o: string) => asn1.create(U, T.OID, false, asn1.oidToDer(o).getBytes());
const octets = (bytes: string) => asn1.create(U, T.OCTETSTRING, false, bytes);
const inteiro = (n: number) => asn1.create(U, T.INTEGER, false, asn1.integerToDer(n).getBytes());
const nulo = () => asn1.create(U, T.NULL, false, '');
const algSha256 = () => seq([oid(OID.sha256), nulo()]);
const der = (a: forge.asn1.Asn1) => asn1.toDer(a).getBytes();
const atributo = (tipo: string, valor: forge.asn1.Asn1) => seq([oid(tipo), set([valor])]);

/** DER exige SET OF em ordem crescente dos bytes codificados. */
function setOrdenado(itens: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  const ordenados = itens.map(i => ({ i, b: der(i) })).sort((x, y) => (x.b < y.b ? -1 : x.b > y.b ? 1 : 0)).map(x => x.i);
  return set(ordenados);
}

export interface CertificadoA1 {
  pfxBase64: string;
  senha: string;
}

interface Aberto {
  chavePem: string;
  certAssinante: forge.pki.Certificate;
  certDerAssinante: string;
  cadeiaDer: string[];
  titular: string;
  validoAte: Date;
}

function abrirPfx({ pfxBase64, senha }: CertificadoA1): Aberto {
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1.fromDer(forge.util.decode64(pfxBase64.replace(/\s/g, ''))), senha);
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const chave = chaves.find(b => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!chave) throw new Error('O certificado não tem chave privada.');
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map(b => b.cert!).filter(Boolean);
  // o assinante é o certificado cuja chave pública bate com a chave privada
  const assinante = certs.find(c => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(chave.n));
  if (!assinante) throw new Error('Não achei, no .pfx, o certificado da chave privada.');
  const derDe = (c: forge.pki.Certificate) => der(forge.pki.certificateToAsn1(c));
  return {
    chavePem: forge.pki.privateKeyToPem(chave),
    certAssinante: assinante,
    certDerAssinante: derDe(assinante),
    cadeiaDer: [assinante, ...certs.filter(c => c !== assinante)].map(derDe),
    titular: String(assinante.subject.getField('CN')?.value || ''),
    validoAte: assinante.validity.notAfter,
  };
}

/** Emissor (Name) e número de série exatamente como estão no certificado. */
function emissorESerie(certDer: string): { emissor: forge.asn1.Asn1; serie: forge.asn1.Asn1 } {
  const tbs = (asn1.fromDer(certDer).value as forge.asn1.Asn1[])[0];
  const campos = tbs.value as forge.asn1.Asn1[];
  const temVersao = campos[0].tagClass === asn1.Class.CONTEXT_SPECIFIC;
  return { serie: campos[temVersao ? 1 : 0], emissor: campos[temVersao ? 3 : 2] };
}

/** Titular e validade do certificado, sem assinar nada (para a tela avisar antes). */
export function infoCertificado(cert: CertificadoA1): { titular: string; validoAte: string } {
  const a = abrirPfx(cert);
  return { titular: a.titular, validoAte: a.validoAte.toISOString() };
}

/** Assina `conteudo` e devolve o .p7s (DER) destacado — o conteúdo NÃO vai dentro. */
export function assinarCadesDestacado(conteudo: Buffer, cert: CertificadoA1, quando = new Date()): { p7s: Buffer; titular: string; validoAte: string } {
  const a = abrirPfx(cert);
  if (a.validoAte.getTime() < quando.getTime()) throw new Error(`O certificado venceu em ${a.validoAte.toISOString().slice(0, 10)}.`);
  const { emissor, serie } = emissorESerie(a.certDerAssinante);

  const resumo = createHash('sha256').update(conteudo).digest('binary');
  const hashCert = createHash('sha256').update(Buffer.from(a.certDerAssinante, 'binary')).digest('binary');

  // ESSCertIDv2 com SHA-256 (o algoritmo padrão é omitido) + IssuerSerial
  const issuerSerial = seq([
    seq([asn1.create(asn1.Class.CONTEXT_SPECIFIC, 4, true, [emissor])]), // GeneralNames { directoryName }
    serie,
  ]);
  const signingCertificateV2 = seq([seq([seq([octets(hashCert), issuerSerial])])]);

  const atributos = [
    atributo(OID.contentType, oid(OID.data)),
    atributo(OID.signingTime, asn1.create(U, T.UTCTIME, false, asn1.dateToUtcTime(quando))),
    atributo(OID.messageDigest, octets(resumo)),
    atributo(OID.signingCertificateV2, signingCertificateV2),
  ];
  // assina o DER do SET OF atributos (tag SET); no SignerInfo ele vai como [0] IMPLÍCITO
  const conjunto = setOrdenado(atributos);
  const assinatura = createSign('RSA-SHA256').update(Buffer.from(der(conjunto), 'binary')).sign(a.chavePem).toString('binary');
  const atributosImplicitos = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, conjunto.value as forge.asn1.Asn1[]);

  const signerInfo = seq([
    inteiro(1),
    seq([emissor, serie]),
    algSha256(),
    atributosImplicitos,
    seq([oid(OID.rsaEncryption), nulo()]),
    octets(assinatura),
  ]);

  const signedData = seq([
    inteiro(1),
    set([algSha256()]),
    seq([oid(OID.data)]), // destacado: sem eContent
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, a.cadeiaDer.map(d => asn1.fromDer(d))),
    set([signerInfo]),
  ]);
  const contentInfo = seq([oid(OID.signedData), asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData])]);
  return { p7s: Buffer.from(der(contentInfo), 'binary'), titular: a.titular, validoAte: a.validoAte.toISOString() };
}
