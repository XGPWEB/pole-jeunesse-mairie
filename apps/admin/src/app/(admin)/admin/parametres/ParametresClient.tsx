'use client';

import { useState, useCallback } from 'react';

interface GeneralData {
  nomPole: string;
  ville: string;
  adresse: string;
  telephone: string;
  email: string;
}

interface SecuriteData {
  dureeSessionJours: number;
  longueurMdpMin: number;
  alerteContratJours: number;
}

interface DonneesData {
  sauvegardeAuto: boolean;
  retentionSauvegardes: number;
}

export interface ParametresData {
  general: GeneralData;
  securite: SecuriteData;
  donnees: DonneesData;
}

interface ToastState {
  visible: boolean;
  message: string;
  type: 'success' | 'error';
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  if (!toast.visible) return null;
  return (
    <div className="fixed top-6 right-6 z-50 animate-fade-in">
      <div
        className={`flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}
      >
        <span>{toast.type === 'success' ? '\u2713' : '\u2717'}</span>
        <span>{toast.message}</span>
        <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">\u00d7</button>
      </div>
    </div>
  );
}

function SectionCard({
  titre,
  description,
  children,
  saving,
  onSave,
}: {
  titre: string;
  description: string;
  children: React.ReactNode;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <div className="mb-5">
        <h2 className="font-bold text-gray-800 text-lg">{titre}</h2>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
      <div className="mt-6 pt-4 border-t border-gray-100">
        <button
          onClick={onSave}
          disabled={saving}
          className="bg-[#6B1A6E] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#551558] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <label className="text-sm font-medium text-gray-600 w-48 shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/20 focus:border-[#6B1A6E] transition-colors"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/20 focus:border-[#6B1A6E] transition-colors"
      />
      {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-[#6B1A6E]' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function ParametresClient({ initial }: { initial: ParametresData }) {
  const [general, setGeneral] = useState<GeneralData>(initial.general);
  const [securite, setSecurite] = useState<SecuriteData>(initial.securite);
  const [donnees, setDonnees] = useState<DonneesData>(initial.donnees);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: '', type: 'success' });

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ visible: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  }, []);

  const saveSection = useCallback(
    async (section: string, data: GeneralData | SecuriteData | DonneesData) => {
      setSavingSection(section);
      try {
        const res = await fetch('/api/parametres', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [section]: data }),
        });
        const result = await res.json();
        if (result.success) {
          showToast('Parametres enregistres avec succes', 'success');
        } else {
          showToast(result.error || 'Erreur lors de la sauvegarde', 'error');
        }
      } catch {
        showToast('Erreur reseau', 'error');
      } finally {
        setSavingSection(null);
      }
    },
    [showToast]
  );

  const updateGeneral = <K extends keyof GeneralData>(key: K, value: GeneralData[K]) => {
    setGeneral((prev) => ({ ...prev, [key]: value }));
  };

  const updateSecurite = <K extends keyof SecuriteData>(key: K, value: SecuriteData[K]) => {
    setSecurite((prev) => ({ ...prev, [key]: value }));
  };

  const updateDonnees = <K extends keyof DonneesData>(key: K, value: DonneesData[K]) => {
    setDonnees((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <>
      <Toast toast={toast} onClose={() => setToast((t) => ({ ...t, visible: false }))} />

      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
      `}</style>

      <div className="p-8 space-y-6 max-w-2xl">
        {/* Informations generales */}
        <SectionCard
          titre="Informations generales"
          description="Coordonnees et identite du pole jeunesse"
          saving={savingSection === 'general'}
          onSave={() => saveSection('general', general)}
        >
          <Field label="Nom du pole">
            <TextInput value={general.nomPole} onChange={(v) => updateGeneral('nomPole', v)} />
          </Field>
          <Field label="Ville">
            <TextInput value={general.ville} onChange={(v) => updateGeneral('ville', v)} />
          </Field>
          <Field label="Adresse">
            <TextInput value={general.adresse} onChange={(v) => updateGeneral('adresse', v)} />
          </Field>
          <Field label="Telephone">
            <TextInput value={general.telephone} onChange={(v) => updateGeneral('telephone', v)} type="tel" />
          </Field>
          <Field label="Email">
            <TextInput value={general.email} onChange={(v) => updateGeneral('email', v)} type="email" />
          </Field>
        </SectionCard>

        {/* Securite & Sessions */}
        <SectionCard
          titre="Securite & Sessions"
          description="Politique de mots de passe et gestion des sessions"
          saving={savingSection === 'securite'}
          onSave={() => saveSection('securite', securite)}
        >
          <Field label="Duree de session">
            <NumberInput
              value={securite.dureeSessionJours}
              onChange={(v) => updateSecurite('dureeSessionJours', v)}
              min={1}
              max={365}
              suffix="jours"
            />
          </Field>
          <Field label="Longueur MDP minimum">
            <NumberInput
              value={securite.longueurMdpMin}
              onChange={(v) => updateSecurite('longueurMdpMin', v)}
              min={4}
              max={64}
              suffix="caracteres"
            />
          </Field>
          <Field label="Alerte contrat avant expiration">
            <NumberInput
              value={securite.alerteContratJours}
              onChange={(v) => updateSecurite('alerteContratJours', v)}
              min={1}
              max={365}
              suffix="jours"
            />
          </Field>
        </SectionCard>

        {/* Donnees & Sauvegardes */}
        <SectionCard
          titre="Donnees & Sauvegardes"
          description="Configuration de la sauvegarde et retention des donnees"
          saving={savingSection === 'donnees'}
          onSave={() => saveSection('donnees', donnees)}
        >
          <Field label="Sauvegarde automatique">
            <Toggle checked={donnees.sauvegardeAuto} onChange={(v) => updateDonnees('sauvegardeAuto', v)} />
          </Field>
          <Field label="Retention des sauvegardes">
            <NumberInput
              value={donnees.retentionSauvegardes}
              onChange={(v) => updateDonnees('retentionSauvegardes', v)}
              min={1}
              max={100}
              suffix="sauvegardes"
            />
          </Field>
        </SectionCard>
      </div>
    </>
  );
}
