// Aides de test pour __tests__/smtp-tls.test.ts — AUCUN serveur réel n'est
// contacté : tout écoute sur 127.0.0.1, port éphémère.
//
// - `genererCertificats` fabrique, à chaque exécution, des clés et certificats
//   JETABLES dans un répertoire temporaire (openssl en ligne de commande). Rien
//   n'est versionné : une clé privée de test commitée finit toujours par être
//   prise pour une vraie, ou réutilisée ailleurs.
// - `demarrerServeurSmtp` est un serveur SMTP minimal qui JOURNALISE les
//   commandes reçues : c'est ce journal qui permet de prouver qu'aucun AUTH
//   n'est parti quand la session n'a pas pu être chiffrée.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import type { Duplex } from 'node:stream';

// ─── Certificats jetables ────────────────────────────────────────────────────

export interface Paire {
  cle: string;
  cert: string;
  /** Chemin du certificat PEM sur disque (utilisable comme SMTP_CA_FILE). */
  certFile: string;
}

export interface CertificatsTest {
  dossier: string;
  /** Autorité privée de test. */
  ca: Paire;
  /** Auto-signé, valable pour 127.0.0.1 : approuvé par personne tant qu'on ne le fournit pas. */
  autoSigne: Paire;
  /** Signé par `ca`, valable pour 127.0.0.1 et localhost. */
  feuille: Paire;
  /** Signé par `ca`, mais pour un AUTRE nom (ni 127.0.0.1 ni localhost). */
  mauvaisNom: Paire;
  /** Signé par `ca`, valable uniquement pour le nom DNS `smtp.interne.test`. */
  nomInterne: Paire;
  supprimer(): void;
}

function openssl(dossier: string, args: string[]): void {
  execFileSync('openssl', args, { cwd: dossier, stdio: 'pipe' });
}

function lirePaire(dossier: string, nom: string): Paire {
  const certFile = path.join(dossier, `${nom}.crt`);
  return {
    cle: readFileSync(path.join(dossier, `${nom}.key`), 'utf8'),
    cert: readFileSync(certFile, 'utf8'),
    certFile,
  };
}

