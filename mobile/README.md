# Rentech Mobile

Expo Router + Supabase, workspace do monorepo raiz (`npm workspaces`).

## Setup

```bash
# na raiz do repo
npm install

# corrige as versões dos pacotes expo-* pra bater com o SDK usado
# (package.json foi escrito com "*" nos periféricos de propósito)
npx expo install --fix -w mobile
```

`mobile/.env` já vem preenchido com a mesma `EXPO_PUBLIC_SUPABASE_URL` /
`EXPO_PUBLIC_SUPABASE_ANON_KEY` do `../.env.local` (valores públicos, os
mesmos expostos no bundle do web via `NEXT_PUBLIC_*`).

## Rodar

```bash
npm run start -w mobile
```

## Estrutura

- `lib/supabase.ts` — cliente Supabase com AsyncStorage (persiste sessão no device).
- `lib/permissoes.ts` — espelho de `../app/lib/permissoes.ts` (web). Mantenha em sincronia.
- `context/AuthContext.tsx` — sessão + perfil (`perfis_usuarios`), mesma tabela que o web usa.
- `app/(tabs)/_layout.tsx` — abas dinâmicas por perfil (`REGRAS_ACESSO`).
- `app/(tabs)/*.tsx` — Início e Simuladores são públicos; RH/Frota/Comercial exigem login e cargo.

## O que falta (fora do escopo deste scaffold)

- Telas reais de RH (holerite, ponto, documentos), Frota (checklist com foto + GPS) e Comercial.
- `packages/types` com os tipos gerados do Supabase (`npm run gen -w @rentech/types`).
- `packages/calc` com a lógica de simuladores/folha compartilhada com o web.
- WebView autenticada apontando pro admin Next.js para os módulos pesados.
