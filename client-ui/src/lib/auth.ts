// Auth OIDC contra o mesmo Keycloak que o dashboard usa (realm do cliente).
// Em produção o front vive na mesma origin do gateway, então o cookie de
// sessão OIDC já basta para /api; este módulo cobre o fluxo de login explícito
// (Authorization Code + PKCE) para quando o front for servido standalone.
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

const env = import.meta.env;

export const oidc = new UserManager({
  authority: env.VITE_OIDC_ISSUER ?? "",
  client_id: env.VITE_OIDC_CLIENT_ID ?? "hermes-client-ui",
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: "code",
  scope: "openid profile email",
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true,
});

// Quando não há issuer configurado (dev/loopback), tratamos como "sem gate":
// o proxy do Vite injeta o session-token e a API responde sem cookie.
export const authDisabled = !env.VITE_OIDC_ISSUER;

export async function getUser(): Promise<User | null> {
  if (authDisabled) return null;
  return oidc.getUser();
}

export async function login(): Promise<void> {
  if (authDisabled) return;
  await oidc.signinRedirect();
}

export async function handleCallback(): Promise<void> {
  if (authDisabled) return;
  await oidc.signinRedirectCallback();
}

export async function logout(): Promise<void> {
  if (authDisabled) return;
  await oidc.signoutRedirect();
}
