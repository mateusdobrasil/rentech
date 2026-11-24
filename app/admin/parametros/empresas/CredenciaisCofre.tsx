"use client";

// app/admin/parametros/empresas/CredenciaisCofre.tsx
// Aba 🔐 Credenciais da ficha da empresa (ou da ficha "Sistema"). Só
// Administrador, e o ExigirMFA pede o código do 2FA antes de mostrar.
// Nenhum valor chega aqui: o servidor manda só onde está (cofre/Vercel), o
// final do valor e quem trocou. Os campos de digitação são só de escrita.
import { useCallback, useEffect, useState } from 'react';
import ExigirMFA from '../../ExigirMFA';
import { useConfirm, useToast } from '../../../components/ui/NotificationProvider';
import { SERVICOS_COFRE, type ServicoCofre, type CampoCofre } from '../../../lib/cofre/catalogo';
import { situacaoCredenciaisAction, salvarCredencialAction, salvarCertificadoA1Action, removerCredencialAction, type SituacaoCampo } from './actions';

const dataBR = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

async function arquivoBase64(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function Selo({ s }: { s: SituacaoCampo | undefined }) {
  if (s?.origem === 'COFRE') return <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">🔒 No cofre</span>;
  if (s?.origem === 'VERCEL') return <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">☁ Na Vercel</span>;
  return <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Não configurado</span>;
}

interface Props { accessToken: string; empresaId: number | null; empresaNome: string }

export default function CredenciaisCofre(props: Props) {
  return (
    <ExigirMFA ativo>
      <Cofre {...props} />
    </ExigirMFA>
  );
}

function Cofre({ accessToken, empresaId, empresaNome }: Props) {
  const [campos, setCampos] = useState<SituacaoCampo[] | null>(null);
  const [cofreAtivo, setCofreAtivo] = useState(true);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);

  const recarregar = useCallback(() => setVersao(v => v + 1), []);
  useEffect(() => {
    let vivo = true;
    situacaoCredenciaisAction(empresaId, accessToken).then(r => {
      if (!vivo) return;
      if (!r.ok || !r.info) { setErro(r.erro || 'Erro ao carregar as credenciais.'); return; }
      setErro(''); setCampos(r.info.campos); setCofreAtivo(r.info.cofreAtivo);
    });
    return () => { vivo = false; };
  }, [empresaId, accessToken, versao]);

  const servicos = SERVICOS_COFRE.filter(s => s.escopo === (empresaId === null ? 'SISTEMA' : 'EMPRESA'));
  const situacao = (nome: string) => campos?.find(c => c.nome === nome);

  if (erro) return <p className="text-sm font-bold text-red-600 p-4">{erro}</p>;
  if (!campos) return <p className="text-xs font-bold text-gray-400 uppercase p-4">Carregando...</p>;

  return (
    <div className="space-y-4">
      <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 text-xs text-[#334155] space-y-1">
        <p><b>🔐 {empresaId === null ? 'Serviços usados por todas as empresas.' : `Credenciais de ${empresaNome}.`}</b> Os valores ficam cifrados no banco e nunca aparecem na tela: só o final, quem trocou e quando.</p>
        <p>Enquanto um campo não estiver no cofre, o sistema usa o que está na Vercel (☁). Uma troca vale em até 1 minuto. Toda mudança fica na auditoria.</p>
      </div>
      {!cofreAtivo && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold px-4 py-3 rounded-lg">
          O cofre ainda não foi ativado no servidor (falta a variável COFRE_CHAVE_MESTRA na Vercel). Dá para ver a situação, mas não gravar.
        </div>
      )}
      {servicos.map(s => s.certificadoA1
        ? <CartaoCertificado key={s.id} servico={s} situacao={situacao} empresaId={empresaId!} accessToken={accessToken} podeGravar={cofreAtivo} onMudou={recarregar} />
        : <CartaoServico key={s.id} servico={s} situacao={situacao} empresaId={empresaId} accessToken={accessToken} podeGravar={cofreAtivo} onMudou={recarregar} />)}
    </div>
  );
}

interface CartaoProps { servico: ServicoCofre; situacao: (nome: string) => SituacaoCampo | undefined; empresaId: number | null; accessToken: string; podeGravar: boolean; onMudou: () => void }

