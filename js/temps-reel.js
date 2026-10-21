/* EvoBuskin - SYNCHRONISATION EN TEMPS RÉEL.
   Quand un autre appareil (ou un vendeur) enregistre une vente, un produit, un paiement..., votre écran se met à jour
   en quelques secondes, sans rien faire. Connexion directe (WebSocket) avec le serveur ; si elle n'est pas disponible,
   l'application vérifie toutes les 20 secondes. */
const TempsReel = (() => {
  const TABLES = ['products', 'customers', 'suppliers', 'sales', 'customer_debts', 'purchases', 'supplier_debts', 'expenses', 'stock_movements', 'business_settings'];
  let ws = null, businessId = null, joined = false, arrete = true, ref = 0, essai = 0;
  let joinRef = null, battement = null, reconnexion = null, jeton = null, delai = null, reessaiVue = 0;

  const url = () => {
    const c = window.AUTH_CONFIG;
    return c.supabaseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(c.supabaseAnonKey) + '&vsn=1.0.0';
  };
  const topic = () => 'realtime:evobuskin-' + businessId;
  const envoyer = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

  function rejoindre() {
    const s = Auth.getSession();
    if (!s) return;
    joined = false; joinRef = String(++ref);
    envoyer({
      topic: topic(), event: 'phx_join', ref: joinRef, join_ref: joinRef,
      payload: {
        config: { broadcast: { self: false }, presence: { key: '' },
          postgres_changes: TABLES.map((t) => ({ event: '*', schema: 'public', table: t, filter: 'business_id=eq.' + businessId })) },
        access_token: s.access_token
      }
    });
  }

  // Met à jour l'écran seulement si cela ne dérange pas (pas de fenêtre ouverte, pas de saisie en cours, pas de vente en cours)
  function rafraichirVue() {
    try {
      if (!window.App || !App.role || !App.onglet) return;
      const saisie = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      const fenetre = document.querySelector('.fond-fenetre');
      const venteEnCours = App.onglet === 'caisse' && window.VueCaisse && Array.isArray(VueCaisse.panier) && VueCaisse.panier.length > 0;
      if (fenetre || saisie || venteEnCours) {
        if (reessaiVue < 5) { reessaiVue++; setTimeout(rafraichirVue, 4000); }
        return;
      }
      reessaiVue = 0;
      App.rafraichir();
    } catch (_) { /* sans importance */ }
  }

  function changement() {
    clearTimeout(delai);
    delai = setTimeout(async () => {
      const r = await CloudSnapshotSync.tirer({ force: true });
      if (r && r.ok) rafraichirVue();
    }, 600);
  }

  function ouvrir() {
    if (arrete || !businessId || !navigator.onLine || !Auth.getSession()) return;
    try { ws = new WebSocket(url()); } catch (_) { planifier(); return; }
    ws.onopen = () => {
      essai = 0; rejoindre();
      clearInterval(battement);
      battement = setInterval(() => envoyer({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }), 25000);
      clearInterval(jeton);
      jeton = setInterval(() => { const s = Auth.getSession(); if (s && joined) envoyer({ topic: topic(), event: 'access_token', payload: { access_token: s.access_token }, ref: String(++ref) }); }, 4 * 60 * 1000);
    };
    ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch (_) { return; }
      if (msg.event === 'phx_reply' && msg.topic === topic() && msg.payload) {
        if (msg.ref === joinRef) joined = msg.payload.status === 'ok';
      } else if (msg.event === 'postgres_changes') changement();
      else if (msg.event === 'phx_close' || msg.event === 'phx_error') { joined = false; }
    };
    ws.onclose = () => { joined = false; clearInterval(battement); clearInterval(jeton); planifier(); };
    ws.onerror = () => { joined = false; };
  }

  function planifier() {
    if (arrete) return;
    clearTimeout(reconnexion);
    essai++;
    reconnexion = setTimeout(ouvrir, Math.min(30000, 1500 * 2 ** Math.min(essai, 5)));
  }

  function demarrer(id) {
    arreter();
    if (!id || !window.AUTH_CONFIG || typeof WebSocket === 'undefined') return;
    businessId = id; arrete = false; essai = 0;
    window.addEventListener('online', ouvrirApresRetour);
    ouvrir();
  }
  function ouvrirApresRetour() { if (!arrete && (!ws || ws.readyState > 1)) { essai = 0; ouvrir(); } }

  function arreter() {
    arrete = true; joined = false;
    clearTimeout(reconnexion); clearTimeout(delai); clearInterval(battement); clearInterval(jeton);
    window.removeEventListener('online', ouvrirApresRetour);
    if (ws) { ws.onclose = null; try { ws.close(); } catch (_) {} }
    ws = null; businessId = null;
  }

  return { demarrer, arreter, actif: () => joined, rafraichirVue };
})();
window.TempsReel = TempsReel;
