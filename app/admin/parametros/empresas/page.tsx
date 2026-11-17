"use client";

import { useState, useEffect, useMemo } from 'react';
import { useConfirm } from '../../../components/ui/NotificationProvider';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { CONTRATO_CLAUSULAS_PADRAO, PROPOSTA_EXTRAS_PADRAO, PROPOSTA_TERMO_PADRAO } from '../../../lib/locacao/textosPadrao';
import { registrarLogAuditoria } from '../../../actions';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';

const somenteDigitos = (v: string): string => (v || '').replace(/\D/g, '');

const formatarCnpj = (cnpjBruto: string): string => {
  const cnpj = somenteDigitos(cnpjBruto);
  if (cnpj.length !== 14) return cnpjBruto || '';
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
};

// Máscara progressiva pro campo do formulário — aplica pontuação conforme o
// usuário digita, sem esperar os 14 dígitos completos (diferente de
// formatarCnpj, usada só pra exibir CNPJ já completo na grid).
const mascararCnpjDigitando = (v: string): string => {
  const d = somenteDigitos(v).slice(0, 14);
  let out = d.slice(0, 2);
  if (d.length > 2) out += '.' + d.slice(2, 5);
  if (d.length > 5) out += '.' + d.slice(5, 8);
  if (d.length > 8) out += '/' + d.slice(8, 12);
  if (d.length > 12) out += '-' + d.slice(12, 14);
  return out;
};

interface Empresa {
  id: number;
  nome: string;
  razao_social: string | null;
  cnpj: string | null;
  ativo: boolean;
  // Entrou por .sql/Pendentes/empresas_fonte_recebimentos.sql — ausente
  // enquanto o SQL não roda (a tela esconde o campo nesse caso).
  fonte_recebimentos?: 'P2S' | 'EXTERNA';
  // CNPJs extras de "Centros" do PrimeStart que são desta empresa (além do
  // CNPJ do cadastro) — .sql/Pendentes/empresas_cnpjs_p2s.sql, lido pelos
  // syncs via app/lib/empresaP2s.ts. Ausente enquanto o SQL não roda.
  cnpjs_p2s?: string[];
  // Cabeçalho e condições gerais da Proposta de Locação —
  // .sql/Pendentes/locacao_propostas.sql. Ausentes enquanto o SQL não roda.
  endereco?: string | null;
  telefone?: string | null;
  email_contato?: string | null;
  site?: string | null;
  proposta_condicoes?: string | null;
  // Contrato de locação + proposta (layout 2026-11-17) —
  // .sql/Pendentes/locacao_contrato_proposta.sql. Ausentes enquanto o SQL não roda.
  inscricao_estadual?: string | null;
  inscricao_municipal?: string | null;
  contrato_clausulas?: string | null;
  contrato_representante_nome?: string | null;
  contrato_representante_email?: string | null;
  contrato_representante_celular?: string | null;
  proposta_extras?: string | null;
  proposta_validade_dias?: number | null;
}

// De onde vêm os recebimentos da empresa — lido pelo Relatório do Diretor
// (app/lib/diretoria/indicadoresDiarios.ts).
const FONTES_RECEBIMENTOS = [
  { valor: 'P2S', rotulo: 'PrimeStart (P2S)', ajuda: 'Recebido, a receber e inadimplência saem do contas a receber do P2S.' },
  { valor: 'EXTERNA', rotulo: 'Outra fonte (não integrada)', ajuda: 'O Relatório do Diretor ignora o contas a receber do P2S desta empresa.' },
] as const;

const contratoFormPadrao = { inscricao_estadual: '', inscricao_municipal: '', contrato_clausulas: '', contrato_representante_nome: '', contrato_representante_email: '', contrato_representante_celular: '', proposta_extras: '', proposta_validade_dias: '7' };
const empresaFormPadrao: { nome: string; razao_social: string; cnpj: string; ativo: boolean; fonte_recebimentos: 'P2S' | 'EXTERNA'; cnpjs_p2s: string; endereco: string; telefone: string; email_contato: string; site: string; proposta_condicoes: string } & typeof contratoFormPadrao =
  { nome: '', razao_social: '', cnpj: '', ativo: true, fonte_recebimentos: 'P2S', cnpjs_p2s: '', endereco: '', telefone: '', email_contato: '', site: '', proposta_condicoes: '', ...contratoFormPadrao };

// "34.075.821/0001-09, 10.353.694/0001-02" → ['34075821000109', '10353694000102'] (só CNPJs completos)
const listaCnpjs = (texto: string) => [...new Set(texto.split(/[,;\n]+/).map(c => somenteDigitos(c)).filter(c => c.length === 14))];

