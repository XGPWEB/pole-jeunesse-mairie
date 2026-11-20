import { getTenantId } from '@/lib/auth';
import { query } from '@/lib/db';
import { getSession } from '@/lib/session';
import PageHeader from '@/components/PageHeader';
import EspaceBadge from '@/components/EspaceBadge';
import { formatDate } from '@/lib/data';
import { todayLocal } from '@/lib/dates';

export const dynamic = 'force-dynamic';

function espaceIdFromLabel(label: string): string {
  const map: Record<string, string> = {
    'Collégiens': 'collegiens', 'Lycéens': 'lyceens', 'PIJ': 'pij', 'CLAS': 'clas',
  };
  return map[label] ?? label.toLowerCase();
}

export default async function EvenementsPage() {
  const tenant_id = await getTenantId();
  const session = await getSession();
  const espace = session?.espaceAssigne ?? 'Tous';
  const espaceId = espaceIdFromLabel(espace);

  const [evenements, activites] = await Promise.all([
    query<any>(`
      SELECT id, titre, description, date::text AS date, heure_debut AS "heureDebut", heure_fin AS "heureFin", lieu, espaces
      FROM evenements WHERE tenant_id = $1 ORDER BY date DESC
    `, [tenant_id]),
    query<any>(`
      SELECT a.id, a.titre, a.espace_id AS "espaceId",
             a.date::text AS date, a.heure_debut AS "heureDebut", a.heure_fin AS "heureFin"
      FROM activites a WHERE a.tenant_id = $1 ORDER BY a.date ASC
    `, [tenant_id]),
  ]);

  const today = todayLocal();

  const futuresActivites = activites
    .filter((a: any) =>
      a.date >= today &&
      (espace === 'Tous' || a.espaceId === espaceId)
    )
    .sort((a: any, b: any) => b.date.localeCompare(a.date));

  const futursEvenements = evenements
    .filter((e: any) => e.date >= today)
    .sort((a: any, b: any) => b.date.localeCompare(a.date));

  return (
    <div>
      <PageHeader titre="Événements" sousTitre="Agenda des événements à venir" />
      <div className="p-8 space-y-6">
        {/* Événements globaux */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-3">🏛 Événements Pôle Jeunesse ({futursEvenements.length})</h2>
          <div className="space-y-3">
            {futursEvenements.map((e: any) => (
              <div key={e.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex gap-4">
                <div className="w-16 h-16 rounded-xl bg-[#6B1A6E]/10 flex flex-col items-center justify-center shrink-0">
                  <span className="text-xl font-extrabold text-[#6B1A6E] leading-none">
                    {new Date(e.date).getDate()}
                  </span>
                  <span className="text-xs text-[#6B1A6E]/70 uppercase">
                    {new Date(e.date).toLocaleDateString('fr-FR', { month: 'short' })}
                  </span>
                </div>
                <div>
                  <p className="font-bold text-gray-800">{e.titre}</p>
                  <p className="text-sm text-gray-500 mt-0.5">{e.description}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    <span>🕐 {e.heureDebut} – {e.heureFin}</span>
                    <span>📍 {e.lieu}</span>
                  </div>
                </div>
              </div>
            ))}
            {futursEvenements.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
                Aucun événement à venir.
              </div>
            )}
          </div>
        </section>

        {/* Activités à venir de mon espace */}
        <section>
          <h2 className="text-base font-bold text-gray-700 mb-3">📅 Prochaines activités ({futuresActivites.length})</h2>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
            {futuresActivites.slice(0, 8).map((a: any) => (
              <div key={a.id} className="flex items-center gap-4 px-6 py-4">
                <div className="text-sm text-gray-400 w-24">{formatDate(a.date)}</div>
                <div className="flex-1">
                  <p className="font-medium text-gray-800 text-sm">{a.titre}</p>
                  <p className="text-xs text-gray-400">{a.heureDebut} – {a.heureFin}</p>
                </div>
                <EspaceBadge espaceId={a.espaceId} />
              </div>
            ))}
            {futuresActivites.length === 0 && (
              <div className="px-6 py-8 text-center text-gray-400 text-sm">Aucune activité à venir.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
