"use client";

import { useEffect, useState } from 'react';

// Versão que ESTE bundle já carregado no navegador acredita ser a atual —
// inlined em tempo de build (ver next.config.ts). Comparado contra /api/version,
// que sempre reflete o deploy ativo no servidor.
const VERSAO_ATUAL = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
const INTERVALO_CHECAGEM_MS = 5 * 60 * 1000;

// Badge fixo com a versão (pra suporte perguntar "o que aparece no canto da
// tela?") + aviso automático quando o servidor já está numa versão diferente
// da que o navegador carregou (deploy novo aconteceu enquanto a aba ficou
// aberta) — ver app/api/version/route.ts.
export default function VersaoSistema() {
  const [novaVersaoDisponivel, setNovaVersaoDisponivel] = useState(false);

  useEffect(() => {
    let ativo = true;

    const checar = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (ativo && data.version && data.version !== VERSAO_ATUAL) {
          setNovaVersaoDisponivel(true);
        }
      } catch {
        // Sem rede/offline não deve gerar um aviso falso de versão nova.
      }
    };

    checar();
    const intervalo = setInterval(checar, INTERVALO_CHECAGEM_MS);
    // Pega o caso comum de suporte: usuário deixou a aba aberta de um dia
    // pro outro e só volta a ela horas depois — não esperar até 5min de novo.
    const aoVoltarPraAba = () => { if (document.visibilityState === 'visible') checar(); };
    document.addEventListener('visibilitychange', aoVoltarPraAba);

    return () => {
      ativo = false;
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', aoVoltarPraAba);
    };
  }, []);

  return (
    <>
      <div
        title={`Versão do sistema: ${VERSAO_ATUAL}`}
        className="fixed bottom-2 left-2 z-[9997] text-[9px] font-bold text-gray-400 bg-white/80 border border-gray-200 rounded px-1.5 py-0.5 tracking-wider select-none pointer-events-none print:hidden"
      >
        v{VERSAO_ATUAL}
      </div>

      {novaVersaoDisponivel && (
        <div className="fixed bottom-2 right-2 z-[9998] bg-[#0C1D4D] text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 text-xs font-bold max-w-xs print:hidden">
          <span>🔄 Nova versão do sistema disponível.</span>
          <button
            onClick={() => window.location.reload()}
            className="bg-[#16A34A] hover:bg-[#15803D] text-white px-3 py-1.5 rounded-lg uppercase tracking-wider whitespace-nowrap flex-shrink-0"
          >
            Atualizar
          </button>
        </div>
      )}
    </>
  );
}
