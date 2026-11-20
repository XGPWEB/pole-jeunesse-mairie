import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/hooks/useAuth';
import { useActivites } from '@/hooks/useActivites';
import { useJeunes } from '@/hooks/useJeunes';
import { ApiError, messageErreur } from '@/lib/api';
import { api } from '@/lib/client';
import { calculerAge, dateCivileParis, formaterDateCivile, heureParis, jourDuMois } from '@/lib/dates';
import { espaceIdAssigne, filtrerParEspace } from '@/lib/espaces';
import {
  BrouillonStatuts,
  brouillonRestant,
  calculerEcart,
  construireRegistre,
  EtatRegistre,
  idLigneManuelle,
  LigneManuelle,
  Registre,
  REGISTRE_VIDE,
  statutAffiche,
  StatutPointage,
} from '@/lib/pointages';
import { demarrerEnvoi, EtatSaisie, executerEnvoi, modifierBrouillon, saisieInitiale } from '@/lib/saisie';
import {
  ActiviteResume,
  chargerPointages,
  creerPointages,
  EntreeArrivee,
  EntreeStatutActivite,
  supprimerPointage,
} from '@/lib/services';

// ─── Types ────────────────────────────────────────────────────────────────────

type Statut = StatutPointage | null;

const OPTIONS_STATUT = [
  { key: 'present', label: 'Présent', color: Colors.present },
  { key: 'absent',  label: 'Absent',  color: Colors.absent  },
  { key: 'excuse',  label: 'Excusé',  color: Colors.excuse  },
] as const;

// Une personne non inscrite ne peut être enregistrée que comme présente :
// le serveur ne stocke pas d'absence nominative sans fiche jeune.
const OPTIONS_STATUT_MANUEL = OPTIONS_STATUT.filter((o) => o.key === 'present');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateBadge(dateCivile: string): { day: string; month: string } {
  if (!dateCivile) return { day: '—', month: '' };
  return {
    day:   String(jourDuMois(dateCivile)),
    month: formaterDateCivile(dateCivile, { month: 'short' }).replace('.', ''),
  };
}

