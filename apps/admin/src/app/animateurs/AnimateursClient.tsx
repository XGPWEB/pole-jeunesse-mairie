'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { envoyerIdentifiants, envoyerReinitialisationMdp } from './emailActions';
import { creerAnimateur, modifierAnimateur, supprimerAnimateur } from './actions';
import ChoixRubriques, { resumeAcces, rubriquesParDefaut, type Editeur } from './ChoixRubriques';
import type { RoleRubriques } from '@/lib/rubriques';
import Field from '@/components/Field';
import { genererMotDePasse } from '@/lib/password';

interface AnimateurCompte {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  dateNaissance: string;
  adresse: string;
  espaceAssigne: string | null;
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
  /** null = menu complet de son rôle. */
  rubriques: string[] | null;
}

const roleDe = (a: { role: string }): RoleRubriques => (a.role === 'admin' ? 'admin' : 'animateur');

interface Props {
  /**
   * Comptes d'un seul rôle : les animateurs (page Équipe) ou les
   * administrateurs (Administration › Administrateurs). Un administrateur
   * supervise et ne fait pas partie des effectifs : ni espace, ni contrat.
   */
  role: RoleRubriques;
  animateurs: AnimateurCompte[];
  /** Admin connecté : il n'accorde que les rubriques qu'il a lui-même. */
  editeur: Editeur;
}

function generateUsername(prenom: string, nom: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '');
  return `${clean(prenom)}.${clean(nom)}`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Seuil "en ligne" : dernière connexion < 30 min
function isOnline(lastLogin?: string): boolean {
  if (!lastLogin) return false;
  return Date.now() - new Date(lastLogin).getTime() < 30 * 60 * 1000;
}

const ESPACE_BADGE: Record<string, { bg: string; text: string }> = {
  Collégiens: { bg: 'bg-purple-100', text: 'text-[#6B1A6E]' },
  Lycéens: { bg: 'bg-blue-100', text: 'text-[#1B3870]' },
  PIJ: { bg: 'bg-sky-100', text: 'text-[#29B5E8]' },
  CLAS: { bg: 'bg-green-100', text: 'text-[#8DC63F]' },
  Tous: { bg: 'bg-gray-100', text: 'text-gray-600' },
};

function EspaceBadge({ espace }: { espace: string }) {
  const style = ESPACE_BADGE[espace] ?? { bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}>
      {espace}
    </span>
  );
}

function StatutBadge({ statut }: { statut: string }) {
  if (statut === 'actif') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        Actif
      </span>
    );
  }
  if (statut === 'suspendu') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
        Suspendu
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
      Inactif
    </span>
  );
}

