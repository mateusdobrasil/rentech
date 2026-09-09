"use client";

import { useEffect, useState } from 'react';
import { VERSAO_APP } from '../../lib/versaoApp';

const INTERVALO_CHECAGEM_MS = 5 * 60 * 1000;

// Aviso automático quando o servidor já está numa versão diferente da que o
// navegador carregou (deploy novo aconteceu enquanto a aba ficou aberta) —
// ver app/api/version/route.ts. O selo fixo com o número da versão fica só
// em /admin (page.tsx, junto do "Seu Nível de Acesso"), não aqui: fixo em
// TODA página incomodava em monitor pequeno.
export default function VersaoSistema() {
  const [novaVersaoDisponivel, setNovaVersaoDisponivel] = useState(false);

  useEffect(() => {
    let ativo = true;

    const checar = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (ativo && data.version && data.version !== VERSAO_APP) {
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

  if (!novaVersaoDisponivel) return null;

  return (
    <div className="fixed bottom-2 right-2 z-[9998] bg-[#0C1D4D] text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 text-xs font-bold max-w-xs print:hidden">
      <span>🔄 Nova versão do sistema disponível.</span>
      <button
        onClick={() => window.location.reload()}
        className="bg-[#16A34A] hover:bg-[#15803D] text-white px-3 py-1.5 rounded-lg uppercase tracking-wider whitespace-nowrap flex-shrink-0"
      >
        Atualizar
      </button>
    </div>
  );
}
