import { query, queryOne } from '@/lib/db';
import { colonnesSanteSql } from '@/lib/jeune-sante';
import { getTenantId } from '@/lib/auth';
import { notFound } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import FicheJeuneForm from '@/app/jeunes/FicheJeuneForm';
import { listerEspacesCommune } from '@/lib/espaces';

export const dynamic = 'force-dynamic';

export default async function ModifierJeuneAnimateurPage({ params: props_params }: { params: Promise<{ id: string }> }) {
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
      <PageHeader titre={`${jeune.prenom} ${jeune.nom}`} sousTitre="Modifier la fiche" />
      <FicheJeuneForm mode="modification" jeuneId={jeune.id} initial={jeune} espaces={espaces} returnPrefix="/animateur/jeunes" />
    </div>
  );
}
