import Image from 'next/image';
import Link from 'next/link';
import Contato from '../components/Contato';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0b0f19] text-slate-50 font-sans scroll-smooth">
      
      {/* Navbar Minimalista */}
      <nav className="fixed w-full border-b border-gray-800 bg-gray-900/90 backdrop-blur z-50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="text-xl font-bold tracking-tight">RENTECH</div>
          <div className="hidden md:flex space-x-8 text-sm font-medium text-gray-300">
            <Link href="#operacao" className="hover:text-blue-400 transition-colors">A Operação</Link>
            <Link href="#especialidades" className="hover:text-blue-400 transition-colors">Especialidades</Link>
          </div>
          <Link href="#contato" className="bg-blue-600 text-white px-6 py-2 rounded-md text-sm font-bold hover:bg-blue-500 transition-colors">
            Orçamento
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
        {/* Fundo escuro tecnológico (pode ser trocado por uma tag <video> depois) */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-900/80 to-[#0b0f19] z-0"></div>
        
        <div className="container mx-auto px-6 relative z-10 text-center md:text-left">
          <h1 className="text-5xl md:text-7xl font-extrabold mb-6 leading-tight">
            Engenharia Audiovisual <br/>para <span className="text-blue-500">Eventos</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mb-10">
            Aluguel e montagem de infraestrutura técnica de ponta. Som, luz e imagem executados com rigor.
          </p>
        </div>
      </section>

      {/* Especialidades - Cards Tecnológicos */}
      <section id="especialidades" className="py-24 bg-gray-900 border-t border-gray-800">
        <div className="container mx-auto px-6">
          <h2 className="text-3xl font-bold mb-12 text-center">Nossas Especialidades</h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            {/* Card React */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden hover:border-blue-500 transition-all hover:-translate-y-1">
              <div className="h-48 bg-gray-700 flex items-center justify-center text-gray-500">
                [Imagem: Feiras e Exibições]
              </div>
              <div className="p-6">
                <h3 className="text-xl font-bold mb-3 text-white">Feiras e Exibições</h3>
                <p className="text-gray-400 text-sm">
                  Painéis de LED, totens interativos e iluminação arquitetural para estandes.
                </p>
              </div>
            </div>
            
            {/* Você pode replicar o card acima para Congressos e Shows */}
          </div>
        </div>
      </section>

    </main>
  );
}