"use client";

// app/portal/MeuCracha.tsx
// Crachá digital do funcionário logado, exibido em bloco na home do Portal
// (/portal). Layout segue o modelo oficial "Rentech CR-80 clássico" — mesma
// estrutura de app/imgs/logo.png para a marca. O QR code aponta pro site da
// empresa (https://rentech.tech) e é gerado no cliente com a lib "qrcode".
import { useEffect, useState } from 'react';
import Image from 'next/image';
import QRCode from 'qrcode';
import logoColorido from '../imgs/logo.png';
import { formatarCpf } from './lib/cpf';

const NAVY = "#26315F";
const BLUE = "#4A69B2";
const INK = "#1c2440";
const MUTED = "#5a637f";

const QR_URL_EMPRESA = 'https://rentech.tech';

export interface DadosCracha {
  nome: string;
  cargo: string | null;
  cpf: string | null;
  matricula: string | null;
  fotoUrl: string | null;
}

function Cordao() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: 26, height: 90, background: NAVY, borderRadius: 3, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: 700, letterSpacing: 2, writingMode: "vertical-rl", paddingBottom: 8 }}>RENTECH</div>
      </div>
      <div style={{ width: 34, height: 16, background: "#b8bcc6", borderRadius: "3px 3px 6px 6px", marginTop: -2 }} />
    </div>
  );
}

function QrBox({ dataUrl, size = 64 }: { dataUrl: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, background: "#fff", border: "1px solid #e2e6ef", borderRadius: 6, padding: 6, boxSizing: "border-box" }}>
      {dataUrl ? (
        <img src={dataUrl} alt="QR code — rentech.tech" style={{ width: "100%", height: "100%", display: "block" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "#f4f6fa" }} />
      )}
    </div>
  );
}

export default function MeuCracha({ dados }: { dados: DadosCracha }) {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    let cancelado = false;
    QRCode.toDataURL(QR_URL_EMPRESA, { margin: 0, width: 256, color: { dark: NAVY, light: '#ffffff' } })
      .then(url => { if (!cancelado) setQrDataUrl(url); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, []);

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-end", fontFamily: "'Barlow', sans-serif" }}>
      <Cordao />

      <div style={{ width: 280, background: "#fff", borderRadius: 16, boxShadow: "0 12px 32px rgba(28,36,64,0.18)", overflow: "hidden", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
        <div style={{ width: 56, height: 9, background: "#eef0f4", borderRadius: 5, margin: "12px auto 0", flexShrink: 0 }} />

        <div style={{ background: NAVY, marginTop: 10, padding: "12px 20px", display: "flex", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: "5px 12px" }}>
            <Image src={logoColorido} alt="Rentech" height={34} style={{ width: "auto", height: 34, display: "block" }} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 22px 0", gap: 12 }}>
          <div style={{ width: 120, height: 120, borderRadius: "50%", padding: 4, background: `linear-gradient(135deg, ${NAVY}, ${BLUE})`, boxSizing: "border-box" }}>
            {dados.fotoUrl ? (
              <img src={dados.fotoUrl} alt={dados.nome} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#eef0f4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: MUTED, textAlign: "center", padding: 8 }}>Foto 3x4</div>
            )}
          </div>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: INK, lineHeight: 1.15 }}>{dados.nome}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: BLUE, textTransform: "uppercase", letterSpacing: 1 }}>{dados.cargo || '—'}</div>
          </div>
          <div style={{ fontSize: 12, color: MUTED, paddingBottom: 4 }}>
            <span style={{ fontWeight: 700, color: NAVY }}>CPF</span>&nbsp; {dados.cpf ? formatarCpf(dados.cpf) : '—'}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "#f4f6fa", borderTop: "1px solid #e2e6ef" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: NAVY }}>COLABORADOR</div>
            <div style={{ fontSize: 11, color: MUTED }}>Matrícula {dados.matricula || '—'}</div>
          </div>
          <QrBox dataUrl={qrDataUrl} />
        </div>
      </div>
    </div>
  );
}
