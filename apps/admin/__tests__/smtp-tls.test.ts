// Revue du 6 octobre 2026, point R3 — le transport SMTP validait n'importe quel
// certificat (`tls.rejectUnauthorized: false`) alors que les liens de
// réinitialisation de mot de passe y transitent.
//
// Deux niveaux de preuve :
//   1. tests unitaires de `buildSmtpTransportOptions` (mode TLS selon le port,
//      combinaisons refusées, autorité privée) ;
//   2. tests RÉSEAU : le VRAI transport nodemailer, construit avec ces options,
//      parle à un serveur SMTP local (127.0.0.1, port éphémère, certificats
//      jetables générés à l'exécution). On y vérifie un refus pour cause de
//      certificat — pas un simple délai dépassé — et, côté serveur, qu'aucune
//      commande AUTH n'a été reçue.
//
// Aucun serveur réel n'est contacté, aucun courriel ne quitte la machine.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nodemailer from 'nodemailer';
import {
  buildSmtpTransportOptions,
  SmtpConfigError,
  type SmtpEnv,
  type SmtpTransportOptions,
} from '@/lib/smtp-transport';
import {
  demarrerServeurSmtp,
  genererCertificats,
  type CertificatsTest,
  type OptionsServeur,
  type ServeurSmtpTest,
} from './smtp-test-server';

// ─── 1. Fonction d'options ───────────────────────────────────────────────────

