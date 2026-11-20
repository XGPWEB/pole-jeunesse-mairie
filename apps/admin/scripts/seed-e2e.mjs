// Comptes de test de la base E2E jetable. Lancé par scripts/e2e-server.sh.
// Le mot de passe arrive par variable d'environnement (généré par Playwright à
// chaque exécution) : il n'est ni versionné ni affiché.
import pg from 'pg';
import bcrypt from 'bcryptjs';

const url = process.env.DATABASE_URL ?? '';
const u = new URL(url);
if (!['localhost', '127.0.0.1'].includes(u.hostname) || !u.pathname.startsWith('/pole_jeunesse_e2e')) {
  console.error('❌ REFUS : seed-e2e ne s\'exécute que sur une base locale pole_jeunesse_e2e*.');
  process.exit(1);
}

const { E2E_ADMIN_USER, E2E_ADMIN_PASS } = process.env;
if (!E2E_ADMIN_USER || !E2E_ADMIN_PASS) {
  console.error('❌ E2E_ADMIN_USER et E2E_ADMIN_PASS sont requis.');
  process.exit(1);
}

/**
 * Jeu de données du tableau de bord (commune C), avec les pièges que la page
 * doit écarter : activité passée, sortie annulée, actualité de plus de 30
 * jours. Dates relatives au jour courant, avec une marge de plusieurs jours.
 * Les chiffres attendus sont dans __tests__/e2e/tableau-de-bord-et-2fa.spec.ts.
 */
async function seedTableauDeBord(client, t) {
  await client.query(`INSERT INTO espaces (id, nom, tranche_age, tenant_id) VALUES ('e2e-esp-c', 'Collégiens', '11-14 ans', $1)`, [t]);
  await client.query(`INSERT INTO jeunes (id, nom, prenom, espace_id, tenant_id) VALUES
    ('e2e-j1', 'Jeune', 'Un', 'e2e-esp-c', $1), ('e2e-j2', 'Jeune', 'Deux', 'e2e-esp-c', $1), ('e2e-j3', 'Jeune', 'Trois', 'e2e-esp-c', $1)`, [t]);
  await client.query(`INSERT INTO activites (id, titre, date, heure_debut, heure_fin, places_total, places_disponibles, statut, tenant_id) VALUES
    ('e2e-act-passee',  'Activité passée E2E', CURRENT_DATE - 5, '14:00', '16:00', 10, 10, 'ouvert',  $1),
    ('e2e-act-cuisine', 'Atelier cuisine E2E', CURRENT_DATE + 3, '14:00', '16:00',  8,  0, 'complet', $1),
    ('e2e-act-foot',    'Tournoi foot E2E',    CURRENT_DATE + 6, '10:00', '12:00', 12,  2, 'ouvert',  $1)`, [t]);
  await client.query(`INSERT INTO inscriptions (id, jeune_id, activite_id, statut, tenant_id) VALUES
    ('e2e-i1', 'e2e-j1', 'e2e-act-foot',    'liste-attente', $1),
    ('e2e-i2', 'e2e-j2', 'e2e-act-foot',    'liste-attente', $1),
    ('e2e-i3', 'e2e-j3', 'e2e-act-foot',    'confirmee',     $1),
    ('e2e-i4', 'e2e-j1', 'e2e-act-cuisine', 'en-attente',    $1)`, [t]);
  await client.query(`INSERT INTO sorties (id, titre, date, statut, capacite, lieu_destination, tenant_id) VALUES
    ('e2e-sortie',         'Sortie accrobranche E2E', CURRENT_DATE + 4, 'planifiee', 2, 'Forêt', $1),
    ('e2e-sortie-annulee', 'Sortie annulée E2E',      CURRENT_DATE + 5, 'annulee',   5, 'Musée', $1)`, [t]);
  await client.query(`INSERT INTO sorties_participants (sortie_id, jeune_id, en_attente) VALUES
    ('e2e-sortie', 'e2e-j1', false), ('e2e-sortie', 'e2e-j2', false), ('e2e-sortie', 'e2e-j3', true)`);
  await client.query(`INSERT INTO actualites (id, titre, date, auteur, categorie, tenant_id) VALUES
    ('e2e-actu-1',   'Actu récente 1 E2E', CURRENT_DATE - 1,  'Auteur', 'info', $1),
    ('e2e-actu-2',   'Actu récente 2 E2E', CURRENT_DATE - 10, 'Auteur', 'info', $1),
    ('e2e-actu-old', 'Actu ancienne E2E',  CURRENT_DATE - 60, 'Auteur', 'info', $1)`, [t]);
  await client.query(`INSERT INTO pointages (id, statut, tenant_id) VALUES
    ('e2e-p1', 'present', $1), ('e2e-p2', 'present', $1), ('e2e-p3', 'present', $1), ('e2e-p4', 'absent', $1)`, [t]);
}

