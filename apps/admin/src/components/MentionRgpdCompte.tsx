import rgpdData from '@/data/rgpd.json';

// ─── Mention d'information RGPD des comptes du personnel ─────────────────────
//
// Information due aux agents dont l'application traite les données (art. 13
// RGPD), affichée sur leur profil (/animateur/profil) et sur leur fiche dans
// l'administration (/animateurs/[id]).
//
// Le contenu vient du registre (src/data/rgpd.json, traitement « Gestion des
// comptes animateurs ») : la mention et le registre ne peuvent pas diverger.

const TRAITEMENT_COMPTES = 't4';

export default function MentionRgpdCompte({ titulaire = 'vous' }: { titulaire?: 'vous' | 'agent' }) {
  const traitement = rgpdData.registreTraitements.find((t) => t.id === TRAITEMENT_COMPTES);
  if (!traitement) return null;
  const { dpo } = rgpdData;
  const cnil = rgpdData.cadreJuridique.autoriteSurveillance;
  const vous = titulaire === 'vous';

  return (
    <section
      aria-labelledby="mention-rgpd-titre"
      className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-sm text-gray-700"
    >
      <h2 id="mention-rgpd-titre" className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
        <span aria-hidden="true">🔒</span> Protection des données personnelles
      </h2>

      <p className="mb-4">
        {vous
          ? 'Les informations de votre compte sont traitées par la '
          : 'Les informations de ce compte sont traitées par la '}
        <strong>{traitement.responsable}</strong>, responsable du traitement, pour la finalité
        suivante : {traitement.finalite.toLowerCase()}.
      </p>

      <dl className="grid gap-3 sm:grid-cols-[12rem_1fr] mb-4">
        <dt className="font-semibold text-gray-800">Base légale</dt>
        <dd>{traitement.baseJuridique} ({traitement.referenceRgpd})</dd>

        <dt className="font-semibold text-gray-800">Données traitées</dt>
        <dd>
          <ul className="list-disc pl-5 space-y-0.5">
            {traitement.categoriesDonnees.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </dd>

        <dt className="font-semibold text-gray-800">Destinataires</dt>
        <dd>{traitement.destinataires.join(', ')}. Aucun transfert hors de l&apos;Union européenne.</dd>

        <dt className="font-semibold text-gray-800">Conservation</dt>
        <dd>
          {traitement.dureeConservationActive}, puis archivage {traitement.dureeArchiveIntermediaire.toLowerCase()} ;
          {' '}{traitement.dureeArchiveDefinitive.charAt(0).toLowerCase() + traitement.dureeArchiveDefinitive.slice(1)}.
        </dd>

        <dt className="font-semibold text-gray-800">Sécurité</dt>
        <dd>{traitement.mesuresSecurite}.</dd>
      </dl>

      <p className="mb-3">
        {vous ? 'Vous disposez' : "L'agent dispose"} d&apos;un droit d&apos;accès, de rectification,
        d&apos;effacement et de limitation du traitement de {vous ? 'vos' : 'ses'} données.
        Pour l&apos;exercer, contacter le délégué à la protection des données :{' '}
        <a href={`mailto:${dpo.email}`} className="text-[#6B1A6E] font-medium hover:underline">{dpo.email}</a>
        {' '}— {dpo.adresse}.
      </p>
      <p className="mb-3">
        En cas de difficulté, une réclamation peut être adressée à la {cnil.nom} (
        <a href={cnil.site} target="_blank" rel="noopener noreferrer" className="text-[#6B1A6E] font-medium hover:underline">cnil.fr</a>).
      </p>
      <p className="text-gray-500">
        Confidentialité : ce compte donne accès à des données de mineurs, parfois de santé. Elles ne
        doivent être consultées et utilisées que pour les besoins du service, et ne jamais être
        communiquées à des tiers non autorisés.
      </p>
    </section>
  );
}
