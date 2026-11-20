import { aDesRenseignementsMedicaux, libelleTriEtat, type SanteJeune } from '@/lib/jeune-sante';

const dateFr = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR') : '—');

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-400 mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-700 whitespace-pre-line">{children}</dd>
    </div>
  );
}

/** Renseignements sanitaires d'un jeune, sur sa fiche (administration et animateurs). */
export default function SanteJeuneCard({ jeune }: { jeune: SanteJeune }) {
  const autorisations: [string, boolean | null][] = [
    ['🚑 Mesures d’urgence', jeune.autorisationMesuresUrgence],
    ['🚶 Sortir seul', jeune.autorisationSortirSeul],
    ['👥 Sortir avec un mineur de + 11 ans', jeune.autorisationSortirAccompagne],
  ];
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest mb-4">🩺 Santé</h2>

      <div className="space-y-2.5 mb-4 pb-4 border-b border-gray-100">
        {autorisations.map(([label, v]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-sm text-gray-600">{label}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${
              v === true ? 'bg-green-50 text-green-700 border-green-200'
                : v === false ? 'bg-red-50 text-red-600 border-red-200'
                : 'bg-gray-50 text-gray-500 border-gray-200'
            }`}>
              {libelleTriEtat(v)}
            </span>
          </div>
        ))}
      </div>

      {!aDesRenseignementsMedicaux(jeune) ? (
        <p className="text-sm text-gray-400">Aucun renseignement médical saisi.</p>
      ) : (
        <dl className="space-y-3">
          {jeune.allergies && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <dt className="text-xs font-bold text-red-600 mb-0.5">Allergies</dt>
              <dd className="text-sm text-red-800 whitespace-pre-line">{jeune.allergies}</dd>
            </div>
          )}
          {jeune.maladies && <Ligne label="Maladies / traitements">{jeune.maladies}</Ligne>}
          {jeune.regimes && <Ligne label="Régimes alimentaires">{jeune.regimes}</Ligne>}
          {(jeune.medecinNom || jeune.medecinTelephone) && (
            <Ligne label="Médecin traitant">{[jeune.medecinNom, jeune.medecinTelephone].filter(Boolean).join(' — ')}</Ligne>
          )}
          {(jeune.assuranceCompagnie || jeune.assurancePolice) && (
            <Ligne label="Assurance">{[jeune.assuranceCompagnie, jeune.assurancePolice && `police n° ${jeune.assurancePolice}`].filter(Boolean).join(' — ')}</Ligne>
          )}
          {(jeune.hospitalisation || jeune.lieuHospitalisation) && (
            <Ligne label="Hospitalisation">{[jeune.hospitalisation, jeune.lieuHospitalisation].filter(Boolean).join(' — ')}</Ligne>
          )}
          {jeune.vaccins.length > 0 && (
            <div>
              <dt className="text-xs text-gray-400 mb-1">Vaccins — dernier rappel</dt>
              <dd>
                <ul className="space-y-1">
                  {jeune.vaccins.map((v, i) => (
                    <li key={i} className="flex justify-between gap-3 text-sm text-gray-700">
                      <span className="min-w-0 truncate">{v.nom}</span>
                      <span className="text-gray-500 shrink-0">{dateFr(v.date)}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
