export const dynamic = 'force-dynamic';
import { notFound } from 'next/navigation';
import { getTenantId } from '@/lib/auth';
import { queryOne, query } from '@/lib/db';
import PrintButton from './PrintButton';

const printCss = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #1a1a1a; background: white; }
  .page { max-width: 210mm; margin: 0 auto; padding: 15mm; }

  .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #6B1A6E; padding-bottom: 12px; margin-bottom: 16px; }
  .header-logo .mairie { font-size: 9pt; color: #666; letter-spacing: 1px; text-transform: uppercase; }
  .header-logo .pole { font-size: 18pt; font-weight: 900; color: #6B1A6E; }
  .header-logo .pole span { color: #A8D8EA; }
  .header-meta { text-align: right; font-size: 9pt; color: #666; }

  .tricolore { height: 4px; display: flex; margin-bottom: 20px; border-radius: 2px; overflow: hidden; }
  .tricolore .b { background: #1B3870; flex: 3; }
  .tricolore .g { background: #8DC63F; flex: 1; }
  .tricolore .c { background: #29B5E8; flex: 1; }

  h1 { font-size: 16pt; font-weight: 900; color: #1a1a1a; margin-bottom: 4px; }
  .subtitle { font-size: 10pt; color: #666; margin-bottom: 20px; }

  .section { margin-bottom: 16px; break-inside: avoid; }
  .section-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6B1A6E; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 8px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  td { padding: 5px 8px; font-size: 10pt; vertical-align: top; border: 1px solid #e5e7eb; }
  td.label { background: #f9f7ff; font-weight: 600; width: 35%; color: #6B1A6E; white-space: nowrap; }
  td.value { background: #fff; }

  .content-block { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 12px; font-size: 10pt; line-height: 1.5; white-space: pre-wrap; }

  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 8pt; color: #999; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    @page { margin: 15mm; size: A4; }
  }
`;

export default async function ProjetPrintPage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const [p, lignesBudget] = await Promise.all([
    queryOne<any>(`
      SELECT id, titre, animateur_nom AS "animateurNom", espace_id AS "espaceId",
             statut, date_depot::text AS "dateDepot", duree, lieu,
             objectifs_synthetiques AS "objectifsSynthetiques", public_cible AS "publicCible",
             constat, objectifs, resultats_attendus AS "resultatsAttendus", deroulement,
             moyens_humains AS "moyensHumains", moyens_materiels AS "moyensMateriels",
             partenaires, modes_communication AS "modesCommunication",
             retro_planning AS "retroPlanning", outils_evaluation AS "outilsEvaluation",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projets WHERE id = $1 AND tenant_id = $2
    `, [params.id, tenant_id]),
    // projets_budget n'a pas de tenant_id : la lecture est bornée par le projet parent.
    query<any>(`SELECT b.designation, b.cout FROM projets_budget b JOIN projets p ON p.id = b.projet_id
                WHERE b.projet_id = $1 AND p.tenant_id = $2 ORDER BY b.id`, [params.id, tenant_id]),
  ]);

  if (!p) notFound();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: printCss }} />
      <PrintButton color="#6B1A6E" />

      <div className="page">
        <div className="header">
          <div className="header-logo">
            <div className="mairie">Mairie de Nogent-sur-Marne</div>
            <div className="pole"><span>PÔLE</span> JEUNESSE</div>
          </div>
          <div className="header-meta">
            <strong>FICHE PROJET</strong><br />
            Créé le {new Date(p.createdAt).toLocaleDateString('fr-FR')}<br />
            Modifié le {new Date(p.updatedAt).toLocaleDateString('fr-FR')}
          </div>
        </div>

        <div className="tricolore">
          <div className="b" /><div className="g" /><div className="c" />
        </div>

        <h1>{p.titre}</h1>
        <p className="subtitle">{p.animateurNom} · {p.espaceId}</p>

        <div className="section">
          <div className="section-title">Fiche d'identité synthétique</div>
          <table>
            <tbody>
              {([
                ['Date de dépôt', p.dateDepot ? new Date(p.dateDepot).toLocaleDateString('fr-FR') : ''],
                ['Durée', p.duree],
                ['Lieu', p.lieu],
                ['Public cible', p.publicCible],
                ["Objectif(s)", p.objectifsSynthetiques],
              ] as [string, string][]).filter(r => r[1]).map(([label, value]) => (
                <tr key={label}>
                  <td className="label">{label}</td>
                  <td className="value">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(p.constat || p.objectifs || p.resultatsAttendus) && (
          <div className="section">
            <div className="section-title">Présentation du projet</div>
            {p.constat && (
              <>
                <p style={{ fontWeight: 600, fontSize: '10pt', marginBottom: 4 }}>Constat / Contexte :</p>
                <div className="content-block" style={{ marginBottom: 8 }}>{p.constat}</div>
              </>
            )}
            {p.objectifs && (
              <>
                <p style={{ fontWeight: 600, fontSize: '10pt', marginBottom: 4 }}>Objectifs :</p>
                <div className="content-block" style={{ marginBottom: 8 }}>{p.objectifs}</div>
              </>
            )}
            {p.resultatsAttendus && (
              <>
                <p style={{ fontWeight: 600, fontSize: '10pt', marginBottom: 4 }}>Résultats attendus :</p>
                <div className="content-block">{p.resultatsAttendus}</div>
              </>
            )}
          </div>
        )}

        {p.deroulement && (
          <div className="section">
            <div className="section-title">Déroulement</div>
            <div className="content-block">{p.deroulement}</div>
          </div>
        )}

        {(p.moyensHumains || p.moyensMateriels || lignesBudget.filter((l: any) => l.designation || l.cout).length > 0) && (
          <div className="section">
            <div className="section-title">Moyens</div>
            {(p.moyensHumains || p.moyensMateriels) && (
              <table style={{ marginBottom: 10 }}>
                <tbody>
                  {p.moyensHumains && <tr><td className="label">Humains</td><td className="value">{p.moyensHumains}</td></tr>}
                  {p.moyensMateriels && <tr><td className="label">Matériels</td><td className="value">{p.moyensMateriels}</td></tr>}
                </tbody>
              </table>
            )}

            {(() => {
              const lignes = lignesBudget.filter((l: any) => l.designation || l.cout);
              if (lignes.length === 0) return null;
              const total = lignes.reduce((s: number, l: any) => {
                const n = parseFloat(String(l.cout).replace(',', '.'));
                return s + (isNaN(n) ? 0 : n);
              }, 0);
              return (
                <>
                  <p style={{ fontWeight: 700, fontSize: '9pt', textTransform: 'uppercase', letterSpacing: '1px', color: '#6B1A6E', marginBottom: 6 }}>
                    Budget prévisionnel
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <td className="label" style={{ background: '#6B1A6E', color: '#fff', width: '70%' }}>Désignation de la dépense</td>
                        <td className="label" style={{ background: '#6B1A6E', color: '#fff', textAlign: 'right' }}>Coût (€)</td>
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.map((l: any, i: number) => (
                        <tr key={i}>
                          <td className="value">{l.designation}</td>
                          <td className="value" style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                            {l.cout ? `${parseFloat(String(l.cout).replace(',', '.')).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{ background: '#f9f7ff', fontWeight: 800, color: '#1B3870', padding: '6px 8px', borderTop: '2px solid #6B1A6E' }}>TOTAL</td>
                        <td style={{ background: '#f9f7ff', fontWeight: 800, color: '#1B3870', textAlign: 'right', fontFamily: 'monospace', padding: '6px 8px', borderTop: '2px solid #6B1A6E' }}>
                          {total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              );
            })()}
          </div>
        )}

        {p.partenaires && (
          <div className="section">
            <div className="section-title">Partenaires</div>
            <div className="content-block">{p.partenaires}</div>
          </div>
        )}

        {p.modesCommunication && (
          <div className="section">
            <div className="section-title">Modes de communication</div>
            <div className="content-block">{p.modesCommunication}</div>
          </div>
        )}

        {p.retroPlanning && (
          <div className="section">
            <div className="section-title">Rétro-planning</div>
            <div className="content-block">{p.retroPlanning}</div>
          </div>
        )}

        {p.outilsEvaluation && (
          <div className="section">
            <div className="section-title">Outils d'évaluation / Bilan</div>
            <div className="content-block">{p.outilsEvaluation}</div>
          </div>
        )}

        <div className="footer">
          <span>Pôle Jeunesse de Nogent-sur-Marne — Direction de la Jeunesse</span>
          <span>Document généré le {new Date().toLocaleDateString('fr-FR')}</span>
        </div>
      </div>
    </>
  );
}