function Avatar({ prenom, nom, photoUrl }: { prenom: string; nom: string; photoUrl?: string | null }) {
  if (photoUrl) {
    return (
      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 border border-gray-200">
        <img src={photoUrl} alt={`${prenom} ${nom}`} className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center text-sm font-bold text-[#6B1A6E] shrink-0 select-none">
      {prenom[0]}{nom[0]}
    </div>
  );
}

// ─── Credential modal ────────────────────────────────────────────────────────

interface CredentialModalProps {
  animateur: AnimateurCompte;
  onClose: () => void;
}

function CredentialModal({ animateur, onClose }: CredentialModalProps) {
  const [password, setPassword] = useState(() => genererMotDePasse());
  const [toastMsg, setToastMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailResult, setEmailResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [emailError, setEmailError] = useState('');
  const [emailSubject, setEmailSubject] = useState('Vos identifiants Pôle Jeunesse');
  const [emailIntroText, setEmailIntroText] = useState(
    'Ton compte animateur a été créé / mis à jour.\nVoici tes identifiants de connexion :'
  );
  const [showEditFields, setShowEditFields] = useState(false);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2500);
  }

  function handleCopy() {
    navigator.clipboard.writeText(`Identifiant : ${animateur.username}\nMot de passe : ${password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Convert newlines to <br/> for HTML email
  const introHtml = emailIntroText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');

  async function handleSendEmail() {
    setSending(true);
    setEmailResult('idle');
    const result = await envoyerIdentifiants({
      prenom: animateur.prenom,
      nom: animateur.nom,
      email: animateur.email,
      username: animateur.username,
      password,
      espaceAssigne: animateur.espaceAssigne ?? '',
      subject: emailSubject,
      introText: introHtml,
    });
    setSending(false);
    if (result.success) {
      setEmailResult('success');
      showToast(`✉️ Email envoyé à ${animateur.email}`);
    } else {
      setEmailResult('error');
      setEmailError(result.error ?? 'Erreur inconnue');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      {toastMsg && (
        <div className="fixed top-6 right-6 z-60 bg-green-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-semibold animate-fade-in">
          {toastMsg}
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-[#6B1A6E] px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-white font-bold text-lg">Envoyer les identifiants</h2>
            <p className="text-purple-200 text-sm mt-0.5">
              {animateur.prenom} {animateur.nom} &middot; {animateur.email}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-purple-200 hover:text-white text-xl font-bold leading-none"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Identifiant
            </label>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
              <span className="font-mono text-sm text-gray-800 flex-1">{animateur.username}</span>
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Nouveau mot de passe
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
                <span className="font-mono text-sm font-bold text-[#6B1A6E]">{password}</span>
              </div>
              <button
                onClick={() => setPassword(genererMotDePasse())}
                className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:border-[#6B1A6E] hover:text-[#6B1A6E] transition-colors"
                title="Régénérer"
              >
                ↻
              </button>
            </div>
          </div>

          {/* Editable email fields */}
          <div>
            <button
              onClick={() => setShowEditFields(!showEditFields)}
              className="flex items-center gap-2 text-xs font-semibold text-[#6B1A6E] hover:text-[#551558] transition-colors mb-2"
            >
              <span className={`transition-transform ${showEditFields ? 'rotate-90' : ''}`}>&#9654;</span>
              Personnaliser l&apos;email
            </button>
            {showEditFields && (
              <div className="space-y-3 border border-purple-100 rounded-lg p-3 bg-purple-50/30">
                <Field label="Objet de l'email">
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]"
                  />
                </Field>
                <Field label="Texte d'introduction" hint="Les retours a la ligne sont conserves dans l'email.">
                  <textarea
                    value={emailIntroText}
                    onChange={(e) => setEmailIntroText(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E] resize-none"
                  />
                </Field>
              </div>
            )}
          </div>

          {/* Aperçu email visuel — real-time preview */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Aperçu de l&apos;email
            </label>
            <div className="border border-gray-200 rounded-xl overflow-hidden text-xs shadow-sm">
              {/* Subject bar */}
              <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center gap-2">
                <span className="text-[10px] font-semibold text-gray-400 uppercase">Objet :</span>
                <span className="text-xs text-gray-700 font-medium">{emailSubject}</span>
              </div>
              {/* Header violet + logo */}
              <div className="bg-[#6B1A6E] px-4 py-3 flex justify-center">
                <img src="/logo-pj.png" alt="Pôle Jeunesse" className="h-10 object-contain" />
              </div>
              {/* Bande tricolore */}
              <div className="flex h-1">
                <div className="bg-[#1B3870] flex-[3]" />
                <div className="bg-[#8DC63F] flex-1" />
                <div className="bg-[#29B5E8] flex-1" />
              </div>
              {/* Corps */}
              <div className="bg-white px-4 py-3 space-y-2">
                <p className="font-bold text-gray-900 text-sm">Bonjour {animateur.prenom} &#x1F44B;</p>
                <p
                  className="text-gray-500 text-xs leading-relaxed whitespace-pre-line"
                  dangerouslySetInnerHTML={{ __html: introHtml }}
                />
                <div className="bg-[#f8f5fc] border border-[#e2d9f3] rounded-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-[#e2d9f3]">
                    <div className="text-[9px] font-bold text-[#9b7fb6] uppercase tracking-wider mb-0.5">Identifiant</div>
                    <div className="font-mono font-bold text-gray-900">{animateur.username}</div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-[9px] font-bold text-[#9b7fb6] uppercase tracking-wider mb-0.5">Mot de passe</div>
                    <div className="font-mono font-bold text-[#6B1A6E] tracking-widest">{password}</div>
                  </div>
                </div>
                <div className="text-center py-1">
                  <span className="inline-block bg-[#1B3870] text-white font-bold text-xs px-4 py-2 rounded-lg">
                    &#x1F511; Se connecter
                  </span>
                  {/* Adresse réelle du site, celle que l'e-mail contiendra (APP_BASE_URL) */}
                  <p className="text-[10px] text-[#6B1A6E] mt-1">{typeof window !== 'undefined' ? `${window.location.origin}/` : ''}</p>
                </div>
              </div>
              {/* Signature */}
              <div className="bg-[#f9f7fc] border-t border-[#ede9f5] px-4 py-2">
                <p className="font-bold text-gray-900 text-xs">Xavier GERINETTE</p>
                <p className="text-gray-400 text-[10px]">Pole Jeunesse — Mairie de Nogent-sur-Marne</p>
              </div>
            </div>
          </div>

          {/* Resultat email */}
          {emailResult === 'success' && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-green-700">
              <span>&#x2705;</span>
              <span>Email envoye avec succes a <strong>{animateur.email}</strong></span>
            </div>
          )}
          {emailResult === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <strong>Echec de l&apos;envoi :</strong> {emailError}<br/>
              <span className="text-xs text-red-500 mt-1 block">Verifiez la configuration SMTP dans .env.local</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={handleCopy}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                copied
                  ? 'bg-green-50 border-green-300 text-green-700'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {copied ? '✓ Copié !' : '📋 Copier les identifiants'}
            </button>
            <button
              onClick={handleSendEmail}
              disabled={sending || emailResult === 'success'}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                emailResult === 'success'
                  ? 'bg-green-600 text-white cursor-default'
                  : sending
                  ? 'bg-purple-300 text-white cursor-wait'
                  : 'bg-[#6B1A6E] text-white hover:bg-[#551558]'
              }`}
            >
              {emailResult === 'success'
                ? '✓ Envoyé !'
                : sending
                ? '⏳ Envoi en cours...'
                : '📧 Envoyer les identifiants'}
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-lg text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reset modal ─────────────────────────────────────────────────────────────

interface ResetModalProps {
  animateur: AnimateurCompte;
  onClose: () => void;
}

function ResetModal({ animateur, onClose }: ResetModalProps) {
  const [password] = useState(() => genererMotDePasse());
  const [sending, setSending] = useState(false);
  // Deux échecs à ne pas confondre :
  //  - « non-enregistre » : le compte garde son ancien mot de passe ; celui
  //    affiché ne fonctionne pas et ne doit être transmis par aucun moyen ;
  //  - « echec-envoi » : il est enregistré, seul le courriel a échoué ; le
  //    transmettre de vive voix est alors le secours prévu.
  const [resultat, setResultat] = useState<'attente' | 'envoye' | 'non-enregistre' | 'echec-envoi'>('attente');
  const [erreur, setErreur] = useState('');

  async function handleReset() {
    setSending(true);
    // Enregistrer d'abord : rien ne part si l'enregistrement est refusé.
    let enregistrement: { success: boolean; error?: string };
    try {
      enregistrement = await modifierAnimateur(animateur.id, { password, passwordResetRequested: false });
    } catch {
      enregistrement = { success: false, error: 'Enregistrement non confirmé (erreur réseau) : rouvrez la demande pour réessayer.' };
    }
    if (!enregistrement.success) {
      setSending(false);
      setResultat('non-enregistre');
      setErreur(enregistrement.error ?? 'Le mot de passe n’a pas pu être enregistré.');
      return;
    }
    let envoi: { success: boolean; error?: string };
    try {
      envoi = await envoyerReinitialisationMdp({
        prenom: animateur.prenom,
        nom: animateur.nom,
        email: animateur.email,
        username: animateur.username,
        password,
      });
    } catch {
      envoi = { success: false, error: 'Erreur réseau lors de l’envoi.' };
    }
    setSending(false);
    setResultat(envoi.success ? 'envoye' : 'echec-envoi');
    if (!envoi.success) setErreur(envoi.error ?? 'Erreur inconnue');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="bg-orange-500 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-lg">Réinitialisation demandée</h2>
            <p className="text-orange-100 text-sm mt-0.5">
              {animateur.prenom} {animateur.nom}
            </p>
          </div>
          <button onClick={onClose} className="text-orange-100 hover:text-white text-xl font-bold leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
            <strong>Demande reçue</strong> — Cet animateur a demandé une réinitialisation de son mot de passe.
          </div>
          {resultat === 'attente' ? (
            <>
              <p className="text-sm text-gray-600">
                Un nouveau mot de passe va être généré et <strong>envoyé automatiquement</strong> à <span className="text-[#6B1A6E] font-medium">{animateur.email}</span>.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500 mb-1">Nouveau mot de passe qui sera envoyé :</p>
                <p className="font-mono text-base font-bold text-[#6B1A6E]">{password}</p>
              </div>
              <button
                onClick={handleReset}
                disabled={sending}
                className={`w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${sending ? 'bg-orange-300 cursor-wait' : 'bg-orange-500 hover:bg-orange-600'} text-white`}
              >
                {sending ? '⏳ Envoi en cours...' : '✉️ Générer et envoyer par email'}
              </button>
            </>
          ) : (
            <>
              {resultat === 'envoye' && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  <p className="text-sm text-green-700 font-semibold mb-1">✅ Email envoyé avec succès !</p>
                  <p className="text-xs text-green-600">Le nouveau mot de passe a été envoyé à <strong>{animateur.email}</strong></p>
                </div>
              )}
              {resultat === 'non-enregistre' && (
                <div role="alert" className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <p className="text-sm text-red-700 font-semibold">⚠️ Mot de passe non enregistré</p>
                  <p className="text-xs text-red-600 mt-1">{erreur}</p>
                  <p className="text-xs text-red-600 mt-2">
                    Le compte garde son mot de passe actuel. Rien n’a été envoyé : ne transmettez pas le mot de passe proposé, il ne fonctionne pas.
                  </p>
                </div>
              )}
              {resultat === 'echec-envoi' && (
                <div className="space-y-3">
                  <div role="alert" className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                    <p className="text-sm text-red-700 font-semibold">⚠️ Échec de l'envoi email</p>
                    <p className="text-xs text-red-600 mt-1">{erreur}</p>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                    <p className="text-xs text-gray-500 mb-1">Le nouveau mot de passe est enregistré. Communiquez-le manuellement :</p>
                    <p className="font-mono text-base font-bold text-[#6B1A6E]">{password}</p>
                  </div>
                </div>
              )}
            </>
          )}
          <button onClick={onClose} className="w-full px-4 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create animateur modal ───────────────────────────────────────────────────

function CreateModal({ onClose, editeur, role }: { onClose: () => void; editeur: Editeur; role: RoleRubriques }) {
  const TYPES_CONTRAT = ['Titulaire', 'Emploi temporaire', 'Vacataire', "Contrat d'apprentissage", 'Stagiaire'];
  const contratAvecFinObligatoire = (type: string) => type !== 'Titulaire';
  // Un administrateur supervise : ni espace, ni contrat, ni date d'embauche.
  const effectif = role !== 'admin';

  const [form, setForm] = useState({
    prenom: '',
    nom: '',
    email: '',
    telephone: '',
    dateNaissance: '',
    adresse: '',
    espaceAssigne: 'Collégiens',
    typeContrat: 'Titulaire',
    dateEmbauche: '',
    dateFinContrat: '',
  });
  // Par défaut, tout ce que l'auteur peut accorder est coché.
  const [rubriques, setRubriques] = useState<string[]>(() => rubriquesParDefaut(role, editeur));
  const [generatedPassword, setGeneratedPassword] = useState(() => genererMotDePasse());
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [copied, setCopied] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('Image trop lourde. Maximum 3 Mo.'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  const username = generateUsername(form.prenom, form.nom);
  const usernamePreview = form.prenom && form.nom ? username : 'prenom.nom';

  function update(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    const droits = editeur.gereDroits ? { role, rubriques } : {};
    const result = await creerAnimateur({ ...form, ...droits, password: generatedPassword, photoUrl: photoPreview });
    setSaving(false);
    if (result.success) {
      setSubmitted(true);
    } else {
      setSaveError(result.error ?? 'Erreur lors de la création');
    }
  }

  async function handleSendEmail() {
    setEmailSending(true);
    const result = await envoyerIdentifiants({
      prenom: form.prenom,
      nom: form.nom,
      email: form.email,
      username: usernamePreview,
      password: generatedPassword,
      espaceAssigne: effectif ? form.espaceAssigne : '',
    });
    setEmailSending(false);
    setEmailResult(result.success ? 'success' : 'error');
  }

  function handleCopy() {
    navigator.clipboard.writeText(`Identifiant : ${usernamePreview}\nMot de passe : ${generatedPassword}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-[#6B1A6E] px-6 py-4 flex items-center justify-between shrink-0">
          <h2 className="text-white font-bold text-lg">{role === 'admin' ? 'Nouvel administrateur' : 'Nouvel animateur'}</h2>
          <button onClick={onClose} className="text-purple-200 hover:text-white text-xl font-bold leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1">
          {!submitted ? (
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Identité */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prénom" required>
                  <input
                    value={form.prenom}
                    onChange={e => update('prenom', e.target.value)}
                    placeholder="Marie"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                  />
                </Field>
                <Field label="Nom" required>
                  <input
                    value={form.nom}
                    onChange={e => update('nom', e.target.value)}
                    placeholder="Dupont"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                  />
                </Field>
              </div>

              {/* Contact */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email professionnel" required>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => update('email', e.target.value)}
                    placeholder="marie.dupont@ville-nogentsurmarne.fr"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                  />
                </Field>
                <Field label="Téléphone">
                  <input
                    value={form.telephone}
                    onChange={e => update('telephone', e.target.value)}
                    placeholder="06 12 34 56 78"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Date de naissance">
                  <input
                    type="date"
                    value={form.dateNaissance}
                    onChange={e => update('dateNaissance', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                  />
                </Field>
                {effectif && <Field label="Date d'embauche">
                  <input
                    type="date"
                    value={form.dateEmbauche}
                    onChange={e => update('dateEmbauche', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                  />
                </Field>}
              </div>

              <Field label="Adresse">
                <input
                  value={form.adresse}
                  onChange={e => update('adresse', e.target.value)}
                  placeholder="12 rue des Lilas, 94130 Nogent-sur-Marne"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                />
              </Field>

              {effectif && <div className="grid grid-cols-2 gap-4">
                <Field label="Espace assigné">
                  <select
                    value={form.espaceAssigne}
                    onChange={e => update('espaceAssigne', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                  >
                    <option>Collégiens</option>
                    <option>Lycéens</option>
                    <option>PIJ</option>
                    <option>CLAS</option>
                    <option>Tous</option>
                  </select>
                </Field>
                <Field label="Type de contrat">
                  <select
                    value={form.typeContrat}
                    onChange={e => { update('typeContrat', e.target.value); if (e.target.value === 'Titulaire') update('dateFinContrat', ''); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                  >
                    {TYPES_CONTRAT.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Field>
              </div>}

              {/* Date de fin de contrat — obligatoire si pas Titulaire */}
              {effectif && contratAvecFinObligatoire(form.typeContrat) && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Date de fin de contrat" required>
                    <input
                      type="date"
                      value={form.dateFinContrat}
                      onChange={e => update('dateFinContrat', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                    />
                  </Field>
                  <div className="flex items-end pb-1">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 w-full">
                      ⚠️ Contrat à durée déterminée — date de fin obligatoire
                    </div>
                  </div>
                </div>
              )}

              {editeur.gereDroits ? (
                <div>
                  <p className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Accès au menu</p>
                  <ChoixRubriques
                    role={role}
                    rubriques={rubriques}
                    editeur={editeur}
                    prenom={form.prenom || undefined}
                    onRubriques={setRubriques}
                  />
                </div>
              ) : (
                <p className="text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded-lg px-3 py-2">
                  Le compte est créé comme animateur, avec le menu animateur limité aux rubriques que vous avez vous-même. Son rôle et ses rubriques sont réglés par le compte qui gère les droits.
                </p>
              )}

              {/* Photo de profil */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Photo de profil <span className="text-gray-400 font-normal normal-case">(optionnel)</span>
                </label>
                <div className="flex items-center gap-4">
                  {/* Preview */}
                  <div className="relative w-16 h-16 rounded-full overflow-hidden bg-purple-100 flex items-center justify-center shrink-0 border-2 border-purple-200">
                    {photoPreview ? (
                      <img src={photoPreview} alt="Aperçu" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xl font-bold text-[#6B1A6E] select-none">
                        {form.prenom && form.nom ? `${form.prenom[0]}${form.nom[0]}` : '?'}
                      </span>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 hover:border-[#6B1A6E] hover:text-[#6B1A6E] transition-colors">
                      <span>📷</span>
                      <span>{photoPreview ? 'Changer la photo' : 'Ajouter une photo'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handlePhotoUpload}
                      />
                    </label>
                    {photoPreview && (
                      <button
                        type="button"
                        onClick={() => setPhotoPreview(null)}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-100 text-sm text-red-500 hover:bg-red-50 hover:border-red-300 transition-colors"
                      >
                        <span>🗑</span>
                        <span>Supprimer</span>
                      </button>
                    )}
                  </div>
                  {photoPreview && (
                    <div className="ml-auto text-xs text-green-600 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                      Photo prête
                    </div>
                  )}
                </div>
              </div>

              {/* Account preview */}
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-[#6B1A6E] uppercase tracking-wide">Identifiants générés automatiquement</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Nom d'utilisateur</p>
                    <p className="font-mono text-sm font-bold text-[#6B1A6E]">{usernamePreview}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Mot de passe</p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-bold text-[#6B1A6E]">{generatedPassword}</p>
                      <button
                        type="button"
                        onClick={() => setGeneratedPassword(genererMotDePasse())}
                        className="text-xs text-gray-400 hover:text-[#6B1A6E] transition-colors"
                        title="Régénérer"
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${saving ? 'bg-purple-300 cursor-wait text-white' : 'bg-[#6B1A6E] text-white hover:bg-[#551558]'}`}
                >
                  {saving ? '⏳ Création...' : 'Créer le compte'}
                </button>
              </div>
              {saveError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">⚠️ {saveError}</div>
              )}
            </form>
          ) : (
            /* Success state */
            <div className="p-6 space-y-5">
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-green-100 flex items-center justify-center text-2xl mb-3 border-2 border-green-200">
                  {photoPreview
                    ? <img src={photoPreview} alt="Photo" className="w-full h-full object-cover" />
                    : '✓'
                  }
                </div>
                <h3 className="text-lg font-bold text-gray-800">Compte créé et enregistré !</h3>
                <p className="text-sm text-gray-500 mt-1">{form.prenom} {form.nom} est maintenant dans la base de données.</p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Identifiant</span>
                  <span className="font-mono font-bold text-[#6B1A6E]">{usernamePreview}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Mot de passe</span>
                  <span className="font-mono font-bold text-[#6B1A6E]">{generatedPassword}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Email</span>
                  <span className="font-medium text-gray-800">{form.email}</span>
                </div>
                {effectif && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Espace</span>
                    <span className="font-medium text-gray-800">{form.espaceAssigne}</span>
                  </div>
                )}
              </div>

              {emailResult === 'success' && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
                  ✅ Email envoyé à <strong>{form.email}</strong>
                </div>
              )}
              {emailResult === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">⚠️ Échec de l'envoi email — les identifiants sont bien enregistrés.</div>
              )}

              <div className="flex gap-3">
                <button onClick={handleCopy}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${copied ? 'bg-green-50 border-green-300 text-green-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                  {copied ? '✓ Copié !' : '📋 Copier identifiants'}
                </button>
                <button onClick={handleSendEmail} disabled={emailSending || emailResult === 'success'}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${emailResult === 'success' ? 'bg-green-600 text-white cursor-default' : emailSending ? 'bg-purple-300 text-white cursor-wait' : 'bg-[#6B1A6E] text-white hover:bg-[#551558]'}`}>
                  {emailResult === 'success' ? '✓ Envoyé' : emailSending ? '⏳ Envoi...' : '✉️ Envoyer par email'}
                </button>
              </div>

              <button onClick={() => { onClose(); window.location.reload(); }}
                className="w-full px-4 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors">
                Fermer et actualiser la liste
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AnimateursClient({ role: onglet, animateurs: initialAnimateurs, editeur, initialEspace = 'tous' }: Props & { initialEspace?: string }) {
  const [animateurs, setAnimateurs] = useState(initialAnimateurs);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('tous');
  const [filterEspace, setFilterEspace] = useState(initialEspace);
  const [credModalAnim, setCredModalAnim] = useState<AnimateurCompte | null>(null);
  const [resetModalAnim, setResetModalAnim] = useState<AnimateurCompte | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Seul le compte qui gère les droits crée des administrateurs.
  const peutCreer = onglet === 'animateur' || editeur.gereDroits;
  const effectif = onglet !== 'admin';

  async function handleDelete(a: AnimateurCompte) {
    if (!confirm(`Supprimer définitivement le compte de ${a.prenom} ${a.nom} ?\n\nCette action est irréversible.`)) return;
    setDeletingId(a.id);
    const result = await supprimerAnimateur(a.id);
    setDeletingId(null);
    if (result.success) {
      setAnimateurs(prev => prev.filter(x => x.id !== a.id));
    } else {
      alert(`Erreur : ${result.error}`);
    }
  }

  const duOnglet = animateurs.filter(a => roleDe(a) === onglet);

  // Stats
  const total = duOnglet.length;
  const actifs = duOnglet.filter(a => a.statut === 'actif').length;
  const espacesCoverts = new Set(
    duOnglet.filter(a => a.statut === 'actif').map(a => a.espaceAssigne)
  ).size;
  const resetRequests = duOnglet.filter(a => a.passwordResetRequested).length;

  // Filters
  const filtered = duOnglet.filter(a => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      a.nom.toLowerCase().includes(q) ||
      a.prenom.toLowerCase().includes(q) ||
      a.email.toLowerCase().includes(q) ||
      a.username.toLowerCase().includes(q);

    const matchStatut = filterStatut === 'tous' || a.statut === filterStatut;
    const matchEspace =
      filterEspace === 'tous' ||
      (a.espaceAssigne ?? '').toLowerCase() === filterEspace.toLowerCase();

    return matchSearch && matchStatut && matchEspace;
  });

  return (
    <div>
      {/* Modals */}
      {credModalAnim && (
        <CredentialModal animateur={credModalAnim} onClose={() => setCredModalAnim(null)} />
      )}
      {resetModalAnim && (
        <ResetModal animateur={resetModalAnim} onClose={() => setResetModalAnim(null)} />
      )}
      {showCreate && <CreateModal editeur={editeur} role={onglet} onClose={() => setShowCreate(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-gray-200 bg-white">
        <div>
          <p className="text-sm text-gray-500">
            {total} {onglet === 'admin' ? 'administrateur' : 'animateur'}{total > 1 ? 's' : ''} enregistré{total > 1 ? 's' : ''}
          </p>
        </div>
        {peutCreer && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#6B1A6E] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#551558] flex items-center gap-2 transition-colors"
          >
            {onglet === 'admin' ? '+ Nouvel administrateur' : '+ Nouvel animateur'}
          </button>
        )}
      </div>

      <div className="p-8 space-y-6">
        {/* Stats */}
        <div className={`grid ${effectif ? 'grid-cols-4' : 'grid-cols-3'} gap-5`}>
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center text-2xl">👥</div>
            <div>
              <div className="text-3xl font-extrabold text-[#6B1A6E]">{total}</div>
              <div className="text-sm text-gray-500 font-medium mt-0.5">{onglet === 'admin' ? 'Total administrateurs' : 'Total animateurs'}</div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center text-2xl">✅</div>
            <div>
              <div className="text-3xl font-extrabold text-green-600">{actifs}</div>
              <div className="text-sm text-gray-500 font-medium mt-0.5">Actifs</div>
            </div>
          </div>
          {effectif && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-sky-100 flex items-center justify-center text-2xl">🏠</div>
              <div>
                <div className="text-3xl font-extrabold text-[#29B5E8]">{espacesCoverts}</div>
                <div className="text-sm text-gray-500 font-medium mt-0.5">Espaces couverts</div>
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center text-2xl">🔑</div>
            <div>
              <div className={`text-3xl font-extrabold ${resetRequests > 0 ? 'text-orange-500' : 'text-gray-400'}`}>
                {resetRequests}
              </div>
              <div className="text-sm text-gray-500 font-medium mt-0.5">Demandes réinitialisation</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher — nom, prénom, email, identifiant…"
            className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
          />
          <select
            value={filterStatut}
            onChange={e => setFilterStatut(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-600 focus:outline-none focus:border-[#6B1A6E]"
          >
            <option value="tous">Tous les statuts</option>
            <option value="actif">Actif</option>
            <option value="inactif">Inactif</option>
            <option value="suspendu">Suspendu</option>
          </select>
          {effectif && (
            <select
              value={filterEspace}
              onChange={e => setFilterEspace(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-600 focus:outline-none focus:border-[#6B1A6E]"
            >
              <option value="tous">Tous les espaces</option>
              <option value="Collégiens">Collégiens</option>
              <option value="Lycéens">Lycéens</option>
              <option value="PIJ">PIJ</option>
              <option value="CLAS">CLAS</option>
            </select>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">{onglet === 'admin' ? 'Administrateur' : 'Animateur'}</th>
                {effectif && <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Espace</th>}
                {effectif && <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Contrat</th>}
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Statut</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Accès au menu</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Connexion</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={effectif ? 7 : 5} className="text-center text-gray-400 text-sm py-12">
                    {onglet === 'admin' ? 'Aucun administrateur' : 'Aucun animateur'} ne correspond aux filtres.
                  </td>
                </tr>
              ) : (
                filtered.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    {/* Animateur */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar prenom={a.prenom} nom={a.nom} photoUrl={a.photoUrl} />
                        <div>
                          <div className="font-semibold text-gray-800">
                            {a.prenom} {a.nom}
                            {a.passwordResetRequested && (
                              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-semibold">
                                MDP demandé
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 font-mono">@{a.username}</div>
                        </div>
                      </div>
                    </td>
                    {effectif && (
                      <td className="px-5 py-3.5">
                        <EspaceBadge espace={a.espaceAssigne ?? ''} />
                      </td>
                    )}
                    {effectif && (
                      <td className="px-5 py-3.5">
                        <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded">
                          {a.typeContrat}
                        </span>
                      </td>
                    )}
                    {/* Statut */}
                    <td className="px-5 py-3.5">
                      <StatutBadge statut={a.statut} />
                    </td>
                    {/* Accès au menu */}
                    <td className="px-5 py-3.5">
                      {(() => {
                        const resume = resumeAcces(roleDe(a), a.rubriques);
                        return <span className={`text-xs ${resume === 'Menu complet' ? 'text-gray-500' : 'text-amber-700 font-medium'}`}>{resume}</span>;
                      })()}
                    </td>
                    {/* Connexion */}
                    <td className="px-5 py-3.5">
                      {isOnline(a.lastLogin) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                          En ligne
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                          <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                          {a.lastLogin ? formatDate(a.lastLogin) : 'Jamais connecté'}
                        </span>
                      )}
                    </td>
                    {/* Actions */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/admin/animateurs/${a.id}`}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-purple-50 hover:border-[#6B1A6E] hover:text-[#6B1A6E] transition-colors"
                        >
                          Fiche
                        </Link>
                        <button
                          onClick={() => setCredModalAnim(a)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-600 transition-colors"
                        >
                          MDP
                        </button>
                        {a.passwordResetRequested && (
                          <button
                            onClick={() => setResetModalAnim(a)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-orange-600 border border-orange-200 bg-orange-50 hover:bg-orange-100 transition-colors"
                          >
                            Réinitialiser
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(a)}
                          disabled={deletingId === a.id}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-500 border border-red-200 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-40"
                          title="Supprimer ce profil"
                        >
                          {deletingId === a.id ? '…' : '🗑'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <p className="text-xs text-gray-400 text-right">
            {filtered.length} {onglet === 'admin' ? 'administrateur' : 'animateur'}{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''}
            {filtered.length < total ? ` sur ${total}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
