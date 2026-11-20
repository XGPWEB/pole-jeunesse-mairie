'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ── Auto-resize textarea ───────────────────────────────────────────────────────
function AutoTextarea({
  value, onChange, placeholder = '', required = false, minRows = 2,
  className = '',
}: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; minRows?: number; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, minRows * 24 + 20)}px`;
  }, [value, minRows]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      rows={minRows}
      className={`w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 focus:border-[#1B3870] resize-none overflow-hidden transition-all ${className}`}
    />
  );
}

// ── Auto-resize input ──────────────────────────────────────────────────────────
function AutoInput({
  value, onChange, type = 'text', placeholder = '', required = false, className = '',
}: {
  value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean; className?: string;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (type === 'date') return; // date inputs fixed width
    const span = spanRef.current;
    const input = inputRef.current;
    if (!span || !input) return;
    span.textContent = value || placeholder || ' ';
    const w = Math.max(span.offsetWidth + 24, 120);
    input.style.width = `${w}px`;
  }, [value, placeholder, type]);

  if (type === 'date') {
    return (
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className={`px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 focus:border-[#1B3870] ${className}`}
      />
    );
  }

  return (
    <div className="relative inline-block w-full">
      <span
        ref={spanRef}
        aria-hidden
        className="invisible absolute whitespace-pre text-sm px-3 py-2.5 font-normal"
      />
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={`w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 focus:border-[#1B3870] ${className}`}
      />
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
      <h3 className="text-sm font-bold text-gray-600 uppercase tracking-wider border-b border-gray-100 pb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Budget line ────────────────────────────────────────────────────────────────
interface BudgetLine { designation: string; cout: string; }

// ─────────────────────────────────────────────────────────────────────────────

interface ProjetFormProps { initialData?: any; projetId?: string; basePath?: string; }

const PUBLIC_CIBLE_OPTIONS = ['Collégiens', 'Lycéens', 'Collégiens & Lycéens', 'PIJ'];

export default function ProjetForm({ initialData, projetId, basePath }: ProjetFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState<null | 'brouillon' | 'publie'>(null);
  const [error, setError]   = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // ── Helpers de construction ──────────────────────────────────────────────────
  function buildFormData(d?: any) {
    return {
      titre:                 d?.titre                 ?? '',
      dateDepot:             d?.dateDepot ?? d?.dateProjet ?? '',
      duree:                 d?.duree                 ?? '',
      lieu:                  d?.lieu                  ?? '',
      objectifsSynthetiques: d?.objectifsSynthetiques ?? '',
      publicCible:           d?.publicCible           ?? '',
      constat:               d?.constat               ?? '',
      objectifs:             d?.objectifs             ?? '',
      resultatsAttendus:     d?.resultatsAttendus     ?? '',
      deroulement:           d?.deroulement           ?? '',
      moyensHumains:         d?.moyensHumains         ?? '',
      moyensMateriels:       d?.moyensMateriels       ?? '',
      partenaires:           d?.partenaires           ?? '',
      modesCommunication:    d?.modesCommunication    ?? '',
      retroPlanning:         d?.retroPlanning         ?? '',
      outilsEvaluation:      d?.outilsEvaluation      ?? '',
    };
  }

  function buildBudgetLines(d?: any): BudgetLine[] {
    return d?.lignesBudget?.length ? d.lignesBudget : [{ designation: '', cout: '' }];
  }

  // ── Champs texte ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState(buildFormData(initialData));

  // ── Budget lignes ─────────────────────────────────────────────────────────────
  const [lignesBudget, setLignesBudget] = useState<BudgetLine[]>(buildBudgetLines(initialData));

  // ── Réinitialiser le formulaire quand les données changent ────────────────────
  // Corrige le cas où useState ne se réinitialise pas lors de la navigation
  // ou après un router.refresh() de AutoRefresh
  useEffect(() => {
    setForm(buildFormData(initialData));
    setLignesBudget(buildBudgetLines(initialData));
    setError('');
    setSuccessMsg('');
  }, [projetId, initialData?.titre, initialData?.updatedAt]);

  const totalBudget = lignesBudget.reduce((sum, l) => {
    const n = parseFloat(l.cout.replace(',', '.'));
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  function setField(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function setBudgetLine(idx: number, key: keyof BudgetLine, value: string) {
    setLignesBudget(prev => prev.map((l, i) => i === idx ? { ...l, [key]: value } : l));
  }

  function addBudgetLine() {
    setLignesBudget(prev => [...prev, { designation: '', cout: '' }]);
  }

  function removeBudgetLine(idx: number) {
    setLignesBudget(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  }

  // ── Soumission ────────────────────────────────────────────────────────────────
  async function handleSave(statut: 'brouillon' | 'publie') {
    setSaving(statut);
    setError('');
    try {
      const payload = {
        ...form,
        lignesBudget,
        statut,
        ...(projetId ? { id: projetId } : {}),
      };
      const res = await fetch('/api/projets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(statut === 'publie' ? 'Projet publié avec succes !' : 'Brouillon enregistre !');
        // For new projects, navigate to the edit page so further saves update instead of creating duplicates
        if (!projetId && data.projet?.id) {
          const listPath = basePath ?? '/animateur/projets';
          router.push(`${listPath}/${data.projet.id}`);
        }
        router.refresh();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setError(data.error ?? "Erreur lors de l'enregistrement.");
      }
    } catch {
      setError('Erreur de connexion.');
    } finally {
      setSaving(null);
    }
  }

  const isPublished = initialData?.statut === 'publie';

  return (
    <div className="max-w-3xl space-y-6">
      {/* Bandeau statut */}
      <div className={`flex items-center justify-between px-5 py-3 rounded-xl border ${
        isPublished
          ? 'bg-green-50 border-green-200'
          : 'bg-amber-50 border-amber-200'
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-lg">{isPublished ? '🟢' : '✏️'}</span>
          <span className={`text-sm font-bold ${isPublished ? 'text-green-700' : 'text-amber-700'}`}>
            {isPublished ? 'Projet publié — visible par tous' : 'Mode brouillon — visible par vous uniquement'}
          </span>
        </div>
        {isPublished && (
          <span className="text-xs text-green-600 bg-green-100 px-2.5 py-1 rounded-full font-medium">Publié</span>
        )}
      </div>

      {successMsg && (
        <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm font-semibold">
          {successMsg}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Fiche d'identité */}
      <Section title="📋 Fiche d'identité synthétique">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Nom du projet <span className="text-red-400">*</span>
          </label>
          <AutoInput value={form.titre} onChange={v => setField('titre', v)} placeholder="Titre du projet" required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Date de dépôt du projet</label>
            <AutoInput value={form.dateDepot} onChange={v => setField('dateDepot', v)} type="date" className="w-full" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Durée</label>
            <AutoInput value={form.duree} onChange={v => setField('duree', v)} placeholder="Ex : 3 jours, 2 semaines..." />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Lieu</label>
          <AutoInput value={form.lieu} onChange={v => setField('lieu', v)} placeholder="Lieu du projet" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Objectif(s) du projet</label>
          <AutoTextarea value={form.objectifsSynthetiques} onChange={v => setField('objectifsSynthetiques', v)} minRows={2} placeholder="Résumé des objectifs..." />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Public cible</label>
          <select
            value={form.publicCible}
            onChange={e => setField('publicCible', e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 focus:border-[#1B3870] bg-white"
          >
            <option value="">— Sélectionner un public —</option>
            {PUBLIC_CIBLE_OPTIONS.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      </Section>

      {/* Présentation */}
      <Section title="📝 Présentation du projet">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Constat / Contexte</label>
          <AutoTextarea value={form.constat} onChange={v => setField('constat', v)} minRows={3} placeholder="Décrivez le contexte et le constat de départ..." />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Objectifs (un par ligne)</label>
          <AutoTextarea value={form.objectifs} onChange={v => setField('objectifs', v)} minRows={4} placeholder="- Objectif 1&#10;- Objectif 2..." />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Résultats attendus (quantitatifs et qualitatifs)</label>
          <AutoTextarea value={form.resultatsAttendus} onChange={v => setField('resultatsAttendus', v)} minRows={3} placeholder="Résultats mesurables attendus..." />
        </div>
      </Section>

      {/* Déroulement */}
      <Section title="🗓 Déroulement">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Description du déroulement</label>
          <AutoTextarea value={form.deroulement} onChange={v => setField('deroulement', v)} minRows={4} placeholder="Décrivez les étapes du projet..." />
        </div>
      </Section>

      {/* Moyens */}
      <Section title="🔧 Moyens">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Moyens humains</label>
          <AutoTextarea value={form.moyensHumains} onChange={v => setField('moyensHumains', v)} minRows={2} placeholder="Animateurs, bénévoles, intervenants..." />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Moyens matériels</label>
          <AutoTextarea value={form.moyensMateriels} onChange={v => setField('moyensMateriels', v)} minRows={2} placeholder="Équipements, locaux, matériel..." />
        </div>

        {/* Budget */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">💰 Budget prévisionnel</label>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            {/* En-tête tableau */}
            <div className="grid grid-cols-[1fr_140px_36px] gap-0 bg-gray-50 border-b border-gray-200">
              <div className="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">Désignation de la dépense</div>
              <div className="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider border-l border-gray-200 text-right">Coût (€)</div>
              <div />
            </div>

            {/* Lignes */}
            {lignesBudget.map((ligne, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_140px_36px] gap-0 border-b border-gray-100 last:border-b-0 group">
                <div className="px-2 py-1.5">
                  <input
                    type="text"
                    value={ligne.designation}
                    onChange={e => setBudgetLine(idx, 'designation', e.target.value)}
                    placeholder="Ex : Location de salle"
                    className="w-full px-2 py-1.5 text-sm border-0 focus:outline-none focus:bg-blue-50 rounded-lg transition-colors placeholder-gray-300"
                  />
                </div>
                <div className="px-2 py-1.5 border-l border-gray-100">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={ligne.cout}
                    onChange={e => setBudgetLine(idx, 'cout', e.target.value)}
                    placeholder="0,00"
                    className="w-full px-2 py-1.5 text-sm text-right border-0 focus:outline-none focus:bg-blue-50 rounded-lg transition-colors font-mono placeholder-gray-300"
                  />
                </div>
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => removeBudgetLine(idx)}
                    disabled={lignesBudget.length === 1}
                    className="w-6 h-6 rounded-md text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors text-xs disabled:opacity-0"
                    title="Supprimer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            {/* Total */}
            <div className="grid grid-cols-[1fr_140px_36px] gap-0 bg-gray-50 border-t-2 border-gray-200">
              <div className="px-3 py-2.5 text-sm font-bold text-gray-700">TOTAL</div>
              <div className="px-3 py-2.5 text-sm font-bold text-[#1B3870] text-right border-l border-gray-200 font-mono">
                {totalBudget.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
              </div>
              <div />
            </div>
          </div>

          <button
            type="button"
            onClick={addBudgetLine}
            className="mt-2 flex items-center gap-1.5 text-sm text-[#1B3870] hover:text-[#162d5e] font-medium transition-colors"
          >
            <span className="w-5 h-5 rounded-full bg-[#1B3870]/10 flex items-center justify-center text-xs font-bold">+</span>
            Ajouter une ligne
          </button>
        </div>
      </Section>

      {/* Partenaires */}
      <Section title="🤝 Partenaires">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Partenaires impliqués</label>
          <AutoTextarea value={form.partenaires} onChange={v => setField('partenaires', v)} minRows={2} placeholder="Associations, institutions, entreprises..." />
        </div>
      </Section>

      {/* Communication */}
      <Section title="📣 Modes de communication">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Communication prévue</label>
          <AutoTextarea value={form.modesCommunication} onChange={v => setField('modesCommunication', v)} minRows={2} placeholder="Flyers, réseaux sociaux, affichage..." />
        </div>
      </Section>

      {/* Rétro-planning */}
      <Section title="📅 Rétro-planning">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Étapes et dates clés</label>
          <AutoTextarea value={form.retroPlanning} onChange={v => setField('retroPlanning', v)} minRows={4} placeholder="J-30 : …&#10;J-15 : …&#10;J-7 : …" />
        </div>
      </Section>

      {/* Évaluation */}
      <Section title="📊 Outils d'évaluation / Bilan">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Outils d'évaluation prévus</label>
          <AutoTextarea value={form.outilsEvaluation} onChange={v => setField('outilsEvaluation', v)} minRows={3} placeholder="Questionnaires, observations, bilans..." />
        </div>
      </Section>

      {/* Boutons d'action */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Enregistrement</p>
        <div className="flex gap-3">
          {/* Enregistrer brouillon */}
          <button
            type="button"
            onClick={() => handleSave('brouillon')}
            disabled={saving !== null}
            className="flex-1 py-3 border-2 border-[#1B3870] text-[#1B3870] font-bold rounded-xl hover:bg-[#1B3870]/5 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving === 'brouillon' ? '⟳ Enregistrement...' : '✏️ Enregistrer en brouillon'}
          </button>

          {/* Publier */}
          <button
            type="button"
            onClick={() => handleSave('publie')}
            disabled={saving !== null || !form.titre}
            className="flex-1 py-3 bg-[#1B3870] text-white font-bold rounded-xl hover:bg-[#162d5e] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving === 'publie' ? '⟳ Publication...' : '🚀 Publier le projet'}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center">
          {isPublished
            ? 'Le projet est publié. Vous pouvez le repasser en brouillon en enregistrant.'
            : 'Le brouillon n\'est visible que par vous. Publiez pour le partager avec l\'équipe.'}
        </p>
        <button
          type="button"
          onClick={() => router.back()}
          className="w-full py-2 text-gray-500 text-sm hover:text-gray-700 transition-colors"
        >
          ← Retour sans sauvegarder
        </button>
      </div>
    </div>
  );
}
