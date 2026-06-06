import Image from 'next/image';
import Link from 'next/link';

// Importando as imagens diretamente da pasta local
import logoColorido from './imgs/logo.png';
import logoPB from './imgs/logo_pb.png';

export default function Home() {
  return (
    // Utilizando o preto oficial da Rentech como fundo principal
    <main className="min-h-screen bg-[#000000] text-slate-50 font-sans scroll-smooth">

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

      {/* Footer com gradiente sutil usando o preto oficial */}
      <footer className="w-full px-6 py-10 mt-auto bg-gradient-to-t from-[#000000] to-transparent border-t border-[#0C1D4D]/50">
        <div className="flex flex-col items-center gap-6 max-w-4xl mx-auto">
          
          <div className="flex gap-4">
            <a href="https://www.instagram.com/rentechlocadora/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-12 h-12 rounded-full bg-[#0C1D4D]/30 border border-[#284B8C]/30 text-[#999999] hover:text-[#336699] hover:border-[#336699] hover:bg-[#336699]/10 hover:-translate-y-1 hover:shadow-[0_10px_20px_rgba(51,102,153,0.2)] transition-all duration-300">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.07zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
            </a>
            <a href="https://www.facebook.com/LocadoraRentech" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-12 h-12 rounded-full bg-[#0C1D4D]/30 border border-[#284B8C]/30 text-[#999999] hover:text-[#336699] hover:border-[#336699] hover:bg-[#336699]/10 hover:-translate-y-1 hover:shadow-[0_10px_20px_rgba(51,102,153,0.2)] transition-all duration-300">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/></svg>
            </a>
            <a href="https://www.youtube.com/@locadorarentech50" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-12 h-12 rounded-full bg-[#0C1D4D]/30 border border-[#284B8C]/30 text-[#999999] hover:text-[#336699] hover:border-[#336699] hover:bg-[#336699]/10 hover:-translate-y-1 hover:shadow-[0_10px_20px_rgba(51,102,153,0.2)] transition-all duration-300">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            </a>
            <a href="https://x.com/LocadoraRentech" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-12 h-12 rounded-full bg-[#0C1D4D]/30 border border-[#284B8C]/30 text-[#999999] hover:text-[#336699] hover:border-[#336699] hover:bg-[#336699]/10 hover:-translate-y-1 hover:shadow-[0_10px_20px_rgba(51,102,153,0.2)] transition-all duration-300">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>
            </a>
          </div>
          
          <p className="text-xs text-[#666666] tracking-widest uppercase font-bold text-center">
            LOCADORA RENTECH &copy; {new Date().getFullYear()} | Todos os direitos reservados
          </p>
        </div>
      </footer>

    </main>
  );
}