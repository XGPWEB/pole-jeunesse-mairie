'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { creerActivite, modifierActivite } from './actions';
import Field from '@/components/Field';

// ─── Données de référence ──────────────────────────────────────────────────────

const ESPACES = [
  { value: 'collegiens', label: 'Espace Collégiens (10–14 ans)' },
  { value: 'lyceens',    label: 'Espace Lycéens (15–17 ans)' },
  { value: 'pij',        label: 'PIJ — Point Information Jeunesse (15–25 ans)' },
  { value: 'clas',       label: 'CLAS — Accompagnement Scolaire (10–17 ans)' },
];

const STATUTS = [
  { value: 'ouvert',   label: 'Ouvert',   color: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'complet',  label: 'Complet',  color: 'bg-red-50 text-red-700 border-red-200' },
  { value: 'annule',   label: 'Annulé',   color: 'bg-gray-100 text-gray-500 border-gray-200' },
  { value: 'brouillon',label: 'Brouillon',color: 'bg-amber-50 text-amber-700 border-amber-200' },
];

const TAGS_SUGGESTIONS = [
  'créatif', 'art', 'collectif', 'sortie', 'cinéma', 'culture', 'sport',
  'jeu', 'compétition', 'gaming', 'orientation', 'études', 'numérique',
  'citoyenneté', 'débat', 'engagement', 'musique', 'vidéo', 'écriture',
  'solidarité', 'nature', 'cuisine', 'théâtre', 'danse', 'code',
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  titre: string;
  description: string;
  espaceId: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  animateur: string;
  placesTotal: number;
  placesDisponibles: number;
  statut: string;
  tags: string[];
}

// ─── UI Primitives ────────────────────────────────────────────────────────────

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

function Select({ children, className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
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

function SectionTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-100">
      <span className="text-lg">{icon}</span>
      <h2 className="text-sm font-extrabold text-gray-700 uppercase tracking-wide">{children}</h2>
    </div>
  );
}

// ─── Formulaire ───────────────────────────────────────────────────────────────

