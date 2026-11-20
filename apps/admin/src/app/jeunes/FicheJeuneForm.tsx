'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { creerJeune, modifierJeune } from './actions';
import Field from '@/components/Field';
import { SANTE_VIDE, type SanteJeune, type Vaccin } from '@/lib/jeune-sante';
import { cleNom, type ChampsFicheAgora, type TypeFicheAgoraLue } from '@/lib/fiches-agora-lecture';
import { proposerEspace } from '@/lib/espace-age';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Contact {
  nom: string;
  lien: string;
  telephone: string;
  email: string;
}

interface FormData extends SanteJeune {
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: 'M' | 'F' | '';
  espaceId: string;
  etablissement: string;
  classe: string;
  adresse: string;
  secteur: string;
  contacts: Contact[];
  autorisationSortie: boolean;
  autorisationPhoto: boolean;
  autorisationSoinsBenins: boolean;
  observations: string;
}

/** Espace proposé dans la liste : ceux de la commune, fournis par la page (audit 2026-10-07, A4). */
export interface EspaceOption { id: string; nom: string; trancheAge?: string | null }

const SECTEURS = [
  'Le Bois Baltard',
  'Les Viselets',
  'Village',
  'Marne Beauté',
  'Plaisance Mairie',
];

const LIENS = ['Mère', 'Père', 'Tuteur légal', 'Grand-parent', 'Autre'];

const EMPTY_CONTACT: Contact = { nom: '', lien: 'Mère', telephone: '', email: '' };

// ─── Éditions AGORA (fiche enfant, fiche santé) ───────────────────────────────

type Piece = TypeFicheAgoraLue;
interface Fichier { dataUri: string; nom: string }
interface Message { ton: 'ok' | 'info' | 'erreur'; texte: string }

const PIECES: { cle: Piece; titre: string; aide: string }[] = [
  { cle: 'enfant', titre: 'Fiche enfant', aide: 'Identité, adresse, responsables, contacts, autorisations' },
  { cle: 'sante',  titre: 'Fiche santé',  aide: 'Vaccins, médecin traitant, assurance, allergies' },
];
const TYPES_ACCEPTES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

function lireEnDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const contient = (a: string, b: string) => a === '' || b === '' || a.includes(b) || b.includes(a);

/**
 * Une fiche santé déposée sur la fiche d'un AUTRE jeune y inscrirait ses
 * allergies et son médecin : on refuse dès que l'identité lue contredit celle
 * déjà saisie (nom, prénom ou date de naissance).
 */
function memeJeune(form: FormData, champs: ChampsFicheAgora): boolean {
  if (!contient(cleNom(form.nom), cleNom(champs.nom ?? ''))) return false;
  if (!contient(cleNom(form.prenom), cleNom(champs.prenom ?? ''))) return false;
  return !(form.dateNaissance && champs.dateNaissance && form.dateNaissance !== champs.dateNaissance);
}

const CHAMPS_IDENTITE = ['nom', 'prenom', 'dateNaissance', 'lieuNaissance', 'sexe', 'adresse'] as const;
const CHAMPS_TEXTE = [
  'etablissement', 'classe', 'regimes', 'maladies', 'allergies', 'medecinNom', 'medecinTelephone',
  'assuranceCompagnie', 'assurancePolice', 'hospitalisation', 'lieuHospitalisation',
] as const;
const CHAMPS_AUTORISATIONS = [
  'autorisationPhoto', 'autorisationSortirSeul', 'autorisationSortirAccompagne', 'autorisationMesuresUrgence',
] as const;

/**
 * Reporte dans le formulaire ce qui a été lu. Une rubrique absente de la
 * fiche ne vide jamais un champ déjà rempli. L'identité vient de la fiche
 * enfant ; la fiche santé ne fait que la compléter si elle manque.
 */
