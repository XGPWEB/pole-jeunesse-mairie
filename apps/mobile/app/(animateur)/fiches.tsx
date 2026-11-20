import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useJeunes, useHistoriqueJeune, useFicheJeune } from '@/hooks/useJeunes';
import { useEspaces } from '@/hooks/useEspaces';
import JeuneListItem from '@/components/JeuneListItem';
import { calculerAge, formaterDateCivile } from '@/lib/dates';
import { lienTelephone } from '@/lib/ficheJeune';
import { JeuneResume } from '@/lib/services';
import { EspaceId } from '@/types';

type Jeune = JeuneResume;

const STATUT_LABELS = { present: 'Présent', absent: 'Absent', excuse: 'Excusé' } as const;
const STATUT_COLORS = { present: Colors.present, absent: Colors.absent, excuse: Colors.excuse } as const;

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

function HistoriquePresences({ jeuneId }: { jeuneId: string }) {
  // Historique réel : pointages du jeune sur le serveur (GET /api/presences).
  const historique = useHistoriqueJeune(jeuneId);
  if (historique.loading) {
    return <Text style={styles.noHistorique}>Chargement de l'historique…</Text>;
  }
  if (historique.data === null) {
    return (
      <TouchableOpacity onPress={historique.reload}>
        <Text style={[styles.noHistorique, { color: Colors.danger }]}>
          {historique.error ?? 'Historique indisponible.'} Appuyer pour réessayer.
        </Text>
      </TouchableOpacity>
    );
  }
  if (historique.data.length === 0) {
    return <Text style={styles.noHistorique}>Aucun historique de présence enregistré.</Text>;
  }
  return (
    <View style={styles.historiqueList}>
      {historique.data.map((p) => (
        <View key={p.id} style={styles.historiqueRow}>
          <View style={[styles.statutDot, { backgroundColor: STATUT_COLORS[p.statut] }]} />
          <Text style={styles.historiqueDate}>
            {formaterDateCivile(p.date, { day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
          <Text style={[styles.historiqueStatut, { color: STATUT_COLORS[p.statut] }]}>
            {STATUT_LABELS[p.statut]}
          </Text>
          <Text style={styles.historiqueNote}>{p.activiteId ? 'Activité' : 'Accueil'}</Text>
        </View>
      ))}
    </View>
  );
}

function CarteAutorisation({ label, accordee }: { label: string; accordee: boolean }) {
  const couleur = accordee ? Colors.success : Colors.danger;
  return (
    <View style={[styles.authCard, { borderColor: couleur }]}>
      <Ionicons name={accordee ? 'checkmark-circle' : 'close-circle'} size={22} color={couleur} />
      <Text style={styles.authLabel}>{label}</Text>
      <Text style={[styles.authStatus, { color: couleur }]}>{accordee ? 'Oui' : 'Non'}</Text>
    </View>
  );
}

/**
 * Contacts famille, autorisations et observations d'UN jeune, lus sur le
 * serveur à chaque ouverture (GET /api/jeunes/[id]/fiche). Aucune donnée de
 * repli ni de démonstration : tant que le serveur n'a pas répondu, ou après
 * un échec, rien n'est affiché d'autre que l'état de chargement ou l'erreur.
 * Les données ne vivent que dans l'état de ce composant, démonté à la
 * fermeture de la fiche.
 */
function DetailFiche({ jeuneId }: { jeuneId: string }) {
  const fiche = useFicheJeune(jeuneId);

  if (fiche.loading) {
    return (
      <View style={styles.ficheSection}>
        <Text style={styles.ficheSectionTitre}>Contacts famille et autorisations</Text>
        <View style={styles.ficheInfoRow}>
          <ActivityIndicator size="small" color={Colors.purple} />
          <Text style={styles.ficheInfoText}>Chargement de la fiche…</Text>
        </View>
      </View>
    );
  }

  // Garde : ne jamais afficher la fiche d'un autre jeune que celui demandé.
  const donnees = fiche.data !== null && fiche.data.id === jeuneId ? fiche.data : null;
  if (donnees === null) {
    return (
      <View style={styles.ficheSection}>
        <Text style={styles.ficheSectionTitre}>Contacts famille et autorisations</Text>
        <View style={[styles.observationBox, { backgroundColor: Colors.dangerLight }]}>
          <Ionicons name="alert-circle-outline" size={16} color={Colors.danger} />
          <Text style={styles.observationText}>
            {fiche.error ?? 'Fiche indisponible.'}
          </Text>
        </View>
        <TouchableOpacity onPress={fiche.reload} style={styles.contactBtn} accessibilityRole="button">
          <Ionicons name="refresh" size={14} color={Colors.navy} />
          <Text style={styles.contactBtnText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      {/* Contacts famille */}
      <View style={styles.ficheSection}>
        <Text style={styles.ficheSectionTitre}>Contacts famille</Text>
        {donnees.contacts.length === 0 ? (
          <Text style={styles.noHistorique}>Aucun contact renseigné sur la fiche.</Text>
        ) : (
          donnees.contacts.map((c, i) => {
            const lien = lienTelephone(c.telephone);
            return (
              <View key={`${i}-${c.nom}`} style={styles.contactCard}>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactNom}>{c.nom || 'Nom non renseigné'}</Text>
                  {c.lien ? <Text style={styles.contactLien}>{c.lien}</Text> : null}
                </View>
                <View style={styles.contactActions}>
                  {c.telephone === '' ? (
                    <Text style={styles.noHistorique}>Téléphone non renseigné</Text>
                  ) : lien === null ? (
                    <View style={styles.contactBtn}>
                      <Ionicons name="call-outline" size={14} color={Colors.navy} />
                      <Text style={styles.contactBtnText}>{c.telephone}</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.contactBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Appeler ${c.nom || 'ce contact'}`}
                      onPress={() => {
                        // Un appareil sans téléphonie rejette l'ouverture : le numéro reste lisible.
                        Linking.openURL(lien).catch(() => undefined);
                      }}
                    >
                      <Ionicons name="call-outline" size={14} color={Colors.navy} />
                      <Text style={styles.contactBtnText}>{c.telephone}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Autorisations */}
      <View style={styles.ficheSection}>
        <Text style={styles.ficheSectionTitre}>Autorisations</Text>
        <View style={styles.autorisationsGrid}>
          <CarteAutorisation label="Sortie" accordee={donnees.autorisations.sortie} />
          <CarteAutorisation label="Photo" accordee={donnees.autorisations.photo} />
          <CarteAutorisation label="Soins bénins" accordee={donnees.autorisations.soinsBenins} />
        </View>
      </View>

      {/* Observations */}
      <View style={styles.ficheSection}>
        <Text style={styles.ficheSectionTitre}>Observations</Text>
        {donnees.observations ? (
          <View style={styles.observationBox}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.textMuted} />
            <Text style={styles.observationText}>{donnees.observations}</Text>
          </View>
        ) : (
          <Text style={styles.noHistorique}>Aucune observation.</Text>
        )}
      </View>
    </>
  );
}

function FicheModal({ jeune, visible, onClose }: { jeune: Jeune | null; visible: boolean; onClose: () => void }) {
  if (!jeune) return null;
  const couleur = ESPACE_COLORS[jeune.espaceId] ?? Colors.textMuted;
  const age = calculerAge(jeune.dateNaissance);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={styles.modal}>
        {/* Header */}
        <View style={[styles.ficheHeader, { backgroundColor: couleur }]}>
          <View style={styles.ficheAvatar}>
            <Text style={styles.ficheAvatarText}>{jeune.prenom.charAt(0)}{jeune.nom.charAt(0)}</Text>
          </View>
          <View style={styles.ficheHeaderInfo}>
            <Text style={styles.ficheNom}>{jeune.prenom} {jeune.nom}</Text>
            <Text style={styles.ficheMeta}>{age === null ? 'Âge inconnu' : `${age} ans`}</Text>
            <Text style={styles.ficheEspace}>{ESPACE_LABELS[jeune.espaceId] ?? jeune.espaceId}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.ficheClose}>
            <Ionicons name="close" size={22} color={Colors.white} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.ficheBody}>
          {/* Identité */}
          <View style={styles.ficheSection}>
            <Text style={styles.ficheSectionTitre}>Identité</Text>
            {jeune.dateNaissance ? (
              <View style={styles.ficheInfoRow}>
                <Ionicons name="calendar-outline" size={15} color={Colors.textMuted} />
                <Text style={styles.ficheInfoText}>
                  Né(e) le {formaterDateCivile(jeune.dateNaissance, { day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>
              </View>
            ) : null}
            {jeune.secteur ? (
              <View style={styles.ficheInfoRow}>
                <Ionicons name="home-outline" size={15} color={Colors.textMuted} />
                <Text style={styles.ficheInfoText}>Secteur : {jeune.secteur}</Text>
              </View>
            ) : null}
          </View>

          {/* Contacts, autorisations, observations : fiche détaillée du serveur.
              Rendue seulement quand la fiche est ouverte, et remontée pour chaque
              jeune : rien n'est conservé d'une ouverture à l'autre. */}
          {visible ? <DetailFiche key={jeune.id} jeuneId={jeune.id} /> : null}

          {/* Historique présences */}
          <View style={[styles.ficheSection, { marginBottom: 40 }]}>
            <Text style={styles.ficheSectionTitre}>Historique de présence</Text>
            <HistoriquePresences jeuneId={jeune.id} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function Fiches() {
  const espaces = useEspaces();
  const [filtreEspace, setFiltreEspace] = useState<EspaceId | 'tous'>('tous');
  const [recherche, setRecherche] = useState('');
  const [ficheSelectee, setFicheSelectee] = useState<Jeune | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  // Jeunes du backend pour la session courante ; aucune donnée de repli.
  const jeunesRes = useJeunes();
  const jeunesFiltrés = (jeunesRes.data ?? []).filter(
    (j) =>
      (filtreEspace === 'tous' || j.espaceId === filtreEspace) &&
      (recherche === '' ||
        `${j.prenom} ${j.nom}`.toLowerCase().includes(recherche.toLowerCase()) ||
        j.secteur.toLowerCase().includes(recherche.toLowerCase()))
  );

  function openFiche(jeune: Jeune) {
    setFicheSelectee(jeune);
    setModalVisible(true);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Recherche */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={Colors.textLight} />
        <TextInput
          style={styles.searchInput}
          placeholder="Nom, prénom, secteur…"
          placeholderTextColor={Colors.textLight}
          value={recherche}
          onChangeText={setRecherche}
          returnKeyType="search"
        />
        {recherche !== '' && (
          <TouchableOpacity onPress={() => setRecherche('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textLight} />
          </TouchableOpacity>
        )}
      </View>

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
              style={[styles.filtreBtnText, filtreEspace === e.id && styles.filtreBtnTextActive]}
            >
              {ESPACE_LABELS[e.id]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Compteur */}
      <View style={styles.compteurRow}>
        <Text style={styles.compteur}>{jeunesFiltrés.length} jeune{jeunesFiltrés.length > 1 ? 's' : ''}</Text>
      </View>

      {/* Liste */}
      <ScrollView style={styles.flex}>
        {jeunesRes.loading ? (
          <View style={styles.emptyBox}>
            <ActivityIndicator size="large" color={Colors.purple} />
            <Text style={styles.emptyText}>Chargement des jeunes…</Text>
          </View>
        ) : jeunesRes.data === null ? (
          <View style={styles.emptyBox}>
            <Ionicons name="cloud-offline-outline" size={40} color={Colors.textLight} />
            <Text style={styles.emptyText}>{jeunesRes.error ?? 'Liste des jeunes indisponible.'}</Text>
            <TouchableOpacity onPress={jeunesRes.reload}>
              <Text style={[styles.emptyText, { color: Colors.purple, fontWeight: '700' }]}>Réessayer</Text>
            </TouchableOpacity>
          </View>
        ) : jeunesFiltrés.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="search-outline" size={40} color={Colors.textLight} />
            <Text style={styles.emptyText}>Aucun jeune trouvé</Text>
          </View>
        ) : (
          jeunesFiltrés.map((j) => (
            <JeuneListItem key={j.id} jeune={j} onPress={() => openFiche(j)} />
          ))
        )}
      </ScrollView>

      <FicheModal
        jeune={ficheSelectee}
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },

  filtreScroll: { maxHeight: 50, backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  filtreContainer: { paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: 'center' },
  filtreBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  filtreBtnActive: { backgroundColor: Colors.purple, borderColor: Colors.purple },
  filtreBtnText: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },
  filtreBtnTextActive: { color: Colors.white },

  compteurRow: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: Colors.background },
  compteur: { fontSize: 12, color: Colors.textMuted, fontWeight: '500' },

  emptyBox: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: Colors.textMuted },

  // Modal fiche
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modal: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  ficheHeader: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 14 },
  ficheAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ficheAvatarText: { fontSize: 20, fontWeight: '800', color: Colors.white },
  ficheHeaderInfo: { flex: 1 },
  ficheNom: { color: Colors.white, fontSize: 18, fontWeight: '800' },
  ficheMeta: { color: Colors.white, fontSize: 13, opacity: 0.85, marginTop: 2 },
  ficheEspace: { color: Colors.white, fontSize: 11, opacity: 0.7, marginTop: 2, textTransform: 'uppercase', fontWeight: '600' },
  ficheClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  ficheBody: { padding: 16 },
  ficheSection: { marginBottom: 20 },
  ficheSectionTitre: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  ficheInfoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 7 },
  ficheInfoText: { fontSize: 13, color: Colors.text, flex: 1, lineHeight: 19 },

  contactCard: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  contactInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  contactNom: { fontSize: 14, fontWeight: '700', color: Colors.text },
  contactLien: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' },
  contactActions: { gap: 6 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  contactBtnText: { fontSize: 12, color: Colors.navy, fontWeight: '500' },

  autorisationsGrid: { flexDirection: 'row', gap: 10 },
  authCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  authLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', textAlign: 'center' },
  authStatus: { fontSize: 13, fontWeight: '800' },

  observationBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: Colors.warningLight,
    borderRadius: 10,
    padding: 12,
    alignItems: 'flex-start',
  },
  observationText: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 19 },

  noHistorique: { fontSize: 13, color: Colors.textLight, fontStyle: 'italic' },
  historiqueList: { gap: 8 },
  historiqueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statutDot: { width: 10, height: 10, borderRadius: 5 },
  historiqueDate: { fontSize: 12, color: Colors.textMuted, minWidth: 100 },
  historiqueStatut: { fontSize: 12, fontWeight: '700' },
  historiqueNote: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' },
});
