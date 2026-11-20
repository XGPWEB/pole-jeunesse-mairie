import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import Badge from '@/components/ui/Badge';
import { Activite } from '@/types';

const ESPACE_COLORS: Record<string, string> = {
  collegiens: Colors.collegiens,
  lyceens: Colors.lyceens,
  pij: Colors.pij,
  clas: Colors.clas,
};

const ESPACE_LABELS: Record<string, string> = {
  collegiens: 'Collégiens',
  lyceens: 'Lycéens',
  pij: 'PIJ',
  clas: 'CLAS',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function statutBadge(statut: Activite['statut']) {
  if (statut === 'complet') return { label: 'Complet', variant: 'danger' as const };
  if (statut === 'annule') return { label: 'Annulé', variant: 'neutral' as const };
  return { label: 'Ouvert', variant: 'success' as const };
}

interface ActiviteCardProps {
  activite: Activite;
  onPress?: () => void;
  showEspace?: boolean;
}

export default function ActiviteCard({ activite, onPress, showEspace = false }: ActiviteCardProps) {
  const couleur = ESPACE_COLORS[activite.espaceId];
  const badge = statutBadge(activite.statut);
  const tauxRemplissage = Math.round(
    ((activite.placesTotal - activite.placesDisponibles) / activite.placesTotal) * 100
  );

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.card}
    >
      <View style={[styles.dateBand, { backgroundColor: couleur }]}>
        <Text style={styles.dateDay}>
          {new Date(activite.date).getDate()}
        </Text>
        <Text style={styles.dateMois}>
          {new Date(activite.date).toLocaleDateString('fr-FR', { month: 'short' })}
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text style={styles.titre} numberOfLines={1}>{activite.titre}</Text>
          <Badge label={badge.label} variant={badge.variant} />
        </View>

        {showEspace && (
          <Text style={[styles.espacePill, { color: couleur }]}>
            {ESPACE_LABELS[activite.espaceId]}
          </Text>
        )}

        <Text style={styles.description} numberOfLines={2}>{activite.description}</Text>

        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Ionicons name="time-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.infoText}>
              {activite.heureDebut} – {activite.heureFin}
            </Text>
          </View>
          <View style={styles.infoItem}>
            <Ionicons name="location-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.infoText} numberOfLines={1}>{activite.lieu.split(' — ')[0]}</Text>
          </View>
        </View>

        <View style={styles.placesRow}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${tauxRemplissage}%` as any, backgroundColor: couleur },
              ]}
            />
          </View>
          <Text style={styles.placesText}>
            {activite.placesDisponibles > 0
              ? `${activite.placesDisponibles} place${activite.placesDisponibles > 1 ? 's' : ''} dispo.`
              : 'Complet'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  dateBand: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  dateDay: { fontSize: 22, fontWeight: '800', color: Colors.white },
  dateMois: { fontSize: 11, color: Colors.white, textTransform: 'uppercase', fontWeight: '600' },

  body: { flex: 1, padding: 12, gap: 5 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  titre: { fontSize: 14, fontWeight: '700', color: Colors.text, flex: 1 },
  espacePill: { fontSize: 11, fontWeight: '600', marginTop: -2 },
  description: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },

  infoRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  infoText: { fontSize: 11, color: Colors.textMuted },

  placesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2 },
  placesText: { fontSize: 11, color: Colors.textMuted, minWidth: 70 },
});
