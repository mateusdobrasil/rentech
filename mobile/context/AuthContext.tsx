import type { Session } from '@supabase/supabase-js';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { normalizarPermissao } from '../lib/permissoes';
import { emailSinteticoPortal } from '../lib/cpf';
import { registrarPushToken, removerPushToken } from '../lib/pushNotifications';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;
const CHAVE_BIOMETRIA_ATIVADA = 'biometria_ativada';
const CHAVE_NOTIFICACOES_ATIVADAS = 'notificacoes_ativadas';

// O sistema tem duas bases de conta separadas de propósito (ver app/actions.ts:313
// no repo web/): 'STAFF' = perfis_usuarios (equipe com acesso ao /admin, e-mail+senha),
// 'PORTAL' = portal_funcionarios_auth (colaborador comum, CPF+senha — mesma conta
// do Portal do Funcionário). Ver README do brief, seção "Login — duas identidades".
export type TipoConta = 'STAFF' | 'PORTAL';

export interface PerfilUsuario {
  tipo: TipoConta;
  nome: string;
  email: string;
  permissaoBruta: string | null;
  // Resultado de normalizarPermissao() para STAFF; sentinela literal 'PORTAL'
  // para contas do Portal — nunca bate em nenhuma regra de REGRAS_ACESSO
  // (que lista cargos de perfis_usuarios), então cai sempre no conjunto
  // Início+Perfil sem checagem especial.
  permissaoNormalizada: string;
  cargoExibicao: string | null;
  funcionarioNome: string | null;
  matriculaEsocial: string | null;
  // Só PORTAL: folha_funcionarios.pode_dirigir — mesma flag que já libera o
  // Checklist de Veículo no Portal web, agora também libera a aba Frota no
  // app pra colaborador comum marcado como motorista.
  podeDirigir: boolean;
}

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  perfil: PerfilUsuario | null;
  /** true quando há sessão restaurada do storage mas ainda não desbloqueada por biometria. */
  locked: boolean;
  biometriaSuportada: boolean;
  biometriaAtivada: boolean;
  notificacoesAtivadas: boolean;
  signInEquipe: (email: string, senha: string) => Promise<{ error: string | null }>;
  signInColaborador: (cpf: string, senha: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  ativarBiometria: () => Promise<{ ok: boolean; erro?: string }>;
  desativarBiometria: () => Promise<void>;
  desbloquearComBiometria: () => Promise<{ ok: boolean; erro?: string }>;
  ativarNotificacoes: () => Promise<{ ok: boolean; erro?: string }>;
  desativarNotificacoes: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Busca o registro em perfis_usuarios correspondente à sessão — mesma tabela
// e mesmas colunas (permissao/nivel) que o web usa em useAcessoRota.ts.
async function buscarPerfilStaff(userId: string, emailFallback: string): Promise<PerfilUsuario | null> {
  const { data, error } = await supabase
    .from('perfis_usuarios')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) return null;

  const permissaoBruta = data.permissao || data.nivel || '';
  return {
    tipo: 'STAFF',
    nome: data.nome || '',
    email: data.email || emailFallback,
    permissaoBruta,
    permissaoNormalizada: normalizarPermissao(permissaoBruta),
    cargoExibicao: permissaoBruta || null,
    funcionarioNome: null,
    matriculaEsocial: null,
    podeDirigir: false,
  };
}

