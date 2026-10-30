/* EvoBuskin - DIAGNOSTIC : garde les derniers incidents techniques (sans mot de passe, sans jeton, sans email)
   pour que le support puisse trouver la vraie cause d'un problème. L'utilisateur voit un message en français
   avec un court « code », et peut copier le rapport (écran de connexion ou Réglages). */
const Diag = (() => {
  const CLE = 'evobuskin_diag_v1', MAX = 25, VERSION = '2.2.0';
  let dernier = null;
  const lire = () => { try { return JSON.parse(localStorage.getItem(CLE) || '[]'); } catch (_) { return []; } };
  const nettoyer = (m) => String(m || '')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jeton]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .slice(0, 400);
  const code = (e) => String(e.etape || 'X').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) + (e.status ? '-' + String(e.status).replace(/[^\w]/g, '').slice(0, 12) : '');

  function noter(etape, err, extra) {
    try {
      const e = Object.assign({
        t: new Date().toISOString(), etape: String(etape),
        message: nettoyer((err && err.message) || err),
        status: (err && (err.status || err.code)) || null, enLigne: navigator.onLine
      }, extra || {});
      dernier = e;
      const l = lire(); l.push(e);
      localStorage.setItem(CLE, JSON.stringify(l.slice(-MAX)));
      return code(e);
    } catch (_) { return 'X'; }
  }
  const dernierCode = () => (dernier ? code(dernier) : '');

  function rapport() {
    const lignes = ['EvoBuskin — rapport de diagnostic', 'Version : ' + VERSION, 'Date : ' + new Date().toISOString(),
      'Site : ' + location.host, 'En ligne : ' + navigator.onLine, 'Rôle : ' + ((window.App && App.role) || '-'),
      'Appareil : ' + navigator.userAgent, ''];
    lire().forEach((e) => lignes.push(e.t + ' | ' + e.etape + ' | ' + (e.status || '-') + ' | ' + e.message));
    return lignes.join('\n');
  }

  async function copier() {
    const texte = rapport();
    try { await navigator.clipboard.writeText(texte); return true; }
    catch (_) {
      try {
        const z = document.createElement('textarea'); z.value = texte; z.style.position = 'fixed'; z.style.opacity = '0';
        document.body.appendChild(z); z.select(); const ok = document.execCommand('copy'); z.remove(); return ok;
      } catch (_2) { return false; }
    }
  }

  // Erreurs inattendues de l'application
  window.addEventListener('error', (ev) => noter('js', ev.error || ev.message));
  window.addEventListener('unhandledrejection', (ev) => noter('promesse', ev.reason));

  return { noter, dernierCode, rapport, copier };
})();
window.Diag = Diag;
