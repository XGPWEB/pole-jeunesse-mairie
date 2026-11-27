'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Field from '@/components/Field';

type Etat = 'chargement' | 'formulaire' | 'sans-jeton' | 'termine';

export default function ReinitialisationClient() {
  const [etat, setEtat] = useState<Etat>('chargement');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Le jeton arrive dans le FRAGMENT de l'URL (#token=…) : il n'est jamais
    // envoyé au serveur lors du chargement de la page (ni journaux d'accès, ni
    // Referer). On le retire aussitôt de la barre d'adresse et de l'historique.
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const jeton = params.get('token') ?? '';
    if (jeton) {
      setToken(jeton);
      setEtat('formulaire');
      window.history.replaceState(null, '', window.location.pathname);
    } else {
      setEtat('sans-jeton');
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('Les deux mots de passe ne sont pas identiques.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (data.success) {
        setEtat('termine');
        setPassword('');
        setConfirmation('');
        setToken('');
      } else {
        setError(data.error ?? 'La réinitialisation a échoué.');
      }
    } catch {
      setError('Erreur de connexion au serveur.');
    } finally {
      setLoading(false);
    }
  }

  const champ = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E] transition-all';

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#5a1460] via-[#6B1A6E] to-[#8B2E8E] flex items-center justify-center p-4">
      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-[#6B1A6E] px-8 pt-8 pb-6 text-center">
            <h1 className="text-white text-2xl font-extrabold tracking-tight">
              <span className="text-[#A8D8EA]">PÔLE</span> JEUNESSE
            </h1>
            <p className="text-white/70 text-xs mt-2">Nouveau mot de passe</p>
          </div>

          <div className="px-8 py-8">
            {etat === 'chargement' && (
              <p className="text-center text-sm text-gray-500">Chargement…</p>
            )}

            {etat === 'sans-jeton' && (
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-5">
                  Ce lien est incomplet ou a déjà été ouvert. Refaites une demande depuis
                  « Mot de passe oublié ? » sur la page de connexion.
                </p>
                <Link href="/login" className="inline-block w-full py-2.5 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors text-sm">
                  Retour à la connexion
                </Link>
              </div>
            )}

            {etat === 'termine' && (
              <div className="text-center">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-green-700 font-medium text-sm mb-1">Votre mot de passe a été modifié.</p>
                <p className="text-gray-500 text-xs mb-5">
                  Par sécurité, toutes vos sessions ouvertes ont été fermées.
                </p>
                <Link href="/login" className="inline-block w-full py-2.5 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors text-sm">
                  Se connecter
                </Link>
              </div>
            )}

            {etat === 'formulaire' && (
              <>
                <p className="text-gray-500 text-sm mb-5">
                  Choisissez un nouveau mot de passe : au moins 12 caractères, une majuscule et un caractère spécial.
                </p>
                {error && (
                  <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">⚠️ {error}</div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <Field label="Nouveau mot de passe" required>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                      autoComplete="new-password" autoFocus className={champ} />
                  </Field>
                  <Field label="Confirmez le mot de passe" required>
                    <input type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)}
                      autoComplete="new-password" className={champ} />
                  </Field>
                  <button type="submit" disabled={loading || !password || !confirmation}
                    className="w-full py-3 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors disabled:opacity-50">
                    {loading ? '⟳ Enregistrement...' : 'Enregistrer le mot de passe'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
