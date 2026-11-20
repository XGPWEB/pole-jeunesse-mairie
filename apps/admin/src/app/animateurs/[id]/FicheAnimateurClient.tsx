'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { modifierAnimateur } from '../actions';
import { envoyerIdentifiants } from '../emailActions';
import AccesCompte from './AccesCompte';
import ChangerRole from './ChangerRole';
import type { Editeur } from '../ChoixRubriques';
import { genererMotDePasse } from '@/lib/password';

interface AnimateurCompte {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  dateNaissance: string;
  adresse: string;
  espaceAssigne: string;
  dateEmbauche: string;
  dateFinContrat: string;
  typeContrat: string;
  username: string;
  password: string;
  statut: string;
  createdAt: string;
  lastLogin?: string;
  photoUrl: string | null;
  passwordResetRequested: boolean;
  role: string;
  rubriques: string[] | null;
}

interface Props {
  animateur: AnimateurCompte;
  editeur: Editeur;
}

function getAge(dateNaissance: string): number {
  const naissance = new Date(dateNaissance);
  const now = new Date();
  let age = now.getFullYear() - naissance.getFullYear();
  const mois = now.getMonth() - naissance.getMonth();
  if (mois < 0 || (mois === 0 && now.getDate() < naissance.getDate())) age--;
  return age;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ESPACE_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  Collégiens: { bg: 'bg-purple-100', text: 'text-[#6B1A6E]', border: 'border-purple-200' },
  Lycéens: { bg: 'bg-blue-100', text: 'text-[#1B3870]', border: 'border-blue-200' },
  PIJ: { bg: 'bg-sky-100', text: 'text-[#29B5E8]', border: 'border-sky-200' },
  CLAS: { bg: 'bg-green-100', text: 'text-[#8DC63F]', border: 'border-green-200' },
  Tous: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' },
};