export default function EmpresasPage() {
  const router = useRouter();
  const confirmar = useConfirm();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente } = usePageAccess({ nomeFallback: 'Usuário' });

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [funcionariosPorEmpresa, setFuncionariosPorEmpresa] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

  const [form, setForm] = useState(empresaFormPadrao);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });

  useEffect(() => {
    if (!authLoading && !acessoNegado) carregarEmpresas();
  }, [authLoading, acessoNegado]);

  const carregarEmpresas = async () => {
    setLoading(true);
    try {
      const [empresasRes, funcionariosRes] = await Promise.all([
        supabase.from('empresas').select('*').order('nome'),
        supabase.from('folha_funcionarios').select('empresa_id'),
      ]);
      if (empresasRes.error) throw empresasRes.error;
      setEmpresas((empresasRes.data || []) as Empresa[]);

      const contagem: Record<number, number> = {};
      (funcionariosRes.data || []).forEach((f: { empresa_id: number | null }) => {
        if (f.empresa_id) contagem[f.empresa_id] = (contagem[f.empresa_id] || 0) + 1;
      });
      setFuncionariosPorEmpresa(contagem);
    } catch (error) {
      console.error(error);
      mostrarFeedback('Erro ao carregar empresas.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const mostrarFeedback = (msg: string, type: 'success' | 'error') => {
    setFeedback({ show: true, msg, type });
    setTimeout(() => setFeedback({ show: false, msg: '', type: 'success' }), 3000);
  };

  const colunaFonteExiste = empresas.some(e => e.fonte_recebimentos !== undefined);
  const colunaCnpjsP2sExiste = empresas.some(e => e.cnpjs_p2s !== undefined);
  const colunasPropostaExistem = empresas.some(e => e.proposta_condicoes !== undefined);
  const colunasContratoExistem = empresas.some(e => e.contrato_clausulas !== undefined);

  const prepararEdicao = (e: Empresa) => {
    setForm({ nome: e.nome, razao_social: e.razao_social || '', cnpj: mascararCnpjDigitando(e.cnpj || ''), ativo: e.ativo, fonte_recebimentos: e.fonte_recebimentos === 'EXTERNA' ? 'EXTERNA' : 'P2S', cnpjs_p2s: (e.cnpjs_p2s || []).map(formatarCnpj).join(', '), endereco: e.endereco || '', telefone: e.telefone || '', email_contato: e.email_contato || '', site: e.site || '', proposta_condicoes: e.proposta_condicoes || '',
      inscricao_estadual: e.inscricao_estadual || '', inscricao_municipal: e.inscricao_municipal || '', contrato_clausulas: e.contrato_clausulas || '',
      contrato_representante_nome: e.contrato_representante_nome || '', contrato_representante_email: e.contrato_representante_email || '',
      contrato_representante_celular: e.contrato_representante_celular || '', proposta_extras: e.proposta_extras || '', proposta_validade_dias: String(e.proposta_validade_dias ?? 7) });
    setEditandoId(e.id);
  };

  const limparForm = () => {
    setForm(empresaFormPadrao);
    setEditandoId(null);
  };

  const salvarEmpresa = async () => {
    if (!form.nome.trim()) return mostrarFeedback('Informe o nome da empresa.', 'error');

    setSalvando(true);
    try {
      const payload = {
        nome: form.nome.trim().toUpperCase(),
        razao_social: form.razao_social.trim() || null,
        cnpj: somenteDigitos(form.cnpj) || null,
        ativo: form.ativo,
        ...(colunaFonteExiste ? { fonte_recebimentos: form.fonte_recebimentos } : {}),
        ...(colunaCnpjsP2sExiste ? { cnpjs_p2s: listaCnpjs(form.cnpjs_p2s) } : {}),
        ...(colunasPropostaExistem ? {
          endereco: form.endereco.trim() || null, telefone: form.telefone.trim() || null, email_contato: form.email_contato.trim() || null,
          site: form.site.trim() || null, proposta_condicoes: form.proposta_condicoes.trim() || null,
        } : {}),
        ...(colunasContratoExistem ? {
          inscricao_estadual: form.inscricao_estadual.trim() || null, inscricao_municipal: form.inscricao_municipal.trim() || null,
          contrato_clausulas: form.contrato_clausulas.trim() || null,
          contrato_representante_nome: form.contrato_representante_nome.trim() || null,
          contrato_representante_email: form.contrato_representante_email.trim() || null,
          contrato_representante_celular: form.contrato_representante_celular.trim() || null,
          proposta_extras: form.proposta_extras.trim() || null,
          proposta_validade_dias: Math.max(1, Math.min(90, Number(form.proposta_validade_dias) || 7)),
        } : {}),
      };

      let error;
      if (editandoId) {
        ({ error } = await supabase.from('empresas').update(payload).eq('id', editandoId));
      } else {
        ({ error } = await supabase.from('empresas').insert([payload]));
      }
      if (error) {
        if (error.code === '23505') throw new Error('Já existe uma empresa cadastrada com este nome ou CNPJ.');
        throw error;
      }

      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: editandoId ? 'ATUALIZOU EMPRESA' : 'CADASTROU EMPRESA',
        setor: 'PARÂMETROS / EMPRESAS',
        equipamento_nome: payload.nome,
      });

      mostrarFeedback(editandoId ? 'Empresa atualizada com sucesso!' : 'Empresa cadastrada com sucesso!', 'success');
      limparForm();
      carregarEmpresas();
    } catch (error: any) {
      mostrarFeedback(error.message || 'Erro ao salvar empresa.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const removerEmpresa = async (empresa: Empresa) => {
    const emUso = funcionariosPorEmpresa[empresa.id] || 0;
    const aviso = emUso > 0
      ? ` Atenção: ${emUso} funcionário(s) está(ão) vinculado(s) a esta empresa e ficará(ão) sem empresa definida.`
      : '';
    if (!(await confirmar({ message: `Remover a empresa "${empresa.nome}"?${aviso}`, danger: true, confirmLabel: 'Remover' }))) return;

    try {
      const { error } = await supabase.from('empresas').delete().eq('id', empresa.id);
      if (error) throw error;

      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'REMOVEU EMPRESA',
        setor: 'PARÂMETROS / EMPRESAS',
        equipamento_nome: empresa.nome,
      });

      mostrarFeedback('Empresa removida.', 'success');
      if (editandoId === empresa.id) limparForm();
      carregarEmpresas();
    } catch (error) {
      console.error(error);
      mostrarFeedback('Erro ao remover empresa.', 'error');
    }
  };

  const empresasFiltradas = useMemo(() => {
    const termo = busca.toLowerCase();
    return empresas.filter(e =>
      e.nome.toLowerCase().includes(termo) ||
      (e.razao_social || '').toLowerCase().includes(termo) ||
      (e.cnpj || '').includes(somenteDigitos(termo))
    );
  }, [empresas, busca]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para aceder ao Cadastro de Empresas.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics/>

      <div className="px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">Cadastro de Empresas</h1>
          <p className="text-sm font-medium text-gray-500">Empresas do Grupo Rentech usadas para vincular funcionários e restringir acesso por CNPJ.</p>
        </div>
        <Link href="/admin/parametros" className="text-xs font-bold bg-white hover:bg-gray-100 border border-gray-300 text-gray-600 px-6 py-3 rounded-lg transition-colors uppercase tracking-wider shadow-sm">
          ⬅ Voltar ao Hub
        </Link>
      </div>

      {feedback.show && (
        <div className={`fixed top-6 right-8 px-6 py-3 rounded-lg shadow-xl z-50 font-black text-xs uppercase tracking-wider ${feedback.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {feedback.type === 'success' ? '✅ ' : '❌ '}{feedback.msg}
        </div>
      )}

      <div className="px-4 md:px-8 pb-8 flex-grow flex flex-col lg:flex-row gap-6 overflow-hidden">

        <div className="w-full lg:w-[400px] bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] h-fit space-y-4">
          <div className="border-b border-gray-100 pb-2">
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">
              {editandoId ? 'Editar Empresa' : 'Nova Empresa'}
            </h2>
            <p className="text-[11px] text-gray-400 font-bold uppercase mt-0.5">CNPJ é opcional, mas recomendado</p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Nome (identificador curto)</label>
              <input type="text" placeholder="Ex: RENTECH LOGÍSTICA" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-bold uppercase bg-gray-50 text-[#0C1D4D]" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Razão Social</label>
              <input type="text" placeholder="Ex: Rentech Logística e Transportes LTDA" value={form.razao_social} onChange={e => setForm({ ...form, razao_social: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">CNPJ</label>
              <input type="text" inputMode="numeric" placeholder="00.000.000/0000-00" maxLength={18} value={form.cnpj} onChange={e => setForm({ ...form, cnpj: mascararCnpjDigitando(e.target.value) })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
            </div>
            {colunaCnpjsP2sExiste && (
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Outros CNPJs no PrimeStart (P2S)</label>
                <textarea rows={2} placeholder="Ex: 34.075.821/0001-09" value={form.cnpjs_p2s} onChange={e => setForm({ ...form, cnpjs_p2s: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699] resize-none" />
                <p className="text-[10px] text-gray-400 mt-1">Centros do P2S que também são desta empresa, além do CNPJ acima. Separe por vírgula. Títulos e fichas desses CNPJs entram nesta empresa.</p>
              </div>
            )}
            {colunaFonteExiste && (
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Fonte dos recebimentos</label>
                <select value={form.fonte_recebimentos} onChange={e => setForm({ ...form, fonte_recebimentos: e.target.value as 'P2S' | 'EXTERNA' })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]">
                  {FONTES_RECEBIMENTOS.map(f => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">{FONTES_RECEBIMENTOS.find(f => f.valor === form.fonte_recebimentos)?.ajuda}</p>
              </div>
            )}
            {colunasPropostaExistem && (
              <div className="space-y-3 border-t border-gray-100 pt-3">
                <p className="text-[10px] font-black text-[#336699] uppercase">Proposta de locação (cabeçalho do PDF)</p>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Endereço</label>
                  <input type="text" placeholder="Rua, nº - Bairro - Cidade/UF - CEP" value={form.endereco} onChange={e => setForm({ ...form, endereco: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Telefone</label>
                    <input type="text" value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">E-mail</label>
                    <input type="text" value={form.email_contato} onChange={e => setForm({ ...form, email_contato: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Site</label>
                  <input type="text" value={form.site} onChange={e => setForm({ ...form, site: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                </div>
                <div>
                  <div className="flex justify-between items-end mb-1">
                    <label className="block text-[10px] font-black text-gray-500 uppercase">Termo de responsabilidade (proposta)</label>
                    {!form.proposta_condicoes.trim() && <button type="button" onClick={() => setForm({ ...form, proposta_condicoes: PROPOSTA_TERMO_PADRAO })} className="text-[9px] font-black uppercase text-[#336699]">carregar padrão</button>}
                  </div>
                  <textarea rows={6} placeholder="Em branco = termo do orçamento padrão (fiel depositário, extravio, diárias por atraso, cancelamento 24h...)" value={form.proposta_condicoes} onChange={e => setForm({ ...form, proposta_condicoes: e.target.value })}
                    className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                  <p className="text-[10px] text-gray-400 mt-1">Aparece no fim de toda proposta desta empresa. Um item por linha.</p>
                </div>
                {colunasContratoExistem && (
                  <>
                    <div>
                      <div className="flex justify-between items-end mb-1">
                        <label className="block text-[10px] font-black text-gray-500 uppercase">Extras sob consulta (proposta)</label>
                        {!form.proposta_extras.trim() && <button type="button" onClick={() => setForm({ ...form, proposta_extras: PROPOSTA_EXTRAS_PADRAO })} className="text-[9px] font-black uppercase text-[#336699]">carregar padrão</button>}
                      </div>
                      <textarea rows={4} placeholder="Em branco = lista padrão (cabeamento acima de 10 m, notebook/player, conversores...)" value={form.proposta_extras} onChange={e => setForm({ ...form, proposta_extras: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Validade padrão do orçamento (dias)</label>
                      <input type="number" min={1} max={90} value={form.proposta_validade_dias} onChange={e => setForm({ ...form, proposta_validade_dias: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                    </div>
                  </>
                )}
              </div>
            )}
            {colunasContratoExistem && (
              <div className="space-y-3 border-t border-gray-100 pt-3">
                <p className="text-[10px] font-black text-[#336699] uppercase">Contrato de locação</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Inscrição estadual</label>
                    <input type="text" value={form.inscricao_estadual} onChange={e => setForm({ ...form, inscricao_estadual: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Inscrição municipal</label>
                    <input type="text" value={form.inscricao_municipal} onChange={e => setForm({ ...form, inscricao_municipal: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Representante que assina pela empresa</label>
                  <input type="text" placeholder="Nome" value={form.contrato_representante_nome} onChange={e => setForm({ ...form, contrato_representante_nome: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699] mb-2" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" placeholder="E-mail" value={form.contrato_representante_email} onChange={e => setForm({ ...form, contrato_representante_email: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                    <input type="text" placeholder="Celular (WhatsApp)" value={form.contrato_representante_celular} onChange={e => setForm({ ...form, contrato_representante_celular: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Vem preenchido no envio do contrato para a Autentique (dá para trocar na hora).</p>
                </div>
                <div>
                  <div className="flex justify-between items-end mb-1">
                    <label className="block text-[10px] font-black text-gray-500 uppercase">Cláusulas do contrato</label>
                    {!form.contrato_clausulas.trim() && <button type="button" onClick={() => setForm({ ...form, contrato_clausulas: CONTRATO_CLAUSULAS_PADRAO })} className="text-[9px] font-black uppercase text-[#336699]">carregar padrão para editar</button>}
                  </div>
                  <textarea rows={8} placeholder="Em branco = contrato padrão da Rentech (Definições + Cláusulas 1ª a 41ª)" value={form.contrato_clausulas} onChange={e => setForm({ ...form, contrato_clausulas: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699] font-mono" />
                  <p className="text-[10px] text-gray-400 mt-1">"## Título" vira título de seção; **texto** sai em negrito; linha em branco separa parágrafos.</p>
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 font-bold text-xs text-[#0C1D4D] cursor-pointer select-none">
              <input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} className="w-4 h-4 accent-[#336699]" />
              Empresa ativa
            </label>

            <div className="pt-2 flex gap-2">
              {editandoId && (
                <button onClick={limparForm} className="bg-gray-100 text-gray-500 font-black text-[10px] uppercase tracking-wider px-4 py-3 rounded-xl hover:bg-gray-200 transition-colors">
                  Cancelar
                </button>
              )}
              <button onClick={salvarEmpresa} disabled={salvando} className="w-full bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-[#284B8C] transition-all shadow-md disabled:opacity-50">
                {salvando ? '...' : editandoId ? '💾 Gravar Alterações' : '➕ Cadastrar Empresa'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex-grow bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col h-full">
          <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
            <input
              type="text"
              placeholder="🔍 Buscar por nome, razão social ou CNPJ..."
              value={busca} onChange={e => setBusca(e.target.value)}
              className="w-full max-w-md p-2 border border-gray-300 rounded-lg text-xs font-semibold outline-none focus:border-[#336699]"
            />
          </div>

          <div className="overflow-auto flex-grow">
            {loading ? (
              <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider text-xs">Carregando...</p>
            ) : empresasFiltradas.length === 0 ? (
              <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider text-xs">Nenhuma empresa cadastrada.</p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] sticky top-0 text-[10px] font-black uppercase text-gray-400 tracking-wider">
                  <tr>
                    <th className="p-4 w-20 text-center">Status</th>
                    <th className="p-4">Empresa / Razão Social</th>
                    <th className="p-4">CNPJ</th>
                    <th className="p-4 text-center w-32">Funcionários</th>
                    <th className="p-4 text-center w-40">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-sm font-medium">
                  {empresasFiltradas.map(e => (
                    <tr key={e.id} className={`hover:bg-gray-50 transition-colors ${!e.ativo ? 'opacity-40 bg-gray-50' : ''}`}>
                      <td className="p-4 text-center">
                        <div className={`w-3 h-3 rounded-full mx-auto ${e.ativo ? 'bg-green-500 shadow-sm' : 'bg-red-500 shadow-sm'}`}></div>
                      </td>
                      <td className="p-4">
                        <strong className="block text-[#0C1D4D] font-black uppercase tracking-tight">{e.nome}</strong>
                        <span className="text-xs text-[#64748B] font-bold">{e.razao_social || '—'}</span>
                        {e.fonte_recebimentos === 'EXTERNA' && (
                          <span className="block mt-1 text-[9px] font-black uppercase text-amber-700">Recebimentos: outra fonte</span>
                        )}
                      </td>
                      <td className="p-4 text-xs text-gray-600 font-mono">{formatarCnpj(e.cnpj || '') || '—'}</td>
                      <td className="p-4 text-center text-xs font-bold text-gray-600">{funcionariosPorEmpresa[e.id] || 0}</td>
                      <td className="p-4 text-center">
                        <div className="flex justify-center items-center gap-2">
                          <button onClick={() => prepararEdicao(e)} className="bg-blue-50 border border-blue-200 text-[#0369A1] font-bold text-[10px] uppercase px-3 py-1.5 rounded-md hover:bg-blue-100 transition-colors">
                            Editar
                          </button>
                          <button onClick={() => removerEmpresa(e)} className="bg-red-50 border border-red-200 text-red-600 font-bold text-[10px] uppercase px-3 py-1.5 rounded-md hover:bg-red-100 transition-colors">
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
