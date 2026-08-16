"use client";

import BackButton from '../BackButton';

// Coloque o arquivo .pptx de teste em /public/testes/apresentacao-teste.pptx
const PPTX_SRC = '/testes/apresentacao-teste.pptx';

export default function Apresentacao() {
  return (
    <>
      <div className="relative w-full h-[calc(100vh-5rem)] bg-[#000000] bg-[radial-gradient(circle_at_20%_30%,_rgba(12,29,77,0.4)_0%,_transparent_45%),radial-gradient(circle_at_80%_70%,_rgba(51,102,153,0.2)_0%,_transparent_45%)] flex flex-col items-center justify-center text-center px-6 gap-6">
        <BackButton />
        <div className="text-[10px] font-black uppercase tracking-widest text-[#336699]">Exibição • PPTX</div>
        <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tight text-white">Apresentação de Teste</h1>
        <p className="text-sm text-[#999999] max-w-md">
          Abra ou baixe o arquivo para testar a exibição de slides em monitores interativos e painéis de LED.
        </p>
        <a
          href={encodeURI(PPTX_SRC)}
          download
          className="bg-[#284B8C] hover:bg-[#336699] text-white px-8 py-4 rounded-xl font-black uppercase tracking-widest text-sm shadow-lg transition-all"
        >
          Baixar Apresentação (.pptx)
        </a>
      </div>
    </>
  );
}
