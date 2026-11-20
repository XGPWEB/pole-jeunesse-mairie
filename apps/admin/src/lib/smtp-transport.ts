import { readFileSync } from 'node:fs';

// ─── Options du transport SMTP ───────────────────────────────────────────────
//
// Les liens de réinitialisation de mot de passe et les identifiants des
// animateurs transitent par ce transport. Deux garanties sont donc exigées, et
// AUCUNE variable d'environnement ne permet de les lever :
//
//   1. le certificat du serveur est toujours validé (chaîne de confiance ET nom
//      d'hôte) — `rejectUnauthorized` vaut `true`, en dur ;
//   2. la session est toujours chiffrée AVANT l'authentification — TLS
//      implicite sur 465, STARTTLS obligatoire ailleurs. Sans `requireTLS`,
//      nodemailer continue en clair quand le serveur n'annonce pas STARTTLS :
//      un intermédiaire n'a qu'à retirer l'annonce de la réponse EHLO pour
//      lire les identifiants SMTP et les liens de reset.
//
// Ce module est une fonction pure de l'environnement (pas d'accès réseau, pas
// d'état) : il se teste sans serveur, et le vrai transport construit à partir
// de ses options se teste contre un serveur local (__tests__/smtp-tls.test.ts).

/** Variables d'environnement lues par le transport SMTP. */
export interface SmtpEnv {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  /** Chemin d'un fichier PEM : autorité(s) de certification privée(s) du serveur SMTP. */
  SMTP_CA_FILE?: string;
  /** Nom attendu dans le certificat, s'il diffère de SMTP_HOST. */
  SMTP_TLS_SERVERNAME?: string;
}

/**
 * Sous-ensemble des options nodemailer que nous produisons. Type local et
 * explicite (plutôt que le type très large de nodemailer) pour que les tests
 * puissent affirmer chaque champ ; sa compatibilité avec nodemailer est
 * vérifiée à la compilation par l'appel `createTransport(...)` d'emailService.
 */
export interface SmtpTransportOptions {
  host: string;
  port: number;
  /** `true` = TLS implicite dès la connexion (465). */
  secure: boolean;
  /** `true` = STARTTLS exigé : échec si le serveur ne le propose pas ou le refuse. */
  requireTLS: boolean;
  auth: { user: string | undefined; pass: string | undefined };
  tls: {
    rejectUnauthorized: true;
    minVersion: 'TLSv1.2';
    ca?: string;
    servername?: string;
  };
}

/** Erreur de configuration SMTP : message destiné à l'exploitant, sans secret. */
export class SmtpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpConfigError';
  }
}

/** Lecteur de fichier injectable (les tests unitaires n'ont pas à toucher le disque). */
export type LireFichier = (chemin: string) => string;

const lireFichierUtf8: LireFichier = (chemin) => readFileSync(chemin, 'utf8');

// Ports dont le mode TLS est fixé par l'usage (RFC 8314 pour 465 et 587) :
// 465 = TLS implicite ; 587 (soumission) et 25 (relais) = STARTTLS.
const PORT_TLS_IMPLICITE = 465;
const PORTS_STARTTLS: readonly number[] = [587, 25];

// deploy.sh injecte une chaîne VIDE dans PM2 pour toute variable absente de
// pj-smtp.env : une valeur vide (ou blanche) doit donc compter comme absente.
function valeur(brute: string | undefined): string | undefined {
  const v = brute?.trim();
  return v ? v : undefined;
}

function lireSecure(brute: string | undefined): boolean | undefined {
  const v = valeur(brute)?.toLowerCase();
  if (v === undefined) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  // Une faute de frappe (« yes », « 1 », « ture ») ne doit pas être interprétée
  // silencieusement comme « false » : on refuse.
  throw new SmtpConfigError(
    `SMTP_SECURE invalide (« ${v} ») : valeurs acceptées « true » ou « false », ou variable absente.`,
  );
}

function lirePort(brute: string | undefined, secure: boolean | undefined): number {
  const v = valeur(brute);
  // Port absent : 465 par défaut (comportement historique), sauf si
  // SMTP_SECURE=false demande explicitement STARTTLS — alors 587, le port de
  // soumission, pour ne pas fabriquer nous-mêmes une combinaison incohérente.
  if (v === undefined) return secure === false ? 587 : PORT_TLS_IMPLICITE;
  const port = Number(v);
  if (!/^\d+$/.test(v) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SmtpConfigError(`SMTP_PORT invalide (« ${v} ») : entier attendu entre 1 et 65535.`);
  }
  return port;
}

/**
 * Détermine le mode TLS. Le PORT fait foi pour 465, 587 et 25 ; SMTP_SECURE
 * n'y est qu'une confirmation facultative, et une contradiction est refusée :
 * `secure: true` sur 587 ou `secure: false` sur 465 ne donnent de toute façon
 * qu'un échec de connexion obscur (poignée de main TLS face à un serveur qui
 * parle en clair, ou l'inverse). Pour un port non standard, rien ne permet de
 * deviner : SMTP_SECURE devient obligatoire.
 */
