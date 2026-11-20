'use client';
import { useState, useEffect } from 'react';

/**
 * idle     état courant (activée / non activée)
 * auth     réauthentification avant de générer un nouveau secret : mot de
 *          passe, plus un code de l'application ACTUELLE s'il s'agit d'une
 *          rotation (remplacement du facteur existant)
 * confirm  scan du QR code + code de la NOUVELLE application
 * disable  mot de passe + code actuel
 */
type Step = 'idle' | 'auth' | 'confirm' | 'disable';

export default function SecuriteClient() {
  const [step, setStep] = useState<Step>('idle');
  const [qrCode, setQrCode] = useState('');
  // Le secret n'est conservé ici que pour l'AFFICHAGE (saisie manuelle dans
  // l'application). Il n'est plus renvoyé au serveur : celui-ci valide le code
  // contre le secret provisoire qu'il a lui-même stocké.
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/animateurs/me')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setTotpEnabled(d.totpEnabled ?? false))
      .catch(() => setTotpEnabled(false));
  }, []);

  function reinitialiserSaisie() {
    setPassword('');
    setCurrentCode('');
    setCode('');
    setQrCode('');
    setSecret('');
    setError('');
  }

  function retourIdle() {
    // Abandon : on demande au serveur d'oublier le secret provisoire (il
    // expire de toute façon). Le facteur actif n'a pas été touché.
    if (step === 'confirm') {
      fetch('/api/auth/totp/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      }).catch(() => {});
    }
    reinitialiserSaisie();
    setStep('idle');
  }

  async function startSetup() {
    if (!password) { setError('Entrez votre mot de passe.'); return; }
    if (totpEnabled && currentCode.length < 6) { setError('Entrez le code de votre application actuelle.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/totp/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          password,
          ...(totpEnabled ? { currentCode } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Impossible de générer le QR code. Réessayez.'); return; }
      setQrCode(data.qrCode);
      setSecret(data.secret);
      setPassword('');
      setCurrentCode('');
      setCode('');
      setStep('confirm');
    } catch {
      setError('Impossible de générer le QR code. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmEnable() {
    if (!code.trim()) { setError('Entrez le code à 6 chiffres.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/totp/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enable', code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      const rotation = totpEnabled === true;
      setTotpEnabled(true);
      reinitialiserSaisie();
      setStep('idle');
      setSuccess(rotation
        ? 'Application d’authentification remplacée. L’ancienne ne fonctionne plus.'
        : 'Double authentification activée ! Votre compte est maintenant protégé.');
    } catch {
      setError('Erreur serveur.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmDisable() {
    if (!password) { setError('Entrez votre mot de passe.'); return; }
    if (!code.trim()) { setError('Entrez votre code actuel.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/totp/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable', password, code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setTotpEnabled(false);
      reinitialiserSaisie();
      setStep('idle');
      setSuccess('Double authentification désactivée.');
    } catch {
      setError('Erreur serveur.');
    } finally {
      setLoading(false);
    }
  }

  const champMdp = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]';
  const champCode = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]';

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Sécurité du compte</h1>
          <p className="text-gray-500 text-sm mt-1">Gérez la double authentification (2FA) de votre compte admin.</p>
        </div>

        {/* Status banner */}
        {success && (
          <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-800 text-sm">
            ✅ {success}
          </div>
        )}
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Card état 2FA */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${totpEnabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                <span className="text-xl">{totpEnabled ? '🛡️' : '🔓'}</span>
              </div>
              <div>
                <p className="font-semibold text-gray-800">Double authentification (TOTP)</p>
                <p className={`text-xs font-medium ${totpEnabled ? 'text-green-600' : 'text-gray-400'}`}>
                  {totpEnabled === null ? 'Chargement...' : totpEnabled ? 'Activée' : 'Non activée'}
                </p>
              </div>
            </div>
            {totpEnabled !== null && (
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${totpEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {totpEnabled ? 'ACTIVE' : 'INACTIVE'}
              </span>
            )}
          </div>

          {/* Step: idle */}
          {step === 'idle' && !totpEnabled && (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                La double authentification ajoute une couche de sécurité supplémentaire.
                À chaque connexion, vous devrez entrer un code temporaire généré par votre application (Google Authenticator, Authy…).
              </p>
              <button
                onClick={() => { reinitialiserSaisie(); setSuccess(''); setStep('auth'); }}
                disabled={loading}
                className="w-full py-3 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors disabled:opacity-50"
              >
                🛡️ Activer la 2FA
              </button>
            </div>
          )}

          {step === 'idle' && totpEnabled && (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                La 2FA est active sur votre compte. Chaque connexion nécessite votre application d'authentification.
              </p>
              <button
                onClick={() => { reinitialiserSaisie(); setSuccess(''); setStep('auth'); }}
                className="w-full mb-3 py-2.5 border border-[#6B1A6E]/30 text-[#6B1A6E] font-semibold rounded-xl hover:bg-purple-50 transition-colors text-sm"
              >
                Changer d&apos;application d&apos;authentification
              </button>
              <button
                onClick={() => { reinitialiserSaisie(); setSuccess(''); setStep('disable'); }}
                className="w-full py-2.5 border border-red-200 text-red-600 font-semibold rounded-xl hover:bg-red-50 transition-colors text-sm"
              >
                Désactiver la 2FA
              </button>
            </div>
          )}

          {/* Step: auth (réauthentification avant activation ou rotation) */}
          {step === 'auth' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {totpEnabled
                  ? 'Pour remplacer votre application d’authentification, confirmez votre mot de passe et entrez un code de l’application ACTUELLE.'
                  : 'Pour activer la double authentification, confirmez d’abord votre mot de passe.'}
              </p>
              <div>
                <label htmlFor="securite-mdp" className="block text-xs font-semibold text-gray-600 mb-1">Mot de passe</label>
                <input id="securite-mdp" type="password" autoComplete="current-password" value={password}
                  onChange={e => setPassword(e.target.value)} className={champMdp} />
              </div>
              {totpEnabled && (
                <div>
                  <label htmlFor="securite-code-actuel" className="block text-xs font-semibold text-gray-600 mb-1">Code de l&apos;application actuelle</label>
                  <input id="securite-code-actuel" type="text" inputMode="numeric" maxLength={6} value={currentCode}
                    onChange={e => setCurrentCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" className={champCode} />
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={retourIdle} className="flex-1 py-2.5 text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 text-sm">Annuler</button>
                <button onClick={startSetup} disabled={loading || !password || (totpEnabled === true && currentCode.length < 6)}
                  className="flex-1 py-2.5 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors disabled:opacity-50 text-sm">
                  {loading ? '⟳ Vérification...' : 'Continuer'}
                </button>
              </div>
            </div>
          )}

          {/* Step: confirm (scan QR + entrer code) */}
          {step === 'confirm' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">1. Scannez ce QR code avec votre application</p>
                <p className="text-xs text-gray-500 mb-3">Google Authenticator, Authy, ou toute app TOTP compatible.</p>
                {qrCode && (
                  <div className="flex justify-center">
                    <img src={qrCode} alt="QR code 2FA" className="w-48 h-48 border border-gray-200 rounded-xl" />
                  </div>
                )}
                <details className="mt-3">
                  <summary className="text-xs text-[#6B1A6E] cursor-pointer select-none">Afficher la clé manuellement</summary>
                  <p className="mt-2 font-mono text-xs bg-gray-50 p-2 rounded break-all border">{secret}</p>
                </details>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">2. Entrez le code généré pour confirmer</p>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]"
                />
              </div>
              <div className="flex gap-3">
                <button onClick={retourIdle} className="flex-1 py-2.5 text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 text-sm">Annuler</button>
                <button onClick={confirmEnable} disabled={loading || code.length < 6} className="flex-1 py-2.5 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors disabled:opacity-50 text-sm">
                  {loading ? '⟳ Vérification...' : 'Confirmer et activer'}
                </button>
              </div>
            </div>
          )}

          {/* Step: disable */}
          {step === 'disable' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Pour désactiver la 2FA, confirmez votre mot de passe et entrez un code valide de votre application d&apos;authentification.
              </p>
              <div>
                <label htmlFor="securite-mdp-desactivation" className="block text-xs font-semibold text-gray-600 mb-1">Mot de passe</label>
                <input id="securite-mdp-desactivation" type="password" autoComplete="current-password" value={password}
                  onChange={e => setPassword(e.target.value)} className={champMdp} />
              </div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
              />
              <div className="flex gap-3">
                <button onClick={retourIdle} className="flex-1 py-2.5 text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 text-sm">Annuler</button>
                <button onClick={confirmDisable} disabled={loading || !password || code.length < 6} className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 text-sm">
                  {loading ? '⟳ Vérification...' : 'Désactiver'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Info sécurité */}
        <div className="mt-6 bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-xs text-amber-700 font-semibold mb-1">⚠️ Information importante</p>
          <p className="text-xs text-amber-600">
            Si vous perdez accès à votre application d'authentification, contactez l'administrateur système
            pour désactiver manuellement la 2FA via la base de données.
          </p>
        </div>
      </div>
    </div>
  );
}
