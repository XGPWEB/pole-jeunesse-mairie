'use client';
import { useState, useEffect, useMemo } from 'react';

interface Reservation {
  id: string;
  vehicule: string;
  animateurNom: string;
  espaceId: string;
  dateDebut: string;
  dateFin: string;
  heureDepart: string;
  heureRetour: string;
  motif: string;
  statut: string;
  animateurId?: string;
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// ── Helpers de conflit (miroir de l'API) ──────────────────────────────────────
function toMin(t: string): number {
  if (!t) return 23 * 60 + 59;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
function horairesChevauchent(dep1: string, ret1: string, dep2: string, ret2: string): boolean {
  const s1 = toMin(dep1), e1 = toMin(ret1 || '23:59');
  const s2 = toMin(dep2), e2 = toMin(ret2 || '23:59');
  return s1 < e2 && e1 > s2;
}
function datesChevauchent(deb1: string, fin1: string, deb2: string, fin2: string): boolean {
  return deb1 <= fin2 && fin1 >= deb2;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function VehiculesClient() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showForm, setShowForm]         = useState(false);
  const [form, setForm]                 = useState({ dateDebut: '', dateFin: '', heureDepart: '', heureRetour: '', motif: '' });
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState('');
  const [showArchives, setShowArchives] = useState(false);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const [weekOffset, setWeekOffset]     = useState(0);

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + 1 + weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  useEffect(() => {
    fetch('/api/vehicules')
      .then(r => r.json())
      .then(d => { setReservations(d.reservations ?? []); setLoading(false); });
  }, []);

  function getResForDay(dateStr: string) {
    return reservations.filter(r =>
      r.statut !== 'annulee' && dateStr >= r.dateDebut && dateStr <= (r.dateFin ?? r.dateDebut)
    );
  }

  // ── Séparation actives / archives ─────────────────────────────────────────
  const actives = useMemo(() =>
    reservations
      .filter(r => r.statut !== 'annulee' && (r.dateFin ?? r.dateDebut) >= todayStr)
      .sort((a, b) => a.dateDebut.localeCompare(b.dateDebut)),
    [reservations, todayStr]
  );

  const archives = useMemo(() =>
    reservations
      .filter(r => r.statut !== 'annulee' && (r.dateFin ?? r.dateDebut) < todayStr)
      .sort((a, b) => b.dateDebut.localeCompare(a.dateDebut)), // plus récente en premier
    [reservations, todayStr]
  );

  // ── Détection conflit côté client (temps réel) ────────────────────────────
  const conflitPreview = useMemo(() => {
    if (!form.dateDebut || !form.heureDepart) return null;
    const fin = form.dateFin || form.dateDebut;
    return reservations.find(r => {
      if (r.statut === 'annulee') return false;
      const rFin = r.dateFin ?? r.dateDebut;
      if (!datesChevauchent(form.dateDebut, fin, r.dateDebut, rFin)) return false;
      return horairesChevauchent(form.heureDepart, form.heureRetour, r.heureDepart, r.heureRetour);
    }) ?? null;
  }, [form.dateDebut, form.dateFin, form.heureDepart, form.heureRetour, reservations]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (conflitPreview) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const res = await fetch('/api/vehicules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setReservations(data.reservations ?? []);
        setSuccess('Réservation enregistrée !');
        setShowForm(false);
        setForm({ dateDebut: '', dateFin: '', heureDepart: '', heureRetour: '', motif: '' });
      } else {
        setError(data.error ?? 'Erreur lors de la réservation.');
      }
    } catch {
      setError('Erreur de connexion.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Annuler cette réservation ?')) return;
    const res = await fetch(`/api/vehicules?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) setReservations(data.reservations ?? []);
  }

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;

  function ReservationRow({ r, isPast }: { r: Reservation; isPast?: boolean }) {
    const dateStr = r.dateDebut === (r.dateFin ?? r.dateDebut)
      ? formatDate(r.dateDebut)
      : `${formatDate(r.dateDebut)} → ${formatDate(r.dateFin ?? r.dateDebut)}`;
    return (
      <div className={`flex items-center gap-4 px-6 py-4 ${isPast ? 'opacity-60' : ''}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 ${isPast ? 'bg-gray-100' : 'bg-blue-50'}`}>
          🚐
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-800 text-sm">{r.motif}</p>
          <p className="text-xs text-gray-500">
            📅 {dateStr}
            {' · '}🕐 {r.heureDepart}{r.heureRetour ? ` – ${r.heureRetour}` : ''}
          </p>
          <p className="text-xs text-gray-400">{r.animateurNom} · {r.espaceId}</p>
        </div>
        {!isPast && (
          <button onClick={() => handleCancel(r.id)}
            className="text-sm text-red-400 hover:text-red-600 font-medium">
            Annuler
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {success && (
        <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
          ✅ {success}
        </div>
      )}

      {/* ── Calendrier semaine ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">🗓 Calendrier de réservation</h2>
          <div className="flex gap-2">
            <button onClick={() => setWeekOffset(w => w - 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">← Précédente</button>
            <button onClick={() => setWeekOffset(0)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Aujourd&apos;hui</button>
            <button onClick={() => setWeekOffset(w => w + 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Suivante →</button>
          </div>
        </div>

        <div className="grid grid-cols-7 divide-x divide-gray-100">
          {weekDays.map((d, i) => {
            const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const isToday = dateStr === todayStr;
            const dayRes  = getResForDay(dateStr);
            const isConflitDay = conflitPreview &&
              dateStr >= conflitPreview.dateDebut && dateStr <= (conflitPreview.dateFin ?? conflitPreview.dateDebut);
            return (
              <div key={i} className={`min-h-[130px] p-3 transition-colors ${isToday ? 'bg-blue-50/50' : ''} ${isConflitDay ? 'bg-red-50' : ''}`}>
                <div className={`text-center mb-2 ${isToday ? 'text-[#1B3870] font-bold' : 'text-gray-400'}`}>
                  <div className="text-xs">{DAY_LABELS[i]}</div>
                  <div className={`text-lg font-extrabold ${isToday ? 'bg-[#1B3870] text-white w-8 h-8 rounded-full flex items-center justify-center mx-auto' : ''}`}>
                    {d.getDate()}
                  </div>
                </div>
                {dayRes.map(r => (
                  <div key={r.id}
                    className={`rounded-lg px-2 py-1.5 mb-1 ${isConflitDay && horairesChevauchent(form.heureDepart, form.heureRetour, r.heureDepart, r.heureRetour) ? 'bg-red-100 border border-red-300' : 'bg-[#1B3870]/10'}`}>
                    <p className={`text-[10px] font-semibold truncate ${isConflitDay ? 'text-red-700' : 'text-[#1B3870]'}`}>
                      {r.animateurNom}
                    </p>
                    <p className={`text-[9px] ${isConflitDay ? 'text-red-500' : 'text-[#1B3870]/70'}`}>
                      {r.heureDepart}{r.heureRetour ? `–${r.heureRetour}` : ''}
                    </p>
                    <p className="text-[9px] text-gray-400 truncate">{r.motif}</p>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Bouton nouvelle réservation ── */}
      <button onClick={() => { setShowForm(!showForm); setError(''); }}
        className="flex items-center gap-2 px-6 py-3 bg-[#1B3870] text-white font-bold rounded-xl hover:bg-[#162d5e] transition-colors">
        🚐 {showForm ? 'Annuler' : 'Nouvelle réservation'}
      </button>

      {/* ── Formulaire ── */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-bold text-gray-800 mb-5">Nouvelle réservation — Renault Trafic</h3>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              ⚠️ {error}
            </div>
          )}

          {conflitPreview && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-300 rounded-xl">
              <p className="text-sm font-bold text-red-700 mb-1">🚫 Créneau indisponible</p>
              <p className="text-sm text-red-600">
                Le véhicule est déjà réservé sur ce créneau par{' '}
                <strong>{conflitPreview.animateurNom}</strong>{' '}
                de <strong>{conflitPreview.heureDepart}</strong>
                {conflitPreview.heureRetour ? <> à <strong>{conflitPreview.heureRetour}</strong></> : ''}{' '}
                — <em>{conflitPreview.motif}</em>
              </p>
              <p className="text-xs text-red-400 mt-1">
                Modifiez vos horaires pour trouver un créneau disponible.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Date de départ *</label>
              <input type="date" required value={form.dateDebut}
                onChange={e => setForm(f => ({ ...f, dateDebut: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Date de retour</label>
              <input type="date" value={form.dateFin} min={form.dateDebut}
                onChange={e => setForm(f => ({ ...f, dateFin: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Heure de départ *</label>
              <input type="time" required value={form.heureDepart}
                onChange={e => setForm(f => ({ ...f, heureDepart: e.target.value }))}
                className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 ${conflitPreview ? 'border-red-300 bg-red-50 focus:ring-red-200' : 'border-gray-200 focus:ring-[#1B3870]/30'}`}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Heure de retour</label>
              <input type="time" value={form.heureRetour}
                onChange={e => setForm(f => ({ ...f, heureRetour: e.target.value }))}
                className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 ${conflitPreview ? 'border-red-300 bg-red-50 focus:ring-red-200' : 'border-gray-200 focus:ring-[#1B3870]/30'}`}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Motif / Destination *</label>
              <input type="text" required placeholder="Ex: Sortie au cinéma, Tournoi sportif..." value={form.motif}
                onChange={e => setForm(f => ({ ...f, motif: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30"
              />
            </div>
            <div className="col-span-2">
              <button type="submit" disabled={saving || !!conflitPreview}
                className="w-full py-3 bg-[#1B3870] text-white font-bold rounded-xl hover:bg-[#162d5e] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving
                  ? '⟳ Enregistrement...'
                  : conflitPreview
                    ? '🚫 Créneau indisponible — modifiez les horaires'
                    : '✅ Confirmer la réservation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Réservations à venir / en cours ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">🚐 Réservations à venir</h2>
          {actives.length > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">
              {actives.length}
            </span>
          )}
        </div>
        {actives.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400">
            <div className="text-3xl mb-2">🗓</div>
            <p className="text-sm">Aucune réservation à venir.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {actives.map(r => <ReservationRow key={r.id} r={r} />)}
          </div>
        )}
      </div>

      {/* ── Archives ── */}
      {archives.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowArchives(v => !v)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-gray-400">🗂</span>
              <span className="font-semibold text-gray-500 text-sm">Archives — réservations passées</span>
              <span className="text-xs bg-gray-100 text-gray-500 font-semibold px-2 py-0.5 rounded-full">
                {archives.length}
              </span>
            </div>
            <span className="text-gray-400 text-sm">{showArchives ? '▲ Replier' : '▼ Afficher'}</span>
          </button>

          {showArchives && (
            <div className="divide-y divide-gray-50 border-t border-gray-100">
              {archives.map(r => <ReservationRow key={r.id} r={r} isPast />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
