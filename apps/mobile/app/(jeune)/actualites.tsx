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
import { useActualitesPubliques } from '@/hooks/useContenuPublic';
import IndisponibleNotice from '@/components/IndisponibleNotice';
import { Actualite } from '@/types';

const CATEGORIE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  evenement: { label: 'Événement', color: Colors.blue, icon: 'star' },
  annonce: { label: 'Annonce', color: Colors.navy, icon: 'megaphone' },
  sortie: { label: 'Sortie', color: Colors.lyceens, icon: 'bus' },
  atelier: { label: 'Atelier', color: Colors.clas, icon: 'color-palette' },
};

const ESPACE_LABELS: Record<string, string> = {
  collegiens: 'Collégiens',
  lyceens: 'Lycéens',
  pij: 'PIJ',
  clas: 'CLAS',
};

function formatDateLong(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateCourte(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Actualites() {
  const fil = useActualitesPubliques();
  const actualites = fil.data ?? [];
  const [selected, setSelected] = useState<Actualite | null>(null);
  const [filtre, setFiltre] = useState<string>('tous');

  const filtrees = filtre === 'tous'
    ? actualites
    : actualites.filter((a) => a.categorie === filtre);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Filtres */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtreScroll}
        contentContainerStyle={styles.filtreContainer}
      >
        <TouchableOpacity
          style={[styles.filtreBtn, filtre === 'tous' && styles.filtreBtnActive]}
          onPress={() => setFiltre('tous')}
        >
          <Text style={[styles.filtreBtnText, filtre === 'tous' && styles.filtreBtnTextActive]}>Tout</Text>
        </TouchableOpacity>
        {Object.entries(CATEGORIE_CONFIG).map(([key, val]) => (
          <TouchableOpacity
            key={key}
            style={[
              styles.filtreBtn,
              filtre === key && { backgroundColor: val.color, borderColor: val.color },
            ]}
            onPress={() => setFiltre(key)}
          >
            <Ionicons name={val.icon as any} size={13} color={filtre === key ? Colors.white : val.color} />
            <Text style={[styles.filtreBtnText, filtre === key && styles.filtreBtnTextActive]}>
              {val.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {filtrees.map((actu) => {
          const cat = CATEGORIE_CONFIG[actu.categorie];
          return (
            <TouchableOpacity
              key={actu.id}
              style={[styles.card, actu.epingle && styles.cardEpingle]}
              onPress={() => setSelected(actu)}
              activeOpacity={0.85}
            >
              {actu.epingle && (
                <View style={styles.epingleBanner}>
                  <Ionicons name="pin" size={11} color={Colors.white} />
                  <Text style={styles.epingleText}>À la une</Text>
                </View>
              )}
              <View style={styles.cardHeader}>
                <View style={[styles.catBadge, { backgroundColor: cat.color + '18' }]}>
                  <Ionicons name={cat.icon as any} size={13} color={cat.color} />
                  <Text style={[styles.catLabel, { color: cat.color }]}>{cat.label}</Text>
                </View>
                {actu.espaceId && (
                  <Text style={styles.espaceTag}>{ESPACE_LABELS[actu.espaceId]}</Text>
                )}
              </View>
              <Text style={styles.cardTitre}>{actu.titre}</Text>
              <Text style={styles.cardContenu} numberOfLines={3}>{actu.contenu}</Text>
              <View style={styles.cardFooter}>
                <Ionicons name="person-circle-outline" size={14} color={Colors.textLight} />
                <Text style={styles.cardAuteur}>{actu.auteur}</Text>
                <Text style={styles.cardSep}>·</Text>
                <Ionicons name="calendar-outline" size={13} color={Colors.textLight} />
                <Text style={styles.cardDate}>{formatDateCourte(actu.date)}</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {!fil.disponible && (
          <IndisponibleNotice
            titre="Actualités non disponibles dans l'application"
            message="Les actualités du Pôle Jeunesse ne sont pas encore consultables ici. Pour toute information, contactez directement l'équipe."
          />
        )}

        {fil.disponible && filtrees.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="newspaper-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>Aucune actualité dans cette catégorie.</Text>
          </View>
        )}
      </ScrollView>

      {/* Modal détail */}
      <Modal visible={!!selected} animationType="slide" transparent>
        <Pressable style={styles.overlay} onPress={() => setSelected(null)} />
        {selected && (
          <View style={styles.modal}>
            <View style={[styles.modalTop, { backgroundColor: CATEGORIE_CONFIG[selected.categorie].color }]}>
              <View style={styles.modalTopContent}>
                <View style={styles.modalCatRow}>
                  <Ionicons name={CATEGORIE_CONFIG[selected.categorie].icon as any} size={14} color={Colors.white} />
                  <Text style={styles.modalCat}>{CATEGORIE_CONFIG[selected.categorie].label}</Text>
                  {selected.espaceId && (
                    <Text style={styles.modalEspace}>— {ESPACE_LABELS[selected.espaceId]}</Text>
                  )}
                </View>
                <Text style={styles.modalTitre}>{selected.titre}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelected(null)} style={styles.modalClose}>
                <Ionicons name="close" size={22} color={Colors.white} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <Text style={styles.modalContenu}>{selected.contenu}</Text>
              <View style={styles.modalMeta}>
                <Ionicons name="person-circle-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.modalMetaText}>{selected.auteur}</Text>
                <Text style={styles.modalMetaSep}>·</Text>
                <Text style={styles.modalMetaText}>{formatDateLong(selected.date)}</Text>
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filtreScroll: { maxHeight: 54, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  filtreContainer: { paddingHorizontal: 14, paddingVertical: 10, gap: 8, alignItems: 'center' },
  filtreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  filtreBtnActive: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  filtreBtnText: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },
  filtreBtnTextActive: { color: Colors.white },

  list: { flex: 1 },
  listContent: { padding: 16 },

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
    gap: 6,
    overflow: 'hidden',
  },
  cardEpingle: { borderWidth: 1.5, borderColor: Colors.navy + '40' },
  epingleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.navy,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  epingleText: { color: Colors.white, fontSize: 10, fontWeight: '700' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  catLabel: { fontSize: 11, fontWeight: '700' },
  espaceTag: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' },
  cardTitre: { fontSize: 15, fontWeight: '800', color: Colors.text, lineHeight: 21 },
  cardContenu: { fontSize: 13, color: Colors.textMuted, lineHeight: 19 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  cardAuteur: { fontSize: 11, color: Colors.textLight },
  cardSep: { fontSize: 11, color: Colors.textLight },
  cardDate: { fontSize: 11, color: Colors.textLight },

  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textLight },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modal: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    overflow: 'hidden',
  },
  modalTop: { padding: 20, paddingTop: 24, flexDirection: 'row', alignItems: 'flex-start' },
  modalTopContent: { flex: 1, gap: 6 },
  modalCatRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modalCat: { color: Colors.white, fontSize: 12, fontWeight: '700', opacity: 0.9, textTransform: 'uppercase' },
  modalEspace: { color: Colors.white, fontSize: 12, opacity: 0.75 },
  modalTitre: { color: Colors.white, fontSize: 18, fontWeight: '800', lineHeight: 24 },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: { padding: 20 },
  modalContenu: { fontSize: 15, color: Colors.text, lineHeight: 24, marginBottom: 20 },
  modalMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 30 },
  modalMetaText: { fontSize: 12, color: Colors.textMuted },
  modalMetaSep: { fontSize: 12, color: Colors.textLight },
});
