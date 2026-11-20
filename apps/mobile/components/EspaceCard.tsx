import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { Espace } from '@/types';

interface EspaceCardProps {
  espace: Espace;
  onPress?: () => void;
}

export default function EspaceCard({ espace, onPress }: EspaceCardProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.card, { borderLeftColor: espace.couleur }]}
    >
      <View style={[styles.iconWrapper, { backgroundColor: espace.couleur + '20' }]}>
        <Ionicons name={espace.icon as any} size={28} color={espace.couleur} />
      </View>
      <View style={styles.content}>
        <Text style={styles.nom}>{espace.nom}</Text>
        <Text style={styles.age}>{espace.trancheAge}</Text>
        <Text style={styles.description} numberOfLines={2}>
          {espace.description}
        </Text>
        <View style={styles.footer}>
          <Ionicons name="location-outline" size={13} color={Colors.textMuted} />
          <Text style={styles.adresse} numberOfLines={1}>{espace.adresse}</Text>
        </View>
        <View style={styles.footer}>
          <Ionicons name="time-outline" size={13} color={Colors.textMuted} />
          <Text style={styles.horaires} numberOfLines={2}>{espace.horaires.replace(' | ', '\n')}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
    gap: 12,
  },
  iconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, gap: 3 },
  nom: { fontSize: 15, fontWeight: '700', color: Colors.text },
  age: { fontSize: 12, color: Colors.blue, fontWeight: '600' },
  description: { fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  adresse: { fontSize: 11, color: Colors.textMuted, flex: 1 },
  horaires: { fontSize: 11, color: Colors.textMuted, flex: 1, lineHeight: 16 },
});