function tlsImplicite(port: number, secure: boolean | undefined): boolean {
  if (port === PORT_TLS_IMPLICITE) {
    if (secure === false) {
      throw new SmtpConfigError(
        'Configuration SMTP incohérente : le port 465 impose le TLS implicite, or SMTP_SECURE=false. ' +
          'Mettre SMTP_SECURE=true (ou supprimer la variable), ou utiliser le port 587 pour STARTTLS.',
      );
    }
    return true;
  }
  if (PORTS_STARTTLS.includes(port)) {
    if (secure === true) {
      throw new SmtpConfigError(
        `Configuration SMTP incohérente : le port ${port} impose STARTTLS, or SMTP_SECURE=true. ` +
          'Mettre SMTP_SECURE=false (ou supprimer la variable), ou utiliser le port 465 pour le TLS implicite.',
      );
    }
    return false;
  }
  if (secure === undefined) {
    throw new SmtpConfigError(
      `Port SMTP non standard (${port}) : préciser SMTP_SECURE=true (TLS implicite) ` +
        'ou SMTP_SECURE=false (STARTTLS obligatoire). Dans les deux cas la session est chiffrée.',
    );
  }
  return secure;
}

function lireCa(chemin: string, lire: LireFichier): string {
  let pem: string;
  try {
    pem = lire(chemin);
  } catch (err) {
    // Pas de repli silencieux sur les autorités publiques : si l'exploitant a
    // désigné une autorité privée, l'ignorer ferait soit échouer l'envoi avec
    // une erreur de certificat trompeuse, soit masquer une erreur de déploiement.
    const detail = err instanceof Error ? err.message : String(err);
    throw new SmtpConfigError(`SMTP_CA_FILE illisible (« ${chemin} ») : ${detail}`);
  }
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new SmtpConfigError(
      `SMTP_CA_FILE (« ${chemin} ») ne contient aucun certificat au format PEM (-----BEGIN CERTIFICATE-----).`,
    );
  }
  return pem;
}

/**
 * Construit les options nodemailer à partir de l'environnement.
 *
 * | SMTP_PORT        | SMTP_SECURE      | Résultat                                   |
 * |------------------|------------------|--------------------------------------------|
 * | absent           | absent / true    | 465, TLS implicite                         |
 * | absent           | false            | 587, STARTTLS obligatoire                  |
 * | 465              | absent / true    | TLS implicite                              |
 * | 465              | false            | refus (SmtpConfigError)                    |
 * | 587 ou 25        | absent / false   | STARTTLS obligatoire                       |
 * | 587 ou 25        | true             | refus (SmtpConfigError)                    |
 * | autre            | true             | TLS implicite                              |
 * | autre            | false            | STARTTLS obligatoire                       |
 * | autre            | absent           | refus (SmtpConfigError)                    |
 *
 * Lève `SmtpConfigError` (jamais de repli) si SMTP_HOST manque, si une valeur
 * est invalide ou incohérente, ou si SMTP_CA_FILE est configuré mais illisible.
 */
export function buildSmtpTransportOptions(
  env: SmtpEnv,
  lire: LireFichier = lireFichierUtf8,
): SmtpTransportOptions {
  const host = valeur(env.SMTP_HOST);
  if (!host) {
    // Sans hôte, nodemailer se rabat sur « localhost » : on préfère une erreur
    // lisible à une tentative de connexion vers une machine non voulue.
    throw new SmtpConfigError('SMTP_HOST manquant : envoi de courriels impossible.');
  }

  const secureDemande = lireSecure(env.SMTP_SECURE);
  const port = lirePort(env.SMTP_PORT, secureDemande);
  const secure = tlsImplicite(port, secureDemande);

  const tls: SmtpTransportOptions['tls'] = {
    // En dur : aucune variable d'environnement ne désactive la validation.
    rejectUnauthorized: true,
    // TLS 1.0/1.1 sont obsolètes (RFC 8996). C'est déjà le défaut de Node 20,
    // mais on ne dépend ni de la version de Node ni d'un --tls-min-v1.0.
    minVersion: 'TLSv1.2',
  };

  // Autorité privée : on FOURNIT l'autorité au lieu de désactiver la
  // validation. Attention, `ca` REMPLACE le magasin d'autorités publiques de
  // Node : seules les autorités de ce fichier sont alors acceptées.
  const caFile = valeur(env.SMTP_CA_FILE);
  if (caFile) tls.ca = lireCa(caFile, lire);

  // Nom attendu dans le certificat quand on joint le serveur par une adresse
  // IP ou un alias interne. Le nom reste vérifié — simplement contre celui-ci.
  const servername = valeur(env.SMTP_TLS_SERVERNAME);
  if (servername) tls.servername = servername;

  return {
    host,
    port,
    secure,
    // nodemailer : `requireTLS` force la commande STARTTLS même si le serveur
    // ne l'annonce pas, et fait échouer la connexion si la montée en TLS est
    // refusée ; il l'emporte sur ignoreTLS / opportunisticTLS. Sans objet en
    // TLS implicite (la session est déjà chiffrée).
    requireTLS: !secure,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    tls,
  };
}
