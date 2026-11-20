import { describe, it, expect } from 'vitest';
import {
  TAILLE_MAX_FICHE_AGORA, analyserFicheAgora, detecterTypeFicheAgora, nettoyerNomFicheAgora, preparerRestitutionFicheAgora,
} from '@/lib/fiche-agora';

const uri = (type: string, octets: Buffer | string) => `data:${type};base64,${Buffer.from(octets).toString('base64')}`;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const HTML = '<!doctype html><script>document.title="x"</script>';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>';

describe('detecterTypeFicheAgora — type établi d\'après le contenu', () => {
  it('reconnaît les quatre formats acceptés', () => {
    expect(detecterTypeFicheAgora(PDF)).toBe('application/pdf');
    expect(detecterTypeFicheAgora(PNG)).toBe('image/png');
    expect(detecterTypeFicheAgora(JPEG)).toBe('image/jpeg');
    expect(detecterTypeFicheAgora(WEBP)).toBe('image/webp');
  });

  it('PDF précédé de quelques octets parasites : accepté ; signature trop loin : refusée', () => {
    expect(detecterTypeFicheAgora(Buffer.concat([Buffer.alloc(100, 0x20), PDF]))).toBe('application/pdf');
    expect(detecterTypeFicheAgora(Buffer.concat([Buffer.alloc(2000, 0x20), PDF]))).toBeNull();
  });

  it('HTML, SVG, GIF, texte, RIFF non WEBP et contenu vide : aucun type', () => {
    for (const contenu of [HTML, SVG, 'GIF89a....', 'bonjour', 'RIFF\u0004\u0000\u0000\u0000WAVEfmt ', '']) {
      expect(detecterTypeFicheAgora(Buffer.from(contenu, 'latin1')), contenu.slice(0, 20)).toBeNull();
    }
  });
});

describe('analyserFicheAgora', () => {
  it('accepte PDF, PNG, JPEG, WEBP et rend le contenu décodé', () => {
    for (const [type, octets] of [['application/pdf', PDF], ['image/png', PNG], ['image/jpeg', JPEG], ['image/webp', WEBP]] as const) {
      const a = analyserFicheAgora(uri(type, octets));
      expect(a).toMatchObject({ ok: true, type, dataUri: uri(type, octets) });
      if (a.ok) expect(a.octets.equals(octets)).toBe(true);
    }
  });

  it('le type annoncé ne compte pas : le type stocké est celui du contenu', () => {
    expect(analyserFicheAgora(uri('image/png', JPEG))).toMatchObject({ ok: true, type: 'image/jpeg', dataUri: uri('image/jpeg', JPEG) });
    // Type annoncé hostile mais contenu inerte : enregistré sous son vrai type.
    expect(analyserFicheAgora(uri('text/html', PNG))).toMatchObject({ ok: true, type: 'image/png', dataUri: uri('image/png', PNG) });
  });

  it('refuse HTML et SVG, quel que soit le type annoncé', () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/pdf', 'image/png', 'application/xhtml+xml', 'text/plain']) {
      for (const contenu of [HTML, SVG]) {
        const a = analyserFicheAgora(uri(type, contenu));
        expect(a.ok, `${type} / ${contenu.slice(0, 10)}`).toBe(false);
        if (!a.ok) expect(a.erreur).toContain('PDF, PNG, JPEG ou WEBP');
      }
    }
  });

  it('refuse ce qui n\'est pas une data URI base64 stricte', () => {
    const b64 = PDF.toString('base64');
    for (const valeur of [
      null, undefined, 42, {}, '', 'bonjour', 'https://exemple.test/a.pdf', 'javascript:alert(1)',
      `data:application/pdf,${b64}`,                        // pas de ;base64
      `data:application/pdf;charset=utf-8;base64,${b64}`,   // paramètre
      `data:text/html;charset=utf-8;base64,${Buffer.from(HTML).toString('base64')}`,
      `data:application/pdf;base64,${b64}\n<script>`,       // suite hors base64
      `data:application/pdf;base64, ${b64}`,                // espace
      `data:application/pdf;base64,${b64.slice(0, -1)}`,    // longueur invalide
      'data:application/pdf;base64,',                       // vide
      `data:;base64,${b64}`,
    ]) {
      expect(analyserFicheAgora(valeur).ok, String(valeur).slice(0, 50)).toBe(false);
    }
  });

  it('taille : 5 Mo décodés acceptés, un octet de plus refusé, envoi démesuré refusé sans décodage', () => {
    const plein = Buffer.concat([PDF, Buffer.alloc(TAILLE_MAX_FICHE_AGORA - PDF.length, 0x20)]);
    expect(analyserFicheAgora(uri('application/pdf', plein)).ok).toBe(true);
    const trop = analyserFicheAgora(uri('application/pdf', Buffer.concat([plein, Buffer.from(' ')])));
    expect(trop).toEqual({ ok: false, erreur: 'Fiche AGORA : fichier trop lourd (5 Mo maximum).' });
    expect(analyserFicheAgora(`data:application/pdf;base64,${'A'.repeat(20 * 1024 * 1024)}`)).toMatchObject({ ok: false, erreur: expect.stringContaining('trop lourd') });
  });
});

describe('nettoyerNomFicheAgora', () => {
  it('retire chemins et caractères de contrôle, borne la longueur', () => {
    expect(nettoyerNomFicheAgora('fiche été.pdf')).toBe('fiche été.pdf');
    expect(nettoyerNomFicheAgora('../../etc/passwd')).toBe('passwd');
    expect(nettoyerNomFicheAgora('C:\\Users\\x\\fiche.pdf')).toBe('fiche.pdf');
    expect(nettoyerNomFicheAgora('a\r\nSet-Cookie: x=1.pdf')).toBe('aSet-Cookie: x=1.pdf');
    expect(nettoyerNomFicheAgora('x'.repeat(500))).toHaveLength(200);
    for (const vide of [null, undefined, 12, '', '   ', '/']) expect(nettoyerNomFicheAgora(vide)).toBeNull();
  });
});

describe('preparerRestitutionFicheAgora — pièces déjà en base', () => {
  it('pièce conforme : affichée avec son type réel et nosniff', () => {
    const r = preparerRestitutionFicheAgora(uri('application/pdf', PDF))!;
    expect(r).toMatchObject({ type: 'application/pdf', disposition: 'inline', enTetes: { 'X-Content-Type-Options': 'nosniff' } });
    // Pas de bac à sable sur une pièce conforme : il bloquerait le lecteur PDF du navigateur.
    expect(r.enTetes['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(r.octets.equals(PDF)).toBe(true);
    expect(preparerRestitutionFicheAgora(uri('text/html', PNG))).toMatchObject({ type: 'image/png', disposition: 'inline' });
  });

  it('pièce historique HTML ou SVG : téléchargement opaque sous bac à sable, jamais text/html', () => {
    for (const valeur of [uri('text/html', HTML), uri('image/svg+xml', SVG), `data:text/html;charset=utf-8;base64,${Buffer.from(HTML).toString('base64')}`]) {
      const r = preparerRestitutionFicheAgora(valeur)!;
      expect(r.type).toBe('application/octet-stream');
      expect(r.disposition).toBe('attachment');
      expect(r.enTetes['X-Content-Type-Options']).toBe('nosniff');
      expect(r.enTetes['Content-Security-Policy']).toContain('sandbox');
    }
  });

  it('valeur indécodable : null', () => {
    for (const valeur of ['', 'bonjour', 'data:text/html,<script>', 'data:text/html;base64,']) {
      expect(preparerRestitutionFicheAgora(valeur), valeur).toBeNull();
    }
  });
});
