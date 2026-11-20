import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';

interface IndisponibleNoticeProps {
  titre: string;
  message: string;
  /** Affiche les moyens de joindre le Pôle Jeunesse (défaut : oui). */
  contact?: boolean;
}

/** État « fonction non disponible dans l'application », avec contact direct. */
export default function IndisponibleNotice({ titre, message, contact = true }: IndisponibleNoticeProps) {
  return (
    <View style={styles.box}>
      <Ionicons name="information-circle-outline" size={44} color={Colors.textLight} />
      <Text style={styles.titre}>{titre}</Text>
      <Text style={styles.message}>{message}</Text>
      {contact && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => Linking.openURL('tel:0148727374')}
            activeOpacity={0.8}
          >
            <Ionicons name="call" size={16} color={Colors.white} />
            <Text style={styles.btnText}>01 48 72 73 74</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondaire]}
            onPress={() => Linking.openURL('mailto:pole.jeunesse@ville-nogentsurmarne.fr')}
            activeOpacity={0.8}
          >
            <Ionicons name="mail" size={16} color={Colors.purple} />
            <Text style={[styles.btnText, { color: Colors.purple }]}>Écrire au Pôle Jeunesse</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 28,
    gap: 10,
  },
  titre: { fontSize: 16, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  message: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19 },
  actions: { marginTop: 12, gap: 10, alignSelf: 'stretch' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.purple,
    borderRadius: 12,
    paddingVertical: 12,
  },
  btnSecondaire: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.purple,
  },
  btnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
});
