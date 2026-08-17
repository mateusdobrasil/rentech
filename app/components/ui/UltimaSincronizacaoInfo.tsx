"use client";

// Linha de status "Última sincronização: ..." usada nas telas com botão
// "Sincronizar agora" (Produtos, Parceiros, Colaboradores, Fichas de
// Reserva, Eventos/Feiras) — mesmo formato nas 5, então fica um componente
// só em vez de repetir a formatação em cada page.tsx.
import type { UltimaSincronizacao } from '../../lib/syncLog';

export default function UltimaSincronizacaoInfo({ info, carregando }: { info: UltimaSincronizacao | null; carregando: boolean }) {
  if (carregando) return <p className="text-[11px] text-gray-400 font-medium mt-2">Verificando última sincronização...</p>;
  if (!info || !info.finalizado_em) return <p className="text-[11px] text-gray-400 font-medium mt-2">Nunca sincronizado.</p>;

  const data = new Date(info.finalizado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  if (info.status === 'erro') {
    return <p className="text-[11px] text-red-500 font-medium mt-2">⚠ Última tentativa: {data} — falhou ({info.erro || 'erro desconhecido'})</p>;
  }

  return (
    <p className="text-[11px] text-gray-400 font-medium mt-2">
      Última sincronização: {data} · {info.tipo === 'incremental' ? 'incremental (só o que mudou)' : 'completa'} · {info.registros_processados ?? 0} registro(s)
    </p>
  );
}
