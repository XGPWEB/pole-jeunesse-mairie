'use client';
import { useState, useRef } from 'react';
import Field from '@/components/Field';

interface Animateur {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  telephone?: string;
  poste?: string;
  espaceAssigne: string;
  username: string;
  photoUrl?: string;
  unite?: string;
  typeContrat?: string;
  statut?: string;
}

function passwordStrength(pwd: string): { score: number; label: string; color: string } {
  if (!pwd) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[!@#$%^&*?_\-+=~|\\/<>,.;:'"]/.test(pwd)) score++;
  if (score <= 2) return { score, label: 'Faible', color: 'bg-red-400' };
  if (score === 3) return { score, label: 'Moyen', color: 'bg-amber-400' };
  return { score, label: 'Fort', color: 'bg-green-500' };
}

export default function ProfilClient({ animateur: initial }: { animateur: Animateur }) {
  const [animateur, setAnimateur] = useState(initial);
  const [nom, setNom]             = useState(initial.nom);
  const [prenom, setPrenom]       = useState(initial.prenom);
  const [email, setEmail]         = useState(initial.email ?? '');
  const [emailPassword, setEmailPassword] = useState('');
  const [telephone, setTelephone] = useState(initial.telephone ?? '');
  const [poste, setPoste]         = useState(initial.poste ?? '');
  const [photoUrl, setPhotoUrl]   = useState(initial.photoUrl ?? '');
  const [saving, setSaving]       = useState(false);
  const [infoSuccess, setInfoSuccess] = useState('');
  const [infoError, setInfoError]     = useState('');

  // Mot de passe
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd]         = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdSaving, setPwdSaving]   = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState('');
  const [pwdError, setPwdError]     = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd]         = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const strength = passwordStrength(newPwd);

  // Validation mot de passe en temps réel
  const pwdErrors: string[] = [];
  if (newPwd) {
    if (newPwd.length < 12) pwdErrors.push('Au moins 12 caractères');
    if (!/[A-Z]/.test(newPwd)) pwdErrors.push('Au moins une majuscule');
    if (!/[!@#$%^&*?_\-+=~|\\/<>,.;:'"]/.test(newPwd)) pwdErrors.push('Au moins un caractère spécial');
  }

  // Photo upload
  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setInfoError('La photo ne doit pas dépasser 2 Mo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setPhotoUrl(reader.result as string); };
    reader.readAsDataURL(file);
  }

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setInfoSuccess('');
    setInfoError('');
    try {
      const res = await fetch('/api/animateurs/profil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom, prenom, email, telephone, poste, photoUrl, currentPassword: emailPassword }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.sessionRevoked) {
          window.location.assign('/login');
          return;
        }
        setAnimateur(data.animateur);
        setEmailPassword('');
        setInfoSuccess('Profil mis à jour avec succès !');
      } else {
        setInfoError(data.error ?? 'Erreur lors de la mise à jour.');
      }
    } catch {
      setInfoError('Erreur de connexion.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePwd(e: React.FormEvent) {
    e.preventDefault();
    setPwdSuccess('');
    setPwdError('');

    if (newPwd !== confirmPwd) {
      setPwdError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (pwdErrors.length > 0) {
      setPwdError('Le mot de passe ne respecte pas les critères de sécurité.');
      return;
    }

    setPwdSaving(true);
    try {
      const res = await fetch('/api/animateurs/profil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.sessionRevoked) {
          window.location.assign('/login');
          return;
        }
        setPwdSuccess('Mot de passe modifié avec succès !');
        setCurrentPwd('');
        setNewPwd('');
        setConfirmPwd('');
      } else {
        setPwdError(data.error ?? 'Erreur lors du changement.');
      }
    } catch {
      setPwdError('Erreur de connexion.');
    } finally {
      setPwdSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[#1B3870] flex items-center justify-center text-white text-2xl font-bold shrink-0">
          {animateur.prenom?.[0]}{animateur.nom?.[0]}
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">{animateur.prenom} {animateur.nom}</h1>
          <p className="text-sm text-gray-500">{animateur.poste ?? 'Animateur'} · {animateur.espaceAssigne}</p>
        </div>
      </div>

      {/* Identité & Photo */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-5 flex items-center gap-2">
          <span>👤</span> Informations personnelles
        </h2>

        {infoSuccess && (
          <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">✅ {infoSuccess}</div>
        )}
        {infoError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">⚠️ {infoError}</div>
        )}

        <form onSubmit={handleSaveInfo} className="space-y-5">
          {/* Photo */}
          <div className="flex items-center gap-5">
            <div className="relative">
              {photoUrl ? (
                <img src={photoUrl} alt="Photo" className="w-20 h-20 rounded-2xl object-cover border-2 border-gray-200" />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#1B3870] to-[#6B1A6E] flex items-center justify-center text-white text-2xl font-bold">
                  {prenom?.[0]}{nom?.[0]}
                </div>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-7 h-7 bg-[#6B1A6E] rounded-full flex items-center justify-center text-white text-xs hover:bg-[#5a1460] shadow"
              >
                ✏️
              </button>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">Photo de profil</p>
              <p className="text-xs text-gray-400 mt-0.5">JPG, PNG · max 2 Mo</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-2 text-xs text-[#6B1A6E] hover:underline font-medium"
              >
                Changer la photo
              </button>
              {photoUrl && (
                <button
                  type="button"
                  onClick={() => setPhotoUrl('')}
                  className="ml-3 text-xs text-gray-400 hover:text-red-400"
                >
                  Supprimer
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
            </div>
          </div>

          {/* Champs */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Prénom" required>
              <input
                type="text"
                value={prenom}
                onChange={e => setPrenom(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 focus:border-[#1B3870]"
              />
            </Field>
            <Field label="Nom" required>
              <input
                type="text"
                value={nom}
                onChange={e => setNom(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 focus:border-[#1B3870]"
              />
            </Field>
          </div>

          <Field label="Adresse email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 focus:border-[#1B3870]"
            />
          </Field>
          {email !== (animateur.email ?? '') && (
            <div>
              <Field label="Mot de passe actuel pour changer l’adresse email" required>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={emailPassword}
                  onChange={e => setEmailPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm"
                />
              </Field>
              <p className="text-xs text-gray-500 mt-1">Après le changement, reconnectez-vous pour sécuriser votre compte.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Téléphone">
              <input
                type="tel"
                value={telephone}
                onChange={e => setTelephone(e.target.value)}
                placeholder="06 xx xx xx xx"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 focus:border-[#1B3870]"
              />
            </Field>
            <Field label="Poste">
              <input
                type="text"
                value={poste}
                onChange={e => setPoste(e.target.value)}
                placeholder="Animateur"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 focus:border-[#1B3870]"
              />
            </Field>
          </div>

          {/* Info non modifiables */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wider">Identifiant</label>
              <p className="text-sm font-mono font-bold text-gray-700 bg-gray-50 px-3 py-2 rounded-xl">{animateur.username}</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wider">Espace assigné</label>
              <p className="text-sm font-semibold text-gray-700 bg-gray-50 px-3 py-2 rounded-xl">{animateur.espaceAssigne}</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-[#1B3870] text-white font-bold rounded-xl hover:bg-[#152c5a] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? '⟳ Enregistrement...' : '💾 Enregistrer les modifications'}
          </button>
        </form>
      </div>

      {/* Changement de mot de passe */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-5 flex items-center gap-2">
          <span>🔒</span> Changer le mot de passe
        </h2>

        {pwdSuccess && (
          <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">✅ {pwdSuccess}</div>
        )}
        {pwdError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">⚠️ {pwdError}</div>
        )}

        <form onSubmit={handleSavePwd} className="space-y-4">
          <div className="relative">
            <Field label="Mot de passe actuel" required>
              <input
                type={showCurrentPwd ? 'text' : 'password'}
                value={currentPwd}
                onChange={e => setCurrentPwd(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]"
              />
            </Field>
            <button type="button" onClick={() => setShowCurrentPwd(v => !v)} className="absolute right-3 top-8 text-gray-400 text-sm">
              {showCurrentPwd ? '🙈' : '👁'}
            </button>
          </div>

          <div className="relative">
            <Field label="Nouveau mot de passe" required>
              <input
                type={showNewPwd ? 'text' : 'password'}
                value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                placeholder="Minimum 12 caractères"
                className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]"
              />
            </Field>
            <button type="button" onClick={() => setShowNewPwd(v => !v)} className="absolute right-3 top-8 text-gray-400 text-sm">
              {showNewPwd ? '🙈' : '👁'}
            </button>
            {/* Barre de force */}
            {newPwd && (
              <div className="mt-2 space-y-1.5">
                <div className="flex gap-1">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= strength.score ? strength.color : 'bg-gray-200'}`} />
                  ))}
                </div>
                <p className={`text-xs font-semibold ${strength.score <= 2 ? 'text-red-500' : strength.score === 3 ? 'text-amber-500' : 'text-green-600'}`}>
                  Force : {strength.label}
                </p>
                {pwdErrors.length > 0 && (
                  <ul className="space-y-0.5">
                    {pwdErrors.map(err => (
                      <li key={err} className="text-xs text-red-500 flex items-center gap-1">
                        <span>✗</span> {err}
                      </li>
                    ))}
                  </ul>
                )}
                {pwdErrors.length === 0 && (
                  <p className="text-xs text-green-600 flex items-center gap-1"><span>✓</span> Tous les critères sont remplis</p>
                )}
              </div>
            )}
            {/* Règles */}
            {!newPwd && (
              <div className="mt-2 text-xs text-gray-400 space-y-0.5">
                <p>Le mot de passe doit contenir :</p>
                <p>• Au moins 12 caractères</p>
                <p>• Au moins une majuscule (A–Z)</p>
                <p>• Au moins un caractère spécial (!@#$%...)</p>
              </div>
            )}
          </div>

          <Field
            label="Confirmer le nouveau mot de passe"
            required
            error={confirmPwd && confirmPwd !== newPwd ? 'Les mots de passe ne correspondent pas' : undefined}
          >
            <input
              type="password"
              value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)}
              placeholder="••••••••"
              className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${
                confirmPwd && confirmPwd !== newPwd
                  ? 'border-red-300 focus:ring-red-200'
                  : 'border-gray-200 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]'
              }`}
            />
          </Field>

          <button
            type="submit"
            disabled={pwdSaving || pwdErrors.length > 0 || !currentPwd || !newPwd || newPwd !== confirmPwd}
            className="w-full py-3 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {pwdSaving ? '⟳ Modification...' : '🔑 Modifier le mot de passe'}
          </button>
        </form>
      </div>
    </div>
  );
}