export function genererCertificats(): CertificatsTest {
  const dossier = mkdtempSync(path.join(tmpdir(), 'pj-smtp-tls-'));

  const autoSigner = (nom: string, cn: string, extensions: string[]) => {
    writeFileSync(
      path.join(dossier, `${nom}.cnf`),
      [
        '[req]',
        'distinguished_name = dn',
        'x509_extensions = ext',
        'prompt = no',
        '[dn]',
        `CN = ${cn}`,
        '[ext]',
        ...extensions,
        '',
      ].join('\n'),
    );
    openssl(dossier, [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
      '-keyout', `${nom}.key`, '-out', `${nom}.crt`, '-config', `${nom}.cnf`,
    ]);
  };

  const signerParCa = (nom: string, cn: string, san: string) => {
    openssl(dossier, [
      'req', '-newkey', 'rsa:2048', '-nodes', '-sha256',
      '-keyout', `${nom}.key`, '-out', `${nom}.csr`, '-subj', `/CN=${cn}`,
    ]);
    writeFileSync(
      path.join(dossier, `${nom}.ext`),
      ['basicConstraints = CA:FALSE', 'keyUsage = digitalSignature, keyEncipherment', 'extendedKeyUsage = serverAuth', `subjectAltName = ${san}`, ''].join('\n'),
    );
    openssl(dossier, [
      'x509', '-req', '-in', `${nom}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key',
      '-CAcreateserial', '-sha256', '-days', '2', '-extfile', `${nom}.ext`, '-out', `${nom}.crt`,
    ]);
  };

  autoSigner('ca', 'Autorite de test Pole Jeunesse', [
    'basicConstraints = critical, CA:TRUE',
    'keyUsage = critical, keyCertSign, cRLSign',
  ]);
  autoSigner('autosigne', '127.0.0.1', ['subjectAltName = IP:127.0.0.1, DNS:localhost']);
  signerParCa('feuille', '127.0.0.1', 'IP:127.0.0.1, DNS:localhost');
  signerParCa('mauvaisnom', 'autre-serveur.invalid', 'DNS:autre-serveur.invalid');
  signerParCa('nominterne', 'smtp.interne.test', 'DNS:smtp.interne.test');

  return {
    dossier,
    ca: lirePaire(dossier, 'ca'),
    autoSigne: lirePaire(dossier, 'autosigne'),
    feuille: lirePaire(dossier, 'feuille'),
    mauvaisNom: lirePaire(dossier, 'mauvaisnom'),
    nomInterne: lirePaire(dossier, 'nominterne'),
    supprimer: () => rmSync(dossier, { recursive: true, force: true }),
  };
}

// ─── Serveur SMTP minimal ────────────────────────────────────────────────────

export type ModeServeur =
  /** TLS dès la connexion (comme le port 465). */
  | 'tls-implicite'
  /** Clair puis STARTTLS annoncé et honoré (comme le port 587). */
  | 'starttls'
  /** Clair, STARTTLS ni annoncé ni accepté — c'est aussi ce que voit un client
   *  quand un intermédiaire retire « STARTTLS » de la réponse EHLO. Ce serveur
   *  ACCEPTE l'authentification en clair : un client laxiste s'y ferait prendre. */
  | 'sans-starttls'
  /** STARTTLS annoncé mais refusé (454) : autre forme de repli vers le clair. */
  | 'starttls-refuse';

export interface OptionsServeur {
  mode: ModeServeur;
  paire: Paire;
  /** Pour simuler un serveur limité à un vieux protocole. */
  minVersion?: tls.SecureVersion;
  maxVersion?: tls.SecureVersion;
  ciphers?: string;
}

export interface ServeurSmtpTest {
  port: number;
  /** Verbes SMTP reçus, toutes connexions confondues, dans l'ordre. */
  commandes: string[];
  /** Verbes reçus alors que la session n'était PAS chiffrée. */
  commandesEnClair: string[];
  /** Nombre de poignées de main TLS menées à terme côté serveur. */
  poigneesTls: number;
  /** Nombre de messages acceptés (fin de DATA). */
  messages: number;
  fermer(): Promise<void>;
}

export async function demarrerServeurSmtp(options: OptionsServeur): Promise<ServeurSmtpTest> {
  const { mode, paire } = options;
  const contexteTls: tls.SecureContextOptions = {
    key: paire.cle,
    cert: paire.cert,
    minVersion: options.minVersion,
    maxVersion: options.maxVersion,
    ciphers: options.ciphers,
  };
  const sockets = new Set<net.Socket>();

  const etat: ServeurSmtpTest = {
    port: 0,
    commandes: [],
    commandesEnClair: [],
    poigneesTls: 0,
    messages: 0,
    fermer: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        serveur.close(() => resolve());
      }),
  };

  // Dialogue SMTP sur un flux donné (clair ou chiffré).
  const session = (flux: Duplex, chiffre: boolean, saluer: boolean) => {
    let tampon = '';
    let enData = false;
    const dire = (ligne: string) => {
      if (!flux.destroyed) flux.write(`${ligne}\r\n`);
    };

    const surDonnees = (bloc: Buffer) => {
      tampon += bloc.toString('utf8');
      for (;;) {
        if (enData) {
          const fin = tampon.indexOf('\r\n.\r\n');
          if (fin === -1 && tampon !== '.\r\n') return;
          tampon = fin === -1 ? '' : tampon.slice(fin + 5);
          enData = false;
          etat.messages += 1;
          dire('250 2.0.0 message accepte (serveur de test, rien n\'est transmis)');
          continue;
        }
        const finLigne = tampon.indexOf('\r\n');
        if (finLigne === -1) return;
        const ligne = tampon.slice(0, finLigne);
        tampon = tampon.slice(finLigne + 2);
        const verbe = ligne.split(' ')[0].toUpperCase();
        etat.commandes.push(verbe);
        if (!chiffre) etat.commandesEnClair.push(verbe);

        if (verbe === 'EHLO') {
          const annonceStarttls = !chiffre && (mode === 'starttls' || mode === 'starttls-refuse');
          dire('250-serveur-de-test');
          if (annonceStarttls) dire('250-STARTTLS');
          dire('250 AUTH PLAIN');
        } else if (verbe === 'HELO') {
          dire('250 serveur-de-test');
        } else if (verbe === 'STARTTLS') {
          if (chiffre || mode === 'sans-starttls' || mode === 'tls-implicite') {
            dire('502 5.5.1 commande non reconnue');
          } else if (mode === 'starttls-refuse') {
            dire('454 4.7.0 TLS indisponible');
          } else {
            flux.removeListener('data', surDonnees);
            dire('220 2.0.0 pret pour TLS');
            const chiffreFlux = new tls.TLSSocket(flux as net.Socket, {
              isServer: true,
              secureContext: tls.createSecureContext(contexteTls),
            });
            // Un client qui refuse notre certificat coupe la poignée de main :
            // c'est le cas testé, pas une erreur du serveur.
            chiffreFlux.on('error', () => undefined);
            chiffreFlux.once('secure', () => {
              etat.poigneesTls += 1;
              session(chiffreFlux, true, false);
            });
            return;
          }
        } else if (verbe === 'AUTH') {
          dire('235 2.7.0 authentification acceptee');
        } else if (verbe === 'MAIL' || verbe === 'RCPT' || verbe === 'RSET' || verbe === 'NOOP') {
          dire('250 2.0.0 ok');
        } else if (verbe === 'DATA') {
          enData = true;
          dire('354 fin par <CRLF>.<CRLF>');
        } else if (verbe === 'QUIT') {
          dire('221 2.0.0 au revoir');
          flux.end();
          return;
        } else {
          dire('502 5.5.1 commande non reconnue');
        }
      }
    };

    flux.on('data', surDonnees);
    flux.on('error', () => undefined);
    if (saluer) dire('220 serveur-de-test ESMTP');
  };

  const suivre = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  };

  const serveur: net.Server =
    mode === 'tls-implicite'
      ? tls.createServer(contexteTls, (socket) => {
          etat.poigneesTls += 1;
          session(socket, true, true);
        })
      : net.createServer((socket) => session(socket, false, true));

  // 'connection' est émis pour le socket TCP brut, y compris sous tls.Server :
  // on peut ainsi tout fermer même si la poignée de main n'a jamais abouti.
  serveur.on('connection', suivre);
  serveur.on('tlsClientError', () => undefined);

  await new Promise<void>((resolve, reject) => {
    serveur.once('error', reject);
    serveur.listen(0, '127.0.0.1', () => resolve());
  });
  const adresse = serveur.address();
  if (adresse === null || typeof adresse === 'string') throw new Error('adresse du serveur de test inattendue');
  etat.port = adresse.port;
  return etat;
}
