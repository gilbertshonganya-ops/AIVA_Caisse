/* EvoBuskin - configuration publique de l'authentification Supabase.
 * IMPORTANT : ne mettez JAMAIS ici une clé service_role/secret.
 * La clé anon/publishable Supabase est conçue pour être distribuée au client,
 * mais toute sécurité réelle doit être imposée par Auth + RLS + fonctions serveur.
 */
window.AUTH_CONFIG = Object.freeze({
  supabaseUrl: 'https://qydyyqyxlrqcfozderxs.supabase.co',
  supabaseAnonKey: 'sb_publishable_xBMgDxT5IEGHwI3eouW3ag_jFM5qeTd',
  // false = pas d'écran Google Authenticator pour le patron (doit correspondre à v9_mfa_verified côté SQL).
  // Coordonnées affichées dans les conditions d'utilisation et la politique de confidentialité (laisser vide pour ne rien afficher)
  supportEmail: 'evobuskin@gmail.com',
  supportWhatsapp: '+243895006995',
  requireMfa: false
});