describe('buildSmtpTransportOptions — mode TLS selon le port', () => {
  const base: SmtpEnv = { SMTP_HOST: 'smtp.exemple.test', SMTP_USER: 'u@exemple.test', SMTP_PASS: 'secret-de-test' };
  const lectureInterdite = () => {
    throw new Error('aucune lecture de fichier attendue');
  };
  const options = (env: SmtpEnv) => buildSmtpTransportOptions({ ...base, ...env }, lectureInterdite);

  it('465 → TLS implicite, que SMTP_SECURE soit absent ou « true »', () => {
    for (const SMTP_SECURE of [undefined, 'true', 'TRUE', '']) {
      const o = options({ SMTP_PORT: '465', SMTP_SECURE });
      expect(o).toMatchObject({ host: 'smtp.exemple.test', port: 465, secure: true, requireTLS: false });
    }
  });

  it('587 et 25 → STARTTLS OBLIGATOIRE (secure=false + requireTLS=true)', () => {
    for (const SMTP_PORT of ['587', '25']) {
      for (const SMTP_SECURE of [undefined, 'false', '']) {
        const o = options({ SMTP_PORT, SMTP_SECURE });
        expect(o).toMatchObject({ port: Number(SMTP_PORT), secure: false, requireTLS: true });
      }
    }
  });

  it('port absent ou vide → 465 implicite ; avec SMTP_SECURE=false → 587 STARTTLS', () => {
    expect(options({})).toMatchObject({ port: 465, secure: true, requireTLS: false });
    // deploy.sh injecte '' dans PM2 pour une variable absente.
    expect(options({ SMTP_PORT: '', SMTP_SECURE: '' })).toMatchObject({ port: 465, secure: true });
    expect(options({ SMTP_SECURE: 'false' })).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });

  it('refuse les combinaisons incohérentes au lieu de choisir à la place de l\'exploitant', () => {
    expect(() => options({ SMTP_PORT: '465', SMTP_SECURE: 'false' })).toThrow(SmtpConfigError);
    expect(() => options({ SMTP_PORT: '465', SMTP_SECURE: 'false' })).toThrow(/465 impose le TLS implicite/);
    expect(() => options({ SMTP_PORT: '587', SMTP_SECURE: 'true' })).toThrow(/587 impose STARTTLS/);
    expect(() => options({ SMTP_PORT: '25', SMTP_SECURE: 'true' })).toThrow(/25 impose STARTTLS/);
  });

  it('port non standard : SMTP_SECURE obligatoire, et la session reste chiffrée dans les deux cas', () => {
    expect(() => options({ SMTP_PORT: '2525' })).toThrow(/Port SMTP non standard \(2525\)/);
    expect(options({ SMTP_PORT: '2525', SMTP_SECURE: 'false' })).toMatchObject({ secure: false, requireTLS: true });
    expect(options({ SMTP_PORT: '2465', SMTP_SECURE: 'true' })).toMatchObject({ secure: true, requireTLS: false });
  });

  it('il n\'existe AUCUNE configuration sans chiffrement avant authentification', () => {
    const ports = [undefined, '', '25', '465', '587', '2525'];
    const secures = [undefined, '', 'true', 'false'];
    let construites = 0;
    for (const SMTP_PORT of ports) {
      for (const SMTP_SECURE of secures) {
        let o: SmtpTransportOptions;
        try {
          o = options({ SMTP_PORT, SMTP_SECURE });
        } catch (err) {
          expect(err).toBeInstanceOf(SmtpConfigError);
          continue;
        }
        construites += 1;
        // Soit TLS implicite, soit STARTTLS exigé — jamais ni l'un ni l'autre.
        expect(o.secure || o.requireTLS).toBe(true);
        expect(o.tls.rejectUnauthorized).toBe(true);
      }
    }
    expect(construites).toBeGreaterThan(0);
  });

  it('refuse les valeurs invalides plutôt que de les interpréter', () => {
    expect(() => options({ SMTP_PORT: '465', SMTP_SECURE: 'yes' })).toThrow(/SMTP_SECURE invalide/);
    expect(() => options({ SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT invalide/);
    expect(() => options({ SMTP_PORT: '0' })).toThrow(/SMTP_PORT invalide/);
    expect(() => options({ SMTP_PORT: '70000' })).toThrow(/SMTP_PORT invalide/);
    expect(() => buildSmtpTransportOptions({ SMTP_PORT: '465' }, lectureInterdite)).toThrow(/SMTP_HOST manquant/);
    expect(() => buildSmtpTransportOptions({ SMTP_HOST: '  ' }, lectureInterdite)).toThrow(/SMTP_HOST manquant/);
  });

  it('transmet les identifiants tels quels', () => {
    expect(options({ SMTP_PORT: '465' }).auth).toEqual({ user: 'u@exemple.test', pass: 'secret-de-test' });
  });
});

describe('buildSmtpTransportOptions — validation du certificat', () => {
  const base: SmtpEnv = { SMTP_HOST: 'smtp.exemple.test', SMTP_PORT: '465' };
  const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

  it('valide toujours le certificat, TLS 1.2 minimum, sans autorité ni nom imposés par défaut', () => {
    const o = buildSmtpTransportOptions(base, () => {
      throw new Error('aucune lecture de fichier attendue');
    });
    expect(o.tls).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  });

  it('aucune variable d\'environnement ne désactive la validation', () => {
    // Variables qu'un exploitant pressé pourrait tenter : elles ne sont pas lues.
    const tentative = {
      ...base,
      SMTP_TLS_REJECT_UNAUTHORIZED: 'false',
      SMTP_REJECT_UNAUTHORIZED: '0',
      SMTP_TLS_INSECURE: 'true',
      SMTP_IGNORE_TLS: 'true',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    };
    const o = buildSmtpTransportOptions(tentative);
    expect(o.tls.rejectUnauthorized).toBe(true);
    expect(o).not.toHaveProperty('ignoreTLS');
    expect(o).not.toHaveProperty('opportunisticTLS');
  });

  it('SMTP_CA_FILE : le PEM est lu et fourni comme autorité', () => {
    const lus: string[] = [];
    const o = buildSmtpTransportOptions({ ...base, SMTP_CA_FILE: '/etc/ssl/ca-interne.pem' }, (chemin) => {
      lus.push(chemin);
      return PEM;
    });
    expect(lus).toEqual(['/etc/ssl/ca-interne.pem']);
    expect(o.tls).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2', ca: PEM });
  });

  it('SMTP_CA_FILE illisible → erreur claire, pas de repli silencieux (vrai disque)', () => {
    const absent = '/chemin/inexistant/pole-jeunesse-ca.pem';
    expect(() => buildSmtpTransportOptions({ ...base, SMTP_CA_FILE: absent })).toThrow(SmtpConfigError);
    expect(() => buildSmtpTransportOptions({ ...base, SMTP_CA_FILE: absent })).toThrow(
      /SMTP_CA_FILE illisible \(« \/chemin\/inexistant\/pole-jeunesse-ca\.pem »\).*ENOENT/,
    );
  });

  it('SMTP_CA_FILE lisible mais sans certificat PEM → erreur claire', () => {
    expect(() => buildSmtpTransportOptions({ ...base, SMTP_CA_FILE: '/x.pem' }, () => 'pas un certificat')).toThrow(
      /ne contient aucun certificat au format PEM/,
    );
    expect(() => buildSmtpTransportOptions({ ...base, SMTP_CA_FILE: '/x.pem' }, () => '')).toThrow(SmtpConfigError);
  });

  it('SMTP_TLS_SERVERNAME : nom attendu transmis à TLS, la validation reste active', () => {
    const o = buildSmtpTransportOptions({ ...base, SMTP_TLS_SERVERNAME: 'smtp.interne.test' });
    expect(o.tls).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: 'smtp.interne.test' });
  });
});