// Contas de Portal não têm policy de leitura direta em portal_funcionarios_auth/
// folha_funcionarios pela chave anon — passa pela rota nova app/api/portal/perfil
// (web), validada por access token com service role, mesmo padrão de
// resolverFuncionarioPortal() usado pelo Portal web.
async function buscarPerfilPortal(accessToken: string): Promise<PerfilUsuario | null> {
  if (!SITE_URL) return null;
  try {
    const res = await fetch(`${SITE_URL}/api/portal/perfil`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();
    if (!res.ok || !json.ok) return null;

    return {
      tipo: 'PORTAL',
      nome: json.info.funcionarioNome || '',
      email: '',
      permissaoBruta: null,
      permissaoNormalizada: 'PORTAL',
      cargoExibicao: json.info.cargo || null,
      funcionarioNome: json.info.funcionarioNome || null,
      matriculaEsocial: json.info.matriculaEsocial || null,
      podeDirigir: !!json.info.podeDirigir,
    };
  } catch {
    return null;
  }
}

async function resolverPerfil(sessaoAtual: Session): Promise<PerfilUsuario | null> {
  const staff = await buscarPerfilStaff(sessaoAtual.user.id, sessaoAtual.user.email ?? '');
  if (staff) return staff;
  return buscarPerfilPortal(sessaoAtual.access_token);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [locked, setLocked] = useState(false);
  const [biometriaSuportada, setBiometriaSuportada] = useState(false);
  const [biometriaAtivada, setBiometriaAtivada] = useState(false);
  const [notificacoesAtivadas, setNotificacoesAtivadas] = useState(false);

  // Só a primeira carga (sessão restaurada do AsyncStorage no cold start) pode
  // travar atrás de biometria — um signIn explícito dentro desta mesma sessão
  // do app já prova identidade por senha, não precisa re-travar na hora.
  const primeiraCarga = useRef(true);
  // "Uma vez por sessão do app" — análogo ao sessionStorage do web (que reseta
  // por aba); aqui reseta ao reabrir o app.
  const logRegistrado = useRef(false);
  // Idem, mas pra re-registrar o token de push silenciosamente (o token
  // pode mudar entre instalações) quando o usuário já tinha ativado antes.
  const pushRegistrado = useRef(false);

  useEffect(() => {
    let ativo = true;

    (async () => {
      const suportada = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      if (ativo) setBiometriaSuportada(suportada);
      const ativada = await AsyncStorage.getItem(CHAVE_BIOMETRIA_ATIVADA);
      if (ativo) setBiometriaAtivada(ativada === 'true');
      const notificacoesAtivadasSalvo = await AsyncStorage.getItem(CHAVE_NOTIFICACOES_ATIVADAS);
      if (ativo) setNotificacoesAtivadas(notificacoesAtivadasSalvo === 'true');
    })();

    async function carregar(sessaoAtual: Session | null) {
      if (!ativo) return;
      setSession(sessaoAtual);

      if (!sessaoAtual) {
        setPerfil(null);
        setLocked(false);
        setLoading(false);
        primeiraCarga.current = false;
        return;
      }

      const perfilCarregado = await resolverPerfil(sessaoAtual);
      if (!ativo) return;
      setPerfil(perfilCarregado);

      if (primeiraCarga.current) {
        const ativada = await AsyncStorage.getItem(CHAVE_BIOMETRIA_ATIVADA);
        if (ativo) setLocked(ativada === 'true');
      } else {
        setLocked(false);
      }
      primeiraCarga.current = false;
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data: { session } }) => carregar(session));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, sessaoAtual) => {
      carregar(sessaoAtual);
    });

    return () => {
      ativo = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // Log de auditoria + ultimo_acesso: só para contas de equipe (STAFF), como o
  // web faz em app/admin/layout.tsx. Contas de Portal não têm essa tabela de
  // log hoje.
  useEffect(() => {
    if (!session || !perfil || perfil.tipo !== 'STAFF' || logRegistrado.current) return;
    logRegistrado.current = true;

    (async () => {
      const dataHoraAtual = new Date().toISOString();
      await supabase.from('perfis_usuarios').update({ ultimo_acesso: dataHoraAtual }).eq('id', session.user.id);
      await supabase.from('logs_auditoria').insert([{
        usuario_nome: perfil.nome || session.user.email || 'Usuário Desconhecido',
        acao: 'ACESSO AO SISTEMA',
        setor: 'APP MOBILE',
        equipamento_id: null,
        equipamento_nome: null,
      }]);
    })();
  }, [session, perfil]);

  // Se o usuário já tinha ativado notificações numa sessão anterior,
  // re-registra o token sozinho ao abrir o app (best-effort, nunca bloqueia
  // nem avisa erro — se falhar, o toggle no Perfil simplesmente aparece
  // desligado da próxima vez que ele checar).
  useEffect(() => {
    if (!session || !perfil || !notificacoesAtivadas || pushRegistrado.current) return;
    pushRegistrado.current = true;
    registrarPushToken(session.access_token, perfil.tipo).catch(() => {});
  }, [session, perfil, notificacoesAtivadas]);

  async function signInEquipe(email: string, senha: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    return { error: error?.message ?? null };
  }

  async function signInColaborador(cpf: string, senha: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: emailSinteticoPortal(cpf), password: senha });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function ativarBiometria() {
    const resultado = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirme sua identidade' });
    if (!resultado.success) return { ok: false, erro: 'Não foi possível confirmar sua identidade.' };
    await AsyncStorage.setItem(CHAVE_BIOMETRIA_ATIVADA, 'true');
    setBiometriaAtivada(true);
    return { ok: true };
  }

  async function desativarBiometria() {
    await AsyncStorage.setItem(CHAVE_BIOMETRIA_ATIVADA, 'false');
    setBiometriaAtivada(false);
  }

  async function desbloquearComBiometria() {
    const resultado = await LocalAuthentication.authenticateAsync({ promptMessage: 'Desbloquear Rentech' });
    if (!resultado.success) return { ok: false, erro: 'Não foi possível confirmar sua identidade.' };
    setLocked(false);
    return { ok: true };
  }

  async function ativarNotificacoes() {
    if (!session || !perfil) return { ok: false, erro: 'Sessão indisponível.' };
    const resultado = await registrarPushToken(session.access_token, perfil.tipo);
    if (!resultado.ok) return resultado;
    await AsyncStorage.setItem(CHAVE_NOTIFICACOES_ATIVADAS, 'true');
    setNotificacoesAtivadas(true);
    return { ok: true };
  }

  async function desativarNotificacoes() {
    if (session) await removerPushToken(session.access_token);
    await AsyncStorage.setItem(CHAVE_NOTIFICACOES_ATIVADAS, 'false');
    setNotificacoesAtivadas(false);
  }

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        perfil,
        locked,
        biometriaSuportada,
        biometriaAtivada,
        notificacoesAtivadas,
        signInEquipe,
        signInColaborador,
        signOut,
        ativarBiometria,
        desativarBiometria,
        desbloquearComBiometria,
        ativarNotificacoes,
        desativarNotificacoes,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
