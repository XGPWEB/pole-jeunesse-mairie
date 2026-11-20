export const dynamic = 'force-dynamic';
import { notFound } from 'next/navigation';
import { getTenantId } from '@/lib/auth';
import Link from 'next/link';
import { query, queryOne } from '@/lib/db';
import { colonnesSanteSql } from '@/lib/jeune-sante';
import FicheJeuneForm from '../../FicheJeuneForm';
import { listerEspacesCommune } from '@/lib/espaces';

export default async function ModifierJeunePage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const [jeuneRow, contacts, espaces] = await Promise.all([
    queryOne<any>(`
      SELECT id, nom, prenom, date_naissance::text AS "dateNaissance", sexe, secteur, espace_id AS "espaceId",
             etablissement, classe, observations, adresse,
             autorisation_sortie AS "autorisationSortie",
             autorisation_photo AS "autorisationPhoto",
             autorisation_soins_benins AS "autorisationSoinsBenins",
             (fiche_agora IS NOT NULL) AS "hasFicheAgora",
             fiche_agora_nom AS "ficheAgoraNom",
             (fiche_sante IS NOT NULL) AS "hasFicheSante",
             fiche_sante_nom AS "ficheSanteNom",
             ${colonnesSanteSql()}
      FROM jeunes WHERE id = $1 AND tenant_id = $2
    `, [params.id, tenant_id]),
    query<any>(`
      SELECT jc.nom, jc.lien, jc.email, jc.telephone
      FROM jeunes_contacts jc
      JOIN jeunes j ON j.id = jc.jeune_id
      WHERE jc.jeune_id = $1 AND j.tenant_id = $2
      ORDER BY jc.id
    `, [params.id, tenant_id]),
    listerEspacesCommune(tenant_id),
  ]);
  if (!jeuneRow) notFound();
  const jeune = { ...jeuneRow, contacts };

  return (
    <div>
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/admin/jeunes" className="text-gray-400 hover:text-[#6B1A6E] text-sm font-medium transition-colors">
            ← Fiches Jeunes
          </Link>
          <span className="text-gray-300">/</span>
          <Link href={`/admin/jeunes/${jeune.id}`} className="text-gray-400 hover:text-[#6B1A6E] text-sm font-medium transition-colors">
            {jeune.prenom} {jeune.nom.toUpperCase()}
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">
              ✏️ Modifier — {jeune.prenom} <span className="uppercase">{jeune.nom}</span>
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Modifier les informations de la fiche</p>
          </div>
        </div>
      </div>

      <FicheJeuneForm
        mode="modification"
        jeuneId={jeune.id}
        initial={jeune}
        espaces={espaces}
      />
    </div>
  );
}
