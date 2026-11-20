import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  size?: number;
}

/**
 * Reproduction vectorielle du logo Pôle Jeunesse :
 * - Panneau gauche blanc avec "PÔLE" en violet, écrit verticalement (rotation -90°)
 * - Bulle droite violette (#6B1A6E) avec "JEUN" en bleu ciel (#A8D8EA) et "ESSE" en blanc
 * - Queue de bulle triangulaire en bas à gauche de la bulle droite
 *
 * Fix layout issues:
 * - Le texte "PÔLE" est contraint à une largeur fixe = hauteur du panneau avant rotation,
 *   ce qui évite tout débordement (transform ne modifie pas le layout en RN).
 * - overflow: 'hidden' sur le panneau gauche masque tout dépassement résiduel.
 * - numberOfLines={1} sur tous les Text empêche le retour à la ligne.
 * - "ESSE" est un seul Text (plus de row ESS + E) pour éviter les décalages.
 */
export default function LogoPoleJeunesse({ size = 100 }: Props) {
  // Total width is 15% wider than height to accommodate both panels + gap
  const w = size * 1.15;
  const h = size;

  // Left panel: ~32% of total width
  const leftW = Math.round(w * 0.32);
  // Gap between panels
  const gap = 3;
  // Right bubble: remaining width
  const rightW = w - leftW - gap;

  // Font size for JEUN / ESSE — sized to fit comfortably in rightW
  const fontSize = Math.round(size * 0.2);

  // Border radius for rounded corners
  const radius = Math.round(size * 0.1);

  // Tail dimensions (small triangle below-left of right bubble)
  const tailH = Math.round(size * 0.14);
  const tailLeft = Math.round(size * 0.07);   // offset from right bubble left edge
  const tailRight = Math.round(size * 0.14);  // width of right side (angled)

  // "PÔLE" font size — smaller to fit within leftW after rotation
  // After -90° rotation the text's rendered width becomes its layout height,
  // and its rendered height becomes its layout width.
  // We give the Text a fixed width = (h * 0.8) so the rotated text spans ~80% of
  // the panel height, and a fixed height = leftW so it stays within the panel width.
  const poleFontSize = Math.round(size * 0.15);
  const poleTextWidth = Math.round(h * 0.82);   // becomes visual height after rotation
  const poleTextHeight = Math.round(leftW * 0.9); // becomes visual width after rotation

  return (
    <View style={{ width: w, height: h + tailH }}>
      {/* Main row: left panel + gap + right bubble */}
      <View style={{ flexDirection: 'row', width: w, height: h }}>

        {/* ── Left panel — white background, purple border, "PÔLE" vertical ── */}
        <View style={[styles.leftPanel, {
          width: leftW,
          height: h,
          borderRadius: radius,
          borderColor: '#6B1A6E',
        }]}>
          {/*
           * The Text is sized as if it were horizontal:
           *   width  = poleTextWidth  (will become the visual height after rotation)
           *   height = poleTextHeight (will become the visual width after rotation)
           * After rotation the text is centred by the parent's alignItems/justifyContent.
           */}
          <Text
            numberOfLines={1}
            style={[styles.poleText, {
              fontSize: poleFontSize,
              width: poleTextWidth,
              height: poleTextHeight,
              transform: [{ rotate: '-90deg' }],
            }]}
          >
            PÔLE
          </Text>
        </View>

        {/* ── Gap ── */}
        <View style={{ width: gap }} />

        {/* ── Right bubble — purple ── */}
        <View style={[styles.rightBubble, {
          width: rightW,
          height: h,
          borderRadius: radius,
          backgroundColor: '#6B1A6E',
          paddingHorizontal: Math.round(size * 0.07),
          paddingVertical: Math.round(size * 0.1),
        }]}>
          {/* "JEUN" in light blue */}
          <Text
            numberOfLines={1}
            style={[styles.jeunText, { fontSize }]}
          >
            JEUN
          </Text>

          {/* "ESSE" in white — single Text, no row split */}
          <Text
            numberOfLines={1}
            style={[styles.esseText, { fontSize }]}
          >
            ESSE
          </Text>
        </View>
      </View>

      {/* ── Tail — triangle below-left corner of right bubble ── */}
      <View style={[styles.tail, {
        left: leftW + gap + tailLeft,
        borderLeftWidth: tailLeft,
        borderRightWidth: tailRight,
        borderTopWidth: tailH,
        borderTopColor: '#6B1A6E',
      }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  leftPanel: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',  // clip any residual overflow from the rotated text
  },
  poleText: {
    color: '#6B1A6E',
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  rightBubble: {
    justifyContent: 'space-evenly',
    overflow: 'hidden',
  },
  jeunText: {
    color: '#A8D8EA',
    fontWeight: '900',
    letterSpacing: 1,
  },
  esseText: {
    color: '#FFFFFF',
    fontWeight: '900',
    letterSpacing: 1,
  },
  tail: {
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