function fusionner(form: FormData, type: Piece, champs: ChampsFicheAgora): FormData {
  const suivant: FormData = { ...form };
  for (const cle of CHAMPS_IDENTITE) {
    const v = champs[cle];
    if (v && (type === 'enfant' || !form[cle])) (suivant as any)[cle] = v;
  }
  for (const cle of CHAMPS_TEXTE) if (champs[cle]) suivant[cle] = champs[cle]!;
  for (const cle of CHAMPS_AUTORISATIONS) if (champs[cle] !== undefined) suivant[cle] = champs[cle]!;
  if (champs.vaccins?.length) suivant.vaccins = champs.vaccins;
  if (champs.contacts?.length) {
    const contacts = form.contacts.filter(c => c.nom.trim() || c.telephone.trim()).map(c => ({ ...c }));
    for (const lu of champs.contacts) {
      const existant = contacts.find(c => cleNom(c.nom) === cleNom(lu.nom));
      if (existant) {
        existant.telephone = lu.telephone || existant.telephone;
        existant.email = lu.email || existant.email;
      } else {
        contacts.push({ ...lu });
      }
    }
    suivant.contacts = contacts;
  }
  return suivant;
}

// ─── Composants utilitaires ───────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
      {children}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
  );
}

function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-800
        focus:outline-none focus:border-[#6B1A6E] focus:ring-1 focus:ring-[#6B1A6E]/20
        placeholder:text-gray-300 ${className}`}
    />
  );
}

function Select({ className = '', children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-800
        focus:outline-none focus:border-[#6B1A6E] focus:ring-1 focus:ring-[#6B1A6E]/20 ${className}`}
    >
      {children}
    </select>
  );
}

function Toggle({
  label, description, checked, onChange,
}: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={`flex items-center justify-between p-3.5 rounded-lg border cursor-pointer transition-colors ${
        checked ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
      }`}
      onClick={() => onChange(!checked)}
    >
      <div>
        <div className="text-sm font-medium text-gray-700">{label}</div>
        {description && <div className="text-xs text-gray-400 mt-0.5">{description}</div>}
      </div>
      <div className={`w-11 h-6 rounded-full relative transition-colors ${checked ? 'bg-green-500' : 'bg-gray-300'}`}>
        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
      </div>
    </div>
  );
}

/** Autorisation à trois états : une autorisation non renseignée n'est pas un refus. */
function TriEtat({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  const options: { v: boolean | null; texte: string; actif: string }[] = [
    { v: true,  texte: 'Oui', actif: 'bg-green-500 border-green-500 text-white' },
    { v: false, texte: 'Non', actif: 'bg-red-500 border-red-500 text-white' },
    { v: null,  texte: 'Non renseigné', actif: 'bg-gray-500 border-gray-500 text-white' },
  ];
  return (
    <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg border bg-gray-50 border-gray-200" role="group" aria-label={label}>
      <div className="text-sm font-medium text-gray-700">{label}</div>
      <div className="flex gap-1 shrink-0">
        {options.map(o => (
          <button
            key={o.texte}
            type="button"
            aria-pressed={value === o.v}
            onClick={() => onChange(o.v)}
            className={`px-2.5 py-1 rounded-md border text-xs font-semibold transition-colors ${
              value === o.v ? o.actif : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
            }`}
          >
            {o.texte}
          </button>
        ))}
      </div>
    </div>
  );
}

function Zone({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={2}
      {...props}
      className={`w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-800
        focus:outline-none focus:border-[#6B1A6E] focus:ring-1 focus:ring-[#6B1A6E]/20
        resize-y placeholder:text-gray-300 ${className}`}
    />
  );
}

function SectionTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-100">
      <span className="text-lg">{icon}</span>
      <h2 className="text-sm font-extrabold text-gray-700 uppercase tracking-wide">{children}</h2>
    </div>
  );
}

// ─── Formulaire principal ─────────────────────────────────────────────────────

