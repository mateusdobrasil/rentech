"use client";

// Anexos de uma conta a pagar (2026-11-22): boleto, nota, comprovante.
// Upload direto do navegador para o bucket privado por URL assinada (o arquivo
// não passa pelo servidor); links de 30 min. Conta de OP mostra também os
// anexos da OP, só para leitura.
import { useEffect, useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';
import { supabase } from '../../../lib/supabase';
import { urlUploadAnexoPagarAction, confirmarAnexoPagarAction, anexosTituloPagarAction, removerAnexoPagarAction } from './actions';

interface Props {
  titulo: { id: number; fornecedor_nome?: string | null; descricao?: string | null } | null;
  accessToken: string;
  onClose: () => void;
  onMudou: () => void;
}

export default function AnexosConta({ titulo, accessToken, onClose, onMudou }: Props) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [dados, setDados] = useState<{ anexos: { caminho: string; nome: string; url: string | null }[]; daOp: { nome: string; url: string }[] } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!titulo) return;
    let vivo = true;
    anexosTituloPagarAction(titulo.id, accessToken).then(r => {
      if (!vivo) return;
      if (r.ok) setDados(r.info); else toast(r.erro || 'Erro ao carregar os anexos.', 'error');
    });
    return () => { vivo = false; };
  }, [titulo, accessToken, versao, toast]);

  async function enviar(arquivos: FileList | null) {
    if (!titulo || !arquivos?.length) return;
    setEnviando(true);
    let ok = 0;
    for (const f of Array.from(arquivos)) {
      const r = await urlUploadAnexoPagarAction(titulo.id, f.name, f.size, accessToken);
      if (!r.ok) { toast(`${f.name}: ${r.erro}`, 'error'); continue; }
      const { error } = await supabase.storage.from(r.info.bucket).uploadToSignedUrl(r.info.caminho, r.info.token, f, { contentType: f.type || 'application/octet-stream' });
      if (error) { toast(`${f.name}: ${error.message}`, 'error'); continue; }
      const c = await confirmarAnexoPagarAction(titulo.id, r.info.caminho, accessToken);
      if (!c.ok) { toast(`${f.name}: ${c.erro}`, 'error'); continue; }
      ok++;
    }
    setEnviando(false);
    if (ok) { toast(`${ok} arquivo(s) anexado(s).`, 'success'); setVersao(v => v + 1); onMudou(); }
  }

  async function remover(caminho: string, nome: string) {
    if (!titulo || !(await confirmar({ title: 'Remover anexo', message: `Remover "${nome}" desta conta?`, confirmLabel: 'Remover' }))) return;
    const r = await removerAnexoPagarAction(titulo.id, caminho, accessToken);
    if (!r.ok) { toast(r.erro || 'Falha ao remover.', 'error'); return; }
    setVersao(v => v + 1); onMudou();
  }

  const fechar = () => { setDados(null); onClose(); };
  return (
    <Modal open={!!titulo} onClose={fechar} title={`📎 Anexos · ${titulo?.fornecedor_nome || titulo?.descricao || ''}`} maxWidthClassName="max-w-xl">
      {!dados ? <p className="text-sm text-gray-500">Carregando…</p> : (
        <div className="space-y-3">
          {dados.anexos.length === 0 && dados.daOp.length === 0 && <p className="text-sm text-gray-500">Nenhum anexo ainda.</p>}
          {dados.anexos.length > 0 && (
            <ul className="divide-y divide-[#F1F5F9] border border-[#E2E8F0] rounded-xl">
              {dados.anexos.map(a => (
                <li key={a.caminho} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="text-[#336699] font-bold hover:underline truncate">{a.nome}</a> : <span className="truncate">{a.nome}</span>}
                  <button onClick={() => remover(a.caminho, a.nome)} className="text-[10px] font-black text-gray-400 hover:text-red-500 shrink-0">remover</button>
                </li>
              ))}
            </ul>
          )}
          {dados.daOp.length > 0 && (
            <div>
              <p className="text-[11px] font-black uppercase text-gray-500 mb-1">Anexos da OP</p>
              <ul className="space-y-1">{dados.daOp.map(a => <li key={a.url}><a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-[#336699] font-bold hover:underline">{a.nome}</a></li>)}</ul>
            </div>
          )}
          <label className={`inline-block text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm cursor-pointer ${enviando ? 'bg-gray-200 text-gray-500' : 'bg-[#0C1D4D] text-white'}`}>
            {enviando ? 'Enviando…' : '+ Anexar arquivos'}
            <input type="file" multiple disabled={enviando} className="hidden" onChange={e => { enviar(e.target.files); e.target.value = ''; }} />
          </label>
          <p className="text-[11px] text-gray-400">Boleto, nota fiscal, comprovante… até 20 MB por arquivo.</p>
        </div>
      )}
    </Modal>
  );
}
