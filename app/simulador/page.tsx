import Image from 'next/image';
import Link from 'next/link';
import logoColorido from '../imgs/logo.png'; // Ajuste o caminho se necessário

export default function Simuladores() {
  return (
    // Fundo alinhado à paleta oficial com gradiente radial sutil para manter o aspecto tecnológico
    <div className="min-h-screen bg-[#000000] bg-[radial-gradient(circle_at_20%_30%,_rgba(12,29,77,0.3)_0%,_transparent_40%),radial-gradient(circle_at_80%_70%,_rgba(51,102,153,0.15)_0%,_transparent_40%)] text-[#B3B3B3] font-sans flex flex-col items-center overflow-x-hidden">
      
      <div className="container mx-auto px-6 py-12 max-w-4xl flex-col flex flex-grow">
        
        {/* Cabeçalho */}
        <header className="text-center mb-16 flex flex-col items-center">
          <Link href="/">
            <Image 
              src={logoColorido} 
              alt="Locadora Rentech" 
              width={320} 
              height={120} 
              className="w-full max-w-[280px] md:max-w-[320px] h-auto drop-shadow-[0_0_15px_rgba(51,102,153,0.3)] mb-8 hover:scale-105 transition-transform duration-500"
              priority
            />
          </Link>
          <h1 className="uppercase tracking-widest font-light text-sm md:text-base text-white border-t border-white/10 inline-block pt-6 leading-relaxed max-w-[90%]">
            Sistemas de Simuladores para <span className="text-[#336699] font-black">Apoio a Projetos e Comercial</span>
          </h1>
        </header>

        {/* Grid de Simuladores */}
        <main className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full flex-grow">
          
          {/* Card 1 */}
          <Link href="/simulador/videowall" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Comercial • Monitores
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              LED / VW / TV / Monitor
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Configuração de matrizes de Video Wall, grids de monitores e telas de grande formato.
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

          {/* Card 2 */}
          <Link href="/simulador/tela" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Projetos • LED
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              Simulador de Tela
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Dimensionamento técnico, resoluções e quantitativo de gabinetes para painéis LED Indoor e Outdoor.
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

          {/* Card 3 */}
          <Link href="/simulador/grid" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Projetos • Estrutural
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              Simulador de LED em GRID
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Planejamento de montagem e distribuição de módulos LED em formatos de grid e matrizes complexas.
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

          {/* Card 4 */}
          <Link href="/simulador/curvatura" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Engenharia • Especial
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              Simulador de Curvatura
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Cálculo de angulação e montagem para projetos com painéis de LED curvos (Côncavos/Convexos).
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

        </main>
      </div>

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
            LOCADORA RENTECH &copy; {new Date().getFullYear()} | Hub Técnico de Apoio
          </p>
        </div>
      </footer>

    </div>
  );
}