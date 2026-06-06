"use client";

import { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import logoColorido from '../../../../app/imgs/logo.png';
// Importação da Action de Criação que fizemos no backend
import { criarOP, NovaOPData } from '../actions'; 

interface ItemOP {
  id: number;
  descricao: string;
  qtd: number;
  valorUnitario: number;
}

export default function NovaOrdemPagamento() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; success: boolean; msg: string; title: string }>({ open: false, success: false, msg: '', title: '' });

  // Estado dos Dados Pessoais / Projeto
  const [responsavelNome, setResponsavelNome] = useState(''); // O ideal é puxar isso do Auth futuramente
  const [natureza, setNatureza] = useState('SUBLOCAÇÃO');
  const [osNum, setOsNum] = useState('');
  const [osCliente, setOsCliente] = useState('');
  const [osEvento, setOsEvento] = useState('');
  const [osPeriodo, setOsPeriodo] = useState('');

  // Estado do Favorecido (Recebedor)
  const [empresaRecebedora, setEmpresaRecebedora] = useState('');
  const [cnpjCpf, setCnpjCpf] = useState('');
  const [endereco, setEndereco] = useState('');
  
  // Estado Financeiro
  const [tipoPagamento, setTipoPagamento] = useState('PIX');
  const [chavePix, setChavePix] = useState('CELULAR');
  const [dadosPagamento, setDadosPagamento] = useState('');
  const [dataVencimento, setDataVencimento] = useState('');
  const [obs, setObs] = useState('');
  const [fileUrl, setFileUrl] = useState(''); // Placeholder para futuro upload de S3/Supabase Storage

  // Gestão Dinâmica de Itens usando React State
  const [itens, setItens] = useState<ItemOP[]>(
    Array.from({ length: 3 }, (_, i) => ({ id: i, descricao: '', qtd: 0, valorUnitario: 0 }))
  );

  const formatarMoeda = (valor: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
  };

  const aplicarMascaraCpfCnpj = (valor: string) => {
    let v = valor.replace(/\D/g, "");
    if (v.length <= 11) {
      v = v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    } else {
      v = v.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
    }
    setCnpjCpf(v);
  };

  const adicionarLinhaItem = () => {
    setItens([...itens, { id: Date.now(), descricao: '', qtd: 0, valorUnitario: 0 }]);
  };

  const removerLinhaItem = (id: number) => {
    if (itens.length > 1) {
      setItens(itens.filter(item => item.id !== id));
    }
  };

  const atualizarItem = (id: number, campo: keyof ItemOP, valor: any) => {
    setItens(itens.map(item => item.id === id ? { ...item, [campo]: valor } : item));
  };

  // Cálculo Automático e Reativo do Total da OP
  const totalGeral = useMemo(() => {
    return itens.reduce((acc, item) => acc + (item.qtd * item.valorUnitario), 0);
  }, [itens]);

  const handleSubmeterFormulario = async () => {
    setLoading(true);
    
    // Filtra itens em branco antes de salvar
    const itensValidos = itens
      .filter(i => i.descricao.trim() !== '' && i.qtd > 0)
      .map(i => ({ descricao: i.descricao.toUpperCase(), qtd: i.qtd, valor_unitario: i.valorUnitario, total: i.qtd * i.valorUnitario }));

    if (itensValidos.length === 0) {
      setModal({ open: true, success: false, title: 'Atenção', msg: 'Adicione pelo menos um item válido com quantidade e valor.' });
      setLoading(false);
      return;
    }

    const payload: NovaOPData = {
      responsavel_nome: responsavelNome.toUpperCase() || 'USUÁRIO DO SISTEMA',
      natureza_pagamento: natureza,
      os_numero: osNum.toUpperCase(),
      os_cliente: osCliente.toUpperCase(),
      os_evento: osEvento.toUpperCase(),
      os_periodo: osPeriodo.toUpperCase(),
      empresa_recebedora: empresaRecebedora.toUpperCase(),
      cnpj_cpf_recebedora: cnpjCpf,
      endereco_recebedora: endereco.toUpperCase(),
      telefone_recebedora: '', // Omitido no front antigo, mas presente no banco
      tipo_pagamento: tipoPagamento,
      chave_pix: tipoPagamento === 'PIX' ? chavePix : '',
      dados_pagamento: dadosPagamento.toUpperCase(),
      data_vencimento: dataVencimento,
      observacao: obs.toUpperCase(),
      itens: itensValidos,
      total_geral: totalGeral,
      file_url: fileUrl // Será preenchido via Storage depois
    };

    const resposta = await criarOP(payload);

    if (resposta.success) {
      setModal({ open: true, success: true, title: 'Sucesso!', msg: 'A Ordem de Pagamento foi registrada e enviada ao Financeiro.' });
    } else {
      setModal({ open: true, success: false, title: 'Erro de Conexão', msg: resposta.message || 'Falha ao salvar no banco de dados.' });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-4 lg:p-10 font-sans text-[#0A2A4A] print:bg-white print:p-0">
      
      {/* Modal de Feedback */}
      {modal.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm print:hidden">
          <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full mx-4 transform transition-all">
            <div className={`text-6xl mb-4 ${modal.success ? 'text-green-500' : 'text-red-500'}`}>
              {modal.success ? '✅' : '❌'}
            </div>
            <h3 className="text-2xl font-black text-[#0A2A4A] mb-2">{modal.title}</h3>
            <p className="text-[#64748B] mb-8 font-medium">{modal.msg}</p>
            <button 
              onClick={() => {
                setModal({ ...modal, open: false });
                if (modal.success) router.push('/admin/op'); // Volta para o Dashboard
              }}
              className="w-full py-3 bg-[#0C1D4D] text-white font-bold rounded-lg hover:bg-[#284B8C] transition-colors"
            >
              OK, VOLTAR
            </button>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg border border-[#E2E8F0] overflow-hidden print:border-none print:shadow-none">
        
        {/* Cabeçalho */}
        <div className="bg-[#0C1D4D] p-6 lg:p-8 flex flex-col sm:flex-row justify-between items-center gap-4 print:bg-transparent print:border-b-2 print:border-black">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} className="print:grayscale" />
          <div className="text-center sm:text-right">
            <h2 className="text-2xl font-black text-white uppercase tracking-wider print:text-black">Ordem de Pagamento</h2>
            <p className="text-[#999999] text-sm font-bold print:text-gray-500">Solicitação Financeira Administrativa</p>
          </div>
        </div>

        <div className="p-6 lg:p-8 space-y-8">
          
          {/* Sessão 1: Responsável e Natureza */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-bold text-[#64748B] uppercase tracking-wider mb-2">Responsável</label>
              <input type="text" placeholder="Seu Nome Completo" className="w-full p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-sm text-[#0A2A4A] focus:border-[#00A8E8] outline-none font-semibold uppercase" value={responsavelNome} onChange={(e) => setResponsavelNome(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#64748B] uppercase tracking-wider mb-2">Natureza do Pagamento</label>
              <select className="w-full p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-sm text-[#0A2A4A] focus:border-[#00A8E8] outline-none font-semibold" value={natureza} onChange={(e) => setNatureza(e.target.value)}>
                <option value="SUBLOCAÇÃO">SUBLOCAÇÃO</option>
                <option value="FREELANCE">FREELANCE</option>
                <option value="REEMBOLSO">REEMBOLSO</option>
                <option value="HOSPEDAGEM">HOSPEDAGEM</option>
                <option value="BV">BV (BONIFICAÇÃO/COMISSÃO)</option>
              </select>
            </div>
          </section>

          {/* Sessão 2: Dados da OS */}
          <section className="bg-[#F8FAFC] p-5 rounded-xl border border-[#E2E8F0]">
            <h3 className="text-sm font-black text-[#0A2A4A] uppercase tracking-widest mb-4 border-b border-[#E2E8F0] pb-2">Dados do Projeto / Evento</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input type="text" placeholder="Nº DA OS" className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase" value={osNum} onChange={(e) => setOsNum(e.target.value)} />
              <input type="text" placeholder="CLIENTE" className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase" value={osCliente} onChange={(e) => setOsCliente(e.target.value)} />
              <input type="text" placeholder="EVENTO" className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase" value={osEvento} onChange={(e) => setOsEvento(e.target.value)} />
              <input type="text" placeholder="PERÍODO (Ex: 10/05 a 12/05)" className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase" value={osPeriodo} onChange={(e) => setOsPeriodo(e.target.value)} />
            </div>
          </section>

          {/* Sessão 3: Favorecido */}
          <section className="space-y-4">
            <h3 className="text-sm font-black text-[#0A2A4A] uppercase tracking-widest mb-2 border-b border-[#E2E8F0] pb-2">Dados do Favorecido (Recebedor)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input type="text" placeholder="NOME DA EMPRESA OU PROFISSIONAL" className="w-full p-3 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase font-bold" value={empresaRecebedora} onChange={(e) => setEmpresaRecebedora(e.target.value)} />
              <input type="text" placeholder="CNPJ OU CPF" className="w-full p-3 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] font-bold" value={cnpjCpf} onChange={(e) => aplicarMascaraCpfCnpj(e.target.value)} />
            </div>
            <input type="text" placeholder="ENDEREÇO COMPLETO" className="w-full p-3 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
          </section>

          {/* Sessão 4: Financeiro */}
          <section className="bg-[#E0F2FE]/40 p-5 rounded-xl border border-[#BAE6FD]">
            <h3 className="text-sm font-black text-[#0284C7] uppercase tracking-widest mb-4 border-b border-[#BAE6FD] pb-2">Dados Bancários para Pagamento</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-[10px] font-bold text-[#0369A1] uppercase tracking-wider mb-1">Forma</label>
                <select className="w-full p-2.5 bg-white border border-[#BAE6FD] rounded-lg text-sm text-[#0A2A4A] font-bold outline-none focus:ring-2 focus:ring-[#00A8E8]" value={tipoPagamento} onChange={(e) => setTipoPagamento(e.target.value)}>
                  <option value="PIX">PIX</option>
                  <option value="BOLETO">BOLETO BANCÁRIO</option>
                  <option value="TRANSFERÊNCIA">TRANSFERÊNCIA (TED/DOC)</option>
                  <option value="DINHEIRO">DINHEIRO (ESPÉCIE)</option>
                </select>
              </div>

              {tipoPagamento === 'PIX' && (
                <div>
                  <label className="block text-[10px] font-bold text-[#0369A1] uppercase tracking-wider mb-1">Tipo de Chave</label>
                  <select className="w-full p-2.5 bg-white border border-[#BAE6FD] rounded-lg text-sm text-[#0A2A4A] font-bold outline-none focus:ring-2 focus:ring-[#00A8E8]" value={chavePix} onChange={(e) => setChavePix(e.target.value)}>
                    <option value="CELULAR">CELULAR</option>
                    <option value="EMAIL">E-MAIL</option>
                    <option value="CPF/CNPJ">CPF / CNPJ</option>
                    <option value="ALEATÓRIO">CHAVE ALEATÓRIA</option>
                  </select>
                </div>
              )}

              <div className={tipoPagamento !== 'PIX' ? 'md:col-span-2' : ''}>
                <label className="block text-[10px] font-bold text-[#EF4444] uppercase tracking-wider mb-1">Data de Vencimento Obrigatória</label>
                <input type="date" className="w-full p-2.5 bg-white border border-[#FCA5A5] rounded-lg text-sm text-[#0A2A4A] font-bold outline-none focus:ring-2 focus:ring-red-400" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} required />
              </div>
            </div>

            <input type="text" placeholder="DIGITE A CHAVE PIX, CÓDIGO DE BARRAS OU AGÊNCIA/CONTA" className="w-full p-3 bg-white border border-[#BAE6FD] rounded-lg text-sm text-[#0A2A4A] uppercase font-bold" value={dadosPagamento} onChange={(e) => setDadosPagamento(e.target.value)} />
          </section>

          {/* Sessão 5: Itens da OP */}
          <section className="space-y-4">
            <h3 className="text-sm font-black text-[#0A2A4A] uppercase tracking-widest mb-2 border-b border-[#E2E8F0] pb-2">Detalhamento dos Itens a Pagar</h3>
            
            <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="bg-[#0C1D4D] text-white text-[11px] uppercase tracking-wider font-bold">
                    <th className="p-3 w-1/2">Descrição do Serviço / Item</th>
                    <th className="p-3 w-24 text-center">Qtd</th>
                    <th className="p-3 w-32">Valor Unit. (R$)</th>
                    <th className="p-3 w-32 text-right">Total (R$)</th>
                    <th className="p-3 w-12 text-center print:hidden">🗑️</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {itens.map((item) => (
                    <tr key={item.id} className="bg-white hover:bg-[#F8FAFC]">
                      <td className="p-2">
                        <input type="text" placeholder="Detalhes do serviço..." className="w-full p-2 border border-transparent hover:border-[#CBD5E1] focus:border-[#00A8E8] rounded bg-transparent uppercase text-sm outline-none" value={item.descricao} onChange={(e) => atualizarItem(item.id, 'descricao', e.target.value)} />
                      </td>
                      <td className="p-2">
                        <input type="number" min="0" className="w-full p-2 border border-[#CBD5E1] rounded text-center text-sm font-semibold outline-none focus:border-[#00A8E8]" value={item.qtd || ''} onChange={(e) => atualizarItem(item.id, 'qtd', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="p-2">
                        <input type="number" min="0" step="0.01" className="w-full p-2 border border-[#CBD5E1] rounded text-sm font-semibold outline-none focus:border-[#00A8E8]" value={item.valorUnitario || ''} onChange={(e) => atualizarItem(item.id, 'valorUnitario', parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="p-2 text-right font-bold text-[#0C1D4D]">
                        {formatarMoeda(item.qtd * item.valorUnitario)}
                      </td>
                      <td className="p-2 text-center print:hidden">
                        <button onClick={() => removerLinhaItem(item.id)} className="text-red-400 hover:text-red-600 hover:scale-110 transition-transform disabled:opacity-30" disabled={itens.length === 1}>✖</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={adicionarLinhaItem} className="w-full py-3 bg-[#F0F4F8] border border-dashed border-[#94A3B8] text-[#64748B] font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#E2E8F0] hover:text-[#0A2A4A] transition-colors print:hidden">
              ➕ Adicionar Nova Linha de Item
            </button>

            {/* Totalizador */}
            <div className="bg-[#0C1D4D] text-white p-6 rounded-xl flex justify-between items-center shadow-lg mt-6">
              <span className="text-sm font-black uppercase tracking-widest text-[#94A3B8]">Valor Total a Pagar</span>
              <span className="text-3xl font-black tracking-tighter text-[#00A8E8]">{formatarMoeda(totalGeral)}</span>
            </div>
          </section>

          {/* Sessão 6: Anexos e Finalização */}
          <section className="bg-[#F8FAFC] p-5 rounded-xl border border-[#E2E8F0] print:hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-bold text-[#0A2A4A] uppercase tracking-wider mb-2">📎 Anexar Comprovante / NF / Recibo</label>
                <input type="file" className="w-full text-sm text-[#64748B] file:mr-4 file:py-2.5 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[#E0F2FE] file:text-[#0369A1] hover:file:bg-[#BAE6FD] cursor-pointer" accept=".pdf, image/*" />
                <p className="text-[10px] text-[#94A3B8] mt-1">Formatos aceitos: PDF, JPG, PNG (Max 5MB)</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#64748B] uppercase tracking-wider mb-2">Observações Adicionais</label>
                <input type="text" placeholder="Qualquer informação extra para o financeiro..." className="w-full p-3 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] uppercase" value={obs} onChange={(e) => setObs(e.target.value)} />
              </div>
            </div>
          </section>

          {/* Botão de Envio */}
          <div className="pt-4 border-t border-[#E2E8F0] print:hidden">
            <button 
              onClick={handleSubmeterFormulario}
              disabled={loading}
              className="w-full py-4 bg-green-600 text-white font-black text-lg rounded-xl hover:bg-green-500 hover:shadow-[0_0_20px_rgba(22,163,74,0.3)] transition-all uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'PROCESSANDO ORDEM DE PAGAMENTO...' : 'SALVAR E ENVIAR AO FINANCEIRO ➔'}
            </button>
            <p className="text-center text-[10px] text-[#94A3B8] mt-3 font-semibold uppercase tracking-widest">
              AO ENVIAR, ESTA OP ENTRARÁ NO FLUXO DE APROVAÇÃO GERENCIAL
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}