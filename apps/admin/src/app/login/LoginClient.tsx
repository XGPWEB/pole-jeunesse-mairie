'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/Field';
import { APP_VERSION } from '@/lib/version';

type Screen = 'login' | 'totp' | 'forgot';

export default function LoginClient() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>('login');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [totpCode, setTotpCode] = useState('');
  const [totpPending, setTotpPending] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  const [totpError, setTotpError] = useState('');

  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [forgotError, setForgotError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include',
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error ?? 'Identifiants incorrects.');
        setLoading(false);
        return;
      }

      if (data.requiresTOTP) {
        setTotpPending(data.pendingToken);
        setScreen('totp');
        setLoading(false);
        return;
      }

      if (data.role === 'admin') {
        router.push('/admin/dashboard');
      } else {
        router.push('/animateur/dashboard');
      }
    } catch {
      setError('Erreur de connexion au serveur.');
      setLoading(false);
    }
  }

  async function handleTOTP(e: React.FormEvent) {
    e.preventDefault();
    setTotpLoading(true);
    setTotpError('');
    try {
      const res = await fetch('/api/auth/verify-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingToken: totpPending, code: totpCode }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) {
        setTotpError(data.error ?? 'Code incorrect.');
        setTotpLoading(false);
        return;
      }
      if (data.role === 'admin') {
        router.push('/admin/dashboard');
      } else {
        router.push('/animateur/dashboard');
      }
    } catch {
      setTotpError('Erreur de connexion au serveur.');
      setTotpLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setForgotLoading(true);
    setForgotSuccess('');
    setForgotError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername }),
      });
      const data = await res.json();
      if (data.success) {
        // Message volontairement identique dans tous les cas : le serveur ne
        // révèle ni l'existence de l'identifiant ni le rôle du compte.
        setForgotSuccess(
          "Si cet identifiant existe, la demande a été prise en compte. Selon votre compte, " +
          "vous recevrez un lien par e-mail ou votre administrateur vous en enverra un. " +
          "Votre mot de passe actuel reste valable d'ici là.",
        );
        setForgotUsername('');
      } else {
        setForgotError(data.error ?? 'La demande n’a pas pu être envoyée.');
      }
    } catch {
      setForgotError('Erreur de connexion au serveur.');
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#5a1460] via-[#6B1A6E] to-[#8B2E8E] flex items-center justify-center p-4">
      <div className="absolute top-0 left-0 w-96 h-96 bg-white/5 rounded-full -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-64 h-64 bg-white/5 rounded-full translate-x-1/4 translate-y-1/4" />

      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-[#6B1A6E] px-8 pt-8 pb-6 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                <span className="text-3xl">{screen === 'totp' ? '🔐' : '🏛'}</span>
              </div>
            </div>
            <div className="text-white/70 text-xs font-semibold tracking-widest uppercase mb-1">
              Mairie de Nogent-sur-Marne
            </div>
            <h1 className="text-white text-2xl font-extrabold tracking-tight">
              <span className="text-[#A8D8EA]">PÔLE</span> JEUNESSE
            </h1>
            <div className="flex mt-4 rounded-full overflow-hidden h-1 mx-auto w-32">
              <div className="bg-[#1B3870] flex-[3]" />
              <div className="bg-[#8DC63F] flex-1" />
              <div className="bg-[#29B5E8] flex-1" />
            </div>
          </div>

          <div className="px-8 py-8">
            {/* ── Écran login ────────────────────────────────────────── */}
            {screen === 'login' && (
              <>
                <p className="text-gray-500 text-sm text-center mb-6">Connectez-vous à votre espace personnel</p>
                {error && (
                  <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2">
                    <span>⚠️</span>{error}
                  </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-5">
                  <Field label="Identifiant" required>
                    <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                      placeholder="prenom.nom" autoFocus
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E] transition-all" />
                  </Field>
                  <Field label="Mot de passe" required>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E] transition-all" />
                  </Field>
                  <button type="submit" disabled={loading}
                    className="w-full py-3 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {loading ? <><span className="animate-spin">⟳</span>Connexion...</> : <><span>🔑</span>Se connecter</>}
                  </button>
                </form>
                <p className="text-center text-xs text-gray-400 mt-6">
                  <button type="button"
                    onClick={() => { setScreen('forgot'); setForgotSuccess(''); setForgotError(''); }}
                    className="text-[#6B1A6E] hover:underline font-medium">
                    Mot de passe oublié ?
                  </button>
                </p>
              </>
            )}

            {/* ── Écran TOTP ─────────────────────────────────────────── */}
            {screen === 'totp' && (
              <>
                <div className="text-center mb-6">
                  <p className="font-semibold text-gray-800">Double authentification</p>
                  <p className="text-gray-500 text-sm mt-1">
                    Entrez le code à 6 chiffres de votre application d'authentification.
                  </p>
                </div>
                {totpError && (
                  <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    ⚠️ {totpError}
                  </div>
                )}
                <form onSubmit={handleTOTP} className="space-y-5">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    autoFocus
                    className="w-full px-4 py-4 border border-gray-200 rounded-xl text-center text-3xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]"
                  />
                  <button type="submit" disabled={totpLoading || totpCode.length < 6}
                    className="w-full py-3 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {totpLoading ? <><span className="animate-spin">⟳</span>Vérification...</> : <>🔐 Vérifier</>}
                  </button>
                </form>
                <p className="text-center text-xs text-gray-400 mt-6">
                  <button type="button" onClick={() => { setScreen('login'); setTotpCode(''); setTotpError(''); }}
                    className="text-[#6B1A6E] hover:underline font-medium">
                    ← Retour à la connexion
                  </button>
                </p>
              </>
            )}

            {/* ── Écran mot de passe oublié ──────────────────────────── */}
            {screen === 'forgot' && (
              <>
                {forgotSuccess ? (
                  <div className="text-center py-4">
                    <div className="text-4xl mb-3">✅</div>
                    <p className="text-green-700 font-medium text-sm">{forgotSuccess}</p>
                    <button onClick={() => setScreen('login')}
                      className="mt-5 w-full py-2.5 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors text-sm">
                      Retour à la connexion
                    </button>
                  </div>
                ) : (
                  <>
                    <h2 className="text-lg font-bold text-gray-800 mb-2">🔑 Mot de passe oublié</h2>
                    <p className="text-gray-500 text-sm mb-5">
                      Entrez votre identifiant. Si une adresse e-mail figure sur votre fiche, vous y recevrez un lien de réinitialisation. Sinon, votre administrateur sera prévenu.
                    </p>
                    {forgotError && (
                      <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">⚠️ {forgotError}</div>
                    )}
                    <form onSubmit={handleForgot} className="space-y-4">
                      <Field label="Identifiant" required>
                        <input type="text" value={forgotUsername} onChange={e => setForgotUsername(e.target.value)}
                          placeholder="prenom.nom" autoFocus
                          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]" />
                      </Field>
                      <button type="submit" disabled={forgotLoading}
                        className="w-full py-3 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                        {forgotLoading ? '⟳ Envoi...' : '📩 Envoyer la demande'}
                      </button>
                      <button type="button" onClick={() => setScreen('login')}
                        className="w-full py-2.5 text-gray-500 text-sm hover:text-gray-700">
                        Annuler
                      </button>
                    </form>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <p className="text-center text-white/50 text-xs mt-6">
          v{APP_VERSION} — Pôle Jeunesse Nogent-sur-Marne · 2026
        </p>
      </div>
    </div>
  );
}
