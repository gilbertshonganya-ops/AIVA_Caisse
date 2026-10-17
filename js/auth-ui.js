/* EvoBuskin - écrans inscription / connexion / récupération du mot de passe. */
const AuthUI = (() => {
  let mode = 'login';
  let inviteOuverte = false;
  let accountType = 'patron';
  let busy = false;

  const passwordRules = [
    { key: 'length', label: '12 caractères minimum', test: p => p.length >= 12 },
    { key: 'upper', label: 'une lettre majuscule', test: p => /[A-Z]/.test(p) },
    { key: 'lower', label: 'une lettre minuscule', test: p => /[a-z]/.test(p) },
    { key: 'number', label: 'un chiffre', test: p => /\d/.test(p) },
    { key: 'special', label: 'un caractère spécial', test: p => /[^A-Za-z0-9]/.test(p) }
  ];

  function strength(password) {
    const passed = passwordRules.filter(r => r.test(password)).length;
    const score = passed;
    const percent = passed * 20;
    if (!password) return { score, percent: 0, label: 'Aucun mot de passe', cls: '' };
    if (passed < 3) return { score, percent, label: percent + '% — Faible', cls: 'faible' };
    if (passed < 5) return { score, percent, label: percent + '% — Moyen', cls: 'moyen' };
    return { score, percent, label: '100% — Très fort', cls: 'tres-fort' };
  }

  function passwordHTML(id = 'motDePasse', confirmId = '') {
    return `
      <label class="champ-auth">
        <span>Mot de passe</span>
        <div class="auth-password-wrap">
          <input id="${id}" type="password" autocomplete="new-password" minlength="12" required placeholder="12 caractères minimum">
          <button type="button" class="auth-eye" data-toggle-password="${id}" aria-label="Afficher le mot de passe">👁</button>
        </div>
        <div class="password-meter" aria-hidden="true"><i></i></div>
        <div id="passwordStrength" class="password-strength">Aucun mot de passe</div>
        <ul class="password-rules" id="passwordRules">${passwordRules.map(r => `<li data-rule="${r.key}">○ ${r.label}</li>`).join('')}</ul>
      </label>
      ${confirmId ? `<label class="champ-auth"><span>Confirmer le mot de passe</span><div class="auth-password-wrap"><input id="${confirmId}" type="password" autocomplete="new-password" required placeholder="Répétez le mot de passe"><button type="button" class="auth-eye" data-toggle-password="${confirmId}" aria-label="Afficher le mot de passe">👁</button></div></label>` : ''}
    `;
  }

  function shell(content, slogan) {
    const vue = $('#vue');
    $('#menu').hidden = true;
    $('#btnQuitter').hidden = true;
    $('#infoRole').textContent = 'Compte sécurisé';
    vue.innerHTML = `<section class="auth-page"><div class="auth-card"><img class="auth-logo" src="icons/logo.png" alt="EvoBuskin" width="86" height="86"><div class="auth-brand">EvoBuskin</div>${slogan ? `<p class="auth-slogan"><b>${slogan}</b></p>` : ''}${content}</div></section>`;
    bindCommon();
  }

  function bindCommon() {
    $$('.auth-eye').forEach(btn => btn.addEventListener('click', () => {
      const input = $('#' + btn.dataset.togglePassword);
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    }));
    const pwd = $('#motDePasse');
    if (pwd) pwd.addEventListener('input', updatePasswordMeter);
    const confirm = $('#confirmationMotDePasse');
    if (confirm) confirm.addEventListener('input', updatePasswordMeter);
  }

  function updatePasswordMeter() {
    const pwd = $('#motDePasse');
    if (!pwd) return;
    const s = strength(pwd.value);
    const meter = $('.password-meter i');
    if (meter) meter.style.width = s.percent + '%';
    const label = $('#passwordStrength');
    if (label) { label.textContent = s.label; label.className = 'password-strength ' + s.cls; }
    $$('.password-rules li').forEach(li => {
      const rule = passwordRules.find(r => r.key === li.dataset.rule);
      const ok = rule && rule.test(pwd.value);
      li.textContent = (ok ? '✓ ' : '○ ') + rule.label;
      li.classList.toggle('ok', ok);
    });
    const confirm = $('#confirmationMotDePasse');
    const match = $('#passwordMatch');
    if (confirm && match) {
      match.textContent = !confirm.value ? '' : (confirm.value === pwd.value ? '✓ Les mots de passe correspondent.' : 'Les mots de passe ne correspondent pas.');
      match.className = 'password-match ' + (confirm.value && confirm.value === pwd.value ? 'ok' : 'bad');
    }
  }

  const MESSAGE_MDP = 'Le mot de passe doit avoir 12 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial.';
  function validPassword(password) {
    return passwordRules.every(r => r.test(password));
  }

  function errorText(err) {
    if (window.Reseau && Reseau.estErreurReseau(err)) return Reseau.MESSAGE;
    const msg = String(err?.message || err || 'Une erreur est survenue.');
    if (/HORS_LIGNE_COMPTE_INCONNU/.test(msg)) return 'Pas de connexion Internet. Ce compte doit d’abord être ouvert une fois avec Internet sur cet appareil.';
    if (/CUSTOMER_HAS_DEBT/.test(msg)) return 'Ce client a encore une dette : suppression impossible.';
    if (/invalid login credentials/i.test(msg)) return 'Adresse email ou mot de passe incorrect.';
    if (/EMAIL_NOT_CONFIRMED|email not confirmed/i.test(msg)) return 'Votre adresse email doit être confirmée avant la connexion.';
    if (/AAL2_REQUIRED/i.test(msg)) return 'Une authentification à deux facteurs est requise pour ce compte.';
    if (/user already registered/i.test(msg)) return 'Un compte existe déjà avec cette adresse email.';
    if (/database error saving new user|unexpected_failure/i.test(msg)) return accountType === 'vendeur' ? 'Code d’invitation invalide, expiré ou déjà utilisé, ou limite d’utilisateurs atteinte. Demandez un nouveau code au propriétaire.' : 'Impossible de créer le compte pour le moment. Réessayez plus tard.';
    if (/rate limit/i.test(msg)) return 'Trop de demandes. Patientez quelques instants avant de réessayer.';
    return msg;
  }

  function notice(message, type = '') {
    const el = $('#authMessage');
    if (!el) return;
    el.textContent = message;
    el.className = 'auth-message ' + type;
  }

  function submitButton(text) { return `<button class="btn auth-submit" id="authSubmit" type="submit">${esc(text)}</button>`; }

  function afficherConnexion() {
    if (!inviteOuverte && new URLSearchParams(window.location.search).get('invite')) { inviteOuverte = true; return afficherInscription(); }
    mode = 'login';
    shell(`
      <h1>Connexion</h1>
      <p class="auth-subtitle">Accédez à votre espace EvoBuskin.</p>
      <div id="authMessage" class="auth-message" role="alert"></div>
      <form id="loginForm" novalidate>
        <label class="champ-auth"><span>Adresse email</span><input id="email" type="email" autocomplete="email" inputmode="email" required placeholder="vous@exemple.com"></label>
        <label class="champ-auth"><span>Mot de passe</span><div class="auth-password-wrap"><input id="motDePasse" type="password" autocomplete="current-password" required placeholder="Votre mot de passe"><button type="button" class="auth-eye" data-toggle-password="motDePasse" aria-label="Afficher le mot de passe">👁</button></div></label>
        ${submitButton('Se connecter')}
      </form>
      <button class="auth-link" id="forgotPassword">Mot de passe oublié ?</button>
      <div class="auth-separator"><span>Pas encore de compte ?</span></div>
      <button class="btn contour" id="goSignup">Créer un compte</button>
    `, 'Continuez à faire avancer votre commerce.');
    $('#loginForm').addEventListener('submit', connexion);
    $('#forgotPassword').addEventListener('click', afficherRecuperation);
    $('#goSignup').addEventListener('click', afficherInscription);
  }

  function afficherInscription() {
    mode = 'signup';
    shell(`
      <h1>Créer votre compte</h1>
      <p class="auth-subtitle">Commencez votre espace professionnel EvoBuskin.</p>
      <div id="authMessage" class="auth-message" role="alert"></div>
      <form id="signupForm" novalidate>
        <div class="role-title">Je souhaite créer un compte en tant que :</div>
        <div class="account-types">
          <button type="button" class="account-type actif" data-type="patron"><b>👑 Propriétaire</b><small>Je crée et gère ma boutique.</small></button>
          <button type="button" class="account-type" data-type="vendeur"><b>🧾 Vendeur</b><small>Je rejoins une boutique avec une invitation.</small></button>
        </div>
        <label class="champ-auth"><span>Nom complet</span><input id="nomComplet" type="text" autocomplete="name" maxlength="100" required placeholder="Votre nom complet"></label>
        <label class="champ-auth"><span>Adresse email</span><input id="email" type="email" autocomplete="email" inputmode="email" maxlength="254" required placeholder="vous@exemple.com"></label>
        <div id="businessFields">
          <label class="champ-auth"><span>Nom de la boutique</span><input id="nomBoutiqueAuth" type="text" autocomplete="organization" maxlength="120" required placeholder="Ex. Boutique Gilbert"></label>
        </div>
        <div id="inviteFields" hidden>
          <label class="champ-auth"><span>Code d'invitation</span><input id="codeInvitation" type="text" autocomplete="off" maxlength="80" placeholder="Code reçu du propriétaire"></label>
        </div>
        ${passwordHTML('motDePasse', 'confirmationMotDePasse')}
        <div id="passwordMatch" class="password-match"></div>
        <label class="auth-check"><input id="conditions" type="checkbox" required><span>J'accepte les conditions d'utilisation et la politique de confidentialité.</span></label>
        ${submitButton('Créer mon compte')}
      </form>
      <div class="auth-separator"><span>Déjà un compte ?</span></div>
      <button class="btn contour" id="goLogin">Se connecter</button>
    `, 'Sachez ce que vous vendez et ce que vous gagnez.');
    $$('.account-type').forEach(b => b.addEventListener('click', () => {
      accountType = b.dataset.type;
      $$('.account-type').forEach(x => x.classList.toggle('actif', x === b));
      $('#businessFields').hidden = accountType !== 'patron';
      $('#inviteFields').hidden = accountType !== 'vendeur';
      $('#nomBoutiqueAuth').required = accountType === 'patron';
      $('#codeInvitation').required = accountType === 'vendeur';
    }));
    $('#signupForm').addEventListener('submit', inscription);
    const invitation = new URLSearchParams(window.location.search).get('invite');
    if (invitation) { const bv = $('[data-type="vendeur"]'); if (bv) bv.click(); $('#codeInvitation').value = invitation.slice(0, 40); }
    $('#goLogin').addEventListener('click', afficherConnexion);
  }

  function afficherRecuperation() {
    mode = 'recovery';
    shell(`
      <h1>Mot de passe oublié ?</h1>
      <p class="auth-subtitle">Entrez l'adresse email de votre compte. Si elle existe, nous vous enverrons un lien sécurisé pour choisir un nouveau mot de passe.</p>
      <div id="authMessage" class="auth-message" role="alert"></div>
      <form id="recoveryForm" novalidate>
        <label class="champ-auth"><span>Adresse email</span><input id="email" type="email" autocomplete="email" inputmode="email" required placeholder="vous@exemple.com"></label>
        ${submitButton('Envoyer le lien de récupération')}
      </form>
      <button class="auth-link" id="backLogin">← Retour à la connexion</button>
    `);
    $('#recoveryForm').addEventListener('submit', recuperation);
    $('#backLogin').addEventListener('click', afficherConnexion);
  }

  let minuteurAttente = null;
  function arreterAttente() { if (minuteurAttente) clearInterval(minuteurAttente); minuteurAttente = null; }
  // Après 5 erreurs : pause de 60 secondes (conservée même si la page est rechargée)
  function afficherAttente() {
    arreterAttente();
    const maj = () => {
      const reste = AuthHorsLigne.attente();
      const bouton = $('#authSubmit');
      if (reste <= 0) { arreterAttente(); notice(''); if (bouton) bouton.disabled = false; return; }
      if (bouton) bouton.disabled = true;
      notice('Trop de tentatives. Patientez ' + reste + ' seconde' + (reste > 1 ? 's' : '') + ' avant de réessayer.', 'erreur');
    };
    maj();
    minuteurAttente = setInterval(maj, 1000);
  }

  async function connexionHorsLigne(email, password) {
    const r = await AuthHorsLigne.verifier(email, password);
    if (r && r.inconnu) throw (navigator.onLine ? Reseau.erreur() : new Error('HORS_LIGNE_COMPTE_INCONNU'));
    if (!r) throw new Error('Invalid login credentials');
    await Chargeur.pendant(() => App.ouvrirSessionHorsLigne(r.user, r.profil), 'Ouverture de votre boutique…');
    Audit.log('connexion', { mode: 'sans Internet' });
  }

  async function connexion(e) {
    e.preventDefault(); if (busy) return;
    const email = $('#email').value.trim(); const password = $('#motDePasse').value;
    if (!email || !password) return notice('Renseignez votre email et votre mot de passe.', 'erreur');
    if (AuthHorsLigne.attente() > 0) return afficherAttente();
    busy = true; $('#authSubmit').disabled = true; notice('');
    try {
      if (!navigator.onLine) { await connexionHorsLigne(email, password); return; }
      let data;
      try { data = await Auth.signIn(email, password); }
      catch (err) {
        if (err.reseau) { await connexionHorsLigne(email, password); return; } // coupure pendant la connexion : mode hors ligne
        if (/invalid login credentials/i.test(String(err.message))) {
          AuthHorsLigne.compterEchec();
          Auth.rpcPublic('v19_log_auth_failure', { p_email: email, p_kind: 'connexion_echec' }).catch(() => {}); // visible dans le journal du patron
        }
        throw err;
      }
      if (!data.access_token) throw new Error('Connexion non terminée. Vérifiez votre adresse email.');
      AuthHorsLigne.effacerEssais();
      await Chargeur.pendant(async () => {
        await AuthHorsLigne.memoriser(email, password, data.user);
        if (typeof App.apresAuthentification === 'function') await App.apresAuthentification(data);
        else App.afficherConnexion();
      }, 'Ouverture de votre boutique…');
      Audit.log('connexion', { mode: 'avec Internet' });
      AuthHorsLigne.envoyerEchecsEnAttente();
    } catch (err) { notice(errorText(err), 'erreur'); if (AuthHorsLigne.attente() > 0) afficherAttente(); }
    finally { busy = false; if ($('#authSubmit') && AuthHorsLigne.attente() <= 0) $('#authSubmit').disabled = false; }
  }

  async function inscription(e) {
    e.preventDefault(); if (busy) return;
    const email = $('#email').value.trim(); const password = $('#motDePasse').value; const confirm = $('#confirmationMotDePasse').value;
    const fullName = $('#nomComplet').value.trim(); const businessName = $('#nomBoutiqueAuth').value.trim(); const inviteCode = $('#codeInvitation').value.trim();
    if (!fullName || !email) return notice('Complétez les informations obligatoires.', 'erreur');
    if (!validPassword(password)) return notice('Votre mot de passe doit atteindre 100% : 12 caractères minimum, majuscule, minuscule, chiffre et caractère spécial.', 'erreur');
    if (password !== confirm) return notice('Les deux mots de passe ne correspondent pas.', 'erreur');
    if (accountType === 'patron' && !businessName) return notice('Indiquez le nom de votre boutique.', 'erreur');
    if (accountType === 'vendeur' && !inviteCode) return notice('Un code d’invitation est requis pour un vendeur.', 'erreur');
    if (!$('#conditions').checked) return notice('Vous devez accepter les conditions d’utilisation.', 'erreur');
    busy = true; $('#authSubmit').disabled = true; notice('');
    try {
      const data = await Auth.signUp({ email, password, fullName, accountType, businessName, inviteCode });
      if (data.access_token) {
        await AuthHorsLigne.memoriser(email, password, data.user);
        await Chargeur.pendant(async () => { if (typeof App.apresAuthentification === 'function') await App.apresAuthentification(data); }, 'Ouverture de votre boutique…');
      } else {
        notice('Compte créé. Consultez votre email pour confirmer votre adresse, puis connectez-vous.', 'succes');
      }
    } catch (err) { notice(errorText(err), 'erreur'); }
    finally { busy = false; if ($('#authSubmit')) $('#authSubmit').disabled = false; }
  }

  // Mot de passe oublié : le système vérifie si le compte existe, puis envoie le lien.
  // Après 5 essais, pause de 60 secondes (aussi contrôlée par le serveur).
  let minuteurRecup = null;
  function afficherAttenteRecup() {
    if (minuteurRecup) clearInterval(minuteurRecup);
    const maj = () => {
      const reste = AuthHorsLigne.attente('recup');
      const bouton = $('#authSubmit');
      if (reste <= 0) { clearInterval(minuteurRecup); minuteurRecup = null; notice(''); if (bouton) bouton.disabled = false; return; }
      if (bouton) bouton.disabled = true;
      notice('Trop de tentatives. Patientez ' + reste + ' seconde' + (reste > 1 ? 's' : '') + ' avant de réessayer.', 'erreur');
    };
    maj(); minuteurRecup = setInterval(maj, 1000);
  }

  async function recuperation(e) {
    e.preventDefault(); if (busy) return;
    const email = $('#email').value.trim();
    if (!email) return notice('Renseignez votre adresse email.', 'erreur');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return notice('Cette adresse email n’est pas valide.', 'erreur');
    if (AuthHorsLigne.attente('recup') > 0) return afficherAttenteRecup();
    busy = true; $('#authSubmit').disabled = true; notice('');
    try {
      let existe;
      try { existe = await Auth.rpcPublic('v19_account_exists', { p_email: email }); }
      catch (err) {
        if (/RATE_LIMITED/.test(String(err.message))) { AuthHorsLigne.forcerPause('recup'); afficherAttenteRecup(); return; }
        throw err;
      }
      AuthHorsLigne.compterEchec('recup');
      if (!existe) {
        notice('Aucun compte n’est associé à cette adresse email. Vérifiez l’adresse ou créez un compte.', 'erreur');
        if (AuthHorsLigne.attente('recup') > 0) afficherAttenteRecup();
        return;
      }
      await Auth.resetPassword(email);
      AuthHorsLigne.effacerEssais('recup');
      notice('Compte trouvé. Un lien de récupération vient d’être envoyé à ' + email + '. Consultez votre boîte mail (et les courriers indésirables).', 'succes');
    } catch (err) { notice(Reseau.estErreurReseau(err) ? Reseau.MESSAGE : 'Impossible de traiter la demande pour le moment. Réessayez plus tard.', 'erreur'); }
    finally { busy = false; if ($('#authSubmit') && AuthHorsLigne.attente('recup') <= 0) $('#authSubmit').disabled = false; }
  }


  async function afficherMfaSetup(status,onDone){
    mode='mfa';
    if(!status.enrolled){
      shell(`<h1>Protection renforcée</h1><p class="auth-subtitle">Votre compte propriétaire nécessite une authentification à deux facteurs.</p><div id="authMessage" class="auth-message" role="alert"></div><button class="btn auth-submit" id="startMfa">Activer la double authentification</button><div class="auth-security-box">Utilisez une application TOTP. La clé secrète ne doit jamais être partagée.</div>`);
      $('#startMfa').addEventListener('click',async()=>{try{$('#startMfa').disabled=true;const f=await Auth.enrollTotp();const q0=f?.totp?.qr_code||'';const qr=q0.startsWith('data:image/svg+xml')?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(q0.slice(q0.indexOf(',')+1)):q0;const secret=f?.totp?.secret||'';shell(`<h1>Configurer la 2FA</h1><p class="auth-subtitle">Scannez le QR code, puis saisissez le code à 6 chiffres.</p><div id="authMessage" class="auth-message" role="alert"></div>${qr?`<img class="mfa-qr" src="${esc(qr)}" alt="QR code TOTP">`:''}<div class="auth-security-box"><b>Clé TOTP de secours</b><br><code class="mfa-secret">${esc(secret)}</code></div><form id="mfaForm"><label class="champ-auth"><span>Code à 6 chiffres</span><input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></label>${submitButton('Vérifier et activer')}</form>`);$('#mfaForm').addEventListener('submit',async e=>{e.preventDefault();try{const fs=await Auth.listFactors();const latest=(fs?.all||[]).filter(x=>x.factor_type==='totp').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];if(!latest)throw new Error('MFA_FACTOR_NOT_FOUND');const ch=await Auth.challengeFactor(latest.id);await Auth.verifyFactor(latest.id,ch.id,$('#mfaCode').value);notice('Double authentification activée.','succes');setTimeout(onDone,400)}catch(err){notice('Code invalide ou activation impossible.','erreur')}})}catch(err){notice(errorText(err),'erreur');$('#startMfa').disabled=false}})
    }else{
      shell(`<h1>Vérification 2FA</h1><p class="auth-subtitle">Entrez le code de votre application d’authentification.</p><div id="authMessage" class="auth-message" role="alert"></div><form id="mfaForm"><label class="champ-auth"><span>Code à 6 chiffres</span><input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus></label>${submitButton('Vérifier')}</form><button class="auth-link" id="mfaLogout">Annuler et se déconnecter</button>`);
      $('#mfaForm').addEventListener('submit',async e=>{e.preventDefault();try{$('#authSubmit').disabled=true;const ch=status.challenge||await Auth.challengeFactor(status.factor.id);await Auth.verifyFactor(status.factor.id,ch.id,$('#mfaCode').value);notice('Vérification réussie.','succes');setTimeout(onDone,300)}catch(err){notice('Code invalide. Réessayez.','erreur');$('#authSubmit').disabled=false}});$('#mfaLogout').addEventListener('click',()=>App.verrouiller())
    }
  }

  async function afficherNouveauMotDePasse(accessToken) {
    mode = 'reset';
    shell(`
      <h1>Nouveau mot de passe</h1>
      <p class="auth-subtitle">Choisissez un nouveau mot de passe fort pour sécuriser votre compte.</p>
      <div id="authMessage" class="auth-message" role="alert"></div>
      <form id="resetForm" novalidate>
        ${passwordHTML('motDePasse', 'confirmationMotDePasse')}
        <div id="passwordMatch" class="password-match"></div>
        ${submitButton('Enregistrer le nouveau mot de passe')}
      </form>
    `);
    $('#resetForm').addEventListener('submit', async (e) => {
      e.preventDefault(); if (busy) return;
      const password = $('#motDePasse').value; const confirm = $('#confirmationMotDePasse').value;
      if (!validPassword(password)) return notice('Votre nouveau mot de passe doit atteindre 100% : 12 caractères minimum, majuscule, minuscule, chiffre et caractère spécial.', 'erreur');
      if (password !== confirm) return notice('Les deux mots de passe ne correspondent pas.', 'erreur');
      busy = true; $('#authSubmit').disabled = true; notice('Mise à jour sécurisée en cours…');
      try {
        await Auth.updatePassword(accessToken, password);
        notice('Mot de passe modifié avec succès. Vous pouvez maintenant vous connecter.', 'succes');
        setTimeout(() => afficherConnexion(), 1200);
      } catch (err) { notice(errorText(err), 'erreur'); }
      finally { busy = false; if ($('#authSubmit')) $('#authSubmit').disabled = false; }
    });
  }

  function recupererTokenDeRecuperation() {
    const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    if (hash.get('type') !== 'recovery') return null;
    return hash.get('access_token');
  }

  return { afficherConnexion, afficherInscription, afficherRecuperation, afficherNouveauMotDePasse, afficherMfaSetup, recupererTokenDeRecuperation, strength, validPassword, MESSAGE_MDP };
})();
window.AuthUI = AuthUI;
