/* EvoBuskin - connexion SANS Internet.
   Après une première connexion réussie avec Internet, l'appareil garde :
   - une EMPREINTE du mot de passe (PBKDF2-SHA256, sel aléatoire) : le mot de passe lui-même n'est jamais conservé ;
   - une copie du profil (rôle, boutique) pour rouvrir l'espace de travail sans serveur.
   Hors connexion, le mot de passe saisi est comparé à cette empreinte. Les ventes faites hors ligne
   restent dans la file d'envoi et partent vers le serveur dès le retour d'Internet. */
const AuthHorsLigne = (() => {
  const CLE_COMPTES = 'evobuskin_comptes_locaux_v1';
  const CLE_PROFILS = 'evobuskin_profils_locaux_v1';
  const CLE_ESSAIS = 'evobuskin_essais_hors_ligne_v1';
  const ITERATIONS = 120000;
  const MAX_ESSAIS = 5, PAUSE_MS = 60 * 1000;

  const lire = (cle) => { try { return JSON.parse(localStorage.getItem(cle) || '{}') || {}; } catch (_) { return {}; } };
  const ecrire = (cle, v) => { try { localStorage.setItem(cle, JSON.stringify(v)); } catch (_) {} };
  const normEmail = (e) => String(e || '').trim().toLowerCase();
  const versHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  const aleatoire = () => versHex(crypto.getRandomValues(new Uint8Array(16)));

  async function empreinte(motDePasse, selHex, email) {
    const texte = normEmail(email) + '\u0000' + motDePasse;
    if (window.crypto && crypto.subtle && window.isSecureContext) {
      const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(texte), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(selHex), iterations: ITERATIONS }, cle, 256);
      return 'p' + versHex(bits);
    }
    // Contexte non sécurisé (rare) : version de repli en JavaScript pur
    let h = selHex + texte;
    for (let i = 0; i < 4000; i++) h = Sha256.hex(h + selHex);
    return 's' + h;
  }

  // Appelé après chaque connexion réussie AVEC Internet
  async function memoriser(email, motDePasse, user) {
    if (!email || !motDePasse || !user?.id) return;
    try {
      const sel = aleatoire();
      const comptes = lire(CLE_COMPTES);
      comptes[normEmail(email)] = { sel, hash: await empreinte(motDePasse, sel, email), userId: user.id, nom: user.user_metadata?.full_name || '', date: Date.now() };
      ecrire(CLE_COMPTES, comptes);
    } catch (e) { console.warn('Connexion hors ligne non préparée :', e); }
  }

  function memoriserProfil(userId, profil) {
    if (!userId || !profil) return;
    const profils = lire(CLE_PROFILS);
    profils[userId] = Object.assign({}, profil, { vuLe: Date.now() });
    ecrire(CLE_PROFILS, profils);
  }
  function profil(userId) { return lire(CLE_PROFILS)[userId] || null; }
  function existe(email) { return Boolean(lire(CLE_COMPTES)[normEmail(email)]); }

  // Limite d'essais (cinq erreurs, puis 60 secondes d'attente) — conservée même si on recharge la page
  function attente(c = '') {
    const e = lire(CLE_ESSAIS + c);
    return Math.max(0, Math.ceil(((e.jusqua || 0) - Date.now()) / 1000));
  }
  function compterEchec(c = '') {
    const e = lire(CLE_ESSAIS + c);
    e.n = (e.n || 0) + 1;
    if (e.n >= MAX_ESSAIS) { e.n = 0; e.jusqua = Date.now() + PAUSE_MS; }
    ecrire(CLE_ESSAIS + c, e);
  }
  function forcerPause(c = '') { ecrire(CLE_ESSAIS + c, { n: 0, jusqua: Date.now() + PAUSE_MS }); }
  function effacerEssais(c = '') { ecrire(CLE_ESSAIS + c, {}); }

  // Retourne { user, profil } si l'email et le mot de passe correspondent, sinon null
  async function verifier(email, motDePasse) {
    const compte = lire(CLE_COMPTES)[normEmail(email)];
    if (!compte) return { inconnu: true };
    const p = profil(compte.userId);
    if (!p) return { inconnu: true };
    const hash = await empreinte(motDePasse, compte.sel, email);
    if (hash !== compte.hash) { compterEchec(); noterEchecEnAttente(email); return null; }
    effacerEssais();
    return { user: { id: compte.userId, email: normEmail(email), user_metadata: { full_name: compte.nom } }, profil: p };
  }

  // Mot de passe modifié avec Internet : on met à jour l'empreinte locale
  async function mettreAJourMotDePasse(email, motDePasse, user) { return memoriser(email, motDePasse, user); }

  function oublier(email) {
    const c = lire(CLE_COMPTES); delete c[normEmail(email)]; ecrire(CLE_COMPTES, c);
  }

  // Échecs de connexion constatés SANS Internet : envoyés au journal du patron au retour d'Internet
  const CLE_ECHECS = 'evobuskin_echecs_en_attente_v1';
  function noterEchecEnAttente(email) {
    const l = (() => { try { return JSON.parse(localStorage.getItem(CLE_ECHECS) || '[]'); } catch (_) { return []; } })();
    l.push(normEmail(email)); try { localStorage.setItem(CLE_ECHECS, JSON.stringify(l.slice(-20))); } catch (_) {}
  }
  async function envoyerEchecsEnAttente() {
    if (!navigator.onLine) return;
    let l = []; try { l = JSON.parse(localStorage.getItem(CLE_ECHECS) || '[]'); } catch (_) {}
    if (!l.length) return;
    localStorage.removeItem(CLE_ECHECS);
    for (const email of l) { try { await Auth.rpcPublic('v19_log_auth_failure', { p_email: email, p_kind: 'connexion_echec' }); } catch (_) {} }
  }

  return { noterEchecEnAttente, envoyerEchecsEnAttente, memoriser, memoriserProfil, profil, existe, verifier, attente, compterEchec, forcerPause, effacerEssais, mettreAJourMotDePasse, oublier };
})();
window.AuthHorsLigne = AuthHorsLigne;