// ─── 2. Vrai transport nodemailer contre un serveur local ────────────────────

interface ErreurSmtp extends Error {
  code?: string;
  command?: string;
}

describe('transport SMTP réel contre un serveur local (127.0.0.1)', () => {
  let certs: CertificatsTest;
  const serveurs: ServeurSmtpTest[] = [];

  beforeAll(() => {
    certs = genererCertificats();
  }, 30_000);

  afterEach(async () => {
    await Promise.all(serveurs.splice(0).map((s) => s.fermer()));
  });

  afterAll(() => {
    certs?.supprimer();
  });

  const demarrer = async (options: OptionsServeur): Promise<ServeurSmtpTest> => {
    const s = await demarrerServeurSmtp(options);
    serveurs.push(s);
    return s;
  };

  // Les options viennent de la fonction de production avec le port NOMINAL
  // (465 ou 587) ; seul le numéro de port est ensuite remplacé par le port
  // éphémère du serveur de test. `surcharge` n'est utilisé que par les
  // contre-épreuves (témoins) explicitement signalées.
  const envoyer = (
    serveur: ServeurSmtpTest,
    env: SmtpEnv,
    surcharge: Partial<Parameters<typeof nodemailer.createTransport>[0] & object> = {},
  ) => {
    const options = buildSmtpTransportOptions({
      SMTP_HOST: '127.0.0.1',
      SMTP_USER: 'expediteur@test.invalid',
      SMTP_PASS: 'mot-de-passe-de-test',
      ...env,
    });
    const transport = nodemailer.createTransport({ ...options, port: serveur.port, ...surcharge });
    return transport.sendMail({
      from: 'expediteur@test.invalid',
      to: 'destinataire@test.invalid',
      subject: 'Lien de réinitialisation (test)',
      text: 'https://exemple.test/reset?token=jeton-de-test',
    });
  };

  const echec = async (envoi: Promise<unknown>): Promise<ErreurSmtp> => {
    try {
      await envoi;
    } catch (err) {
      if (err instanceof Error) return err;
      throw new Error(`rejet inattendu : ${String(err)}`);
    }
    throw new Error('l\'envoi aurait dû être refusé, il a réussi');
  };

  const AUTO_SIGNE = /self[- ]signed certificate/i;
  const MAUVAIS_NOM = /does not match certificate's altnames/i;

  // ── Port 465 : TLS implicite ──────────────────────────────────────────────

  describe('port 465 — TLS implicite', () => {
    it('certificat auto-signé non approuvé → refus pour cause de certificat, rien n\'est envoyé', async () => {
      const serveur = await demarrer({ mode: 'tls-implicite', paire: certs.autoSigne });
      const err = await echec(envoyer(serveur, { SMTP_PORT: '465' }));
      expect(err.message).toMatch(AUTO_SIGNE);
      expect(err.code).toBe('ESOCKET'); // pas ETIMEDOUT : c'est bien un refus, pas un délai
      expect(serveur.poigneesTls).toBe(0);
      expect(serveur.commandes).toEqual([]);
      expect(serveur.messages).toBe(0);
    });

    it('même serveur, son certificat fourni via SMTP_CA_FILE → poignée de main TLS et envoi réussis', async () => {
      const serveur = await demarrer({ mode: 'tls-implicite', paire: certs.autoSigne });
      const info = await envoyer(serveur, { SMTP_PORT: '465', SMTP_CA_FILE: certs.autoSigne.certFile });
      expect(info.response).toMatch(/^250 /);
      expect(serveur.poigneesTls).toBe(1);
      expect(serveur.commandes).toEqual(['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA']);
      expect(serveur.commandesEnClair).toEqual([]);
      expect(serveur.messages).toBe(1);
    });

    it('certificat signé par une autorité privée fournie via SMTP_CA_FILE → accepté', async () => {
      const serveur = await demarrer({ mode: 'tls-implicite', paire: certs.feuille });
      await envoyer(serveur, { SMTP_PORT: '465', SMTP_CA_FILE: certs.ca.certFile });
      expect(serveur.poigneesTls).toBe(1);
      expect(serveur.messages).toBe(1);
    });

    it('certificat signé par une autorité que l\'on n\'a PAS fournie → refus', async () => {
      const serveur = await demarrer({ mode: 'tls-implicite', paire: certs.feuille });
      const err = await echec(envoyer(serveur, { SMTP_PORT: '465' }));
      expect(err.message).toMatch(/unable to verify the first certificate|unable to get local issuer certificate|self[- ]signed certificate in certificate chain/i);
      expect(serveur.commandes).toEqual([]);
    });

    it('autorité approuvée mais certificat émis pour un AUTRE nom → refus', async () => {
      const serveur = await demarrer({ mode: 'tls-implicite', paire: certs.mauvaisNom });
      const err = await echec(envoyer(serveur, { SMTP_PORT: '465', SMTP_CA_FILE: certs.ca.certFile }));
      expect(err.message).toMatch(MAUVAIS_NOM);
      expect(serveur.commandes).toEqual([]);
      expect(serveur.messages).toBe(0);
    });

    it('SMTP_TLS_SERVERNAME : le nom est vérifié contre la valeur configurée (accepté si elle correspond, refusé sinon)', async () => {
      const serveur = await demarrer({ mode: 'tls-implicite', paire: certs.nomInterne });
      const env: SmtpEnv = { SMTP_PORT: '465', SMTP_CA_FILE: certs.ca.certFile };

      const sansNom = await echec(envoyer(serveur, env));
      expect(sansNom.message).toMatch(MAUVAIS_NOM);

      const mauvaisNom = await echec(envoyer(serveur, { ...env, SMTP_TLS_SERVERNAME: 'autre.interne.test' }));
      expect(mauvaisNom.message).toMatch(MAUVAIS_NOM);
      expect(serveur.messages).toBe(0);

      await envoyer(serveur, { ...env, SMTP_TLS_SERVERNAME: 'smtp.interne.test' });
      expect(serveur.messages).toBe(1);
    });

    describe('serveur limité à TLS 1.1', () => {
      const vieuxTls = { minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' } as const;

      it('refusé : TLS 1.2 minimum', async () => {
        const serveur = await demarrer({ mode: 'tls-implicite', paire: certs.feuille, ...vieuxTls });
        const err = await echec(envoyer(serveur, { SMTP_PORT: '465', SMTP_CA_FILE: certs.ca.certFile }));
        expect(err.message).toMatch(/protocol version|unsupported protocol|no protocols available/i);
        expect(serveur.commandes).toEqual([]);
      });

      it('témoin : le même serveur accepte un client qui tolère TLS 1.1 (le refus vient donc bien de notre minimum)', async () => {
        const serveur = await demarrer({ mode: 'tls-implicite', paire: certs.feuille, ...vieuxTls });
        await envoyer(
          serveur,
          { SMTP_PORT: '465' },
          { tls: { ca: certs.ca.cert, minVersion: 'TLSv1', ciphers: 'DEFAULT@SECLEVEL=0' } },
        );
        expect(serveur.messages).toBe(1);
      });
    });
  });

  // ── Port 587 : STARTTLS obligatoire ───────────────────────────────────────

  describe('port 587 — STARTTLS obligatoire', () => {
    it('certificat approuvé → STARTTLS, puis AUTH et message UNIQUEMENT dans la session chiffrée', async () => {
      const serveur = await demarrer({ mode: 'starttls', paire: certs.feuille });
      await envoyer(serveur, { SMTP_PORT: '587', SMTP_CA_FILE: certs.ca.certFile });
      expect(serveur.poigneesTls).toBe(1);
      expect(serveur.commandes).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA']);
      expect(serveur.commandesEnClair).toEqual(['EHLO', 'STARTTLS']);
      expect(serveur.messages).toBe(1);
    });

    it('certificat auto-signé non approuvé → refus pour cause de certificat, aucun AUTH', async () => {
      const serveur = await demarrer({ mode: 'starttls', paire: certs.autoSigne });
      const err = await echec(envoyer(serveur, { SMTP_PORT: '587' }));
      expect(err.message).toMatch(AUTO_SIGNE);
      expect(serveur.poigneesTls).toBe(0);
      expect(serveur.commandes).toEqual(['EHLO', 'STARTTLS']);
      expect(serveur.commandes).not.toContain('AUTH');
      expect(serveur.messages).toBe(0);
    });

    it('même serveur auto-signé, certificat fourni via SMTP_CA_FILE → accepté', async () => {
      const serveur = await demarrer({ mode: 'starttls', paire: certs.autoSigne });
      await envoyer(serveur, { SMTP_PORT: '587', SMTP_CA_FILE: certs.autoSigne.certFile });
      expect(serveur.poigneesTls).toBe(1);
      expect(serveur.messages).toBe(1);
    });

    it('autorité approuvée mais certificat émis pour un AUTRE nom → refus, aucun AUTH', async () => {
      const serveur = await demarrer({ mode: 'starttls', paire: certs.mauvaisNom });
      const err = await echec(envoyer(serveur, { SMTP_PORT: '587', SMTP_CA_FILE: certs.ca.certFile }));
      expect(err.message).toMatch(MAUVAIS_NOM);
      expect(serveur.commandes).not.toContain('AUTH');
      expect(serveur.messages).toBe(0);
    });

    it('SMTP_TLS_SERVERNAME est aussi appliqué à la montée STARTTLS', async () => {
      const serveur = await demarrer({ mode: 'starttls', paire: certs.nomInterne });
      const env: SmtpEnv = { SMTP_PORT: '587', SMTP_CA_FILE: certs.ca.certFile };
      expect((await echec(envoyer(serveur, env))).message).toMatch(MAUVAIS_NOM);
      await envoyer(serveur, { ...env, SMTP_TLS_SERVERNAME: 'smtp.interne.test' });
      expect(serveur.messages).toBe(1);
    });

    it('serveur qui n\'offre pas STARTTLS → refus AVANT tout envoi d\'identifiants', async () => {
      const serveur = await demarrer({ mode: 'sans-starttls', paire: certs.feuille });
      const err = await echec(envoyer(serveur, { SMTP_PORT: '587', SMTP_CA_FILE: certs.ca.certFile }));
      expect(err.code).toBe('ETLS');
      expect(err.message).toMatch(/STARTTLS/);
      // Le journal du serveur fait foi : ni identifiants, ni enveloppe, ni contenu.
      expect(serveur.commandes).toEqual(['EHLO', 'STARTTLS']);
      expect(serveur.commandes).not.toContain('AUTH');
      expect(serveur.commandes).not.toContain('MAIL');
      expect(serveur.messages).toBe(0);
    });

    it('témoin : ce même serveur reçoit bien AUTH en clair d\'un client SANS requireTLS (le test ci-dessus n\'est donc pas vide)', async () => {
      const serveur = await demarrer({ mode: 'sans-starttls', paire: certs.feuille });
      await envoyer(serveur, { SMTP_PORT: '587' }, { requireTLS: false });
      expect(serveur.poigneesTls).toBe(0);
      expect(serveur.commandesEnClair).toContain('AUTH');
      expect(serveur.messages).toBe(1);
    });

    it('serveur qui annonce STARTTLS puis le refuse (454) → refus, aucun AUTH', async () => {
      const serveur = await demarrer({ mode: 'starttls-refuse', paire: certs.feuille });
      const err = await echec(envoyer(serveur, { SMTP_PORT: '587', SMTP_CA_FILE: certs.ca.certFile }));
      expect(err.code).toBe('ETLS');
      expect(serveur.commandes).toEqual(['EHLO', 'STARTTLS']);
      expect(serveur.messages).toBe(0);
    });
  });
});
