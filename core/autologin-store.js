// Tokens de auto-login de un solo uso generados tras el onboarding.
// TTL: 10 minutos. Limpeza automática cada minuto.
export const autologinStore = new Map();

setInterval(() => {
  const cutoff = Date.now() - 600000;
  for (const [k, v] of autologinStore) {
    if (v.created < cutoff) autologinStore.delete(k);
  }
}, 60000);
