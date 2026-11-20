import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { Jeune, StatutPresence } from '@/types';
import { getAge } from '@/hooks/useJeunes';

const STATUT_CONFIG: Record<StatutPresence, { label: string; color: string; icon: string }> = {
  present: { label: 'Présent', color: Colors.present, icon: 'checkmark-circle' },
  absent: { label: 'Absent', color: Colors.absent, icon: 'close-circle' },
  excuse: { label: 'Excusé', color: Colors.excuse, icon: 'alert-circle' },
  'non-pointe': { label: '—', color: Colors.textLight, icon: 'ellipse-outline' },
};

interface PresenceRowProps {
  jeune: Jeune;
  statut: StatutPresence;
  onChangeStatut: (statut: StatutPresence) => void;
}

const STATUTS_CYCLE: StatutPresence[] = ['non-pointe', 'present', 'absent', 'excuse'];

export default function PresenceRow({ jeune, statut, onChangeStatut }: PresenceRowProps) {
  const config = STATUT_CONFIG[statut];

  function cycleStatut() {
    const idx = STATUTS_CYCLE.indexOf(statut);
    const next = STATUTS_CYCLE[(idx + 1) % STATUTS_CYCLE.length];
    onChangeStatut(next);
  }

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {jeune.prenom[0]}{jeune.nom[0]}
        </Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.nom}>{jeune.prenom} {jeune.nom}</Text>
        <Text style={styles.meta}>{jeune.classe} · {getAge(jeune.dateNaissance)} ans</Text>
      </View>

      <TouchableOpacity onPress={cycleStatut} style={styles.statutBtn} activeOpacity={0.7}>
        <Ionicons name={config.icon as any} size={26} color={config.color} />
        <Text style={[styles.statutLabel, { color: config.color }]}>{config.label}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
    backgroundColor: Colors.white,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.blueLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '700', color: Colors.navy },
  info: { flex: 1 },
  nom: { fontSize: 14, fontWeight: '600', color: Colors.text },
  meta: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  statutBtn: { alignItems: 'center', minWidth: 60 },
  statutLabel: { fontSize: 10, fontWeight: '600', marginTop: 2 },
});
