"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { registrarLogAuditoria } from '../actions';
import { Analytics } from "@vercel/analytics/next";

export default function CadastroFreelance() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erroMsg, setErroMsg] = useState('');

  const [lgpdAceita, setLgpdAceita] = useState(false);
  const [mostrarRecusa, setMostrarRecusa] = useState(false);

  // Empresa do grupo (Rentech × AlfaLight) para a qual o freelancer está se
  // cadastrando. Não é mais escolhida por ele — vem do domínio de onde ele
  // acessou (portal.alfalight.com.br = AlfaLight; qualquer outro domínio,
  // inclusive localhost em teste, = Rentech), mesma técnica usada na troca
  // de logo de app/login/page.tsx. Os setores/níveis abaixo dependem dela:
  // cada empresa loca equipamento diferente, então tem sua própria lista.
  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [empresaTravada, setEmpresaTravada] = useState<{ id: number; nome: string } | null>(null);

  useEffect(() => {
    supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome')
      .then(({ data }) => setEmpresas(data || []));
  }, []);

  useEffect(() => {
    if (empresas.length === 0) return;
    const ehAlfaLight = window.location.hostname === 'portal.alfalight.com.br';
    const alvo = empresas.find(e => e.nome.toLowerCase().includes(ehAlfaLight ? 'alfa' : 'rentech'));
    if (!alvo) return;
    setEmpresaTravada(alvo);
    setFormData(prev => ({ ...prev, empresa_id: String(alvo.id) }));
  }, [empresas]);

  const [setores, setSetores] = useState<{ id: string; nome: string }[]>([]);
  const [niveis, setNiveis] = useState<{ id: string; nome: string }[]>([]);
  // setor_id -> nivel_id ('' = "Não trabalho com o Item")
  const [niveisEscolhidos, setNiveisEscolhidos] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    empresa_id: '',
    nome: '', cpf: '', data_nascimento: '', email: '', telefone: '', endereco: '',
    pix_chave: '', pix_tipo: 'CPF', valor_diaria: '', // NOVO CAMPO AQUI
    comentarios: ''
  });

  // Recarrega o catálogo de setores/níveis toda vez que a empresa escolhida
  // muda — e limpa as respostas já dadas, já que a lista de setores muda.
  useEffect(() => {
    setNiveisEscolhidos({});
    if (!formData.empresa_id) { setSetores([]); setNiveis([]); return; }
    const empresaId = Number(formData.empresa_id);
    Promise.all([
      supabase.from('freelancers_setores').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('ordem'),
      supabase.from('freelancers_niveis').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('ordem'),
    ]).then(([resSetores, resNiveis]) => {
      setSetores(resSetores.data || []);
      setNiveis(resNiveis.data || []);
    });
  }, [formData.empresa_id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErroMsg(''); 

    const payloadFinal = {
      ...formData,
      empresa_id: formData.empresa_id ? Number(formData.empresa_id) : null,
      // Garante que o valor da diária seja salvo como número no banco, mesmo se o usuário digitar vírgula
      valor_diaria: formData.valor_diaria ? parseFloat(formData.valor_diaria.replace(',', '.')) : null,
      lgpd_aceite: true,
    };

    const { data: freelancerCriado, error } = await supabase.from('freelancers').insert([payloadFinal]).select('id').single();

    if (!error) {
      // Um insert em lote com os setores respondidos (setor sem resposta =
      // "Não trabalho com o Item", não vira linha nenhuma). Se isso falhar,
      // o cadastro em si já foi feito — só avisa no console, mesma
      // tolerância já usada ao copiar o modelo padrão de itens do Checklist
      // de Carga (app/admin/estoque/expedicao/page.tsx).
      const linhasSetorNivel = Object.entries(niveisEscolhidos)
        .filter(([, nivelId]) => nivelId)
        .map(([setorId, nivelId]) => ({ freelancer_id: freelancerCriado.id, setor_id: setorId, nivel_id: nivelId }));
      if (linhasSetorNivel.length > 0) {
        const { error: erroSetores } = await supabase.from('freelancers_setor_nivel').insert(linhasSetorNivel);
        if (erroSetores) console.error('Falha ao gravar setores/níveis do freelancer:', erroSetores.message);
      }

      registrarLogAuditoria({
        usuario_nome: formData.nome,
        acao: 'AUTO-CADASTRO FREELANCER',
        setor: 'FREELANCE',
        equipamento_nome: `Tel: ${formData.telefone} | PIX: ${formData.pix_tipo} — ${formData.pix_chave}`,
      });
      setSucesso(true);
      window.scrollTo(0, 0);
    } else {
      if (error.code === '23505' || error.message.includes('duplicate') || error.message.includes('unique')) {
        setErroMsg("⚠️ Este CPF ou Número de WhatsApp já se encontra cadastrado em nossa base.");
      } else {
        setErroMsg("❌ Ocorreu um erro inesperado ao enviar. Verifique a sua conexão e tente novamente.");
      }
    }
    setLoading(false);
  };

  if (sucesso) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-10 rounded-2xl shadow-xl max-w-md w-full border-t-8 border-[#16A34A]">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Cadastro Recebido!</h1>
          <p className="text-[#64748B] font-medium mb-8">
            As suas informações foram enviadas para o banco de talentos da Rentech Locadora com sucesso.
          </p>
          <button onClick={() => window.location.reload()} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-[#284B8C] transition-colors w-full">
            Fazer Novo Cadastro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pb-12 relative">
      <Analytics />

      {/* ========================================================================= */}
      {/* MODAL DE RECUSA */}
      {/* ========================================================================= */}
      {mostrarRecusa && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-white p-8 md:p-10 rounded-3xl shadow-2xl max-w-sm w-full text-center border-t-8 border-red-500 animate-in fade-in zoom-in duration-300">
            <div className="text-5xl mb-6">🛑</div>
            <h2 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider mb-4">
              Acesso Restrito
            </h2>
            <p className="text-[#64748B] text-sm font-medium mb-8 leading-relaxed">
              Sem o aceite da política de privacidade, não podemos recolher e armazenar os seus dados técnicos e de pagamento. Por razões de segurança jurídica, o seu cadastro não poderá prosseguir.
            </p>
            <button 
              onClick={() => router.push('/')} 
              className="w-full py-4 bg-red-500 text-white font-black text-sm uppercase tracking-widest rounded-xl hover:bg-red-600 transition-all shadow-md hover:shadow-lg"
            >
              OK, Voltar ao Site
            </button>
            <button 
              onClick={() => setMostrarRecusa(false)} 
              className="w-full py-3 mt-3 bg-transparent text-[#64748B] font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-[#E2E8F0] transition-colors"
            >
              Mudei de Ideia
            </button>
          </div>
        </div>
      )}
      
      {/* ========================================================================= */}
      {/* MODAL DE BLOQUEIO LGPD */}
      {/* ========================================================================= */}
      {!lgpdAceita && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="bg-white p-8 md:p-10 rounded-3xl shadow-2xl max-w-lg w-full text-center border-t-8 border-[#336699] animate-in fade-in zoom-in duration-300">
            <div className="text-5xl mb-6">🔐</div>
            <h2 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider mb-4">
              Privacidade e LGPD
            </h2>
            <p className="text-[#64748B] text-sm font-medium mb-4 text-justify leading-relaxed">
              Para integrar o nosso Banco de Talentos, a <strong>Rentech Locadora</strong> precisa de recolher os seus dados pessoais sensíveis (como Nome, CPF, Contatos e Chave PIX).
            </p>
            <p className="text-[#64748B] text-sm font-medium mb-8 text-justify leading-relaxed">
              Garantimos que as suas informações serão armazenadas com segurança e utilizadas <strong>exclusivamente</strong> para fins de escalação de equipe, contatos operacionais e pagamentos de diárias, em total conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).
            </p>
            
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => setLgpdAceita(true)}
                className="w-full py-4 bg-[#336699] text-white font-black text-sm uppercase tracking-widest rounded-xl hover:bg-[#284B8C] transition-all shadow-md hover:shadow-lg"
              >
                Li e Aceito os Termos
              </button>
              <button 
                onClick={() => setMostrarRecusa(true)} 
                className="w-full py-3 bg-[#F0F4F8] text-[#64748B] font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-[#E2E8F0] transition-colors"
              >
                Não Concordo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CONTEÚDO DA PÁGINA */}
      {/* ========================================================================= */}
      <div className={!lgpdAceita ? 'pointer-events-none opacity-40 blur-sm h-screen overflow-hidden' : ''}>
        
        <div className="bg-[#0C1D4D] text-center py-10 px-4 rounded-b-[40px] shadow-lg mb-8">
          <h1 className="text-2xl md:text-3xl font-black text-white uppercase tracking-wider mb-2">
            Banco de Talentos
          </h1>
          <p className="text-[#94A3B8] text-sm max-w-lg mx-auto font-medium">
            Faça parte da nossa equipe de freelancers. Preencha os seus dados técnicos e informações para pagamento de diárias (PIX).
          </p>
        </div>

        <div className="container mx-auto px-4 max-w-3xl">
          <form onSubmit={handleSubmit} className="bg-white p-6 md:p-10 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-8">
            
            {/* Dados Pessoais */}
            <div>
              <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">👤 Dados Pessoais</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Empresa de Cadastro</label>
                  <div className="w-full p-3 bg-[#F0F4F8] border border-[#CBD5E1] rounded-xl text-sm font-bold text-[#0C1D4D]">
                    {empresaTravada ? empresaTravada.nome : 'Carregando...'}
                  </div>
                  <p className="mt-1 text-[10px] text-[#94A3B8] font-semibold">Definida automaticamente pelo endereço deste formulário.</p>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Nome Completo</label>
                  <input required type="text" name="nome" value={formData.nome} onChange={handleChange} className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">CPF</label>
                  <input required type="text" name="cpf" value={formData.cpf} onChange={handleChange} placeholder="Apenas números" className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Data de Nascimento</label>
                  <input required type="date" name="data_nascimento" value={formData.data_nascimento} onChange={handleChange} className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none text-[#64748B]" />
                </div>
              </div>
            </div>

            {/* Contato e Endereço */}
            <div>
              <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">📍 Contato e Endereço</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">WhatsApp</label>
                  <input required type="tel" name="telefone" value={formData.telefone} onChange={handleChange} placeholder="(11) 90000-0000" className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">E-mail</label>
                  <input required type="email" name="email" value={formData.email} onChange={handleChange} className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Endereço Completo</label>
                  <input required type="text" name="endereco" value={formData.endereco} onChange={handleChange} placeholder="Rua, Número, Bairro, Cidade" className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
                </div>
              </div>
            </div>

            {/* Dados Bancários e Diária */}
            <div>
              <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">💳 Dados para Pagamento (PIX)</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Tipo de Chave</label>
                  <select name="pix_tipo" value={formData.pix_tipo} onChange={handleChange} className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-bold text-[#0C1D4D] focus:border-[#336699] outline-none cursor-pointer">
                    <option value="CPF">CPF</option>
                    <option value="Celular">Celular</option>
                    <option value="E-mail">E-mail</option>
                    <option value="Chave Aleatória">Chave Aleatória</option>
                    <option value="CNPJ">CNPJ</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">A sua Chave PIX</label>
                  <input required type="text" name="pix_chave" value={formData.pix_chave} onChange={handleChange} className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
                </div>
                
                {/* NOVO CAMPO: Valor da Diária */}
                <div className="md:col-span-3 bg-[#F0F9FF] p-4 rounded-xl border border-[#BAE6FD]">
                  <label className="block text-[10px] font-bold text-[#0369A1] uppercase tracking-wider mb-1">Pretensão Média de Diária (R$)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-[#64748B] font-bold text-sm">R$</span>
                    <input 
                      required 
                      type="number" 
                      step="0.01" 
                      min="0"
                      name="valor_diaria" 
                      value={formData.valor_diaria} 
                      onChange={handleChange} 
                      placeholder="Ex: 350.00" 
                      className="w-full p-3 pl-10 bg-white border border-[#BAE6FD] rounded-xl text-sm font-bold text-[#0C1D4D] focus:border-[#0369A1] outline-none" 
                    />
                  </div>
                  <p className="text-[10px] text-[#64748B] font-semibold mt-1">* Valor base orientativo para cotação das Ordens de Pagamento.</p>
                </div>
              </div>
              <p className="text-[10px] text-red-500 font-bold mt-2">* Não nos responsabilizamos por dados de PIX informados incorretamente.</p>
            </div>

            {/* Conhecimento Técnico */}
            <div>
              <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">⚙️ Nível de Conhecimento Técnico</h2>

              {!formData.empresa_id ? (
                <p className="text-xs text-[#94A3B8] font-semibold bg-[#F8FAFC] border border-dashed border-[#CBD5E1] rounded-xl p-4 text-center">
                  Selecione a Empresa de Cadastro no início do formulário para ver os setores.
                </p>
              ) : setores.length === 0 ? (
                <p className="text-xs text-[#94A3B8] font-semibold bg-[#F8FAFC] border border-dashed border-[#CBD5E1] rounded-xl p-4 text-center">
                  Nenhum setor cadastrado ainda para esta empresa.
                </p>
              ) : (
                <>
                  <p className="text-xs text-[#64748B] mb-4">Seja sincero na sua avaliação para que o possamos escalar para os eventos corretos.</p>
                  <div className="space-y-4">
                    {setores.map((setor) => (
                      <div key={setor.id} className="flex flex-col md:flex-row md:items-center justify-between bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0]">
                        <label className="text-sm font-bold text-[#0C1D4D] uppercase tracking-wider mb-2 md:mb-0">{setor.nome}</label>
                        <select
                          value={niveisEscolhidos[setor.id] || ''}
                          onChange={e => setNiveisEscolhidos(prev => ({ ...prev, [setor.id]: e.target.value }))}
                          className="w-full md:w-64 p-2 bg-white border border-[#CBD5E1] rounded-lg text-xs font-semibold text-[#0C1D4D] focus:border-[#336699] outline-none cursor-pointer"
                        >
                          <option value="">Não trabalho com o Item</option>
                          {niveis.map(n => <option key={n.id} value={n.id}>{n.nome}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Experiência / Comentários */}
            <div>
              <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">📝 Resumo Profissional</h2>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Fale um pouco sobre si (Opcional)</label>
              <textarea name="comentarios" rows={4} value={formData.comentarios} onChange={handleChange} placeholder="Descreva a sua experiência, empresas que já atendeu, softwares que domina (ex: NovaStar, vMix, MA, etc)..." className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none resize-none"></textarea>
            </div>

            {/* REGRAS OPERACIONAIS E CHECKBOX DE ACEITE */}
            <div>
              <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">📋 Regras e Normas de Trabalho</h2>
              <div className="bg-[#E0F2FE]/50 border border-[#BAE6FD] p-5 rounded-xl mb-4">
                <ul className="list-disc pl-5 space-y-3 text-sm text-[#0C1D4D] font-medium">
                  <li>O Freelancer deverá chegar com <strong>15 minutos de antecedência</strong> no local combinado.</li>
                  <li>Atrasos superiores a 1 hora poderão gerar desconto proporcional na diária ou substituição do profissional.</li>
                  <li>Caso precise sair antes do horário previsto, o profissional deverá solicitar autorização prévia.</li>
                  <li>A Rentech <strong>não paga dobra de diária</strong>. Horas excedentes serão tratadas como adicional de horas conforme política interna.</li>
                  <li>Os pagamentos ocorrerão em até <strong>5 dias úteis</strong> após o encerramento do evento.</li>
                  <li><strong>Não é permitido</strong> orientar, corrigir, prometer entregas, negociar ou emitir opiniões técnicas, comerciais ou operacionais diretamente com o cliente. Toda a comunicação deve ser direcionada ao líder ou responsável da Rentech no local.</li>
                  <li>Ao finalizar o seu horário, é obrigatório solicitar ao responsável no evento se vai continuar a trabalhar ou se será liberado.</li>
                  <li>É <strong>proibido o uso de uniforme de outra empresa</strong>. Caso a Rentech não disponibilize uniforme, o profissional deve apresentar-se com uma t-shirt preta lisa.</li>
                  <li><strong>Uso Obrigatório:</strong> Bota de segurança e Capacete (EPIs).</li>
                  <li>Zelar pelos equipamentos da empresa (danos por uso inadequado ou negligência serão descontados).</li>
                </ul>
              </div>
              <label className="flex items-start gap-3 cursor-pointer p-4 border border-[#E2E8F0] rounded-xl hover:bg-[#F8FAFC] transition-colors">
                <input type="checkbox" required className="mt-1 w-5 h-5 accent-[#336699] cursor-pointer shrink-0" />
                <span className="text-sm font-bold text-[#0C1D4D] leading-tight">
                  Declaro que li, compreendi e concordo integralmente com todas as regras operacionais e de prestação de serviços estabelecidas pela Rentech.
                </span>
              </label>
            </div>

            {/* CAIXA DE ERRO SE HOUVER DUPLICIDADE */}
            {erroMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-center font-bold text-sm shadow-sm mt-4">
                {erroMsg}
              </div>
            )}

            <button type="submit" disabled={loading || !lgpdAceita || !formData.empresa_id} className="w-full bg-[#336699] hover:bg-[#284B8C] text-white p-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-md disabled:opacity-50 mt-6">
              {loading ? 'A Enviar Cadastro...' : 'Enviar Cadastro Rentech'}
            </button>

          </form>
        </div>
      </div>
    </div>
  );
}