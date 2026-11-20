import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useActivitesPubliques } from '@/hooks/useContenuPublic';
import IndisponibleNotice from '@/components/IndisponibleNotice';
import { useEspaces } from '@/hooks/useEspaces';
import ActiviteCard from '@/components/ActiviteCard';
import { Activite, EspaceId } from '@/types';

const ESPACE_LABELS: Record<string, string> = {
  collegiens: 'Collégiens',
  lyceens: 'Lycéens',
  pij: 'PIJ',
  clas: 'CLAS',
};

const ESPACE_COLORS: Record<string, string> = {
  collegiens: Colors.collegiens,
  lyceens: Colors.lyceens,
  pij: Colors.pij,
  clas: Colors.clas,
};

function formatDateLong(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function DetailModal({ activite, visible, onClose }: {
  activite: Activite | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!activite) return null;
  const couleur = ESPACE_COLORS[activite.espaceId];
  const tauxRemplissage = Math.round(
    ((activite.placesTotal - activite.placesDisponibles) / activite.placesTotal) * 100
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={styles.modal}>
        <View style={[styles.modalHeader, { backgroundColor: couleur }]}>
          <View style={styles.modalHeaderContent}>
            <Text style={styles.modalEspace}>{ESPACE_LABELS[activite.espaceId]}</Text>
            <Text style={styles.modalTitre}>{activite.titre}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.modalClose}>
            <Ionicons name="close" size={22} color={Colors.white} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody}>
          <Text style={styles.modalDescription}>{activite.description}</Text>

          <View style={styles.modalInfos}>
            {[
              { icon: 'calendar', label: 'Date', value: formatDateLong(activite.date) },
              { icon: 'time', label: 'Horaires', value: `${activite.heureDebut} – ${activite.heureFin}` },
              { icon: 'location', label: 'Lieu', value: activite.lieu },
              { icon: 'person', label: 'Animateur', value: activite.animateur },
            ].map((info) => (
              <View key={info.label} style={styles.modalInfoRow}>
                <View style={[styles.modalInfoIcon, { backgroundColor: couleur + '20' }]}>
                  <Ionicons name={info.icon as any} size={16} color={couleur} />
                </View>
                <View style={styles.modalInfoContent}>
                  <Text style={styles.modalInfoLabel}>{info.label}</Text>
                  <Text style={styles.modalInfoValue}>{info.value}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.placesSection}>
            <View style={styles.placesHeader}>
              <Text style={styles.placesLabel}>Places disponibles</Text>
              <Text style={[styles.placesCount, { color: couleur }]}>
                {activite.placesDisponibles} / {activite.placesTotal}
              </Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${tauxRemplissage}%` as any, backgroundColor: couleur }]} />
            </View>
          </View>

          <View style={styles.tagsRow}>
            {activite.tags.map((tag) => (
              <View key={tag} style={[styles.tag, { borderColor: couleur + '40' }]}>
                <Text style={[styles.tagText, { color: couleur }]}>{tag}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={[
              styles.inscriptionBtn,
              { backgroundColor: activite.statut === 'complet' ? Colors.textLight : couleur },
            ]}
            disabled={activite.statut === 'complet'}
            onPress={onClose}
          >
            <Ionicons
              name={activite.statut === 'complet' ? 'close-circle' : 'person-add'}
              size={18}
              color={Colors.white}
            />
            <Text style={styles.inscriptionBtnText}>
              {activite.statut === 'complet' ? 'Activité complète' : "S'inscrire à cette activité"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function Planning() {
  const espaces = useEspaces();
  const [filtreEspace, setFiltreEspace] = useState<EspaceId | 'tous'>('tous');
  const programme = useActivitesPubliques();
  const activites = (programme.data ?? []).filter(
    (a) => filtreEspace === 'tous' || a.espaceId === filtreEspace,
  );
  const [selectedActivite, setSelectedActivite] = useState<Activite | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const activitesFiltrees = [...activites].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  function openDetail(activite: Activite) {
    setSelectedActivite(activite);
    setModalVisible(true);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Filtres espaces */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtreScroll}
        contentContainerStyle={styles.filtreContainer}
      >
        <TouchableOpacity
          style={[styles.filtreBtn, filtreEspace === 'tous' && styles.filtreBtnActive]}
          onPress={() => setFiltreEspace('tous')}
        >
          <Text style={[styles.filtreBtnText, filtreEspace === 'tous' && styles.filtreBtnTextActive]}>
            Tous
          </Text>
        </TouchableOpacity>
        {espaces.map((e) => (
          <TouchableOpacity
            key={e.id}
            style={[
              styles.filtreBtn,
              filtreEspace === e.id && { backgroundColor: e.couleur, borderColor: e.couleur },
            ]}
            onPress={() => setFiltreEspace(e.id as EspaceId)}
          >
            <Text
              style={[
                styles.filtreBtnText,
                filtreEspace === e.id && styles.filtreBtnTextActive,
              ]}
            >
              {ESPACE_LABELS[e.id]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {!programme.disponible ? (
          <IndisponibleNotice
            titre="Programme non disponible dans l'application"
            message="Le programme des activités n'est pas encore consultable ici. Pour connaître les activités et sorties à venir, contactez le Pôle Jeunesse."
          />
        ) : activitesFiltrees.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>Aucune activité prévue</Text>
          </View>
        ) : (
          activitesFiltrees.map((a) => (
            <ActiviteCard
              key={a.id}
              activite={a}
              onPress={() => openDetail(a)}
              showEspace={filtreEspace === 'tous'}
            />
          ))
        )}
      </ScrollView>

      <DetailModal
        activite={selectedActivite}
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  filtreScroll: { maxHeight: 56, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  filtreContainer: { paddingHorizontal: 14, paddingVertical: 10, gap: 8, alignItems: 'center' },
  filtreBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  filtreBtnActive: { backgroundColor: Colors.purple, borderColor: Colors.purple },
  filtreBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  filtreBtnTextActive: { color: Colors.white },

  list: { flex: 1 },
  listContent: { padding: 16 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textLight },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modal: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  modalHeader: { padding: 20, paddingTop: 24, flexDirection: 'row', alignItems: 'flex-start' },
  modalHeaderContent: { flex: 1, gap: 4 },
  modalEspace: { color: Colors.white, opacity: 0.85, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  modalTitre: { color: Colors.white, fontSize: 20, fontWeight: '800', lineHeight: 26 },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: { padding: 20 },
  modalDescription: { fontSize: 14, color: Colors.text, lineHeight: 21, marginBottom: 20 },
  modalInfos: { gap: 12, marginBottom: 20 },
  modalInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalInfoIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalInfoContent: { flex: 1 },
  modalInfoLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase' },
  modalInfoValue: { fontSize: 14, color: Colors.text, fontWeight: '500', marginTop: 1 },
  placesSection: { marginBottom: 16, gap: 8 },
  placesHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  placesLabel: { fontSize: 13, color: Colors.textMuted, fontWeight: '600' },
  placesCount: { fontSize: 13, fontWeight: '700' },
  progressBar: { height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  tagsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  tagText: { fontSize: 12, fontWeight: '600' },
  modalFooter: { padding: 16, borderTopWidth: 1, borderTopColor: Colors.border },
  inscriptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  inscriptionBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