function compter(etat: EtatRegistre, date: string): Record<StatutPointage, number> {
  const total: Record<StatutPointage, number> = { present: 0, absent: 0, excuse: 0 };
  for (const parDate of Object.values(etat.cellules)) {
    const cellule = parDate[date];
    if (cellule) total[cellule.statut] += 1;
  }
  return total;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function Presences() {
  const { animateur } = useAuth();

  const activitesRes = useActivites();
  const jeunesRes    = useJeunes();

  const [selectedActivity, setSelectedActivity] = useState<ActiviteResume | null>(null);

  // État serveur du registre de l'activité sélectionnée (null = pas encore reçu).
  const [serveur, setServeur]             = useState<EtatRegistre | null>(null);
  const [chargement, setChargement]       = useState(false);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);

  // Saisie locale non enregistrée : rowId → statut voulu (null = effacer).
  const [saisie, setSaisie] = useState<EtatSaisie<BrouillonStatuts>>(saisieInitiale<BrouillonStatuts>({}));
  const [manuelsLocaux, setManuelsLocaux] = useState<LigneManuelle[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [manualForm, setManualForm] = useState({ prenom: '', nom: '', age: '' });

  const espaceId = espaceIdAssigne(animateur?.espace);

  const activites = useMemo(
    () => filtrerParEspace(activitesRes.data ?? [], espaceId),
    [activitesRes.data, espaceId],
  );

  // Les présences d'une activité sont datées du jour de l'activité.
  const datePointage = selectedActivity ? (selectedActivity.date || dateCivileParis()) : '';
  const registre     = serveur ?? REGISTRE_VIDE;

  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => { monte.current = false; };
  }, []);

  /** Relit sur le serveur le registre d'une activité (lève une ApiError). */
  const lireRegistre = useCallback(async (activite: ActiviteResume, date: string) => {
    const cible: Registre = { type: 'activite', activiteId: activite.id };
    const pointages = await chargerPointages(api, { date, activiteId: activite.id });
    return construireRegistre(pointages, cible);
  }, []);

  const recharger = useCallback(async (activite: ActiviteResume, date: string) => {
    setChargement(true);
    setErreurChargement(null);
    try {
      const etat = await lireRegistre(activite, date);
      if (monte.current) setServeur(etat);
    } catch (e) {
      if (monte.current) setErreurChargement(messageErreur(e));
    } finally {
      if (monte.current) setChargement(false);
    }
  }, [lireRegistre]);

  const jeunes = useMemo(() => {
    if (!selectedActivity) return [];
    // Jeunes de l'espace de l'activité, plus ceux déjà pointés sur le serveur.
    return (jeunesRes.data ?? []).filter(
      (j) => j.espaceId === selectedActivity.espaceId || registre.cellules[j.id] !== undefined,
    );
  }, [selectedActivity, jeunesRes.data, registre]);

  const manualEntries = useMemo(() => {
    const vus = new Set(registre.manuels.map((m) => m.rowId));
    return [...registre.manuels, ...manuelsLocaux.filter((m) => !vus.has(m.rowId))];
  }, [registre, manuelsLocaux]);

  const nbModifications = Object.keys(saisie.brouillon).length;

  function ouvrirActivite(a: ActiviteResume) {
    setSelectedActivity(a);
    setServeur(null);
    setSaisie(saisieInitiale<BrouillonStatuts>({}));
    setManuelsLocaux([]);
    recharger(a, a.date || dateCivileParis());
  }

  function selectActivity(a: ActiviteResume) {
    ouvrirActivite(a);
  }

  function quitterActivite() {
    if (nbModifications === 0) {
      setSelectedActivity(null);
      return;
    }
    Alert.alert(
      'Modifications non enregistrées',
      `${nbModifications} saisie(s) ne sont pas enregistrées. Quitter quand même ?`,
      [
        { text: 'Rester', style: 'cancel' },
        { text: 'Quitter sans enregistrer', style: 'destructive', onPress: () => setSelectedActivity(null) },
      ],
    );
  }

  /** Bascule un statut dans le brouillon ; revenir à l'état serveur retire l'entrée. */
  function setStatut(rowId: string, statut: StatutPointage) {
    if (saisie.enCours || serveur === null) return;
    setSaisie((prev) => {
      const actuel: Statut = statutAffiche(registre, prev.brouillon, rowId, datePointage);
      const voulu: Statut  = actuel === statut ? null : statut;
      const enregistre: Statut = registre.cellules[rowId]?.[datePointage]?.statut ?? null;
      const suivant = { ...prev.brouillon };
      if (voulu === enregistre) delete suivant[rowId];
      else suivant[rowId] = voulu;
      return modifierBrouillon(prev, suivant);
    });
  }

  function openModal() {
    setManualForm({ prenom: '', nom: '', age: '' });
    setShowModal(true);
  }

  function handleAjouter() {
    if (!manualForm.prenom.trim() || !manualForm.nom.trim()) return;
    const prenom = manualForm.prenom.trim();
    const nom    = manualForm.nom.trim();
    const rowId  = idLigneManuelle(prenom, nom);
    setManuelsLocaux((prev) => (prev.some((m) => m.rowId === rowId) ? prev : [...prev, { rowId, prenom, nom }]));
    setShowModal(false);
  }

  async function handleEnregistrer() {
    if (!selectedActivity || saisie.enCours) return;
    if (serveur === null) {
      Alert.alert('Registre non chargé', "Les présences déjà enregistrées n'ont pas pu être lues. Rechargez avant d'enregistrer.");
      return;
    }
    if (nbModifications === 0) {
      Alert.alert('Aucune modification', "Il n'y a aucune saisie à enregistrer.");
      return;
    }

    const activite       = selectedActivity;
    const date           = datePointage;
    const animateurLogin = animateur?.username ?? 'animateur';
    const jeunesIds      = new Set((jeunesRes.data ?? []).map((j) => j.id));
    const manuelsParId   = new Map(manualEntries.map((m) => [m.rowId, m]));

    const depart = saisie;
    setSaisie(demarrerEnvoi(depart));

    const suivant = await executerEnvoi(depart, async (brouillon) => {
      // 1. État serveur frais : l'écart est calculé contre ce qui est réellement
      //    enregistré (pas de doublon après un envoi resté sans confirmation).
      const avant = await lireRegistre(activite, date);
      const ecart = calculerEcart(avant, brouillon, date);

      const entrees: (EntreeStatutActivite | EntreeArrivee)[] = [];
      for (const { rowId, statut } of ecart.aEnvoyer) {
        const manuel = manuelsParId.get(rowId);
        if (jeunesIds.has(rowId)) {
          entrees.push({ jeuneId: rowId, activiteId: activite.id, espaceId: activite.espaceId, date, statut });
        } else if (manuel && statut === 'present') {
          entrees.push({
            jeuneId:      null,
            prenomManuel: manuel.prenom,
            nomManuel:    manuel.nom,
            espaceId:     activite.espaceId,
            date,
            heureArrivee: heureParis(),
            type:         'activite',
            activiteId:   activite.id,
            manuel:       true,
            animateur:    animateurLogin,
          });
        }
      }

      // 2. Création d'abord, puis suppression par id des lignes remplacées ou
      //    effacées : une coupure entre les deux ne fait perdre aucune saisie.
      await creerPointages(api, entrees);
      for (const id of ecart.aSupprimer) {
        await supprimerPointage(api, id);
      }

      // 3. Relecture : la confirmation décrit ce que le serveur contient.
      let apres: EtatRegistre;
      try {
        apres = await lireRegistre(activite, date);
      } catch {
        throw new ApiError(
          'network',
          "Présences envoyées, mais leur enregistrement n'a pas pu être relu. Appuyez de nouveau sur Enregistrer pour vérifier.",
        );
      }
      if (monte.current) setServeur(apres);
      const reste = brouillonRestant(apres, brouillon, date);
      const nbReste = Object.keys(reste).length;
      if (nbReste > 0) {
        throw new ApiError(
          'invalid_response',
          `${nbReste} saisie(s) n'apparaissent pas sur le serveur après l'envoi. Elles sont conservées : réessayez.`,
        );
      }
      const total = compter(apres, date);
      return {
        brouillonRestant: reste,
        confirmation: `${total.present} présent(s) · ${total.absent} absent(s) · ${total.excuse} excusé(s)`,
      };
    });

    if (!monte.current) return;
    setSaisie(suivant);
    if (suivant.erreur) {
      Alert.alert('⚠️ Présences non enregistrées', `${suivant.erreur}\n\nVotre saisie est conservée.`, [{ text: 'OK' }]);
    } else if (suivant.confirmation) {
      Alert.alert('Présences enregistrées', suivant.confirmation, [{ text: 'OK' }]);
    }
  }

  // ── View 1: Activity list ──────────────────────────────────────────────────

  if (!selectedActivity) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Pointage Activité</Text>
          <Text style={styles.headerSubtitle}>Sélectionnez une activité</Text>
        </View>

        <FlatList
          data={activites}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            activitesRes.loading ? (
              <View style={styles.emptyBox}>
                <ActivityIndicator size="large" color={Colors.purple} />
                <Text style={styles.emptyText}>Chargement des activités…</Text>
              </View>
            ) : activitesRes.data === null ? (
              <View style={styles.emptyBox}>
                <Ionicons name="cloud-offline-outline" size={40} color={Colors.textLight} />
                <Text style={styles.emptyText}>{activitesRes.error ?? 'Activités indisponibles.'}</Text>
                <TouchableOpacity style={styles.addManualBtn} onPress={activitesRes.reload} activeOpacity={0.8}>
                  <Ionicons name="refresh" size={18} color={Colors.purple} />
                  <Text style={styles.addManualBtnText}>Réessayer</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Ionicons name="calendar-outline" size={40} color={Colors.textLight} />
                <Text style={styles.emptyText}>Aucune activité disponible</Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const badge = formatDateBadge(item.date);
            return (
              <TouchableOpacity
                style={styles.actCard}
                onPress={() => selectActivity(item)}
                activeOpacity={0.85}
              >
                {/* Date badge */}
                <View style={styles.dateBadge}>
                  <Text style={styles.dateBadgeDay}>{badge.day}</Text>
                  <Text style={styles.dateBadgeMonth}>{badge.month}</Text>
                </View>

                {/* Info */}
                <View style={styles.actInfo}>
                  <Text style={styles.actTitre} numberOfLines={1}>{item.titre}</Text>
                  <Text style={styles.actMeta} numberOfLines={1}>
                    {item.heureDebut}–{item.heureFin}
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
              </TouchableOpacity>
            );
          }}
        />
      </SafeAreaView>
    );
  }

  // ── View 2: Mark attendance ────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Header with back */}
      <View style={styles.header2}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={quitterActivite}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back" size={18} color={Colors.white} />
          <Text style={styles.backBtnText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.header2Title} numberOfLines={1}>{selectedActivity.titre}</Text>
      </View>

      {/* État du registre : chargement, erreur, saisie en attente, confirmation */}
      {chargement && (
        <View style={styles.etatBanner}>
          <ActivityIndicator size="small" color={Colors.purple} />
          <Text style={styles.etatBannerText}>Lecture des présences enregistrées…</Text>
        </View>
      )}
      {!chargement && (erreurChargement || jeunesRes.error || saisie.erreur) && (
        <View style={[styles.etatBanner, styles.etatBannerErreur]}>
          <Ionicons name="alert-circle" size={16} color={Colors.danger} />
          <Text style={[styles.etatBannerText, { color: Colors.danger }]}>
            {saisie.erreur ?? erreurChargement ?? jeunesRes.error}
          </Text>
          {(erreurChargement || jeunesRes.error) && (
            <TouchableOpacity
              onPress={() => { jeunesRes.reload(); recharger(selectedActivity, datePointage); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="refresh" size={16} color={Colors.danger} />
            </TouchableOpacity>
          )}
        </View>
      )}
      {!chargement && !saisie.erreur && !erreurChargement && nbModifications > 0 && (
        <View style={styles.etatBanner}>
          <Ionicons name="create-outline" size={16} color={Colors.purple} />
          <Text style={styles.etatBannerText}>
            {nbModifications} modification(s) non enregistrée(s)
          </Text>
        </View>
      )}
      {!chargement && saisie.confirmation && nbModifications === 0 && (
        <View style={styles.etatBanner}>
          <Ionicons name="checkmark-circle" size={16} color={Colors.present} />
          <Text style={styles.etatBannerText}>Enregistré sur le serveur — {saisie.confirmation}</Text>
        </View>
      )}

      <FlatList
        data={jeunes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Ionicons name="people-outline" size={40} color={Colors.textLight} />
            <Text style={styles.emptyText}>
              {jeunesRes.loading
                ? 'Chargement des jeunes…'
                : jeunesRes.data === null
                  ? 'Liste des jeunes indisponible'
                  : 'Aucun jeune dans cet espace'}
            </Text>
          </View>
        }
        ListFooterComponent={
          <>
            {/* Manual entries */}
            {manualEntries.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>Ajoutés manuellement</Text>
                </View>
                {manualEntries.map((entry) => {
                  const current: Statut = statutAffiche(registre, saisie.brouillon, entry.rowId, datePointage);
                  return (
                    <View key={entry.rowId} style={[styles.jeuneCard, styles.jeuneCardManual]}>
                      <View style={styles.jeuneTopRow}>
                        <View style={styles.avatar}>
                          <Text style={styles.avatarLetter}>{entry.prenom.charAt(0).toUpperCase()}</Text>
                        </View>
                        <View style={styles.jeuneInfo}>
                          <View style={styles.jeuneNameRow}>
                            <Text style={styles.jeuneName}>
                              {entry.prenom} {entry.nom.toUpperCase()}
                            </Text>
                            <View style={styles.manualBadge}>
                              <Text style={styles.manualBadgeText}>Manuel</Text>
                            </View>
                          </View>
                        </View>
                      </View>
                      <View style={styles.statutRow}>
                        {OPTIONS_STATUT_MANUEL.map((opt) => {
                          const isSelected = current === opt.key;
                          return (
                            <TouchableOpacity
                              key={opt.key}
                              style={[
                                styles.statutBtn,
                                isSelected
                                  ? { backgroundColor: opt.color, borderColor: opt.color }
                                  : styles.statutBtnIdle,
                              ]}
                              onPress={() => setStatut(entry.rowId, opt.key)}
                              activeOpacity={0.8}
                            >
                              <Text style={[styles.statutBtnText, isSelected && styles.statutBtnTextActive]}>
                                {opt.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
                <View style={styles.separator} />
              </>
            )}

            {/* Add manually button */}
            <TouchableOpacity style={styles.addManualBtn} onPress={openModal} activeOpacity={0.8}>
              <Ionicons name="add" size={18} color={Colors.purple} />
              <Text style={styles.addManualBtnText}>Ajouter manuellement</Text>
            </TouchableOpacity>
          </>
        }
        renderItem={({ item }) => {
          const current: Statut = statutAffiche(registre, saisie.brouillon, item.id, datePointage);
          const age = calculerAge(item.dateNaissance);

          return (
            <View style={styles.jeuneCard}>
              {/* Top row */}
              <View style={styles.jeuneTopRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarLetter}>{item.prenom.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.jeuneInfo}>
                  <View style={styles.jeuneNameRow}>
                    <Text style={styles.jeuneName}>
                      {item.prenom} {item.nom.toUpperCase()}
                    </Text>
                  </View>
                  {age !== null && (
                    <Text style={styles.jeuneParticipation}>{age} ans</Text>
                  )}
                </View>
              </View>

              {/* Status buttons */}
              <View style={styles.statutRow}>
                {OPTIONS_STATUT.map((opt) => {
                  const isSelected = current === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[
                        styles.statutBtn,
                        isSelected
                          ? { backgroundColor: opt.color, borderColor: opt.color }
                          : styles.statutBtnIdle,
                      ]}
                      onPress={() => setStatut(item.id, opt.key)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.statutBtnText, isSelected && styles.statutBtnTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        }}
      />

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.enregistrerBtn, (saisie.enCours || chargement) && { opacity: 0.6 }]}
          onPress={handleEnregistrer}
          disabled={saisie.enCours || chargement}
          activeOpacity={0.85}
        >
          <Text style={styles.enregistrerBtnText}>{saisie.enCours ? 'Enregistrement…' : 'Enregistrer'}</Text>
        </TouchableOpacity>
      </View>

      {/* Manual add modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Ajout manuel</Text>
            <Text style={styles.modalSubtitle}>Jeune non inscrit ou passage libre</Text>

            <View style={styles.modalFields}>
              <TextInput
                style={styles.modalInput}
                placeholder="Prénom *"
                placeholderTextColor={Colors.textLight}
                value={manualForm.prenom}
                onChangeText={(v) => setManualForm((f) => ({ ...f, prenom: v }))}
                autoCapitalize="words"
              />
              <TextInput
                style={styles.modalInput}
                placeholder="Nom *"
                placeholderTextColor={Colors.textLight}
                value={manualForm.nom}
                onChangeText={(v) => setManualForm((f) => ({ ...f, nom: v }))}
                autoCapitalize="characters"
              />
              <TextInput
                style={styles.modalInput}
                placeholder="Âge"
                placeholderTextColor={Colors.textLight}
                value={manualForm.age}
                onChangeText={(v) => setManualForm((f) => ({ ...f, age: v }))}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirmBtn,
                  (!manualForm.prenom.trim() || !manualForm.nom.trim()) && styles.modalConfirmBtnDisabled,
                ]}
                onPress={handleAjouter}
                activeOpacity={0.85}
                disabled={!manualForm.prenom.trim() || !manualForm.nom.trim()}
              >
                <Text style={styles.modalConfirmText}>Ajouter</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // Header (View 1)
  header: {
    backgroundColor: Colors.purple,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 4,
  },
  headerTitle:    { color: Colors.white, fontSize: 18, fontWeight: '800' },
  headerSubtitle: { color: Colors.white, fontSize: 13, opacity: 0.8 },

  // Header (View 2)
  header2: {
    backgroundColor: Colors.purple,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 10,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  backBtnText:  { color: Colors.white, fontSize: 13, fontWeight: '600' },
  header2Title: { flex: 1, color: Colors.white, fontSize: 15, fontWeight: '700' },

  // List
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  separator:   { height: 10 },

  // Section header
  sectionHeader: { marginTop: 16, marginBottom: 8 },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // Activity card
  actCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  dateBadge: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: Colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  dateBadgeDay:   { color: Colors.white, fontSize: 20, fontWeight: '800', lineHeight: 22 },
  dateBadgeMonth: { color: Colors.white, fontSize: 10, textTransform: 'uppercase', fontWeight: '600', opacity: 0.85 },
  actInfo:  { flex: 1, gap: 3 },
  actTitre: { fontSize: 14, fontWeight: '700', color: Colors.text },
  actMeta:  { fontSize: 12, color: Colors.textMuted },

  // Jeune card
  jeuneCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  jeuneCardManual: {
    borderWidth: 1,
    borderColor: Colors.purplePale,
  },
  jeuneTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: Colors.white, fontSize: 16, fontWeight: '700' },
  jeuneInfo:    { flex: 1, gap: 2 },
  jeuneNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  jeuneName:    { fontSize: 14, fontWeight: '700', color: Colors.text },
  jeuneParticipation: { fontSize: 11, color: Colors.textMuted },

  priorityBadge: {
    backgroundColor: Colors.purplePale,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  priorityBadgeText: { color: Colors.purple, fontSize: 10, fontWeight: '700' },

  manualBadge: {
    backgroundColor: Colors.purplePale,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  manualBadgeText: { color: Colors.purple, fontSize: 10, fontWeight: '700' },

  // Status buttons
  statutRow: { flexDirection: 'row', gap: 8 },
  statutBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: 'transparent',
  },
  statutBtnIdle:       { borderColor: Colors.border, backgroundColor: 'transparent' },
  statutBtnText:       { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  statutBtnTextActive: { color: Colors.white, fontWeight: '700' },

  // Add manually button
  addManualBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.purple,
    borderRadius: 12,
    paddingVertical: 14,
  },
  addManualBtnText: { color: Colors.purple, fontSize: 14, fontWeight: '700' },

  // Empty
  etatBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.purplePale,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  etatBannerErreur: { backgroundColor: Colors.dangerLight },
  etatBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: Colors.purple },

  emptyBox:  { alignItems: 'center', paddingTop: 48, gap: 12 },
  emptyText: { fontSize: 14, color: Colors.textMuted },

  // Bottom bar
  bottomBar: {
    padding: 12,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 8,
  },
  enregistrerBtn: {
    backgroundColor: Colors.purple,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enregistrerBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  modalTitle:    { fontSize: 18, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  modalSubtitle: { fontSize: 13, color: Colors.textMuted, marginBottom: 20 },
  modalFields:   { gap: 12 },
  modalInput: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  modalCancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: Colors.textMuted },
  modalConfirmBtn: {
    flex: 1,
    backgroundColor: Colors.purple,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalConfirmBtnDisabled: { backgroundColor: Colors.textLight },
  modalConfirmText: { fontSize: 14, fontWeight: '700', color: Colors.white },
});