function CartaoServico({ servico, situacao, empresaId, accessToken, podeGravar, onMudou }: CartaoProps) {
  const configurados = servico.campos.filter(c => situacao(c.nome)?.origem).length;
  const [aberto, setAberto] = useState(false);
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
      <button onClick={() => setAberto(a => !a)} className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-[#F8FAFC]">
        <div>
          <p className="text-sm font-black text-[#0C1D4D]">{servico.icone} {servico.titulo}</p>
          <p className="text-[11px] text-[#64748B]">{servico.usadoEm}</p>
        </div>
        <span className={`text-[10px] font-black uppercase whitespace-nowrap ${configurados === servico.campos.length ? 'text-emerald-600' : configurados ? 'text-amber-600' : 'text-gray-400'}`}>
          {configurados}/{servico.campos.length} {aberto ? '▴' : '▾'}
        </span>
      </button>
      {aberto && (
        <div className="border-t border-[#E2E8F0] divide-y divide-[#F1F5F9]">
          {servico.campos.map(c => <LinhaCampo key={c.nome} campo={c} s={situacao(c.nome)} empresaId={empresaId} accessToken={accessToken} podeGravar={podeGravar} onMudou={onMudou} />)}
        </div>
      )}
    </div>
  );
}

function LinhaCampo({ campo, s, empresaId, accessToken, podeGravar, onMudou }: { campo: CampoCofre; s: SituacaoCampo | undefined; empresaId: number | null; accessToken: string; podeGravar: boolean; onMudou: () => void }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setSalvando(true);
    const v = campo.tipo === 'arquivo' ? (arquivo ? await arquivoBase64(arquivo) : '') : valor;
    const r = await salvarCredencialAction({ empresaId, nome: campo.nome, valor: v }, accessToken);
    setSalvando(false);
    if (!r.ok) { toast(r.erro || 'Erro ao gravar.', 'error'); return; }
    toast(`${campo.rotulo}: gravado no cofre.`, 'success');
    setEditando(false); setValor(''); setArquivo(null);
    onMudou();
  };

  const remover = async () => {
    if (!(await confirmar({ title: 'Remover do cofre', message: `Remover "${campo.rotulo}" do cofre? Se a Vercel tiver esse valor, o sistema volta a usar o de lá.`, confirmLabel: 'Remover', danger: true }))) return;
    const r = await removerCredencialAction({ empresaId, nome: campo.nome }, accessToken);
    if (!r.ok) { toast(r.erro || 'Erro ao remover.', 'error'); return; }
    toast(`${campo.rotulo}: removido do cofre.`, 'success');
    onMudou();
  };

  return (
    <div className="p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-black text-[#0C1D4D]">{campo.rotulo} <Selo s={s} /></p>
          {s?.origem === 'COFRE' && (
            <p className="text-[11px] text-[#64748B] break-all"><span className="font-mono">{s.dica}</span> · {s.atualizadoPor || '—'} em {dataBR(s.atualizadoEm)}</p>
          )}
          {campo.ajuda && <p className="text-[11px] text-gray-400">{campo.ajuda}</p>}
        </div>
        {!editando && (
          <div className="flex gap-2">
            <button onClick={() => setEditando(true)} disabled={!podeGravar} className="text-[10px] font-black uppercase px-3 py-1.5 rounded-md border border-[#336699] text-[#336699] hover:bg-[#F0F4F8] disabled:opacity-40">
              {s?.origem === 'COFRE' ? 'Trocar' : s?.origem === 'VERCEL' ? 'Trazer p/ o cofre' : 'Preencher'}
            </button>
            {s?.origem === 'COFRE' && <button onClick={remover} className="text-[10px] font-black uppercase px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50">Remover</button>}
          </div>
        )}
      </div>
      {editando && (
        <div className="flex flex-col sm:flex-row gap-2">
          {campo.tipo === 'arquivo' ? (
            <input type="file" accept={campo.aceita} onChange={e => setArquivo(e.target.files?.[0] || null)} className="flex-1 text-xs" />
          ) : (
            <input
              type={campo.tipo === 'segredo' ? 'password' : 'text'} value={valor} onChange={e => setValor(e.target.value)}
              autoComplete="new-password" spellCheck={false} placeholder={campo.tipo === 'segredo' ? 'Cole o novo valor' : 'Valor'}
              className="flex-1 p-2 border border-gray-300 rounded-lg text-xs font-mono bg-gray-50 outline-none focus:border-[#336699]"
            />
          )}
          <div className="flex gap-2">
            <button onClick={() => { setEditando(false); setValor(''); setArquivo(null); }} className="text-[10px] font-black uppercase px-3 py-2 rounded-md border border-gray-200 text-gray-500">Cancelar</button>
            <button onClick={salvar} disabled={salvando || (campo.tipo === 'arquivo' ? !arquivo : !valor.trim())} className="text-[10px] font-black uppercase px-3 py-2 rounded-md bg-[#0C1D4D] text-white disabled:opacity-40">{salvando ? '...' : 'Gravar'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CartaoCertificado({ servico, situacao, empresaId, accessToken, podeGravar, onMudou }: CartaoProps & { empresaId: number }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const pfx = situacao('CERT_A1_PFX_BASE64');
  const meta = (pfx?.metadados || {}) as { titular?: string; validoAte?: string };
  const [agora] = useState(() => Date.now());
  const dias = meta.validoAte ? Math.floor((new Date(meta.validoAte).getTime() - agora) / 86400000) : null;
  const [editando, setEditando] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (!arquivo) return;
    setSalvando(true);
    const r = await salvarCertificadoA1Action({ empresaId, pfxBase64: await arquivoBase64(arquivo), senha }, accessToken);
    setSalvando(false);
    if (!r.ok) { toast(r.erro || 'Erro ao gravar o certificado.', 'error'); return; }
    toast(`Certificado de ${r.info?.titular} gravado (vence ${dataBR(r.info?.validoAte)}).`, 'success');
    setEditando(false); setArquivo(null); setSenha('');
    onMudou();
  };

  const remover = async () => {
    if (!(await confirmar({ title: 'Remover certificado', message: 'Remover o certificado A1 (arquivo e senha) do cofre? Se a Vercel tiver um, o sistema volta a usar o de lá.', confirmLabel: 'Remover', danger: true }))) return;
    const r = await removerCredencialAction({ empresaId, nome: 'CERT_A1_PFX_BASE64' }, accessToken);
    if (!r.ok) { toast(r.erro || 'Erro ao remover.', 'error'); return; }
    toast('Certificado removido do cofre.', 'success');
    onMudou();
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-[#0C1D4D]">{servico.icone} {servico.titulo} <Selo s={pfx} /></p>
          <p className="text-[11px] text-[#64748B]">{servico.usadoEm}</p>
          {pfx?.origem === 'COFRE' && meta.titular && (
            <p className={`text-xs font-bold mt-1 ${dias !== null && dias < 30 ? 'text-red-600' : 'text-[#334155]'}`}>
              {meta.titular} · vence {dataBR(meta.validoAte)}{dias !== null && ` (${dias < 0 ? 'vencido' : `${dias} dias`})`}
            </p>
          )}
          {pfx?.origem === 'VERCEL' && <p className="text-[11px] text-sky-700 mt-1">Hoje vem da Vercel. Envie o .pfx aqui para trazer ao cofre.</p>}
        </div>
        {!editando && (
          <div className="flex gap-2">
            <button onClick={() => setEditando(true)} disabled={!podeGravar} className="text-[10px] font-black uppercase px-3 py-1.5 rounded-md border border-[#336699] text-[#336699] hover:bg-[#F0F4F8] disabled:opacity-40">{pfx?.origem === 'COFRE' ? 'Trocar' : 'Enviar .pfx'}</button>
            {pfx?.origem === 'COFRE' && <button onClick={remover} className="text-[10px] font-black uppercase px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50">Remover</button>}
          </div>
        )}
      </div>
      {editando && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input type="file" accept=".pfx,.p12" onChange={e => setArquivo(e.target.files?.[0] || null)} className="text-xs" />
          <input type="password" value={senha} onChange={e => setSenha(e.target.value)} autoComplete="new-password" placeholder="Senha do certificado" className="p-2 border border-gray-300 rounded-lg text-xs bg-gray-50 outline-none focus:border-[#336699]" />
          <p className="sm:col-span-2 text-[11px] text-gray-400">O sistema abre o certificado com a senha e confere se o CNPJ é desta empresa e se não venceu antes de gravar.</p>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button onClick={() => { setEditando(false); setArquivo(null); setSenha(''); }} className="text-[10px] font-black uppercase px-3 py-2 rounded-md border border-gray-200 text-gray-500">Cancelar</button>
            <button onClick={salvar} disabled={salvando || !arquivo || !senha} className="text-[10px] font-black uppercase px-3 py-2 rounded-md bg-[#0C1D4D] text-white disabled:opacity-40">{salvando ? 'Conferindo...' : 'Conferir e gravar'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
