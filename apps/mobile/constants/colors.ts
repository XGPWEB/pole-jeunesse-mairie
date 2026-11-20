// ─── Charte Pôle Jeunesse ────────────────────────────────────────────────────
// Logo PJ : violet/prune + bleu clair
// Logo Nogent : bleu marine + vert + cyan

export const Colors = {
  // Pôle Jeunesse — primaires
  purple: '#6B1A6E',       // violet prune PJ (principal)
  purpleLight: '#8B2E8E',  // violet clair
  purplePale: '#F3E8F4',   // fond violet très léger

  // Pôle Jeunesse — bleu clair
  skyBlue: '#A8D8EA',      // bleu clair PJ
  skyBlueDark: '#7BBFD8',  // bleu clair foncé
  skyBlueLight: '#EAF5FA', // fond bleu très léger

  // Nogent-sur-Marne — tricolore
  navy: '#1B3870',         // bleu marine Nogent
  navyLight: '#254EA0',    // bleu marine clair
  green: '#8DC63F',        // vert Nogent
  greenLight: '#EEF7E0',   // fond vert léger
  cyan: '#29B5E8',         // cyan Nogent
  cyanLight: '#E4F6FD',    // fond cyan léger

  // Neutres
  white: '#FFFFFF',
  background: '#F5F7FA',
  border: '#E2E8F0',
  textLight: '#94A3B8',
  textMuted: '#64748B',
  text: '#1E293B',

  // Sémantiques
  success: '#27AE60',
  successLight: '#E8F5EE',
  danger: '#E74C3C',
  dangerLight: '#FDECEA',
  warning: '#F5A623',
  warningLight: '#FEF3E2',
  info: '#29B5E8',
  infoLight: '#E4F6FD',

  // Espaces — basés sur la charte combinée
  collegiens: '#6B1A6E',   // violet PJ
  lyceens: '#1B3870',      // bleu marine Nogent
  pij: '#29B5E8',          // cyan Nogent
  clas: '#8DC63F',         // vert Nogent

  // Présence
  present: '#27AE60',
  absent: '#E74C3C',
  excuse: '#F5A623',

  // Alias rétrocompat
  blue: '#1B3870',
  blueLight: '#EAF5FA',
  navyDark: '#6B1A6E',
} as const;

export type ColorKey = keyof typeof Colors;
