"use client";

import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";

export default function RhHub() {
  const router = useRouter();

  const modulosRh = [
    {
      titulo: 'Controle de Ponto',
      descricao: 'Importação de registros, cálculo de horas extras e espelhos.',
      icone: '⏱️', link: '/admin/rh/ponto',
      cor: 'bg-blue-50 border-blue-200 text-blue-700', hover: 'hover:border-blue-500'
    },
    {
      titulo: 'Gestão de Holerites',
      descricao: 'Configuração de salários, descontos, bônus e emissão.',
      icone: '💰', link: '/admin/rh/holerite',
      cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
    },
    {
      titulo: 'Parâmetros de Contrato',
      descricao: 'Motor de regras de cálculo (CLT, PJ, Temporário, etc).',
      icone: '⚙️', link: '/admin/rh/parametros',
      cor: 'bg-purple-50 border-purple-200 text-purple-700', hover: 'hover:border-purple-500'
    }​,
    {
      titulo: 'Relatórios e Dashboards',
      descricao: 'Relatórios financeiro e analíticos.',
      icone: '📊', link: '/admin/rh/relatorios',
      cor: 'bg-purple-50 border-purple-200 text-purple-700', hover: 'hover:border-purple-500'
    }
  ];

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Setor de RH</h1>
          <p className="text-[#64748B] font-medium">Gestão de jornada, folha financeira e regras operacionais.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {modulosRh.map((m) => (
            <button key={m.titulo} onClick={() => router.push(m.link)} className={`text-left p-6 rounded-2xl border-2 transition-all shadow-sm ${m.cor} ${m.hover} group`}>
              <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-300">{m.icone}</div>
              <h2 className="text-lg font-black uppercase tracking-wider mb-2">{m.titulo}</h2>
              <p className="text-xs font-medium opacity-80">{m.descricao}</p>
            </button>
          ))}
        </div>
        <div className="mt-12 text-center">
          <button onClick={() => router.push('/admin')} className="text-[#64748B] font-bold text-sm hover:text-[#0C1D4D] transition-colors">
            ⬅ Voltar ao Painel Administrativo Geral
          </button>
        </div>
      </div>
    </div>
  );
}