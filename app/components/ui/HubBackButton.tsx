"use client";

import { useRouter } from 'next/navigation';

export default function HubBackButton() {
  const router = useRouter();
  return (
    <div className="mt-12 text-center pb-12">
      <button onClick={() => router.push('/admin')} className="text-[#64748B] font-bold text-sm hover:text-[#0C1D4D] transition-colors">
        ⬅ Voltar ao Painel Administrativo Geral
      </button>
    </div>
  );
}
