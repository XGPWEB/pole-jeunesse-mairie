export const dynamic = 'force-dynamic';
import { notFound } from 'next/navigation';
import { getTenantId } from '@/lib/auth';
import { queryOne, query } from '@/lib/db';
import { getAge } from '@/lib/dates';
import { aDesRenseignementsMedicaux, colonnesSanteSql, libelleTriEtat, type SanteJeune } from '@/lib/jeune-sante';
import SelectionFiches from './SelectionFiches';

/**
 * Fiches sanitaires des participants d'une sortie : une page A4 par jeune,
 * composée à partir de sa fiche. Page distincte de la fiche sortie et ouverte
 * à la demande — rien n'est imprimé d'office, et l'animateur choisit les
 * jeunes dont il lui manque la fiche.
 */

interface Participant extends SanteJeune {
  id: string;
  nom: string;
  prenom: string;
  dateNaissance: string | null;
  sexe: string | null;
  adresse: string | null;
  observations: string | null;
  autorisationPhoto: boolean | null;
  autorisationSoinsBenins: boolean | null;
  aFicheAgora: boolean;
  contacts: { nom: string | null; lien: string | null; telephone: string | null }[];
}

const dateFr = (iso: string | null | undefined) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR') : '—');

const css = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10.5pt; color: #1a1a1a; background: #eef0f4; }

  .selection { max-width: 210mm; margin: 16px auto; background: white; border: 1px solid #d1d5db; border-radius: 8px; padding: 14px 18px; }
  .selection-tete { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
  .selection-aide { font-size: 9pt; color: #666; margin-top: 2px; }
  .selection-actions { display: flex; align-items: center; gap: 12px; }
  .selection .lien { background: none; border: none; color: #1B3870; font-size: 9.5pt; cursor: pointer; text-decoration: underline; }
  .selection .imprimer { background: #1B3870; color: white; border: none; padding: 9px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 10pt; }
  .selection .imprimer:disabled { opacity: 0.4; cursor: not-allowed; }
  .selection-liste { list-style: none; margin-top: 10px; columns: 2; column-gap: 24px; }
  .selection-liste li { break-inside: avoid; padding: 3px 0; font-size: 9.5pt; }
  .selection-liste label { cursor: pointer; }
  .selection-liste input { margin-right: 6px; }
  .selection-liste .nom { font-weight: 600; }
  .selection-liste .vide { display: block; margin-left: 22px; font-size: 8.5pt; color: #b45309; }
  .selection-liste a { display: block; margin-left: 22px; font-size: 8.5pt; color: #1B3870; }

  .page { width: 210mm; min-height: 297mm; margin: 0 auto 16px; padding: 12mm 15mm 10mm; background: white; }

  .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 3px solid #1B3870; padding-bottom: 10px; margin-bottom: 8px; }
  .header-logo .mairie { font-size: 9pt; color: #666; letter-spacing: 1px; text-transform: uppercase; }
  .header-logo .pole { font-size: 18pt; font-weight: 900; color: #1B3870; }
  .header-logo .pole span { color: #A8D8EA; }
  .header-right { text-align: right; font-size: 9pt; color: #444; }
  .doc-title { font-size: 14pt; font-weight: 900; color: #1B3870; }

  .tricolore { height: 4px; display: flex; margin-bottom: 12px; border-radius: 2px; overflow: hidden; }
  .tricolore .b { background: #6B1A6E; flex: 3; }
  .tricolore .g { background: #8DC63F; flex: 1; }
  .tricolore .c { background: #29B5E8; flex: 1; }

  h1 { font-size: 17pt; font-weight: 900; margin-bottom: 2px; }
  .sous-titre { font-size: 10pt; color: #444; margin-bottom: 10px; }

  .section-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1B3870; border-bottom: 1px solid #d1d5db; padding-bottom: 3px; margin: 12px 0 6px; }

  .grille { display: grid; grid-template-columns: 42mm 1fr; border: 1px solid #d1d5db; border-radius: 4px; overflow: hidden; }
  .grille > .l { background: #eff6ff; font-weight: 600; padding: 5px 9px; font-size: 9.5pt; border-bottom: 1px solid #e5e7eb; color: #1B3870; }
  .grille > .v { padding: 5px 9px; font-size: 9.5pt; border-bottom: 1px solid #e5e7eb; border-left: 1px solid #e5e7eb; white-space: pre-line; }

  .alerte { border: 1.5px solid #e53e3e; border-radius: 5px; padding: 7px 11px; background: #fff5f5; }
  .alerte .t { font-size: 8.5pt; font-weight: 700; color: #c53030; text-transform: uppercase; letter-spacing: 0.3px; }
  .alerte .c { font-size: 11pt; font-weight: 700; white-space: pre-line; margin-top: 2px; }
  .neant { color: #777; font-weight: 400; font-style: italic; }

  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { background: #1B3870; color: white; padding: 5px 8px; text-align: left; font-size: 9pt; }
  td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; }
  .vaccins { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8mm; }
  .vaccins > div { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; border-bottom: 1px solid #f1f5f9; font-size: 9.5pt; }

  .autorisations { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8mm; font-size: 9.5pt; }
  .autorisations > div { display: flex; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding: 3px 0; }
  .oui { font-weight: 700; color: #166534; }
  .non { font-weight: 700; color: #c53030; }
  .nr { color: #777; font-style: italic; }

  .urgences { margin-top: 14px; border: 1.5px solid #e53e3e; border-radius: 5px; display: flex; align-items: center; padding: 5px 12px; gap: 16px; font-size: 8.5pt; }
  .urgences b { color: #c53030; font-size: 10pt; margin-left: 3px; }
  .urgences .t { font-size: 8pt; font-weight: 700; color: #c53030; text-transform: uppercase; }
  .footer { margin-top: 8px; padding-top: 6px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 8pt; color: #999; }

  @media print {
    body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page { width: auto; min-height: 0; margin: 0; padding: 0; break-after: page; page-break-after: always; }
    .page:last-of-type { break-after: auto; page-break-after: auto; }
    @page { margin: 12mm 15mm; size: A4; }
  }
`;

function TriEtat({ v }: { v: boolean | null | undefined }) {
  return <span className={v === true ? 'oui' : v === false ? 'non' : 'nr'}>{libelleTriEtat(v)}</span>;
}

export default async function FichesSanitairesSortiePage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const [s, participants] = await Promise.all([
    queryOne<{ titre: string; date: string }>(
      'SELECT titre, date::text AS date FROM sorties WHERE id = $1 AND tenant_id = $2',
      [params.id, tenant_id],
    ),
    // Mêmes participants que la fiche sortie : les confirmés, pas la liste d'attente.
    // Le jeune est filtré par commune en plus de la sortie.
    query<Participant>(`
      SELECT j.id, j.nom, j.prenom, j.date_naissance::text AS "dateNaissance", j.sexe, j.adresse, j.observations,
             j.autorisation_photo AS "autorisationPhoto",
             j.autorisation_soins_benins AS "autorisationSoinsBenins",
             (j.fiche_sante IS NOT NULL) AS "aFicheAgora",
             ${colonnesSanteSql('j.')},
             COALESCE((
               SELECT json_agg(json_build_object('nom', c.nom, 'lien', c.lien, 'telephone', c.telephone) ORDER BY c.id)
               FROM jeunes_contacts c WHERE c.jeune_id = j.id
             ), '[]'::json) AS contacts
      FROM sorties_participants sp
      JOIN sorties s ON s.id = sp.sortie_id
      JOIN jeunes j ON j.id = sp.jeune_id
      WHERE sp.sortie_id = $1 AND s.tenant_id = $2 AND j.tenant_id = $2 AND NOT sp.en_attente
      ORDER BY j.nom, j.prenom
    `, [params.id, tenant_id]),
  ]);

  if (!s) notFound();

  const dateSortie = new Date(s.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const aujourdhui = new Date().toLocaleDateString('fr-FR');

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {participants.length === 0 ? (
        <div className="selection"><strong>Aucun participant confirmé pour cette sortie.</strong></div>
      ) : (
        <SelectionFiches fiches={participants.map((j, i) => ({
          ancre: `fiche-${i}`, jeuneId: j.id, nom: j.nom, prenom: j.prenom,
          renseignee: aDesRenseignementsMedicaux(j), aFicheAgora: j.aFicheAgora,
        }))} />
      )}

      {participants.map((j, i) => {
        const vaccins = Array.isArray(j.vaccins) ? j.vaccins : [];
        const identite = [
          j.dateNaissance ? `Né${j.sexe === 'F' ? 'e' : ''} le ${dateFr(j.dateNaissance)}${j.lieuNaissance ? ` à ${j.lieuNaissance}` : ''} — ${getAge(j.dateNaissance)} ans` : null,
          j.sexe === 'F' ? 'Fille' : j.sexe === 'M' ? 'Garçon' : null,
        ].filter(Boolean).join(' · ');
        return (
          <div key={j.id} id={`fiche-${i}`} className="page">
            <div className="header">
              <div className="header-logo">
                <div className="mairie">Mairie de Nogent-sur-Marne</div>
                <div className="pole"><span>PÔLE</span> JEUNESSE</div>
              </div>
              <div className="header-right">
                <div className="doc-title">FICHE SANITAIRE</div>
                <div style={{ marginTop: 4 }}>{s.titre}</div>
                <div style={{ marginTop: 2 }}>{dateSortie}</div>
              </div>
            </div>
            <div className="tricolore"><div className="b" /><div className="g" /><div className="c" /></div>

            <h1>{j.nom.toUpperCase()} {j.prenom}</h1>
            <div className="sous-titre">{identite || 'Date de naissance non renseignée'}{j.adresse ? ` — ${j.adresse}` : ''}</div>

            <div className="alerte">
              <div className="t">Allergies</div>
              <div className="c">{j.allergies || <span className="neant">Aucune allergie renseignée</span>}</div>
            </div>

            <div className="section-title">Personnes à prévenir</div>
            <table>
              <thead><tr><th>Nom</th><th style={{ width: '32%' }}>Lien</th><th style={{ width: '34%' }}>Téléphone</th></tr></thead>
              <tbody>
                {j.contacts.map((c, k) => (
                  <tr key={k}><td style={{ fontWeight: 600 }}>{c.nom || '—'}</td><td>{c.lien || '—'}</td><td>{c.telephone || '—'}</td></tr>
                ))}
                {j.contacts.length === 0 && (
                  <tr><td colSpan={3} className="neant">Aucun contact renseigné</td></tr>
                )}
              </tbody>
            </table>

            <div className="section-title">Renseignements médicaux</div>
            <div className="grille">
              <div className="l">Maladies / traitements</div><div className="v">{j.maladies || '—'}</div>
              <div className="l">Régimes alimentaires</div><div className="v">{j.regimes || '—'}</div>
              <div className="l">Médecin traitant</div><div className="v">{[j.medecinNom, j.medecinTelephone].filter(Boolean).join(' — ') || '—'}</div>
              <div className="l">Hospitalisation</div><div className="v">{[j.hospitalisation, j.lieuHospitalisation].filter(Boolean).join(' — ') || '—'}</div>
              <div className="l">Assurance</div><div className="v">{[j.assuranceCompagnie, j.assurancePolice && `police n° ${j.assurancePolice}`].filter(Boolean).join(' — ') || '—'}</div>
            </div>

            <div className="section-title">Vaccins — date du dernier rappel</div>
            {vaccins.length === 0 ? (
              <div className="neant" style={{ fontSize: '9.5pt' }}>Aucun vaccin renseigné</div>
            ) : (
              <div className="vaccins">
                {vaccins.map((v, k) => <div key={k}><span>{v.nom}</span><span>{dateFr(v.date)}</span></div>)}
              </div>
            )}

            <div className="section-title">Autorisations</div>
            <div className="autorisations">
              <div><span>Mesures d’urgence</span><TriEtat v={j.autorisationMesuresUrgence} /></div>
              <div><span>Soins bénins</span><TriEtat v={j.autorisationSoinsBenins} /></div>
              <div><span>Sortir seul, non accompagné</span><TriEtat v={j.autorisationSortirSeul} /></div>
              <div><span>Sortir avec un mineur de + 11 ans</span><TriEtat v={j.autorisationSortirAccompagne} /></div>
              <div><span>Photos / vidéos</span><TriEtat v={j.autorisationPhoto} /></div>
            </div>

            {j.observations && (
              <>
                <div className="section-title">Observations</div>
                <div style={{ fontSize: '9.5pt', whiteSpace: 'pre-line' }}>{j.observations}</div>
              </>
            )}

            <div className="urgences">
              <span className="t">Urgences :</span>
              <span>SAMU <b>15</b></span><span>Police <b>17</b></span><span>Pompiers <b>18</b></span>
              <span style={{ marginLeft: 'auto' }}>Pôle Jeunesse <b>01 88 29 65 40</b></span>
            </div>
            <div className="footer">
              <span>Document confidentiel — à remettre au Pôle Jeunesse au retour de la sortie</span>
              <span>Édité le {aujourdhui}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}