function EspaceBadge({ espace }: { espace: string }) {
  const style = ESPACE_BADGE[espace] ?? { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${style.bg} ${style.text} ${style.border}`}
    >
      {espace}
    </span>
  );
}

function StatutBadge({ statut }: { statut: string }) {
  if (statut === 'actif') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-700 border border-green-200">
        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
        Actif
      </span>
    );
  }
  if (statut === 'suspendu') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-orange-100 text-orange-700 border border-orange-200">
        <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
        Suspendu
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-700 border border-red-200">
      <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
      Inactif
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value}</span>
    </div>
  );
}

function EditableField({
  label,
  value,
  type = 'text',
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6B1A6E] text-gray-800"
      />
    </div>
  );
}

function EditableSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6B1A6E] text-gray-800 bg-white"
      >
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

export default function FicheAnimateurClient({ animateur, editeur }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(animateur.photoUrl);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [resetHandled, setResetHandled] = useState(false);
  const [resetPassword, setResetPassword] = useState<string | null>(null);
  const [resetError, setResetError] = useState('');
  // Sa propre fiche : changer son adresse exige le mot de passe actuel (le
  // serveur le vérifie) ; son mot de passe se change par « Mot de passe oublié ».
  const estSoiMeme = editeur.id === animateur.id;
  const [motDePasseActuel, setMotDePasseActuel] = useState('');

  const TYPES_CONTRAT = ['Titulaire', 'Emploi temporaire', 'Vacataire', "Contrat d'apprentissage", 'Stagiaire'];
  const contratAvecFin = (type: string) => type !== 'Titulaire';
  // Un administrateur supervise : ni espace, ni contrat, ni date d'embauche.
  const effectif = animateur.role !== 'admin';
  // Les administrateurs sont listés dans Administration › Administrateurs
  // (page du compte qui gère les droits), les autres dans l'équipe.
  const retour = !effectif && editeur.gereDroits
    ? { href: '/admin/administrateurs', label: 'Administrateurs' }
    : { href: '/admin/animateurs', label: 'Animateurs' };

  // État contrôlé pour l'édition
  const [editData, setEditData] = useState({
    nom: animateur.nom,
    prenom: animateur.prenom,
    email: animateur.email,
    telephone: animateur.telephone ?? '',
    adresse: animateur.adresse ?? '',
    dateNaissance: animateur.dateNaissance ?? '',
    dateEmbauche: animateur.dateEmbauche ?? '',
    dateFinContrat: animateur.dateFinContrat ?? '',
    espaceAssigne: animateur.espaceAssigne,
    typeContrat: animateur.typeContrat,
    statut: animateur.statut,
  });

  function updateEdit(field: string, value: string) {
    setEditData(d => ({ ...d, [field]: value }));
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('Image trop lourde. Maximum 3 Mo.'); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target?.result as string;
      setPhotoUrl(base64);
      setPhotoSaving(true);
      await modifierAnimateur(animateur.id, { photoUrl: base64 });
      setPhotoSaving(false);
    };
    reader.readAsDataURL(file);
  }

  async function handlePhotoDelete() {
    setPhotoUrl(null);
    setPhotoSaving(true);
    await modifierAnimateur(animateur.id, { photoUrl: null });
    setPhotoSaving(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    const adresseChangee = editData.email !== animateur.email;
    const result = await modifierAnimateur(animateur.id, {
      ...editData,
      ...(estSoiMeme && adresseChangee ? { motDePasseActuel } : {}),
    });
    setSaving(false);
    if (result.success) {
      setMotDePasseActuel('');
      // Sa propre adresse changée : ses sessions sont révoquées.
      if (estSoiMeme && adresseChangee) { window.location.assign('/login'); return; }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setEditMode(false);
      startTransition(() => router.refresh());
    } else {
      setSaveError(result.error ?? 'Erreur lors de la sauvegarde');
    }
  }

  const age = animateur.dateNaissance ? getAge(animateur.dateNaissance) : null;

  const [emailSubject, setEmailSubject] = useState('Vos identifiants Pôle Jeunesse');
  const [emailIntro, setEmailIntro] = useState(`Votre compte animateur a été créé.\nVoici vos identifiants pour vous connecter à la plateforme Pôle Jeunesse.`);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [showEmailCustom, setShowEmailCustom] = useState(false);

  function handleGeneratePassword() {
    setNewPassword(genererMotDePasse());
    setPasswordCopied(false);
    setEmailSent(false);
  }

  /** Enregistre le mot de passe généré, une seule fois par valeur. */
  const [motDePasseEnregistre, setMotDePasseEnregistre] = useState<string | null>(null);
  async function enregistrerMotDePasse(motDePasse: string): Promise<string | null> {
    if (motDePasseEnregistre === motDePasse) return null;
    const res = await modifierAnimateur(animateur.id, {
      password: motDePasse,
      ...(animateur.passwordResetRequested ? { passwordResetRequested: false } : {}),
    });
    if (!res.success) return res.error ?? 'Le mot de passe n’a pas pu être enregistré.';
    setMotDePasseEnregistre(motDePasse);
    return null;
  }

  async function handleCopyPassword() {
    if (!newPassword) return;
    // Copier un mot de passe non enregistré revenait à transmettre un mot de
    // passe qui ne fonctionne pas.
    const erreur = await enregistrerMotDePasse(newPassword);
    if (erreur) { setEmailError(erreur); return; }
    navigator.clipboard.writeText(`Identifiant : ${animateur.username}\nMot de passe : ${newPassword}`);
    setPasswordCopied(true);
    setTimeout(() => setPasswordCopied(false), 2000);
  }

  async function handleSendEmail() {
    if (!newPassword && !resetPassword) return;
    setEmailSending(true);
    setEmailError('');
    setEmailSuccess(false);
    try {
      // Enregistrer AVANT d'envoyer : un mot de passe refusé (politique, compte
      // protégé, droits insuffisants) ne doit jamais partir par courriel.
      const erreurEnregistrement = await enregistrerMotDePasse((newPassword || resetPassword)!);
      if (erreurEnregistrement) { setEmailError(erreurEnregistrement); return; }
      const result = await envoyerIdentifiants({
        prenom: animateur.prenom,
        nom: animateur.nom,
        email: animateur.email,
        username: animateur.username,
        password: (newPassword || resetPassword)!,
        espaceAssigne: animateur.espaceAssigne,
        subject: emailSubject,
        introText: emailIntro,
      });
      if (result.success) {
        setEmailSuccess(true);
        setEmailSent(true);
      } else {
        setEmailError(`${result.error ?? "Erreur lors de l'envoi"} — le nouveau mot de passe est déjà enregistré.`);
      }
    } catch {
      setEmailError("Erreur réseau lors de l'envoi");
    } finally {
      setEmailSending(false);
    }
  }

  async function handleResetRequest() {
    // Le mot de passe affiché doit être celui du compte : il était seulement
    // généré à l'écran, jamais enregistré, et ne permettait pas de se connecter.
    const p = genererMotDePasse();
    setResetError('');
    const erreur = await enregistrerMotDePasse(p);
    if (erreur) { setResetError(erreur); return; }
    setResetPassword(p);
    setResetHandled(true);
  }

  return (
    <div>
      {/* Password reset banner */}
      {animateur.passwordResetRequested && !resetHandled && (
        <div className="bg-amber-50 border-b border-amber-300 px-8 py-3 flex items-center gap-3">
          <span className="text-amber-500 text-lg">⚠️</span>
          <p className="text-sm font-semibold text-amber-800 flex-1">
            Cet animateur a demandé une réinitialisation de mot de passe.
          </p>
          <button
            onClick={() => {
              const el = document.getElementById('reset-section');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="text-xs font-semibold text-amber-700 underline hover:text-amber-900"
          >
            Traiter →
          </button>
        </div>
      )}
      {resetHandled && (
        <div className="bg-green-50 border-b border-green-300 px-8 py-3 flex items-center gap-3">
          <span className="text-green-500 text-lg">✓</span>
          <p className="text-sm font-semibold text-green-800">Demande de réinitialisation traitée.</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-4">
          <Link
            href={retour.href}
            className="text-sm text-gray-500 hover:text-[#6B1A6E] font-semibold flex items-center gap-1.5 transition-colors"
          >
            ← {retour.label}
          </Link>
          <span className="text-gray-300">|</span>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">
              {animateur.prenom} {animateur.nom}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <StatutBadge statut={animateur.statut} />
              {effectif ? <EspaceBadge espace={animateur.espaceAssigne} /> : <span className="text-xs font-semibold text-gray-500">Administrateur</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="text-sm text-green-600 font-semibold flex items-center gap-1">✅ Enregistré</span>
          )}
          {saveError && (
            <span className="text-sm text-red-500 font-medium">{saveError}</span>
          )}
          {editMode && (
            <button onClick={() => { setEditMode(false); setEditData({ nom: animateur.nom, prenom: animateur.prenom, email: animateur.email, telephone: animateur.telephone ?? '', adresse: animateur.adresse ?? '', dateNaissance: animateur.dateNaissance ?? '', dateEmbauche: animateur.dateEmbauche ?? '', dateFinContrat: animateur.dateFinContrat ?? '', espaceAssigne: animateur.espaceAssigne, typeContrat: animateur.typeContrat, statut: animateur.statut }); }}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              Annuler
            </button>
          )}
          <button
            onClick={editMode ? handleSave : () => setEditMode(true)}
            disabled={saving}
            className={`px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
              editMode
                ? 'bg-[#6B1A6E] text-white border-[#6B1A6E] hover:bg-[#551558]'
                : 'border-gray-200 text-gray-600 hover:bg-purple-50 hover:border-[#6B1A6E] hover:text-[#6B1A6E]'
            }`}
          >
            {saving ? '⏳ Enregistrement...' : editMode ? '💾 Enregistrer' : '✏️ Modifier'}
          </button>
        </div>
      </div>

      <div className="p-8 flex gap-8 items-start">
        {/* ── Left column ── */}
        <div className="w-72 shrink-0 space-y-5">
          {/* Photo zone */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col items-center gap-3">
            {/* Avatar */}
            <div className="relative">
              <div className="w-48 h-48 rounded-2xl overflow-hidden bg-gray-100 border-2 border-gray-200 flex items-center justify-center">
                {photoUrl ? (
                  <img src={photoUrl} alt={`${animateur.prenom} ${animateur.nom}`} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-20 h-20 rounded-full bg-purple-100 flex items-center justify-center text-3xl font-extrabold text-[#6B1A6E]">
                      {animateur.prenom[0]}{animateur.nom[0]}
                    </div>
                    <span className="text-xs text-gray-400">Pas de photo</span>
                  </div>
                )}
              </div>
              {photoSaving && (
                <div className="absolute inset-0 bg-white/70 rounded-2xl flex items-center justify-center">
                  <span className="text-xs text-gray-500 font-semibold">⏳ Sauvegarde...</span>
                </div>
              )}
            </div>

            {/* Upload button */}
            <label className="w-full cursor-pointer">
              <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-[#6B1A6E]/30 hover:border-[#6B1A6E] hover:bg-purple-50 transition-all group">
                <span className="text-base">📷</span>
                <span className="text-sm font-semibold text-[#6B1A6E]">
                  {photoUrl ? 'Changer la photo' : 'Ajouter une photo'}
                </span>
              </div>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </label>

            {/* Delete button */}
            {photoUrl && (
              <button
                onClick={handlePhotoDelete}
                className="w-full text-xs text-red-500 hover:text-red-700 font-medium py-1.5 rounded-lg hover:bg-red-50 border border-red-100 transition-colors"
              >
                🗑 Supprimer la photo
              </button>
            )}
            <p className="text-[10px] text-gray-400 text-center">PNG, JPG — max 3 Mo<br/>Sauvegardé automatiquement</p>
          </div>

          {/* Info card */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Identifiant</p>
              <p className="font-mono text-sm font-bold text-[#6B1A6E] bg-purple-50 px-3 py-1.5 rounded-lg">
                @{animateur.username}
              </p>
            </div>

            <div className="flex flex-col gap-0.5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Statut</p>
              <StatutBadge statut={animateur.statut} />
            </div>

            {effectif && (
              <>
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Espace</p>
                  <EspaceBadge espace={animateur.espaceAssigne} />
                </div>

                <InfoRow label="Contrat" value={animateur.typeContrat} />
                <InfoRow label="Date d'embauche" value={formatDateShort(animateur.dateEmbauche)} />
              </>
            )}
            <InfoRow
              label="Dernière connexion"
              value={animateur.lastLogin ? formatDate(animateur.lastLogin) : <span className="text-gray-300">Jamais</span>}
            />
          </div>
        </div>

        {/* ── Right column ── */}
        <div className="flex-1 space-y-6">
          {/* Personal info */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
              <h2 className="font-bold text-gray-800 text-base">Informations personnelles</h2>
            </div>
            <div className="p-6">
              {!editMode ? (
                <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                  <InfoRow label="Prénom" value={animateur.prenom} />
                  <InfoRow label="Nom" value={animateur.nom} />
                  <InfoRow
                    label="Date de naissance"
                    value={
                      animateur.dateNaissance ? (
                        <>
                          {formatDate(animateur.dateNaissance)}{' '}
                          {age !== null && (
                            <span className="text-gray-400 text-xs">({age} ans)</span>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )
                    }
                  />
                  <InfoRow label="Email" value={<a href={`mailto:${animateur.email}`} className="text-[#6B1A6E] hover:underline">{animateur.email}</a>} />
                  <InfoRow label="Téléphone" value={animateur.telephone || <span className="text-gray-300">—</span>} />
                  <InfoRow label="Adresse" value={animateur.adresse || <span className="text-gray-300">—</span>} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <EditableField label="Prénom" value={editData.prenom} onChange={v => updateEdit('prenom', v)} />
                  <EditableField label="Nom" value={editData.nom} onChange={v => updateEdit('nom', v)} />
                  <EditableField label="Date de naissance" value={editData.dateNaissance} type="date" onChange={v => updateEdit('dateNaissance', v)} />
                  <EditableField label="Email" value={editData.email} type="email" onChange={v => updateEdit('email', v)} />
                  {estSoiMeme && editData.email !== animateur.email && (
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Votre mot de passe actuel *</span>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={motDePasseActuel}
                        onChange={e => setMotDePasseActuel(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                      <span className="text-xs text-gray-400">Demandé pour changer votre propre adresse ; vous serez ensuite reconnecté.</span>
                    </label>
                  )}
                  <EditableField label="Téléphone" value={editData.telephone} onChange={v => updateEdit('telephone', v)} />
                  <EditableField label="Adresse" value={editData.adresse} onChange={v => updateEdit('adresse', v)} />
                  {effectif && <EditableField label="Date d'embauche" value={editData.dateEmbauche} type="date" onChange={v => updateEdit('dateEmbauche', v)} />}
                  {effectif && <EditableSelect
                    label="Type de contrat"
                    value={editData.typeContrat}
                    options={TYPES_CONTRAT}
                    onChange={v => { updateEdit('typeContrat', v); if (v === 'Titulaire') updateEdit('dateFinContrat', ''); }}
                  />}
                  {effectif && contratAvecFin(editData.typeContrat) && (
                    <EditableField
                      label="Date de fin de contrat *"
                      value={editData.dateFinContrat}
                      type="date"
                      onChange={v => updateEdit('dateFinContrat', v)}
                    />
                  )}
                  {effectif && <EditableSelect label="Espace assigné" value={editData.espaceAssigne} options={['Collégiens', 'Lycéens', 'PIJ', 'CLAS', 'Tous']} onChange={v => updateEdit('espaceAssigne', v)} />}
                  <EditableSelect label="Statut" value={editData.statut} options={['actif', 'suspendu', 'inactif']} onChange={v => updateEdit('statut', v)} />
                </div>
              )}
            </div>
          </div>

          <AccesCompte animateurId={animateur.id} prenom={animateur.prenom} role={animateur.role} rubriques={animateur.rubriques} editeur={editeur} />

          {/* Account management */}
          <div id="reset-section" className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
              <h2 className="font-bold text-gray-800 text-base">Gestion du compte</h2>
            </div>
            <div className="p-6 space-y-5">
              <ChangerRole animateurId={animateur.id} prenom={animateur.prenom} role={animateur.role} editeur={editeur} />

              {/* Username */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Nom d'utilisateur
                </p>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 inline-block">
                  <span className="font-mono text-sm font-bold text-[#6B1A6E]">@{animateur.username}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">L'identifiant n'est pas modifiable.</p>
              </div>

              {/* Generate new password */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Mot de passe
                </p>
                {estSoiMeme ? (
                  <p className="text-sm text-gray-500">
                    Pour votre propre compte, utilisez « Mot de passe oublié » sur l’écran de connexion :
                    le lien part à l’adresse de votre fiche.
                  </p>
                ) : !newPassword ? (
                  <button
                    onClick={handleGeneratePassword}
                    className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-[#6B1A6E] text-white hover:bg-[#551558] transition-colors"
                  >
                    Générer un nouveau mot de passe
                  </button>
                ) : (
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Nouveau mot de passe</p>
                        <p className="font-mono text-lg font-bold text-[#6B1A6E]">{newPassword}</p>
                      </div>
                      <button
                        onClick={handleGeneratePassword}
                        className="text-gray-400 hover:text-[#6B1A6E] text-xl transition-colors"
                        title="Régénérer"
                      >
                        ↻
                      </button>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleCopyPassword}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                          passwordCopied
                            ? 'bg-green-50 border-green-300 text-green-700'
                            : 'border-gray-200 text-gray-700 hover:bg-white'
                        }`}
                      >
                        {passwordCopied ? '✓ Copié !' : 'Copier'}
                      </button>
                      <button
                        onClick={handleSendEmail}
                        disabled={emailSending}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                          emailSuccess
                            ? 'bg-green-600 text-white'
                            : emailSending
                            ? 'bg-purple-300 text-white cursor-wait'
                            : 'bg-[#6B1A6E] text-white hover:bg-[#551558]'
                        }`}
                      >
                        {emailSuccess ? '✅ Envoyé !' : emailSending ? '⏳...' : '📧 Envoyer par email'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Reset request section */}
              {animateur.passwordResetRequested && (
                <div className="border border-red-200 rounded-xl overflow-hidden">
                  <div className="bg-red-50 px-4 py-3 flex items-center gap-2 border-b border-red-200">
                    <span className="text-red-500">🔴</span>
                    <p className="text-sm font-bold text-red-700">Demande de réinitialisation reçue</p>
                  </div>
                  <div className="p-4">
                    {!resetHandled ? (
                      <>
                        <p className="text-sm text-gray-600 mb-3">
                          L'animateur a signalé un problème avec son mot de passe. Traitez la demande en générant de nouveaux identifiants.
                        </p>
                        {resetError && <p className="text-sm text-red-600 mb-2">{resetError}</p>}
                        <button
                          onClick={handleResetRequest}
                          className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
                        >
                          Traiter la demande
                        </button>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                          <p className="text-xs text-green-700 font-semibold mb-1">Demande traitée — nouveau mot de passe :</p>
                          <p className="font-mono text-base font-bold text-green-800">{resetPassword}</p>
                        </div>
                        <p className="text-xs text-gray-400">Transmettez ce mot de passe via un canal sécurisé.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Email — envoi réel */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h2 className="font-bold text-gray-800 text-base">📧 Envoyer les identifiants par email</h2>
              {emailSuccess && <span className="text-sm text-green-600 font-semibold">✅ Email envoyé !</span>}
            </div>
            <div className="p-6 space-y-4">
              {!(newPassword || resetPassword) ? (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-center">
                  <p className="text-sm text-gray-500">Générez d'abord un nouveau mot de passe pour pouvoir envoyer l'email.</p>
                </div>
              ) : (
                <>
                  {/* Personnalisation */}
                  <button
                    onClick={() => setShowEmailCustom(!showEmailCustom)}
                    className="text-sm text-[#6B1A6E] font-semibold hover:underline flex items-center gap-1"
                  >
                    {showEmailCustom ? '▼' : '▶'} Personnaliser l'email
                  </button>

                  {showEmailCustom && (
                    <div className="space-y-3 bg-purple-50 border border-purple-100 rounded-xl p-4">
                      <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Objet</label>
                        <input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6B1A6E]" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Texte d'introduction</label>
                        <textarea value={emailIntro} onChange={e => setEmailIntro(e.target.value)} rows={3}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6B1A6E] resize-none" />
                      </div>
                    </div>
                  )}

                  {/* Preview visuelle */}
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    {/* Sujet */}
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                      <strong>Objet :</strong> {emailSubject}
                    </div>
                    {/* Header violet */}
                    <div style={{ background: 'linear-gradient(135deg, #6B1A6E, #1B3870)' }} className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <img src="/logo-pj.png" alt="" className="w-10 h-10 rounded-xl bg-white/20 p-1" />
                        <div>
                          <div className="text-white/60 text-[10px] font-medium uppercase tracking-wider">Mairie de Nogent-sur-Marne</div>
                          <div className="text-white font-bold text-sm">PÔLE JEUNESSE</div>
                        </div>
                      </div>
                      <div className="flex mt-3 rounded-full overflow-hidden h-1">
                        <div className="bg-[#6B1A6E] flex-[3]" />
                        <div className="bg-[#8DC63F] flex-1" />
                        <div className="bg-[#29B5E8] flex-1" />
                      </div>
                    </div>
                    {/* Corps */}
                    <div className="px-6 py-5 bg-white space-y-4">
                      <p className="text-sm text-gray-800 font-semibold">Bonjour {animateur.prenom} 👋</p>
                      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{emailIntro}</p>
                      {/* Bloc identifiants */}
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-24">Identifiant :</span>
                          <span className="font-mono text-sm font-bold text-[#6B1A6E]">{animateur.username}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-24">Mot de passe :</span>
                          <span className="font-mono text-sm font-bold text-[#1B3870]">{newPassword || resetPassword}</span>
                        </div>
                      </div>
                      {/* Bouton */}
                      <div className="text-center">
                        <span className="inline-block px-6 py-2.5 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: '#6B1A6E' }}>
                          Se connecter →
                        </span>
                      </div>
                    </div>
                    {/* Signature */}
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
                      <p className="text-xs text-gray-500">Xavier GERINETTE — Pôle Jeunesse — Mairie de Nogent-sur-Marne</p>
                    </div>
                  </div>

                  {/* Actions */}
                  {emailError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">❌ {emailError}</div>
                  )}
                  {emailSuccess && (
                    <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700">
                      ✅ Email envoyé avec succès à <strong>{animateur.email}</strong>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={handleSendEmail}
                      disabled={emailSending || emailSuccess}
                      className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                        emailSuccess
                          ? 'bg-green-600 text-white cursor-default'
                          : emailSending
                          ? 'bg-purple-300 text-white cursor-wait'
                          : 'bg-[#6B1A6E] text-white hover:bg-[#551558]'
                      }`}
                    >
                      {emailSuccess ? '✅ Envoyé !' : emailSending ? '⏳ Envoi en cours...' : '📧 Envoyer les identifiants'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
