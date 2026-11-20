import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { calculerAge } from '@/lib/dates';
import { JeuneResume } from '@/lib/services';

const ESPACE_COLORS: Record<string, string> = {
  collegiens: Colors.collegiens,
  lyceens: Colors.lyceens,
  pij: Colors.pij,
  clas: Colors.clas,
};

interface JeuneListItemProps {
  jeune: JeuneResume;
  onPress?: () => void;
}

export default function JeuneListItem({ jeune, onPress }: JeuneListItemProps) {
  const couleur = ESPACE_COLORS[jeune.espaceId] ?? Colors.textMuted;
  const age = calculerAge(jeune.dateNaissance);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.item}>
      <View style={[styles.avatar, { backgroundColor: couleur + '25' }]}>
        <Text style={[styles.avatarText, { color: couleur }]}>
          {jeune.prenom.charAt(0)}{jeune.nom.charAt(0)}
        </Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.nom}>{jeune.prenom} {jeune.nom}</Text>
        <Text style={styles.details}>
          {age === null ? 'Âge inconnu' : `${age} ans`}{jeune.secteur ? ` · ${jeune.secteur}` : ''}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.white,
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '800' },
  info: { flex: 1, gap: 3 },
  nom: { fontSize: 15, fontWeight: '700', color: Colors.text },
  details: { fontSize: 12, color: Colors.textMuted },
  icons: { flexDirection: 'row', gap: 6, marginTop: 2 },
  iconChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  iconLabel: { fontSize: 10, fontWeight: '600' },
});