export default function FicheJeuneForm({
  mode,
  jeuneId,
  initial,
  returnPrefix = '/jeunes',
  espaces,
}: {
  /** Espaces de la commune. Un rattachement hors de cette liste est refusé par le serveur. */
  espaces: EspaceOption[];
  mode: 'creation' | 'modification';
  jeuneId?: string;
  initial?: Partial<FormData & {
    id: string;
    hasFicheAgora: boolean; ficheAgoraNom: string | null;
    hasFicheSante: boolean; ficheSanteNom: string | null;
  }>;
  returnPrefix?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormData>({
    nom:                    initial?.nom ?? '',
    prenom:                 initial?.prenom ?? '',
    dateNaissance:          initial?.dateNaissance ?? '',
    sexe:                   initial?.sexe ?? '',
    // Espace actuel du jeune s'il est toujours dans la liste. Sinon rien : le
    // choix est obligatoire. On ne présélectionne plus le premier espace de la
    // liste — c'était le CLAS, par ordre alphabétique, et des jeunes créés
    // depuis une fiche AGORA y étaient rangés sans que personne l'ait choisi,
    // donc absents du pointage (retour d'usage du 2026-10-12). Seule exception :
    // une commune qui n'a qu'un espace.
    espaceId:               espaces.some(e => e.id === initial?.espaceId)
                              ? initial!.espaceId!
                              : (mode === 'creation' && espaces.length === 1 ? espaces[0].id : ''),
    etablissement:          initial?.etablissement ?? '',
    classe:                 initial?.classe ?? '',
    adresse:                initial?.adresse ?? '',
    secteur:                initial?.secteur ?? '',
    contacts:               initial?.contacts?.length
                              ? initial.contacts.map(c => ({ ...EMPTY_CONTACT, ...c }))
                              : [{ ...EMPTY_CONTACT }],
    autorisationSortie:     initial?.autorisationSortie ?? true,
    autorisationPhoto:      initial?.autorisationPhoto ?? true,
    autorisationSoinsBenins: initial?.autorisationSoinsBenins ?? true,
    observations:           initial?.observations ?? '',
    lieuNaissance:          initial?.lieuNaissance ?? SANTE_VIDE.lieuNaissance,
    regimes:                initial?.regimes ?? SANTE_VIDE.regimes,
    maladies:               initial?.maladies ?? SANTE_VIDE.maladies,
    allergies:              initial?.allergies ?? SANTE_VIDE.allergies,
    vaccins:                Array.isArray(initial?.vaccins) ? initial!.vaccins!.map(v => ({ nom: v.nom ?? '', date: v.date ?? '' })) : [],
    medecinNom:             initial?.medecinNom ?? SANTE_VIDE.medecinNom,
    medecinTelephone:       initial?.medecinTelephone ?? SANTE_VIDE.medecinTelephone,
    assuranceCompagnie:     initial?.assuranceCompagnie ?? SANTE_VIDE.assuranceCompagnie,
    assurancePolice:        initial?.assurancePolice ?? SANTE_VIDE.assurancePolice,
    hospitalisation:        initial?.hospitalisation ?? SANTE_VIDE.hospitalisation,
    lieuHospitalisation:    initial?.lieuHospitalisation ?? SANTE_VIDE.lieuHospitalisation,
    autorisationSortirSeul:        initial?.autorisationSortirSeul ?? null,
    autorisationSortirAccompagne:  initial?.autorisationSortirAccompagne ?? null,
    autorisationMesuresUrgence:    initial?.autorisationMesuresUrgence ?? null,
  });
  // Dernier état connu du formulaire, lisible depuis une lecture de fiche en
  // cours (deux fichiers déposés ensemble sont traités l'un après l'autre).
  const formRef = useRef(form);
  formRef.current = form;

  // ── Éditions AGORA : fiche enfant et fiche santé (PDF ou image) ──
  // Les fichiers existants ne sont pas rechargés (on n'expose pas le base64) :
  // on affiche leur nom. Nouveau fichier / retrait gérés à part pour ne pas
  // écraser l'existant lors d'une simple modification.
  const [pieces, setPieces] = useState<Record<Piece, Fichier | null>>({ enfant: null, sante: null });
  const [retires, setRetires] = useState<Record<Piece, boolean>>({ enfant: false, sante: false });
  const [lectureEnCours, setLectureEnCours] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  const existant: Record<Piece, { present: boolean; nom: string | null | undefined }> = {
    enfant: { present: !!initial?.hasFicheAgora, nom: initial?.ficheAgoraNom },
    sante:  { present: !!initial?.hasFicheSante, nom: initial?.ficheSanteNom },
  };

  function poserPiece(piece: Piece, fichier: Fichier | null) {
    setPieces(p => ({ ...p, [piece]: fichier }));
    if (fichier) setRetires(r => ({ ...r, [piece]: false }));
  }

  /**
   * Lit un fichier déposé. Un PDF AGORA reconnu remplit le formulaire et se
   * range de lui-même à la bonne place, même déposé dans l'autre case. Un
   * fichier non lisible (image, autre PDF) n'est conservé que s'il a été
   * déposé dans une case précise (`caseChoisie`).
   */
  async function traiterFichier(file: File, caseChoisie?: Piece): Promise<Message> {
    if (!TYPES_ACCEPTES.includes(file.type)) return { ton: 'erreur', texte: `${file.name} : format accepté PDF, PNG, JPEG ou WEBP.` };
    if (file.size > 5 * 1024 * 1024) return { ton: 'erreur', texte: `${file.name} : fichier trop lourd (5 Mo maximum).` };
    const fichier: Fichier = { dataUri: await lireEnDataUri(file), nom: file.name };

    let erreurLecture = 'Lecture automatique impossible.';
    if (file.type === 'application/pdf') {
      try {
        const res = await fetch('/api/jeunes/analyse-fiche', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fichier: fichier.dataUri }),
        });
        const corps = await res.json().catch(() => ({}));
        if (res.ok && corps.champs) {
          const type = corps.type as Piece;
          const champs = corps.champs as ChampsFicheAgora;
          const titre = PIECES.find(p => p.cle === type)!.titre;
          const actuel = formRef.current;
          if (!memeJeune(actuel, champs)) {
            return {
              ton: 'erreur',
              texte: `${file.name} : cette ${titre.toLowerCase()} est celle de ${champs.prenom ?? ''} ${champs.nom ?? ''}, pas celle du jeune en cours de saisie. Elle n’a pas été prise en compte.`,
            };
          }
          const suivant = fusionner(actuel, type, champs);
          // Espace encore à choisir : on propose celui de son âge, s'il n'y a pas d'équivoque.
          let espacePropose = '';
          if (!suivant.espaceId) {
            const id = proposerEspace(espaces, suivant.dateNaissance);
            if (id) {
              suivant.espaceId = id;
              espacePropose = ` Espace proposé d’après l’âge : ${espaces.find(e => e.id === id)?.nom ?? id}.`;
            }
          }
          formRef.current = suivant;
          setForm(suivant);
          poserPiece(type, fichier);
          return { ton: 'ok', texte: `${titre} lue (${file.name}) : les champs reconnus sont remplis.${espacePropose} Vérifiez-les avant d’enregistrer.` };
        }
        erreurLecture = corps.error ?? erreurLecture;
      } catch {
        erreurLecture = 'Lecture automatique impossible (connexion interrompue).';
      }
    } else {
      erreurLecture = 'Une image ne peut pas être lue automatiquement : utilisez le PDF édité par AGORA.';
    }

    if (!caseChoisie) return { ton: 'erreur', texte: `${file.name} : ${erreurLecture}` };
    poserPiece(caseChoisie, fichier);
    return { ton: 'info', texte: `${file.name} : joint à la fiche, mais non lu automatiquement — les champs restent à saisir.` };
  }

  async function handleFichiers(e: React.ChangeEvent<HTMLInputElement>, caseChoisie?: Piece) {
    const fichiers = Array.from(e.target.files ?? []).slice(0, 2);
    e.target.value = '';
    if (fichiers.length === 0) return;
    setLectureEnCours(true);
    const recus: Message[] = [];
    try {
      for (const f of fichiers) recus.push(await traiterFichier(f, caseChoisie));
    } catch {
      recus.push({ ton: 'erreur', texte: 'Fichier illisible.' });
    } finally {
      setMessages(recus);
      setLectureEnCours(false);
    }
  }

  // ── Champs simples ──
  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  // ── Contacts ──
  function setContact(idx: number, key: keyof Contact, value: string) {
    setForm(f => {
      const contacts = [...f.contacts];
      contacts[idx] = { ...contacts[idx], [key]: value };
      return { ...f, contacts };
    });
  }
  function addContact() {
    setForm(f => ({ ...f, contacts: [...f.contacts, { ...EMPTY_CONTACT }] }));
  }
  function removeContact(idx: number) {
    setForm(f => ({ ...f, contacts: f.contacts.filter((_, i) => i !== idx) }));
  }

  // ── Vaccins ──
  function setVaccin(idx: number, key: keyof Vaccin, value: string) {
    setForm(f => ({ ...f, vaccins: f.vaccins.map((v, i) => (i === idx ? { ...v, [key]: value } : v)) }));
  }

  // ── Validation ──
  function isValid(): boolean {
    return !!(form.nom.trim() && form.prenom.trim() && form.dateNaissance && form.espaceId);
  }

  // ── Soumission ──
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid()) return;
    setError(null);

    const payload: any = {
      ...form,
      nom:     form.nom.trim().toUpperCase(),
      prenom:  form.prenom.trim(),
      contacts: form.contacts.filter(c => c.nom.trim() || c.telephone.trim()),
    };
    payload.vaccins = form.vaccins.filter(v => v.nom.trim());
    // On ne renseigne une pièce QUE si elle change (nouveau fichier ou retrait).
    if (pieces.enfant) { payload.ficheAgora = pieces.enfant.dataUri; payload.ficheAgoraNom = pieces.enfant.nom; }
    else if (retires.enfant) { payload.ficheAgora = null; }
    if (pieces.sante) { payload.ficheSante = pieces.sante.dataUri; payload.ficheSanteNom = pieces.sante.nom; }
    else if (retires.sante) { payload.ficheSante = null; }

    startTransition(async () => {
      if (mode === 'creation') {
        const result = await creerJeune(payload);
        if (result.success) {
          setSaved(true);
          setTimeout(() => router.push(`${returnPrefix}/${result.id}`), 1200);
        } else {
          setError(result.error ?? 'Erreur lors de la création');
        }
      } else {
        const result = await modifierJeune(jeuneId!, payload);
        if (result.success) {
          setSaved(true);
          setTimeout(() => router.push(`${returnPrefix}/${jeuneId}`), 1200);
        } else {
          setError(result.error ?? 'Erreur lors de la modification');
        }
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="p-8 grid grid-cols-2 gap-6">

      {/* ── Remplissage depuis AGORA ── */}
      <div className="col-span-2 bg-[#6B1A6E]/5 rounded-xl border border-[#6B1A6E]/20 p-6">
        <div className="flex items-center justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-[#6B1A6E] uppercase tracking-wide">⚡ Remplir depuis AGORA</h2>
            <p className="text-sm text-gray-600 mt-1">
              Déposez la <strong>fiche enfant</strong> et la <strong>fiche santé</strong> éditées par AGORA (PDF) :
              les champs se remplissent, il reste à vérifier l’espace, choisir le quartier, puis enregistrer.
            </p>
          </div>
          <label className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white shrink-0 transition-colors ${
            lectureEnCours ? 'bg-[#6B1A6E]/50 cursor-wait' : 'bg-[#6B1A6E] hover:bg-[#551558] cursor-pointer'
          }`}>
            {lectureEnCours ? 'Lecture en cours…' : '📎 Choisir les fiches AGORA'}
            <input type="file" accept="application/pdf" multiple disabled={lectureEnCours} data-piece="agora"
              onChange={e => handleFichiers(e)} className="hidden" />
          </label>
        </div>
        <div className="mt-3 space-y-2" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={`px-3 py-2 rounded-lg border text-sm ${
              m.ton === 'ok' ? 'bg-green-50 border-green-200 text-green-800'
                : m.ton === 'info' ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {m.ton === 'ok' ? '✅' : m.ton === 'info' ? 'ℹ️' : '⚠️'} {m.texte}
            </div>
          ))}
        </div>
      </div>

      {/* ── Identité ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <SectionTitle icon="👤">Identité</SectionTitle>
        <div className="space-y-4">

          <div className="grid grid-cols-2 gap-3">
            <Field label="Prénom" required>
              <Input
                placeholder="Prénom"
                value={form.prenom}
                onChange={e => set('prenom', e.target.value)}
              />
            </Field>
            <Field label="Nom de famille" required>
              <Input
                placeholder="NOM"
                value={form.nom}
                onChange={e => set('nom', e.target.value)}
                style={{ textTransform: 'uppercase' }}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date de naissance" required>
              <Input
                type="date"
                value={form.dateNaissance}
                onChange={e => set('dateNaissance', e.target.value)}
              />
            </Field>
            <div>
              <Label>Sexe</Label>
              <div className="flex gap-2 mt-0.5">
                {[
                  { value: 'M', label: '👦 Garçon' },
                  { value: 'F', label: '👧 Fille' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('sexe', opt.value as 'M' | 'F')}
                    className={`flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors ${
                      form.sexe === opt.value
                        ? 'border-[#6B1A6E] bg-[#6B1A6E] text-white'
                        : 'border-gray-200 text-gray-600 hover:border-[#6B1A6E] hover:text-[#6B1A6E]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Field label="Lieu de naissance">
            <Input
              placeholder="Ex : Nogent-sur-Marne"
              value={form.lieuNaissance}
              onChange={e => set('lieuNaissance', e.target.value)}
            />
          </Field>

          <Field label="Espace" required>
            <Select value={form.espaceId} onChange={e => set('espaceId', e.target.value)}
              className={form.espaceId ? '' : '!border-amber-400 bg-amber-50'}>
              {!form.espaceId && <option value="">— Choisir un espace —</option>}
              {espaces.map(e => (
                <option key={e.id} value={e.id}>{e.nom}{e.trancheAge ? ` (${e.trancheAge})` : ''}</option>
              ))}
            </Select>
          </Field>

        </div>
      </div>

      {/* ── Scolarité & Adresse ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <SectionTitle icon="🏫">Scolarité & Adresse</SectionTitle>
        <div className="space-y-4">

          <Field label="Établissement scolaire">
            <Input
              placeholder="Ex : Collège Albert Camus"
              value={form.etablissement}
              onChange={e => set('etablissement', e.target.value)}
            />
          </Field>

          <Field label="Classe">
            <Input
              placeholder="Ex : 5e B, Terminale S…"
              value={form.classe}
              onChange={e => set('classe', e.target.value)}
            />
          </Field>

          <Field label="Adresse">
            <Input
              placeholder="Ex : 12 rue des Lilas, 94130 Nogent-sur-Marne"
              value={form.adresse}
              onChange={e => set('adresse', e.target.value)}
            />
          </Field>

          <Field label="Quartier">
            <Select value={form.secteur} onChange={e => set('secteur', e.target.value)}>
              <option value="">— Sélectionner un quartier —</option>
              {SECTEURS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>

        </div>
      </div>

      {/* ── Contacts famille ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <SectionTitle icon="👨‍👩‍👧">Contacts famille</SectionTitle>
        <div className="space-y-4">
          {form.contacts.map((c, idx) => (
            <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-100 space-y-3 relative">
              {form.contacts.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeContact(idx)}
                  className="absolute top-3 right-3 w-6 h-6 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-xs font-bold transition-colors"
                >
                  ✕
                </button>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nom complet">
                  <Input
                    placeholder="Nom Prénom"
                    value={c.nom}
                    onChange={e => setContact(idx, 'nom', e.target.value)}
                  />
                </Field>
                <Field label="Lien">
                  <Select value={c.lien} onChange={e => setContact(idx, 'lien', e.target.value)}>
                    {LIENS.map(l => <option key={l} value={l}>{l}</option>)}
                    {/* Lien repris d'AGORA (« Concubin / concubine »…) : conservé tel quel. */}
                    {c.lien && !LIENS.includes(c.lien) && <option value={c.lien}>{c.lien}</option>}
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Téléphone">
                  <Input
                    placeholder="06 XX XX XX XX"
                    value={c.telephone}
                    onChange={e => setContact(idx, 'telephone', e.target.value)}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    placeholder="email@exemple.fr"
                    value={c.email}
                    onChange={e => setContact(idx, 'email', e.target.value)}
                  />
                </Field>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addContact}
            className="w-full border border-dashed border-gray-300 rounded-lg py-2.5 text-sm font-semibold text-gray-400 hover:border-[#6B1A6E] hover:text-[#6B1A6E] transition-colors flex items-center justify-center gap-2"
          >
            <span className="text-lg leading-none">+</span> Ajouter un contact
          </button>
        </div>
      </div>

      {/* ── Autorisations & Observations ── */}
      <div className="space-y-5">

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <SectionTitle icon="📋">Autorisations parentales</SectionTitle>
          <div className="space-y-3">
            <Toggle
              label="✈️ Sorties"
              description="Autorisation de participer aux sorties"
              checked={form.autorisationSortie}
              onChange={v => set('autorisationSortie', v)}
            />
            <Toggle
              label="📷 Photos / vidéos"
              description="Droit à l'image"
              checked={form.autorisationPhoto}
              onChange={v => set('autorisationPhoto', v)}
            />
            <Toggle
              label="🩹 Soins bénins"
              description="Administration de soins mineurs"
              checked={form.autorisationSoinsBenins}
              onChange={v => set('autorisationSoinsBenins', v)}
            />
            <TriEtat label="🚑 Mesures d’urgence" value={form.autorisationMesuresUrgence} onChange={v => set('autorisationMesuresUrgence', v)} />
            <TriEtat label="🚶 Sortir seul, non accompagné" value={form.autorisationSortirSeul} onChange={v => set('autorisationSortirSeul', v)} />
            <TriEtat label="👥 Sortir avec un mineur de plus de 11 ans" value={form.autorisationSortirAccompagne} onChange={v => set('autorisationSortirAccompagne', v)} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <SectionTitle icon="📝">Observations</SectionTitle>
          <textarea
            rows={5}
            placeholder="Notes sur le jeune, comportement, besoins particuliers…"
            value={form.observations}
            onChange={e => set('observations', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-800
              focus:outline-none focus:border-[#6B1A6E] focus:ring-1 focus:ring-[#6B1A6E]/20
              resize-none placeholder:text-gray-300"
          />
        </div>
      </div>

      {/* ── Santé ── */}
      <div className="col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <SectionTitle icon="🩺">Santé <span className="font-normal normal-case tracking-normal text-gray-300 text-sm">(repris sur la fiche sanitaire des sorties)</span></SectionTitle>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Allergies">
            <Zone placeholder="Alimentaires, médicamenteuses, pollen…" value={form.allergies} onChange={e => set('allergies', e.target.value)} />
          </Field>
          <Field label="Maladies / traitements">
            <Zone placeholder="Asthme, diabète, traitement en cours…" value={form.maladies} onChange={e => set('maladies', e.target.value)} />
          </Field>
          <Field label="Régimes alimentaires">
            <Zone placeholder="Sans porc, végétarien…" value={form.regimes} onChange={e => set('regimes', e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-4 gap-4 mt-4">
          <Field label="Médecin traitant">
            <Input placeholder="Dr Nom Prénom" value={form.medecinNom} onChange={e => set('medecinNom', e.target.value)} />
          </Field>
          <Field label="Téléphone du médecin">
            <Input placeholder="01 XX XX XX XX" value={form.medecinTelephone} onChange={e => set('medecinTelephone', e.target.value)} />
          </Field>
          <Field label="Compagnie d’assurance">
            <Input placeholder="Assureur" value={form.assuranceCompagnie} onChange={e => set('assuranceCompagnie', e.target.value)} />
          </Field>
          <Field label="N° de police">
            <Input placeholder="N° de contrat" value={form.assurancePolice} onChange={e => set('assurancePolice', e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <Field label="Hospitalisation">
            <Input placeholder="Consignes ou antécédents" value={form.hospitalisation} onChange={e => set('hospitalisation', e.target.value)} />
          </Field>
          <Field label="Lieu d’hospitalisation souhaité">
            <Input placeholder="Hôpital ou clinique" value={form.lieuHospitalisation} onChange={e => set('lieuHospitalisation', e.target.value)} />
          </Field>
        </div>

        <div className="mt-5">
          <Label>Vaccins — date du dernier rappel</Label>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {form.vaccins.map((v, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input aria-label={`Vaccin ${idx + 1}`} placeholder="Vaccin" value={v.nom} onChange={e => setVaccin(idx, 'nom', e.target.value)} />
                <Input aria-label={`Dernier rappel du vaccin ${idx + 1}`} type="date" value={v.date} onChange={e => setVaccin(idx, 'date', e.target.value)} className="!w-44 shrink-0" />
                <button
                  type="button"
                  aria-label={`Retirer le vaccin ${idx + 1}`}
                  onClick={() => setForm(f => ({ ...f, vaccins: f.vaccins.filter((_, i) => i !== idx) }))}
                  className="w-7 h-7 shrink-0 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-xs font-bold transition-colors"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, vaccins: [...f.vaccins, { nom: '', date: '' }] }))}
            className="mt-2 border border-dashed border-gray-300 rounded-lg px-4 py-2 text-sm font-semibold text-gray-400 hover:border-[#6B1A6E] hover:text-[#6B1A6E] transition-colors"
          >
            + Ajouter un vaccin
          </button>
        </div>
      </div>

      {/* ── Documents AGORA ── */}
      <div className="col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <SectionTitle icon="📄">Documents AGORA <span className="font-normal normal-case tracking-normal text-gray-300 text-sm">(PDF ou image, facultatif)</span></SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          {PIECES.map(({ cle, titre, aide }) => {
            const nouveau = pieces[cle];
            const enBase = existant[cle].present && !retires[cle];
            const lien = `/api/jeunes/fiche-agora?id=${jeuneId}${cle === 'sante' ? '&piece=sante' : ''}`;
            const choisir = (libelle: string, classe: string) => (
              <label className={`${classe} cursor-pointer`}>
                {libelle}
                <input type="file" accept=".pdf,image/*" data-piece={cle} disabled={lectureEnCours}
                  onChange={e => handleFichiers(e, cle)} className="hidden" />
              </label>
            );
            return (
              <div key={cle} className="p-4 rounded-lg border border-gray-100 bg-gray-50">
                <div className="text-sm font-bold text-gray-700">{titre}</div>
                <div className="text-xs text-gray-400 mb-3">{aide}</div>
                {nouveau ? (
                  <div className="flex items-center gap-3">
                    <span className="text-xl">📄</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{nouveau.nom}</p>
                      <p className="text-xs text-green-600">Nouveau fichier — sera enregistré avec la fiche.</p>
                    </div>
                    <button type="button" onClick={() => poserPiece(cle, null)} className="text-sm text-red-400 hover:text-red-600 font-medium">Retirer</button>
                  </div>
                ) : enBase ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xl">📄</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{existant[cle].nom || titre}</p>
                    </div>
                    <a href={lien} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-[#6B1A6E] hover:underline font-medium">Voir / Imprimer</a>
                    {choisir('Remplacer', 'text-sm text-gray-600 hover:text-gray-800 font-medium')}
                    <button type="button" onClick={() => setRetires(r => ({ ...r, [cle]: true }))} className="text-sm text-red-400 hover:text-red-600 font-medium">Retirer</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {choisir('📎 Choisir un fichier', 'inline-flex items-center gap-2 px-4 py-2.5 border border-dashed border-gray-300 rounded-xl text-sm text-gray-600 bg-white hover:border-[#6B1A6E] hover:text-[#6B1A6E]')}
                    {retires[cle] && existant[cle].present && (
                      <span className="text-xs text-amber-600">La fiche sera retirée à l’enregistrement.</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Barre de sauvegarde ── */}
      <div className="col-span-2 flex items-center justify-between bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-4">
        <div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              ⚠️ {error}
            </div>
          )}
          {!error && !saved && !form.espaceId && form.nom.trim() && form.prenom.trim() && form.dateNaissance && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              Choisissez l’espace du jeune (rubrique Identité) pour pouvoir enregistrer.
            </div>
          )}
          {saved && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">
              ✅ {mode === 'creation' ? 'Fiche créée' : 'Modifications enregistrées'} — redirection…
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={!isValid() || isPending || saved || lectureEnCours}
            className="bg-[#6B1A6E] text-white px-6 py-2.5 rounded-lg text-sm font-semibold
              hover:bg-[#551558] disabled:opacity-50 disabled:cursor-not-allowed transition-colors
              flex items-center gap-2"
          >
            {isPending ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Enregistrement…
              </>
            ) : mode === 'creation' ? (
              '✅ Créer la fiche'
            ) : (
              '✅ Enregistrer les modifications'
            )}
          </button>
        </div>
      </div>

    </form>
  );
}
