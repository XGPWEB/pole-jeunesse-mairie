import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useMesInscriptions } from '@/hooks/useContenuPublic';
import IndisponibleNotice from '@/components/IndisponibleNotice';
import { StatutInscription } from '@/types';

// ─── Config statuts ──────────────────────────────────────────────────────────
type StatutConfig = {
  label: string;
  color: string;
  bgColor: string;
  icon: string;
};

const STATUT_CONFIG: Record<StatutInscription, StatutConfig> = {
  confirmee: {
    label: 'Confirmée',
    color: Colors.success,
    bgColor: Colors.successLight,
    icon: 'checkmark-circle',
  },
  'en-attente': {
    label: 'En attente',
    color: Colors.warning,
    bgColor: Colors.warningLight,
    icon: 'time',
  },
  annulee: {
    label: 'Annulée',
    color: Colors.textMuted,
    bgColor: Colors.border,
    icon: 'close-circle',
  },
  refusee: {
    label: 'Refusée',
    color: Colors.danger,
    bgColor: Colors.dangerLight,
    icon: 'close-circle',
  },
};

// ─── Config espaces ──────────────────────────────────────────────────────────
const ESPACE_CONFIG: Record<string, { label: string; color: string }> = {
  collegiens: { label: 'Collégiens', color: Colors.collegiens },
  lyceens: { label: 'Lycéens', color: Colors.lyceens },
  pij: { label: 'PIJ', color: Colors.pij },
  clas: { label: 'CLAS', color: Colors.clas },
};

// ─── Filtres ─────────────────────────────────────────────────────────────────
type Filtre = 'tous' | StatutInscription;

const FILTRES: { key: Filtre; label: string }[] = [
  { key: 'tous', label: 'Toutes' },
  { key: 'confirmee', label: 'Confirmées' },
  { key: 'en-attente', label: 'En attente' },
  { key: 'annulee', label: 'Annulées' },
  { key: 'refusee', label: 'Refusées' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function MesInscriptions() {
  // L'application ne connaît aucune identité jeune ou famille : il n'y a pas
  // d'inscriptions « de l'utilisateur » à afficher. On l'indique plutôt que de
  // montrer celles d'une autre personne.
  const suivi = useMesInscriptions();
  const inscriptions = suivi.data ?? [];
  const [filtre, setFiltre] = useState<Filtre>('tous');

  if (!suivi.disponible) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <IndisponibleNotice
          titre="Suivi des inscriptions non disponible"
          message="L'application ne propose pas encore de compte jeune ou famille : vos inscriptions ne peuvent pas y être affichées. Pour connaître l'état d'une inscription, contactez le Pôle Jeunesse."
        />
      </SafeAreaView>
    );
  }

  const filtrees =
    filtre === 'tous'
      ? inscriptions
      : inscriptions.filter((i) => i.statut === filtre);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Barre de filtres */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtreScroll}
        contentContainerStyle={styles.filtreContainer}
      >
        {FILTRES.map(({ key, label }) => {
          const isActive = filtre === key;
          const statutCfg = key !== 'tous' ? STATUT_CONFIG[key as StatutInscription] : null;
          const activeColor = statutCfg ? statutCfg.color : Colors.purple;

          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.filtreBtn,
                isActive && { backgroundColor: activeColor, borderColor: activeColor },
              ]}
              onPress={() => setFiltre(key)}
              activeOpacity={0.8}
            >
              {key !== 'tous' && statutCfg && (
                <Ionicons
                  name={statutCfg.icon as any}
                  size={13}
                  color={isActive ? Colors.white : statutCfg.color}
                />
              )}
              <Text
                style={[
                  styles.filtreBtnText,
                  isActive && styles.filtreBtnTextActive,
                  !isActive && key !== 'tous' && statutCfg
                    ? { color: statutCfg.color }
                    : undefined,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Compteur */}
      <View style={styles.compteurRow}>
        <Text style={styles.compteurText}>
          {filtrees.length} inscription{filtrees.length !== 1 ? 's' : ''}
        </Text>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {filtrees.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={52} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>Aucune inscription</Text>
            <Text style={styles.emptySubtitle}>
              {filtre === 'tous'
                ? 'Tu n\'as pas encore d\'inscriptions.'
                : `Aucune inscription avec le statut « ${STATUT_CONFIG[filtre as StatutInscription]?.label} ».`}
            </Text>
          </View>
        ) : (
          filtrees.map((inscription) => {
            const statutCfg = STATUT_CONFIG[inscription.statut];
            const espaceCfg = inscription.espaceId
              ? ESPACE_CONFIG[inscription.espaceId]
              : null;

            return (
              <View key={inscription.id} style={styles.card}>
                {/* En-tête carte */}
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    {espaceCfg && (
                      <View
                        style={[
                          styles.espaceBadge,
                          { backgroundColor: espaceCfg.color + '18' },
                        ]}
                      >
                        <Text style={[styles.espaceBadgeText, { color: espaceCfg.color }]}>
                          {espaceCfg.label}
                        </Text>
                      </View>
                    )}
                  </View>
                  {/* Badge statut */}
                  <View
                    style={[
                      styles.statutBadge,
                      { backgroundColor: statutCfg.bgColor },
                    ]}
                  >
                    <Ionicons
                      name={statutCfg.icon as any}
                      size={13}
                      color={statutCfg.color}
                    />
                    <Text style={[styles.statutBadgeText, { color: statutCfg.color }]}>
                      {statutCfg.label}
                    </Text>
                  </View>
                </View>

                {/* Titre activité */}
                <Text style={styles.cardTitre}>
                  {inscription.activiteTitre ?? `Activité #${inscription.activiteId}`}
                </Text>

                {/* Méta */}
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={14} color={Colors.textLight} />
                  <Text style={styles.metaText}>
                    Inscrit le {formatDate(inscription.dateInscription)}
                  </Text>
                </View>

                {/* Note éventuelle */}
                {inscription.note ? (
                  <View style={styles.noteContainer}>
                    <Ionicons name="chatbubble-ellipses-outline" size={13} color={Colors.purple} />
                    <Text style={styles.noteText}>{inscription.note}</Text>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // Filtres
  filtreScroll: {
    maxHeight: 56,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filtreContainer: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    alignItems: 'center',
  },
  filtreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  filtreBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  filtreBtnTextActive: {
    color: Colors.white,
  },

  // Compteur
  compteurRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  compteurText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },

  // Liste
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 30 },

  // Carte
  card: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  espaceBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 20,
  },
  espaceBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statutBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Contenu
  cardTitre: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.text,
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 12,
    color: Colors.textLight,
  },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.purplePale,
    borderRadius: 8,
    padding: 10,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    color: Colors.purple,
    lineHeight: 17,
    fontStyle: 'italic',
  },

  // État vide
  empty: {
    alignItems: 'center',
    paddingTop: 70,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textLight,
    textAlign: 'center',
    paddingHorizontal: 30,
    lineHeight: 20,
  },
});
