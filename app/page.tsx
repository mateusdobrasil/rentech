import Image from 'next/image';
import Link from 'next/link';

// Importando as imagens diretamente da pasta local
import logoColorido from './imgs/logo.png';
import logoPB from './imgs/logo_pb.png';

export default function Home() {
  return (
    // Utilizando o preto oficial da Rentech como fundo principal
    <main className="min-h-screen bg-[#000000] text-slate-50 font-sans scroll-smooth">
      
      {/* Navbar com o azul mais escuro da marca */}
      <nav className="fixed w-full border-b border-[#0C1D4D] bg-[#0C1D4D]/95 backdrop-blur z-50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          
          {/* Aplicação do Logo Monocromático */}
          <Link href="/" className="flex items-center">
            <Image 
              src={logoPB} 
              alt="Rentech Locadora" 
              width={160} 
              height={60} 
              className="h-10 w-auto object-contain"
              priority
            />
          </Link>

          {/* Links de Navegação Principal e Ecossistema */}
          <div className="hidden lg:flex items-center space-x-8 text-sm font-bold text-[#B3B3B3]">
            {/* Links Públicos */}
            <Link href="#especialidades" className="hover:text-[#336699] transition-colors">Especialidades</Link>
            <Link href="#portfolio" className="hover:text-[#336699] transition-colors">Cases</Link>
            
            {/* Divisor Visual */}
            <div className="w-px h-5 bg-[#284B8C]/50"></div>

            {/* Links do Ecossistema Operacional/Interno */}
            <div className="relative group">
              <Link href="/simulador" className="flex items-center gap-1 hover:text-[#336699] transition-colors">
                Simuladores
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </Link>
              {/* Dropdown de Simuladores (Aparece no hover) */}
              <div className="absolute top-full left-0 mt-4 w-56 bg-[#0C1D4D] border border-[#284B8C] rounded-md shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                <Link href="/simuladores/tela" className="block px-4 py-3 text-xs text-[#B3B3B3] hover:bg-[#284B8C]/30 hover:text-white border-b border-[#284B8C]/30">Simulador de Tela</Link>
                <Link href="/simuladores/led-grid" className="block px-4 py-3 text-xs text-[#B3B3B3] hover:bg-[#284B8C]/30 hover:text-white border-b border-[#284B8C]/30">Simulador de LED em GRID</Link>
                <Link href="/simuladores/curvatura" className="block px-4 py-3 text-xs text-[#B3B3B3] hover:bg-[#284B8C]/30 hover:text-white">Simulador de Curvatura</Link>
              </div>
            </div>

            {/* Link para o Dashboard Administrativo / Financeiro */}
            <Link href="/admin/op" className="flex items-center gap-2 text-[#999999] hover:text-white transition-colors border border-[#666666]/30 px-3 py-1.5 rounded-md hover:border-[#336699] bg-black/20">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
              OP (Ordem de Pagamento)
            </Link>
          </div>
          
          {/* Botão de Orçamento */}
          <Link href="#contato" className="bg-[#284B8C] text-white px-6 py-2 rounded-md text-sm font-black hover:bg-[#336699] hover:shadow-lg hover:shadow-[#284B8C]/40 transition-all uppercase tracking-wide">
            Orçamento
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
        {/* Fundo escuro com gradiente puxando para o azul institucional */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0C1D4D]/40 via-[#000000] to-[#000000] z-0"></div>
        
        <div className="container mx-auto px-6 relative z-10 text-center md:text-left flex flex-col md:flex-row items-center">
          <div className="md:w-2/3">
            <div className="inline-block px-4 py-1 mb-6 border border-[#284B8C]/50 rounded-full bg-[#284B8C]/10 text-[#336699] text-xs font-black tracking-widest uppercase">
              Som • Luz • Vídeo Profissional
            </div>
            
            {/* Títulos com peso máximo (font-black) para remeter à Frutiger 87 Extra Black */}
            <h1 className="text-5xl md:text-7xl font-black mb-6 leading-tight tracking-tighter">
              Engenharia Audiovisual <br/>para <span className="text-[#336699]">Grandes Eventos</span>
            </h1>
            
            {/* Subtítulo utilizando o cinza oficial #B3B3B3 */}
            <p className="text-xl text-[#B3B3B3] max-w-2xl mb-10 leading-relaxed font-medium">
              Elevamos o padrão do seu evento corporativo, show ou congresso com infraestrutura técnica de ponta e um atendimento que não deixa margem para falhas.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
              <Link href="#contato" className="bg-[#284B8C] text-white px-8 py-4 rounded-md text-lg font-black hover:bg-[#336699] transition-colors text-center uppercase tracking-wide">
                Solicitar Orçamento
              </Link>
              <Link href="#portfolio" className="border border-[#666666] text-[#B3B3B3] px-8 py-4 rounded-md text-lg font-black hover:bg-[#666666]/20 hover:text-white transition-colors text-center uppercase tracking-wide">
                Ver Portfólio
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Especialidades */}
      <section id="especialidades" className="py-24 bg-[#000000] border-t border-[#0C1D4D] relative">
        <div className="container mx-auto px-6 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-black mb-4">Nossas Especialidades</h2>
            <p className="text-[#999999] max-w-2xl mx-auto font-medium">Soluções sob medida para cada tipo de ambiente e público.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {/* Card 1 */}
            <div className="bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-xl overflow-hidden hover:border-[#336699] transition-all hover:-translate-y-2 group">
              <div className="h-56 bg-[#0C1D4D]/50 flex items-center justify-center text-[#666666] relative overflow-hidden">
                <span className="font-bold tracking-widest uppercase text-sm">[Imagem: Estande]</span>
              </div>
              <div className="p-8">
                <h3 className="text-2xl font-black mb-3 text-white">Feiras e Exibições</h3>
                <p className="text-[#B3B3B3] text-sm leading-relaxed">
                  Painéis de LED de alta resolução, totens interativos e projetos de iluminação arquitetural.
                </p>
              </div>
            </div>

            {/* Card 2 */}
            <div className="bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-xl overflow-hidden hover:border-[#336699] transition-all hover:-translate-y-2 group">
              <div className="h-56 bg-[#0C1D4D]/50 flex items-center justify-center text-[#666666] relative overflow-hidden">
                <span className="font-bold tracking-widest uppercase text-sm">[Imagem: Auditório]</span>
              </div>
              <div className="p-8">
                <h3 className="text-2xl font-black mb-3 text-white">Congressos</h3>
                <p className="text-[#B3B3B3] text-sm leading-relaxed">
                  Sistemas de sonorização precisos, projeção mapeada e tradução simultânea.
                </p>
              </div>
            </div>

            {/* Card 3 */}
            <div className="bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-xl overflow-hidden hover:border-[#336699] transition-all hover:-translate-y-2 group">
              <div className="h-56 bg-[#0C1D4D]/50 flex items-center justify-center text-[#666666] relative overflow-hidden">
                <span className="font-bold tracking-widest uppercase text-sm">[Imagem: Palco]</span>
              </div>
              <div className="p-8">
                <h3 className="text-2xl font-black mb-3 text-white">Shows e Festivais</h3>
                <p className="text-[#B3B3B3] text-sm leading-relaxed">
                  Estruturas de grid, moving lights, lasers e PA potente para entregar a melhor experiência.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer com Logo Colorido */}
      <footer className="bg-[#000000] py-12 border-t border-[#0C1D4D] flex flex-col items-center">
        <Image 
          src={logoColorido} 
          alt="Rentech Locadora" 
          width={120} 
          height={45} 
          className="h-12 w-auto mb-6 opacity-80 grayscale hover:grayscale-0 transition-all duration-500"
        />
        <p className="text-[#666666] text-sm font-medium">
          &copy; {new Date().getFullYear()} Rentech Locações Audiovisuais. Todos os direitos reservados.
        </p>
      </footer>

    </main>
  );
}