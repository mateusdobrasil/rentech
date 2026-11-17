"use client";

// Anexos do módulo Suporte: upload direto do navegador pro bucket privado por
// URL assinada (nunca mandar o arquivo numa Server Action — 413 da Vercel).
import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { urlUploadAnexoAction } from './actions';
import { BUCKET_SUPORTE, LIMITE_ANEXO_MB, MAX_ANEXOS, type Anexo } from '../../lib/suporte/constantes';

export const tamanhoLegivel = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ehImagem = (a: Anexo) => (a.tipo || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.nome);

export function SeletorAnexos({ anexos, onChange, accessToken, onErro, compacto = false }: {
  anexos: Anexo[]; onChange: (a: Anexo[]) => void; accessToken: string; onErro: (m: string) => void; compacto?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(0);

  const escolher = async (files: FileList | null) => {
    if (!files?.length) return;
    const lista = Array.from(files).slice(0, Math.max(0, MAX_ANEXOS - anexos.length));
    if (lista.length < files.length) onErro(`Máximo de ${MAX_ANEXOS} anexos por envio.`);
    const novos: Anexo[] = [];
    setEnviando(lista.length);
    for (const f of lista) {
      if (f.size > LIMITE_ANEXO_MB * 1024 * 1024) { onErro(`${f.name}: acima de ${LIMITE_ANEXO_MB} MB.`); setEnviando(n => n - 1); continue; }
      const r = await urlUploadAnexoAction(f.name, f.size, accessToken);
      if (!r.ok) { onErro(r.erro || 'Falha ao preparar o envio.'); setEnviando(n => n - 1); continue; }
      const { error } = await supabase.storage.from(BUCKET_SUPORTE).uploadToSignedUrl(r.info.caminho, r.info.token, f, { contentType: f.type || 'application/octet-stream' });
      if (error) onErro(`${f.name}: ${error.message}`);
      else novos.push({ path: r.info.caminho, nome: f.name, tamanho: f.size, tipo: f.type });
      setEnviando(n => n - 1);
    }
    onChange([...anexos, ...novos]);
    if (input.current) input.current.value = '';
  };

  return (
    <div className="space-y-2">
      <input ref={input} type="file" multiple className="hidden" onChange={e => escolher(e.target.files)} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={enviando > 0 || anexos.length >= MAX_ANEXOS}
          className={`border border-dashed border-[#94A3B8] text-[#475569] hover:border-[#336699] hover:text-[#336699] rounded-lg font-bold transition-colors disabled:opacity-50 ${compacto ? 'px-3 py-1.5 text-[11px]' : 'px-4 py-2 text-xs'}`}>
          📎 {enviando > 0 ? `Enviando ${enviando}…` : 'Anexar arquivo'}
        </button>
        {!compacto && <span className="text-[11px] text-[#94A3B8]">Prints, fotos, PDF — até {LIMITE_ANEXO_MB} MB cada.</span>}
      </div>
      {anexos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {anexos.map(a => (
            <span key={a.path} className="inline-flex items-center gap-1.5 bg-[#F1F5F9] text-[#334155] text-[11px] font-bold px-2.5 py-1 rounded-full max-w-full">
              <span className="truncate max-w-[180px]">{ehImagem(a) ? '🖼️' : '📄'} {a.nome}</span>
              <span className="text-[#94A3B8] font-medium">{tamanhoLegivel(a.tamanho)}</span>
              <button type="button" onClick={() => onChange(anexos.filter(x => x.path !== a.path))} className="text-[#94A3B8] hover:text-red-500 ml-0.5" aria-label={`Remover ${a.nome}`}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ListaAnexos({ anexos, urls }: { anexos: Anexo[]; urls: Record<string, string> }) {
  if (!anexos?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {anexos.map(a => {
        const url = urls[a.path];
        if (ehImagem(a) && url) {
          return (
            <a key={a.path} href={url} target="_blank" rel="noreferrer" className="block w-28 h-20 rounded-lg overflow-hidden border border-[#E2E8F0] hover:ring-2 hover:ring-[#336699] transition" title={a.nome}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={a.nome} className="w-full h-full object-cover" />
            </a>
          );
        }
        return (
          <a key={a.path} href={url || '#'} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 bg-white border border-[#E2E8F0] hover:border-[#336699] text-[#336699] text-[11px] font-bold px-2.5 py-1.5 rounded-lg max-w-full">
            <span className="truncate max-w-[200px]">📄 {a.nome}</span>
            <span className="text-[#94A3B8] font-medium">{tamanhoLegivel(a.tamanho)}</span>
          </a>
        );
      })}
    </div>
  );
}
