import Link from 'next/link';
import { Analytics } from "@vercel/analytics/next";

export default function Testes() {
  return (
    <div className="min-h-screen bg-[#000000] bg-[radial-gradient(circle_at_20%_30%,_rgba(12,29,77,0.3)_0%,_transparent_40%),radial-gradient(circle_at_80%_70%,_rgba(51,102,153,0.15)_0%,_transparent_40%)] text-[#B3B3B3] font-sans flex flex-col items-center overflow-x-hidden">
      <Analytics />

      <div className="container mx-auto px-6 py-12 max-w-4xl flex-col flex flex-grow">

        {/* Cabeçalho */}
        <header className="text-center mb-16 flex flex-col items-center">
          <h1 className="uppercase tracking-widest font-light text-sm md:text-base text-white border-t border-white/10 inline-block pt-6 leading-relaxed max-w-[90%]">
            Conteúdos de <span className="text-[#336699] font-black">Teste para TVs, Video Wall, Painéis de LED e Touchscreen</span>
          </h1>
        </header>

        {/* Grid de Testes */}
        <main className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full flex-grow">

          {/* Card 1 */}
          <Link href="/testes/reflexo" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Touchscreen • Jogo
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              Jogo do Reflexo
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Teste de tempo de reação por toque, em tela cheia — ideal para validar resposta e precisão de monitores interativos.
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

          {/* Card 2 */}
          <Link href="/testes/bolhas" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Touchscreen • Multitoque
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              Bolhas
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Estouro de bolhas em tela cheia, com várias na tela ao mesmo tempo — ótimo para estressar a resposta a múltiplos toques simultâneos.
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

          {/* Card 3 */}
          <Link href="/testes/velha" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Touchscreen • Jogo
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              Jogo da Velha
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Clássico jogo da velha em tela cheia, com placar, efeitos sonoros e opção contra a máquina — bom teste de resposta a toques simples.
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

          {/* Card 4 */}
          <Link href="/testes/memoria" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Touchscreen • Jogo
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              Jogo da Memória
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Jogo de encontrar pares em tela cheia, com cronômetro e contagem de movimentos — testa toques sequenciais e resposta da tela.
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

          {/* Card 5 */}
          <Link href="/testes/video-horizontal" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Exibição • Vídeo 16:9
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              Vídeo Horizontal
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Reprodução em tela cheia de conteúdo horizontal, para calibrar TVs, video walls e painéis de LED em formato paisagem.
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

          {/* Card 6 */}
          <Link href="/testes/video-vertical" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Exibição • Vídeo 9:16
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              Vídeo Vertical
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Reprodução em tela cheia de conteúdo vertical, para telas e totens em formato retrato.
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

          {/* Card 7 */}
          <Link href="/testes/apresentacao" className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden md:col-span-2">
            <div className="text-[10px] md:text-xs font-black uppercase text-[#336699] mb-3 tracking-widest">
              Exibição • Apresentação
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">
              Apresentação (.pptx)
            </h2>
            <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
              Abertura de uma apresentação em PowerPoint, para testar exibição de slides em monitores interativos e painéis de LED.
            </p>
            <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500"></div>
          </Link>

        </main>
      </div>

      <footer className="w-full px-6 py-10 mt-auto bg-gradient-to-t from-[#000000] to-transparent border-t border-[#0C1D4D]/50 text-center">
        <p className="text-xs text-[#666666] tracking-widest uppercase font-bold">
          LOCADORA RENTECH &copy; {new Date().getFullYear()} | Central de Testes de Exibição
        </p>
      </footer>

    </div>
  );
}
