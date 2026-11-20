export const dynamic = 'force-dynamic';
import { notFound } from 'next/navigation';
import { getTenantId } from '@/lib/auth';
import { queryOne, query } from '@/lib/db';
import PrintButton from './PrintButton';

function getContactsTel(jeune: any): string {
  const contacts: any[] = jeune?.contacts ?? [];
  const nums = contacts
    .filter((c: any) => c.telephone?.trim())
    .map((c: any) => `${c.lien ? c.lien + ' : ' : ''}${c.telephone.trim()}`);
  return nums.join(' / ') || '—';
}

const printCss = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #1a1a1a; background: white; }
  .page { max-width: 210mm; margin: 0 auto; padding: 12mm 15mm 10mm; }

  .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 3px solid #1B3870; padding-bottom: 12px; margin-bottom: 10px; }
  .header-logo .mairie { font-size: 9pt; color: #666; letter-spacing: 1px; text-transform: uppercase; }
  .header-logo .pole { font-size: 18pt; font-weight: 900; color: #1B3870; }
  .header-logo .pole span { color: #A8D8EA; }
  .header-right { text-align: right; font-size: 9pt; color: #444; }
  .doc-title { font-size: 14pt; font-weight: 900; color: #1B3870; }

  .tricolore { height: 4px; display: flex; margin-bottom: 14px; border-radius: 2px; overflow: hidden; }
  .tricolore .b { background: #6B1A6E; flex: 3; }
  .tricolore .g { background: #8DC63F; flex: 1; }
  .tricolore .c { background: #29B5E8; flex: 1; }

  h1 { font-size: 14pt; font-weight: 900; color: #1a1a1a; margin-bottom: 14px; }

  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #d1d5db; border-radius: 4px; overflow: hidden; margin-bottom: 14px; }
  .info-row { display: contents; }
  .info-label { background: #eff6ff; font-weight: 600; padding: 5px 10px; font-size: 9.5pt; border-bottom: 1px solid #e5e7eb; color: #1B3870; }
  .info-value { background: #fff; padding: 5px 10px; font-size: 9.5pt; border-bottom: 1px solid #e5e7eb; border-left: 1px solid #e5e7eb; }

  .section-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1B3870; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; margin: 14px 0 7px; }

  table.participants { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  table.participants th { background: #1B3870; color: white; padding: 6px 8px; text-align: left; font-size: 9pt; }
  table.participants td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  table.participants tr:nth-child(even) td { background: #f8fafc; }
  .tel-cell { color: #1B3870; font-size: 8.5pt; }

  .urgences { margin-top: 18px; border: 1.5px solid #e53e3e; border-radius: 5px; overflow: hidden; }
  .urgences-body { display: flex; align-items: center; padding: 5px 12px; gap: 16px; }
  .urgences-title { font-size: 8pt; font-weight: 700; color: #c53030; text-transform: uppercase; letter-spacing: 0.3px; }
  .urgence-item { font-size: 8.5pt; color: #333; }
  .urgence-num { font-weight: 900; color: #c53030; font-size: 10pt; margin-left: 3px; }

  .pole-tel { margin-top: 8px; border: 1px solid #d1d5db; border-radius: 4px; padding: 6px 12px; background: #f0f4ff; display: flex; justify-content: space-between; align-items: center; }
  .pole-tel-label { font-size: 8.5pt; font-weight: 700; color: #1B3870; }
  .pole-tel-num { font-size: 12pt; font-weight: 900; color: #1B3870; }

  .footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 8pt; color: #999; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    @page { margin: 12mm 15mm; size: A4; }
  }
`;

export default async function SortiePrintPage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const [s, participants] = await Promise.all([
    queryOne<any>(`
      SELECT id, titre, date::text AS date, animateur_nom AS "animateurNom", espace_id AS "espaceId",
             heure_depart AS "heureDepart", heure_retour AS "heureRetour", lieu_depart AS "lieuDepart",
             lieu_destination AS "lieuDestination", transport, nb_encadrants AS "nbEncadrants",
             autre_encadrant AS "autreEncadrant", observations, itineraire
      FROM sorties WHERE id = $1 AND tenant_id = $2
    `, [params.id, tenant_id]),
    query<any>(`
      SELECT j.id, j.nom, j.prenom,
             COALESCE(
               json_agg(json_build_object('lien', c.lien, 'telephone', c.telephone))
               FILTER (WHERE c.id IS NOT NULL),
               '[]'::json
             ) AS contacts
      FROM sorties_participants sp
      JOIN sorties s ON s.id = sp.sortie_id
      JOIN jeunes j ON j.id = sp.jeune_id
      LEFT JOIN jeunes_contacts c ON c.jeune_id = j.id
      WHERE sp.sortie_id = $1 AND s.tenant_id = $2 AND NOT sp.en_attente
      GROUP BY j.id, j.nom, j.prenom
      ORDER BY j.nom, j.prenom
    `, [params.id, tenant_id]),
  ]);

  if (!s) notFound();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: printCss }} />
      <PrintButton color="#1B3870" />
      {/* Les fiches sanitaires ne partent jamais avec la fiche sortie : page à part, à la demande. */}
      <a href={`/animateur/sorties/${params.id}/fiches-sanitaires`} target="_blank" rel="noopener noreferrer" className="no-print"
        style={{ position: 'fixed', top: 64, right: 16, zIndex: 100, background: 'white', color: '#1B3870', border: '1px solid #1B3870', padding: '8px 16px', borderRadius: 8, fontWeight: 700, fontSize: '12px', textDecoration: 'none' }}>
        🩺 Fiches sanitaires des participants
      </a>

      <div className="page">
        <div className="header">
          <div className="header-logo">
            <div className="mairie">Mairie de Nogent-sur-Marne</div>
            <div className="pole"><span>PÔLE</span> JEUNESSE</div>
          </div>
          <div className="header-right">
            <div className="doc-title">FICHE SORTIE</div>
            <div style={{ marginTop: 4 }}>
              Date : {new Date(s.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <div style={{ marginTop: 2, fontSize: '8pt', color: '#999' }}>
              Généré le {new Date().toLocaleDateString('fr-FR')}
            </div>
          </div>
        </div>

        <div className="tricolore">
          <div className="b" /><div className="g" /><div className="c" />
        </div>

        <h1>{s.titre}</h1>

        <div className="info-grid">
          {([
            ['Animateur référent', s.animateurNom],
            ['Espace', s.espaceId],
            ['Heure de départ', s.heureDepart],
            ['Heure de retour', s.heureRetour || '—'],
            ['Lieu de départ', s.lieuDepart],
            ['Destination', s.lieuDestination],
            ['Transport', s.transport || '—'],
            ['Nb encadrants', String(s.nbEncadrants ?? 1)],
            ['Autre encadrant', s.autreEncadrant || '—'],
            ['Nb participants', String(participants.length)],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} className="info-row">
              <div className="info-label">{label}</div>
              <div className="info-value">{value}</div>
            </div>
          ))}
        </div>

        {s.itineraire && (
          <>
            <div className="section-title">Itinéraire</div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 4, padding: '7px 12px', fontSize: '10pt', background: '#f0f9ff', marginBottom: 6 }}>
              {s.itineraire}
            </div>
          </>
        )}

        <div className="section-title">
          Liste des participants ({participants.length})
        </div>
        <table className="participants">
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th>Nom</th>
              <th>Prénom</th>
              <th>Contact(s) parent(s)</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((j: any, i: number) => (
              <tr key={j.id}>
                <td>{i + 1}</td>
                <td style={{ fontWeight: 600 }}>{j.nom.toUpperCase()}</td>
                <td>{j.prenom}</td>
                <td className="tel-cell">{getContactsTel(j)}</td>
              </tr>
            ))}
            {participants.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: '#999', padding: '12px' }}>
                  Aucun participant sélectionné
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {s.observations && (
          <>
            <div className="section-title">Observations</div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 4, padding: '7px 12px', fontSize: '10pt', background: '#f9fafb' }}>
              {s.observations}
            </div>
          </>
        )}

        <div className="urgences">
          <div className="urgences-body">
            <span className="urgences-title">Urgences :</span>
            <span className="urgence-item">SAMU <span className="urgence-num">15</span></span>
            <span className="urgence-item">Police <span className="urgence-num">17</span></span>
            <span className="urgence-item">Pompiers <span className="urgence-num">18</span></span>
          </div>
        </div>

        <div className="pole-tel">
          <div className="pole-tel-label">📞 Pôle Jeunesse — Mairie de Nogent-sur-Marne</div>
          <div className="pole-tel-num">01 88 29 65 40</div>
        </div>

        <div className="footer">
          <span>Pôle Jeunesse de Nogent-sur-Marne — Direction de la Jeunesse</span>
          <span>Document généré le {new Date().toLocaleDateString('fr-FR')}</span>
        </div>
      </div>
    </>
  );
}
