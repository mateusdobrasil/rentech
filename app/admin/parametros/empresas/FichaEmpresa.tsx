"use client";

// app/admin/parametros/empresas/FichaEmpresa.tsx
// Ficha da empresa em abas. Grava tudo pelo servidor (salvarEmpresaAction).
// A aba 🔐 Credenciais só aparece para o Administrador (e pede 2FA).
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useToast } from '../../../components/ui/NotificationProvider';
import { CONTRATO_CLAUSULAS_PADRAO, PROPOSTA_EXTRAS_PADRAO, PROPOSTA_TERMO_PADRAO } from '../../../lib/locacao/textosPadrao';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { salvarEmpresaAction, consultarCnpjEmpresaAction, consultarCepEmpresaAction, type EmpresaCadastro } from './actions';
import CredenciaisCofre from './CredenciaisCofre';

type Aba = 'dados' | 'endereco' | 'contatos' | 'bancario' | 'proposta' | 'credenciais';
type Form = Record<string, string | boolean>;

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const mascCnpj = (v: string) => { const d = so(v).slice(0, 14); return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2'); };
const mascCpf = (v: string) => { const d = so(v).slice(0, 11); return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'); };
const mascCep = (v: string) => { const d = so(v).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
const fmtCnpj = (v: unknown) => { const d = so(v); return d.length === 14 ? mascCnpj(d) : String(v || ''); };

const REGIMES = [
  { v: '', r: '—' }, { v: 'MEI', r: 'MEI' }, { v: 'SIMPLES', r: 'Simples Nacional' }, { v: 'PRESUMIDO', r: 'Lucro Presumido' }, { v: 'REAL', r: 'Lucro Real' },
];

const CAMPO = 'w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]';
const FormCtx = createContext<{ s: (k: string) => string; set: (k: string, v: string | boolean) => void }>({ s: () => '', set: () => {} });

// Fora da ficha de propósito: componente declarado dentro do render é recriado
// a cada tecla e o campo perde o foco.
function C({ rotulo, k, col = 1, ph, tipo = 'text', mask, ajuda }: { rotulo: string; k: string; col?: number; ph?: string; tipo?: string; mask?: (v: string) => string; ajuda?: ReactNode }) {
  const { s, set } = useContext(FormCtx);
  return (
    <div className={col === 2 ? 'sm:col-span-2' : col === 3 ? 'sm:col-span-3' : ''}>
      <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">{rotulo}</label>
      <input type={tipo} value={s(k)} placeholder={ph} onChange={e => set(k, mask ? mask(e.target.value) : e.target.value)} className={CAMPO} />
      {ajuda && <p className="text-[10px] text-gray-400 mt-1">{ajuda}</p>}
    </div>
  );
}
function Texto({ rotulo, k, linhas, padrao, ajuda }: { rotulo: string; k: string; linhas: number; padrao?: string; ajuda?: string }) {
  const { s, set } = useContext(FormCtx);
  return (
    <div className="sm:col-span-3">
      <div className="flex justify-between items-end mb-1">
        <label className="block text-[10px] font-black text-gray-500 uppercase">{rotulo}</label>
        {padrao && !s(k).trim() && <button type="button" onClick={() => set(k, padrao)} className="text-[9px] font-black uppercase text-[#336699]">carregar padrão</button>}
      </div>
      <textarea rows={linhas} value={s(k)} onChange={e => set(k, e.target.value)} className={`${CAMPO} font-mono`} />
      {ajuda && <p className="text-[10px] text-gray-400 mt-1">{ajuda}</p>}
    </div>
  );
}
const Titulo = ({ children }: { children: ReactNode }) => <p className="sm:col-span-3 text-[10px] font-black text-[#336699] uppercase pt-2 border-t border-gray-100">{children}</p>;

function formDe(e: EmpresaCadastro | null): Form {
  const f: Form = {};
  if (e) for (const [k, v] of Object.entries(e)) f[k] = typeof v === 'boolean' ? v : v == null ? '' : Array.isArray(v) ? v.map(fmtCnpj).join(', ') : String(v);
  f.ativo = e ? e.ativo !== false : true;
  f.cnpj = mascCnpj(String(f.cnpj || ''));
  f.cep = mascCep(String(f.cep || ''));
  f.responsavel_cpf = mascCpf(String(f.responsavel_cpf || ''));
  if (!f.fonte_recebimentos) f.fonte_recebimentos = 'P2S';
  if (!f.proposta_validade_dias) f.proposta_validade_dias = '7';
  return f;
}

interface Props {
  empresa: EmpresaCadastro | null;   // null = nova
  sistema?: boolean;                  // ficha "Sistema (todas as empresas)": só credenciais
  accessToken: string;
  podeCredenciais: boolean;
  sqlCadastro: boolean;
  onFechar: () => void;
  onSalvou: (id: number) => void;
}

export default function FichaEmpresa({ empresa, sistema, accessToken, podeCredenciais, sqlCadastro, onFechar, onSalvou }: Props) {
  const toast = useToast();
  const [aba, setAba] = useState<Aba>(sistema ? 'credenciais' : 'dados');
  const [f, setF] = useState<Form>(() => formDe(empresa));
  const [salvando, setSalvando] = useState(false);
  const [buscando, setBuscando] = useState('');
  const set = (k: string, v: string | boolean) => setF(x => ({ ...x, [k]: v }));
  const s = (k: string) => String(f[k] ?? '');

  const abas: { id: Aba; rotulo: string; so?: boolean }[] = sistema
    ? [{ id: 'credenciais', rotulo: '🔐 Credenciais' }]
    : [
      { id: 'dados', rotulo: '🏢 Dados' }, { id: 'endereco', rotulo: '📍 Endereço' }, { id: 'contatos', rotulo: '👥 Contatos' },
      { id: 'bancario', rotulo: '🏦 Bancário' }, { id: 'proposta', rotulo: '📄 Proposta e contrato' },
      ...(podeCredenciais && empresa ? [{ id: 'credenciais' as Aba, rotulo: '🔐 Credenciais' }] : []),
    ];

  const buscarCnpj = async () => {
    setBuscando('cnpj');
    const r = await consultarCnpjEmpresaAction(s('cnpj'), accessToken);
    setBuscando('');
    if (!r.ok || !r.info) { toast(r.erro || 'Não encontrei o CNPJ.', 'error'); return; }
    const d = r.info;
    setF(x => ({
      ...x,
      razao_social: d.razao_social || x.razao_social, nome_fantasia: d.nome_fantasia || x.nome_fantasia,
      data_abertura: d.data_abertura || x.data_abertura, cnae_principal: d.cnae_principal || x.cnae_principal, cnae_descricao: d.cnae_descricao || x.cnae_descricao,
      regime_tributario: d.regime_tributario || x.regime_tributario,
      cep: d.cep ? mascCep(d.cep) : x.cep, logradouro: d.logradouro || x.logradouro, numero: d.numero || x.numero, complemento: d.complemento || x.complemento,
      bairro: d.bairro || x.bairro, cidade: d.cidade || x.cidade, uf: d.uf || x.uf, codigo_ibge: d.codigo_ibge || x.codigo_ibge,
      telefone: x.telefone || d.telefone || '', email_contato: x.email_contato || d.email || '',
    }));
    toast(`Dados da Receita carregados${d.situacao ? ` (situação: ${d.situacao})` : ''}. Confira e grave.`, 'success');
  };

  const buscarCep = async () => {
    setBuscando('cep');
    const r = await consultarCepEmpresaAction(s('cep'), accessToken);
    setBuscando('');
    if (!r.ok || !r.info) { toast(r.erro || 'CEP não encontrado.', 'error'); return; }
    const d = r.info;
    setF(x => ({ ...x, logradouro: d.logradouro || x.logradouro, bairro: d.bairro || x.bairro, cidade: d.cidade || x.cidade, uf: d.uf || x.uf, codigo_ibge: d.codigo_ibge || x.codigo_ibge }));
  };

  const salvar = async () => {
    setSalvando(true);
    const r = await salvarEmpresaAction({ id: empresa?.id ?? null, dados: f }, accessToken);
    setSalvando(false);
    if (!r.ok || !r.info) { toast(r.erro || 'Erro ao gravar.', 'error'); return; }
    toast(empresa ? 'Empresa atualizada.' : 'Empresa cadastrada.', 'success');
    onSalvou(r.info.id);
  };

  const campo = CAMPO;

  const titulo = sistema ? 'Sistema (todas as empresas)' : empresa ? empresa.nome : 'Nova empresa';
  const enderecoPrevia = [[s('logradouro'), s('numero')].filter(Boolean).join(', '), s('complemento'), s('bairro'), [s('cidade'), s('uf')].filter(Boolean).join('/'), so(s('cep')).length === 8 ? `CEP ${s('cep')}` : ''].filter(Boolean).join(' - ');

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-[#E2E8F0]">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onFechar} className="text-xs font-black text-[#336699] uppercase whitespace-nowrap">← Lista</button>
          <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider truncate">{titulo}</h2>
          {empresa && <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${corSeloEmpresa(empresa.id)}`}>{empresa.nome_curto ? String(empresa.nome_curto) : empresa.nome}</span>}
        </div>
        {aba !== 'credenciais' && (
          <button onClick={salvar} disabled={salvando} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl hover:bg-[#284B8C] disabled:opacity-50">
            {salvando ? 'Gravando...' : empresa ? '💾 Gravar alterações' : '➕ Cadastrar empresa'}
          </button>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto px-3 border-b border-[#E2E8F0] bg-[#F8FAFC]">
        {abas.map(a => (
          <button key={a.id} onClick={() => setAba(a.id)} className={`px-4 py-3 text-[11px] font-black uppercase tracking-wider whitespace-nowrap border-b-2 ${aba === a.id ? 'border-[#336699] text-[#0C1D4D]' : 'border-transparent text-[#94A3B8] hover:text-[#64748B]'}`}>{a.rotulo}</button>
        ))}
      </div>

      <FormCtx.Provider value={{ s, set }}>
      <div className="p-5">
        {!sqlCadastro && aba !== 'credenciais' && (
          <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold px-4 py-3 rounded-lg">
            Falta rodar o SQL do cadastro completo (.sql/Pendentes/empresas_cadastro_completo_e_cofre.sql): os campos novos ainda não são gravados.
          </div>
        )}

        {aba === 'dados' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">CNPJ</label>
              <div className="flex gap-2">
                <input inputMode="numeric" value={s('cnpj')} placeholder="00.000.000/0000-00" onChange={e => set('cnpj', mascCnpj(e.target.value))} className={campo} />
                <button onClick={buscarCnpj} disabled={so(s('cnpj')).length !== 14 || buscando === 'cnpj'} className="text-[10px] font-black uppercase px-3 rounded-lg border border-[#336699] text-[#336699] whitespace-nowrap disabled:opacity-40">{buscando === 'cnpj' ? '...' : 'Buscar na Receita'}</button>
              </div>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 font-bold text-xs text-[#0C1D4D] cursor-pointer select-none pb-2">
                <input type="checkbox" checked={f.ativo === true} onChange={e => set('ativo', e.target.checked)} className="w-4 h-4 accent-[#336699]" /> Empresa ativa
              </label>
            </div>
            <C rotulo="Nome (identificador)" k="nome" ph="Ex.: RENTECH" mask={v => v.toUpperCase()} />
            <C rotulo="Nome curto (mensagens)" k="nome_curto" ph="Ex.: Rentech" />
            <C rotulo="Nome fantasia" k="nome_fantasia" />
            <C rotulo="Razão social" k="razao_social" col={3} />
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Regime tributário</label>
              <select value={s('regime_tributario')} onChange={e => set('regime_tributario', e.target.value)} className={campo}>
                {REGIMES.map(r => <option key={r.v} value={r.v}>{r.r}</option>)}
              </select>
            </div>
            <C rotulo="CNAE principal" k="cnae_principal" ph="7739-0/99" />
            <C rotulo="Data de abertura" k="data_abertura" tipo="date" />
            <C rotulo="Descrição do CNAE" k="cnae_descricao" col={3} />
            <C rotulo="Inscrição estadual" k="inscricao_estadual" />
            <C rotulo="Inscrição municipal" k="inscricao_municipal" />
            <C rotulo="CNO / CAEPF" k="cno_caepf" ajuda="Só se a empresa tiver (vai no AFD do ponto)." />
            <Titulo>Integração com o PrimeStart</Titulo>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Fonte dos recebimentos</label>
              <select value={s('fonte_recebimentos')} onChange={e => set('fonte_recebimentos', e.target.value)} className={campo}>
                <option value="P2S">PrimeStart (P2S)</option>
                <option value="EXTERNA">Outra fonte (não integrada)</option>
              </select>
            </div>
            <C rotulo="Outros CNPJs no P2S" k="cnpjs_p2s" col={2} ph="Ex.: 34.075.821/0001-09" ajuda="Centros do P2S que também são desta empresa. Separe por vírgula." />
            <Texto rotulo="Observações internas" k="observacoes" linhas={3} />
            <p className="sm:col-span-3 text-[11px] text-gray-400">Série, ambiente e alíquotas das notas ficam em Financeiro → Fiscal.</p>
          </div>
        )}

        {aba === 'endereco' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">CEP</label>
              <div className="flex gap-2">
                <input inputMode="numeric" value={s('cep')} placeholder="00000-000" onChange={e => set('cep', mascCep(e.target.value))} onBlur={() => so(s('cep')).length === 8 && !s('logradouro') && buscarCep()} className={campo} />
                <button onClick={buscarCep} disabled={so(s('cep')).length !== 8 || buscando === 'cep'} className="text-[10px] font-black uppercase px-3 rounded-lg border border-[#336699] text-[#336699] disabled:opacity-40">{buscando === 'cep' ? '...' : 'Buscar'}</button>
              </div>
            </div>
            <C rotulo="Logradouro" k="logradouro" col={2} />
            <C rotulo="Número" k="numero" />
            <C rotulo="Complemento" k="complemento" col={2} />
            <C rotulo="Bairro" k="bairro" />
            <C rotulo="Cidade" k="cidade" />
            <div className="grid grid-cols-2 gap-3">
              <C rotulo="UF" k="uf" mask={v => v.toUpperCase().slice(0, 2)} />
              <C rotulo="Cód. IBGE" k="codigo_ibge" />
            </div>
            <div className="sm:col-span-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3">
              <p className="text-[10px] font-black text-gray-500 uppercase mb-1">Como sai na proposta e no contrato</p>
              <p className="text-xs text-[#334155]">{enderecoPrevia || s('endereco') || '—'}</p>
              {!s('logradouro') && s('endereco') && <p className="text-[10px] text-amber-700 mt-1">Hoje vale o endereço antigo (texto único). Preencha os campos acima para trocar.</p>}
            </div>
          </div>
        )}

        {aba === 'contatos' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <C rotulo="Telefone" k="telefone" />
            <C rotulo="E-mail geral" k="email_contato" />
            <C rotulo="Site" k="site" />
            <C rotulo="E-mail do financeiro" k="email_financeiro" />
            <C rotulo="E-mail do fiscal" k="email_fiscal" col={2} />
            <Titulo>Responsável legal</Titulo>
            <C rotulo="Nome" k="responsavel_nome" />
            <C rotulo="CPF" k="responsavel_cpf" mask={mascCpf} />
            <C rotulo="Cargo" k="responsavel_cargo" ph="Sócio administrador" />
            <Titulo>Quem assina os contratos de locação</Titulo>
            <C rotulo="Nome" k="contrato_representante_nome" />
            <C rotulo="E-mail" k="contrato_representante_email" />
            <C rotulo="Celular (WhatsApp)" k="contrato_representante_celular" ajuda="Vem preenchido no envio à Autentique." />
            <Titulo>Contabilidade</Titulo>
            <C rotulo="Escritório / contador" k="contador_nome" />
            <C rotulo="CRC" k="contador_crc" />
            <C rotulo="Telefone" k="contador_telefone" />
            <C rotulo="E-mail" k="contador_email" col={3} />
          </div>
        )}

        {aba === 'bancario' && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <C rotulo="Banco (código)" k="banco_codigo" ph="341" mask={v => so(v).slice(0, 3)} />
            <C rotulo="Agência" k="banco_agencia" />
            <C rotulo="Conta" k="banco_conta" />
            <C rotulo="Chave PIX" k="pix_chave" />
            <p className="sm:col-span-4 text-[11px] text-gray-400">Conta principal da empresa, para documentos. As contas do Financeiro (saldos, conciliação) continuam em Financeiro → Contas; as credenciais do banco, na aba Credenciais.</p>
          </div>
        )}

        {aba === 'proposta' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Texto rotulo="Termo de responsabilidade (proposta)" k="proposta_condicoes" linhas={6} padrao={PROPOSTA_TERMO_PADRAO} ajuda="Aparece no fim de toda proposta desta empresa. Um item por linha. Em branco = termo padrão." />
            <Texto rotulo="Extras sob consulta (proposta)" k="proposta_extras" linhas={4} padrao={PROPOSTA_EXTRAS_PADRAO} ajuda="Em branco = lista padrão." />
            <C rotulo="Validade padrão do orçamento (dias)" k="proposta_validade_dias" tipo="number" />
            <Texto rotulo="Cláusulas do contrato" k="contrato_clausulas" linhas={10} padrao={CONTRATO_CLAUSULAS_PADRAO} ajuda='"## Título" vira título de seção; **texto** sai em negrito; linha em branco separa parágrafos. Em branco = contrato padrão.' />
          </div>
        )}

        {aba === 'credenciais' && (
          <CredenciaisCofre accessToken={accessToken} empresaId={sistema ? null : empresa!.id} empresaNome={sistema ? 'Sistema' : empresa!.nome} />
        )}
      </div>
      </FormCtx.Provider>
    </div>
  );
}