/**
 * Données de fiche-agora.spec.ts et fiches-agora-lecture.spec.ts (commune D, à part pour ne pas fausser les
 * compteurs du tableau de bord de la commune C) :
 *   - l'espace « collegiens », valeur par défaut du formulaire de création ;
 *   - un jeune dont la pièce AGORA est du HTML actif, telle qu'elle pouvait
 *     être enregistrée avant le contrôle serveur (audit 2026-10-07, A1). Elle
 *     est écrite directement en base : l'application la refuserait.
 */
async function seedFicheAgora(client, t) {
  await client.query(`INSERT INTO espaces (id, nom, tranche_age, tenant_id) VALUES ('collegiens', 'Collégiens', '11-14 ans', $1)`, [t]);
  const html = '<!doctype html><title>PIECE-ACTIVE-E2E</title><script>document.title = "SCRIPT-EXECUTE-E2E"</script>';
  await client.query(
    `INSERT INTO jeunes (id, nom, prenom, date_naissance, sexe, espace_id, tenant_id, fiche_agora, fiche_agora_nom)
     VALUES ('e2e-j-html', 'HISTORIQUE', 'Piece', '2012-05-06', 'F', 'collegiens', $1, $2, 'ancienne-piece.html')`,
    [t, `data:text/html;base64,${Buffer.from(html).toString('base64')}`],
  );

  // fiches-agora-lecture.spec.ts : une sortie et deux participants, l'un avec
  // des renseignements sanitaires, l'autre sans (données fictives).
  await client.query(
    `INSERT INTO jeunes (id, nom, prenom, date_naissance, sexe, espace_id, tenant_id, allergies, maladies, medecin_nom, medecin_telephone, vaccins, autorisation_mesures_urgence)
     VALUES ('e2e-j-sante', 'SANITAIRE', 'Alix', '2012-01-02', 'F', 'collegiens', $1, 'Arachide', 'Asthme', 'BERNARD Paul', '01 98 76 54 32', '[{"nom":"DTP","date":"2020-01-02"}]', TRUE),
            ('e2e-j-sans',  'SANSFICHE', 'Lou',  '2012-03-04', 'M', 'collegiens', $1, NULL, NULL, NULL, NULL, '[]', NULL)`,
    [t],
  );
  await client.query(`INSERT INTO jeunes_contacts (jeune_id, nom, lien, telephone) VALUES ('e2e-j-sante', 'SANITAIRE Claire', 'Mère', '06 12 34 56 78')`);
  await client.query(
    `INSERT INTO sorties (id, titre, date, statut, capacite, lieu_destination, tenant_id)
     VALUES ('e2e-sortie-d', 'Sortie sanitaire E2E', CURRENT_DATE + 4, 'planifiee', 5, 'Forêt', $1)`,
    [t],
  );
  await client.query(`INSERT INTO sorties_participants (sortie_id, jeune_id, en_attente) VALUES
    ('e2e-sortie-d', 'e2e-j-sante', false), ('e2e-sortie-d', 'e2e-j-sans', false), ('e2e-sortie-d', 'e2e-j-html', true)`);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const hash = await bcrypt.hash(E2E_ADMIN_PASS, 10);
  await client.query('BEGIN');
  for (const [id, nom] of [['e2e-a', 'Commune E2E A'], ['e2e-b', 'Commune E2E B'], ['e2e-c', 'Commune E2E C'], ['e2e-d', 'Commune E2E D']]) {
    await client.query(
      `INSERT INTO tenants (id, nom) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, nom],
    );
  }
  const comptes = [
    ['e2e-admin-a', E2E_ADMIN_USER, 'admin', 'e2e-a'],
    ['e2e-anim-a', `${E2E_ADMIN_USER}.anim`, 'animateur', 'e2e-a'],
    ['e2e-admin-b', `${E2E_ADMIN_USER}.b`, 'admin', 'e2e-b'],
    // Commune C : réservée à tableau-de-bord-et-2fa.spec.ts. Ses données et le
    // second facteur activé sur le compte .totp ne doivent pas déborder sur
    // les parcours des communes A et B.
    ['e2e-admin-c', `${E2E_ADMIN_USER}.c`, 'admin', 'e2e-c'],
    ['e2e-totp-c', `${E2E_ADMIN_USER}.totp`, 'admin', 'e2e-c'],
    // Commune D : réservée à fiche-agora.spec.ts et fiches-agora-lecture.spec.ts.
    ['e2e-admin-d', `${E2E_ADMIN_USER}.d`, 'admin', 'e2e-d'],
  ];
  for (const [id, username, role, tenant] of comptes) {
    await client.query(
      `INSERT INTO animateurs (id, nom, prenom, username, statut, role, tenant_id, espace_assigne, password_hash)
       VALUES ($1, 'E2E', $2, $3, 'actif', $4, $5, 'Collégiens', $6)`,
      [id, role, username, role, tenant, hash],
    );
  }
  // Commune E : réservée à pij.spec.ts — un informateur PIJ et un animateur
  // d'un autre espace (droit de saisie PIJ selon l'espace assigné).
  await client.query(`INSERT INTO tenants (id, nom) VALUES ('e2e-e', 'Commune E2E E') ON CONFLICT (id) DO NOTHING`);
  for (const [id, suffixe, espace] of [['e2e-pij-e', 'pij', 'PIJ'], ['e2e-college-e', 'college', 'Collégiens']]) {
    await client.query(
      `INSERT INTO animateurs (id, nom, prenom, username, statut, role, tenant_id, espace_assigne, password_hash)
       VALUES ($1, 'E2E', $2, $3, 'actif', 'animateur', 'e2e-e', $4, $5)`,
      [id, suffixe, `${E2E_ADMIN_USER}.${suffixe}`, espace, hash],
    );
  }
  await client.query(
    `INSERT INTO animateurs (id, nom, prenom, username, statut, role, tenant_id, espace_assigne, password_hash)
     VALUES ('e2e-admin-e', 'E2E', 'admin', $1, 'actif', 'admin', 'e2e-e', 'Tous', $2)`,
    [`${E2E_ADMIN_USER}.e`, hash],
  );
  // Commune F : réservée à administrateurs.spec.ts — un administrateur qui
  // gère les droits, un autre administrateur et une animatrice.
  await client.query(`INSERT INTO tenants (id, nom) VALUES ('e2e-f', 'Commune E2E F') ON CONFLICT (id) DO NOTHING`);
  for (const [id, prenom, suffixe, role, espace, gereDroits] of [
    ['e2e-admin-f', 'Chef', 'f', 'admin', null, true],
    ['e2e-superviseur-f', 'Superviseur', 'superviseur', 'admin', 'Tous', false],
    ['e2e-animatrice-f', 'Animatrice', 'animatrice', 'animateur', 'Collégiens', false],
  ]) {
    await client.query(
      `INSERT INTO animateurs (id, nom, prenom, username, statut, role, tenant_id, espace_assigne, password_hash, gere_droits)
       VALUES ($1, 'E2E', $2, $3, 'actif', $4, 'e2e-f', $5, $6, $7)`,
      [id, prenom, `${E2E_ADMIN_USER}.${suffixe}`, role, espace, hash, gereDroits],
    );
  }
  await seedTableauDeBord(client, 'e2e-c');
  await seedFicheAgora(client, 'e2e-d');
  await client.query('COMMIT');
  console.error(`✅ Base E2E initialisée : ${comptes.length} comptes, 4 structures`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}