export default function FicheActiviteForm({
  mode,
  activiteId,
  initial,
  basePath = '/activites',
  animateurs = [],
}: {
  mode: 'creation' | 'modification';
  activiteId?: string;
  initial?: Partial<FormData & { id: string }>;
  basePath?: string;
  animateurs?: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');

  function buildFormData(src?: Partial<FormData & { id: string }>): FormData {
    return {
      titre:             src?.titre ?? '',
      description:       src?.description ?? '',
      espaceId:          src?.espaceId ?? 'collegiens',
      date:              src?.date ?? '',
      heureDebut:        src?.heureDebut ?? '14:00',
      heureFin:          src?.heureFin ?? '17:00',
      lieu:              src?.lieu ?? '',
      animateur:         src?.animateur ?? '',
      placesTotal:       src?.placesTotal ?? 20,
      placesDisponibles: src?.placesDisponibles ?? 20,
      statut:            src?.statut ?? 'ouvert',
      tags:              src?.tags ?? [],
    };
  }

  const [form, setForm] = useState<FormData>(buildFormData(initial));

  // Reset le formulaire quand on navigue vers une autre activité ou vers "nouvelle"
  useEffect(() => {
    setForm(buildFormData(initial));
    setSaved(false);
    setError(null);
    setTagInput('');
  }, [activiteId, mode]);

  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  // ── Tags ──
  function addTag(tag: string) {
    const t = tag.trim().toLowerCase();
    if (t && !form.tags.includes(t)) set('tags', [...form.tags, t]);
    setTagInput('');
  }
  function removeTag(tag: string) {
    set('tags', form.tags.filter(t => t !== tag));
  }

  // ── Calcul auto des places disponibles ──
  function handlePlacesTotalChange(v: number) {
    const diff = form.placesTotal - form.placesDisponibles;
    setForm(f => ({
      ...f,
      placesTotal: v,
      placesDisponibles: Math.max(0, v - diff),
    }));
  }

  function isValid() {
    return !!(form.titre.trim() && form.date && form.espaceId && form.heureDebut && form.heureFin);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid()) return;
    setError(null);

    startTransition(async () => {
      if (mode === 'creation') {
        const result = await creerActivite(form);
        if (result.success) {
          setSaved(true);
          setTimeout(() => router.push(`${basePath}/${result.id}`), 1200);
        } else {
          setError(result.error ?? 'Erreur lors de la création');
        }
      } else {
        const result = await modifierActivite(activiteId!, form);
        if (result.success) {
          setSaved(true);
          setTimeout(() => router.push(`${basePath}/${activiteId}`), 1200);
        } else {
          setError(result.error ?? 'Erreur lors de la modification');
        }
      }
    });
  }

  const placesPrises = form.placesTotal - form.placesDisponibles;
  const tauxRemplissage = form.placesTotal > 0
    ? Math.round((placesPrises / form.placesTotal) * 100)
    : 0;

  return (
    <form onSubmit={handleSubmit} className="p-8 space-y-6">

      <div className="grid grid-cols-3 gap-6">

        {/* ── Colonne gauche — Informations principales ── */}
        <div className="col-span-2 space-y-5">

          {/* Titre & Description */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <SectionTitle icon="📋">Informations générales</SectionTitle>
            <div className="space-y-4">

              <Field label="Titre de l'activité" required>
                <Input
                  placeholder="Ex : Atelier Street Art, Tournoi FIFA, Sortie Musée…"
                  value={form.titre}
                  onChange={e => set('titre', e.target.value)}
                />
              </Field>

              <Field label="Description">
                <textarea
                  rows={4}
                  placeholder="Décrivez l'activité, son objectif, ce que les jeunes vont faire…"
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-800
                    focus:outline-none focus:border-[#6B1A6E] focus:ring-1 focus:ring-[#6B1A6E]/20
                    resize-none placeholder:text-gray-300"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Espace" required>
                  <Select value={form.espaceId} onChange={e => set('espaceId', e.target.value)}>
                    {ESPACES.map(e => (
                      <option key={e.value} value={e.value}>{e.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Lieu">
                  <Input
                    placeholder="Ex : Salle créative, MJC, Parc Lépine…"
                    value={form.lieu}
                    onChange={e => set('lieu', e.target.value)}
                  />
                </Field>
              </div>

            </div>
          </div>

          {/* Date & Horaires */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <SectionTitle icon="📅">Date & Horaires</SectionTitle>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Date" required>
                <Input
                  type="date"
                  value={form.date}
                  onChange={e => set('date', e.target.value)}
                />
              </Field>
              <Field label="Heure de début" required>
                <Input
                  type="time"
                  value={form.heureDebut}
                  onChange={e => set('heureDebut', e.target.value)}
                />
              </Field>
              <Field label="Heure de fin" required>
                <Input
                  type="time"
                  value={form.heureFin}
                  onChange={e => set('heureFin', e.target.value)}
                />
              </Field>
            </div>
            {form.heureDebut && form.heureFin && (
              <div className="mt-3 text-xs text-gray-400">
                Durée estimée :{' '}
                <span className="font-semibold text-gray-600">
                  {(() => {
                    const [dh, dm] = form.heureDebut.split(':').map(Number);
                    const [fh, fm] = form.heureFin.split(':').map(Number);
                    const total = (fh * 60 + fm) - (dh * 60 + dm);
                    if (total <= 0) return '—';
                    const h = Math.floor(total / 60);
                    const m = total % 60;
                    return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m} min`;
                  })()}
                </span>
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <SectionTitle icon="🏷️">Tags</SectionTitle>

            {/* Tags actuels */}
            <div className="flex flex-wrap gap-2 mb-4 min-h-[36px]">
              {form.tags.length === 0 && (
                <span className="text-sm text-gray-300 italic">Aucun tag ajouté</span>
              )}
              {form.tags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 bg-[#6B1A6E]/10 text-[#6B1A6E] text-xs font-semibold px-3 py-1.5 rounded-full border border-[#6B1A6E]/20"
                >
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-500 transition-colors">
                    ✕
                  </button>
                </span>
              ))}
            </div>

            {/* Saisie libre */}
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="Ajouter un tag…"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); }
                }}
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => addTag(tagInput)}
                disabled={!tagInput.trim()}
                className="px-4 py-2.5 bg-[#6B1A6E] text-white rounded-lg text-sm font-semibold
                  hover:bg-[#551558] disabled:opacity-30 transition-colors"
              >
                Ajouter
              </button>
            </div>

            {/* Suggestions rapides */}
            <div className="flex flex-wrap gap-1.5">
              {TAGS_SUGGESTIONS.filter(t => !form.tags.includes(t)).slice(0, 12).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addTag(t)}
                  className="text-xs text-gray-500 border border-gray-200 px-2.5 py-1 rounded-full
                    hover:border-[#6B1A6E] hover:text-[#6B1A6E] transition-colors"
                >
                  + {t}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* ── Colonne droite — Animateur, Places, Statut ── */}
        <div className="space-y-5">

          {/* Animateur */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <SectionTitle icon="👤">Animateur référent</SectionTitle>
            <Select
              value={form.animateur}
              onChange={e => set('animateur', e.target.value)}
            >
              <option value="">— Sélectionner —</option>
              {animateurs.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </Select>
            {form.animateur && (
              <div className="mt-3 flex items-center gap-2 p-2.5 bg-purple-50 rounded-lg border border-purple-100">
                <div className="w-8 h-8 rounded-full bg-[#6B1A6E] flex items-center justify-center text-white text-xs font-bold">
                  {form.animateur.split(' ').map(w => w[0]).join('').slice(0, 2)}
                </div>
                <span className="text-sm font-semibold text-[#6B1A6E]">{form.animateur}</span>
              </div>
            )}
          </div>

          {/* Places */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <SectionTitle icon="🪑">Places</SectionTitle>
            <div className="space-y-4">
              <Field label="Capacité totale">
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={form.placesTotal}
                  onChange={e => handlePlacesTotalChange(parseInt(e.target.value) || 1)}
                />
              </Field>
              <Field label="Places disponibles">
                <Input
                  type="number"
                  min={0}
                  max={form.placesTotal}
                  value={form.placesDisponibles}
                  onChange={e => set('placesDisponibles', Math.min(parseInt(e.target.value) || 0, form.placesTotal))}
                />
              </Field>

              {/* Jauge */}
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                  <span>{placesPrises} inscrits</span>
                  <span className="font-semibold text-[#6B1A6E]">{tauxRemplissage}%</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      tauxRemplissage >= 100 ? 'bg-red-500' :
                      tauxRemplissage >= 75  ? 'bg-amber-400' :
                                               'bg-[#6B1A6E]'
                    }`}
                    style={{ width: `${Math.min(tauxRemplissage, 100)}%` }}
                  />
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {form.placesDisponibles} place{form.placesDisponibles > 1 ? 's' : ''} restante{form.placesDisponibles > 1 ? 's' : ''}
                </div>
              </div>
            </div>
          </div>

          {/* Statut */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <SectionTitle icon="🚦">Statut</SectionTitle>
            <div className="space-y-2">
              {STATUTS.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => set('statut', s.value)}
                  className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm font-semibold transition-colors ${
                    form.statut === s.value
                      ? s.color + ' ring-2 ring-offset-1 ring-[#6B1A6E]/30'
                      : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* ── Barre de sauvegarde ── */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-4">
        <div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              ⚠️ {error}
            </div>
          )}
          {saved && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">
              ✅ {mode === 'creation' ? 'Activité créée' : 'Modifications enregistrées'} — redirection…
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
            disabled={!isValid() || isPending || saved}
            className="bg-[#6B1A6E] text-white px-6 py-2.5 rounded-lg text-sm font-semibold
              hover:bg-[#551558] disabled:opacity-50 disabled:cursor-not-allowed transition-colors
              flex items-center gap-2"
          >
            {isPending ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Enregistrement…
              </>
            ) : mode === 'creation' ? '✅ Créer l\'activité' : '✅ Enregistrer'}
          </button>
        </div>
      </div>

    </form>
  );
}
