import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/hooks/useAuth';
import { useActivites } from '@/hooks/useActivites';
import { useJeunes } from '@/hooks/useJeunes';
import { messageErreur } from '@/lib/api';
import { api } from '@/lib/client';
import { calculerAge, dateCivileParis, formaterDateCivile, heureParis } from '@/lib/dates';
import { espaceIdAssigne, filtrerParEspace, libelleEspaceAssigne, TOUS_ESPACES } from '@/lib/espaces';
import { ActiviteResume, creerPointages, EntreeArrivee, JeuneResume } from '@/lib/services';

// ─── Types données ─────────────────────────────────────────────────────────────

type JeuneAPI = JeuneResume;
type ActiviteAPI = ActiviteResume;

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'libre' | 'activite';

interface PresenceEntry {
  id: string;
  nom: string;
  prenom: string;
  age: string;
  secteur: string;
  manuel: boolean;
  heureArrivee: string;
  heureSortie: string;
}

/** Heure murale à Paris (fuseau de la structure), pas celle de l'appareil. */
function nowHHMM(): string {
  return heureParis();
}

// Masque de saisie HH:MM — filtre les caractères invalides
function maskTime(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcAge(dateNaissance: string): string {
  const age = calculerAge(dateNaissance);
  return age === null ? '—' : String(age);
}

function todayFR(): string {
  return formaterDateCivile(dateCivileParis(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatDate(dateCivile: string): string {
  if (!dateCivile) return '';
  return formaterDateCivile(dateCivile, { day: 'numeric', month: 'long' });
}

// ─── Composant activité row ────────────────────────────────────────────────────

function ActiviteRow({
  activite,
  selected,
  onSelect,
}: {
  activite: ActiviteAPI;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.activiteRow, selected && styles.activiteRowSelected]}
      onPress={onSelect}
      activeOpacity={0.75}
    >
      <View style={[styles.activiteRadio, selected && styles.activiteRadioSelected]}>
        {selected && <View style={styles.activiteRadioDot} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.activiteTitre, selected && styles.activiteTitreSelected]} numberOfLines={1}>
          {activite.titre}
        </Text>
        <Text style={styles.activiteMeta}>
          {formatDate(activite.date)} · {activite.heureDebut}–{activite.heureFin}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen principal ─────────────────────────────────────────────────────────

export default function Pointage() {
  const { animateur } = useAuth();

  const espaceId    = espaceIdAssigne(animateur?.espace);
  const espaceLabel = libelleEspaceAssigne(animateur?.espace);
  const today       = todayFR();

  // ── Données chargées depuis le serveur (aucun jeu de données de repli) ──
  const jeunesRes    = useJeunes();
  const activitesRes = useActivites();
  const JEUNES_DATA: JeuneAPI[]       = useMemo(() => jeunesRes.data ?? [], [jeunesRes.data]);
  const ACTIVITES_DATA: ActiviteAPI[] = useMemo(() => activitesRes.data ?? [], [activitesRes.data]);
  const dataLoading = jeunesRes.loading || activitesRes.loading;
  const dataError   = jeunesRes.error ?? activitesRes.error;

  const loadData = useCallback(() => {
    jeunesRes.reload();
    activitesRes.reload();
  }, [jeunesRes.reload, activitesRes.reload]);

  // ── Mode ──
  const [mode, setMode] = useState<Mode>('libre');

  // ── Activité sélectionnée (mode activité) ──
  const [activiteId, setActiviteId] = useState<string | null>(null);
  const [showActivitePicker, setShowActivitePicker] = useState(false);

  // ── Présences ──
  const [presences, setPresences] = useState<PresenceEntry[]>([]);

  // ── Picker liste de jeunes ──
  const [showJeunePicker, setShowJeunePicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  // ── Modal ajout manuel ──
  const [showModal, setShowModal] = useState(false);
  const [manualForm, setManualForm] = useState({ prenom: '', nom: '' });

  // Jeunes filtrés par espace
  const jeunesEspace = useMemo(() =>
    filtrerParEspace(JEUNES_DATA, espaceId),
    [JEUNES_DATA, espaceId]
  );

  // Activités filtrées par espace
  const activitesEspace = useMemo(() =>
    filtrerParEspace(ACTIVITES_DATA, espaceId),
    [ACTIVITES_DATA, espaceId]
  );

  const activiteSelectionnee = activitesEspace.find(a => a.id === activiteId) ?? null;

  // IDs déjà présents
  const idsPresents = useMemo(() => new Set(presences.map(p => p.id)), [presences]);

  // Jeunes filtrés dans le picker
  const jeunesPickerFiltered = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (q.length === 0) return jeunesEspace;
    return jeunesEspace.filter(
      j => j.nom.toLowerCase().includes(q) || j.prenom.toLowerCase().includes(q)
    );
  }, [pickerSearch, jeunesEspace]);

  // Changer de mode — réinitialise la fiche
  function switchMode(m: Mode) {
    if (m === mode) return;
    if (presences.length > 0) {
      Alert.alert(
        'Changer de mode',
        'La fiche en cours sera effacée. Continuer ?',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Confirmer', style: 'destructive', onPress: () => {
            setPresences([]);
            setActiviteId(null);
            setMode(m);
          }},
        ]
      );
    } else {
      setActiviteId(null);
      setMode(m);
    }
  }

  // Ajouter depuis autocomplete
  function ajouterJeune(j: JeuneAPI) {
    if (idsPresents.has(j.id)) return;
    setPresences(prev => [...prev, {
      id:           j.id,
      nom:          j.nom,
      prenom:       j.prenom,
      age:          calcAge(j.dateNaissance),
      secteur:      j.secteur,
      manuel:       false,
      heureArrivee: nowHHMM(),
      heureSortie:  '',
    }]);
  }

  // Retirer de la fiche
  function retirerPresence(id: string) {
    setPresences(prev => prev.filter(p => p.id !== id));
  }

  // Mettre à jour l'heure d'une entrée
  function updateHeure(id: string, field: 'heureArrivee' | 'heureSortie', value: string) {
    setPresences(prev => prev.map(p =>
      p.id === id ? { ...p, [field]: maskTime(value) } : p,
    ));
  }

  // Ajout manuel
  function handleAjouter() {
    if (!manualForm.prenom.trim() || !manualForm.nom.trim()) return;
    setPresences(prev => [...prev, {
      id:           `manual-${Date.now()}`,
      nom:          manualForm.nom.trim().toUpperCase(),
      prenom:       manualForm.prenom.trim(),
      age:          '',
      secteur:      '',
      manuel:       true,
      heureArrivee: nowHHMM(),
      heureSortie:  '',
    }]);
    setManualForm({ prenom: '', nom: '' });
    setShowModal(false);
  }

  const [sending, setSending] = useState(false);

  // Valider la fiche et envoyer au tableau admin
  async function handleValider() {
    if (mode === 'activite' && !activiteId) {
      Alert.alert('Activité requise', 'Veuillez sélectionner une activité avant de valider.');
      return;
    }
    if (presences.length === 0) {
      Alert.alert('Fiche vide', 'Ajoutez au moins un jeune avant de valider.');
      return;
    }

    // Date civile de la structure (Europe/Paris), jamais la date UTC.
    const todayISO       = dateCivileParis();
    const animateurLogin = animateur?.username ?? 'animateur';
    const activiteChoisie = mode === 'activite' ? activiteId : null;

    const payload: EntreeArrivee[] = presences.map(p => {
      const jeuneEspaceId = !p.manuel
        ? (JEUNES_DATA.find(j => j.id === p.id)?.espaceId || (espaceId !== TOUS_ESPACES ? espaceId : ''))
        : (espaceId !== TOUS_ESPACES ? espaceId : 'collegiens');

      const entry: EntreeArrivee = {
        jeuneId:      p.manuel ? null : p.id,
        espaceId:     jeuneEspaceId,
        date:         todayISO,
        heureArrivee: p.heureArrivee || nowHHMM(),
        type:         mode === 'libre' ? 'accueil-libre' : 'activite',
        activiteId:   activiteChoisie,
        manuel:       p.manuel,
        animateur:    animateurLogin,
      };
      if (p.heureSortie) entry.heureSortie = p.heureSortie;
      if (p.manuel) {
        entry.prenomManuel = p.prenom;
        entry.nomManuel    = p.nom;
      }
      return entry;
    });

    setSending(true);
    try {
      // La fiche n'est vidée et le succès affiché qu'après réponse positive du
      // serveur ; toute erreur laisse la saisie intacte.
      await creerPointages(api, payload);

      const manuelCount  = presences.filter(p => p.manuel).length;
      const activiteInfo = activiteSelectionnee ? `\nActivité : ${activiteSelectionnee.titre}` : '';
      Alert.alert(
        '✅ Fiche enregistrée',
        `${presences.length} présence(s) pour aujourd'hui${activiteInfo}${manuelCount > 0 ? `\ndont ${manuelCount} ajout(s) manuel(s)` : ''}`,
        [{ text: 'OK' }],
      );
      setPresences([]);
      setActiviteId(null);
    } catch (e) {
      Alert.alert(
        '⚠️ Fiche non enregistrée',
        `${messageErreur(e)}\n\nVotre saisie est conservée.`,
        [{ text: 'OK' }],
      );
    } finally {
      setSending(false);
    }
  }

  // ── Résumé par secteur ──
  const statsSecteur = useMemo(() => {
    const counts: Record<string, number> = {};
    presences.forEach(p => {
      const s = p.secteur || 'Non renseigné';
      counts[s] = (counts[s] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [presences]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerTextGroup}>
            <Text style={styles.headerTitle}>Pointage du jour</Text>
            <Text style={styles.headerDate}>{today}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {dataLoading ? (
              <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
            ) : (
              <TouchableOpacity onPress={loadData} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="refresh" size={16} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            )}
            <View style={styles.espaceBadge}>
              <Text style={styles.espaceBadgeText}>{espaceLabel}</Text>
            </View>
          </View>
        </View>

        {/* Toggle mode */}
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'libre' && styles.modeBtnActive]}
            onPress={() => switchMode('libre')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="people-outline"
              size={15}
              color={mode === 'libre' ? Colors.white : 'rgba(255,255,255,0.65)'}
            />
            <Text style={[styles.modeBtnText, mode === 'libre' && styles.modeBtnTextActive]}>
              Accueil libre
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'activite' && styles.modeBtnActive]}
            onPress={() => switchMode('activite')}
            activeOpacity={0.8}
          >
            <Ionicons
              name="calendar-outline"
              size={15}
              color={mode === 'activite' ? Colors.white : 'rgba(255,255,255,0.65)'}
            />
            <Text style={[styles.modeBtnText, mode === 'activite' && styles.modeBtnTextActive]}>
              Par activité
            </Text>
          </TouchableOpacity>
        </View>

        {/* Compteur */}
        <View style={styles.headerCounter}>
          <Ionicons name="people" size={13} color={Colors.white} style={{ opacity: 0.85 }} />
          <Text style={styles.headerCounterText}>
            {presences.length} présent{presences.length > 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Données serveur indisponibles ──────────────────────────────── */}
        {dataError && !dataLoading && (
          <View style={styles.librebanner}>
            <Ionicons name="alert-circle" size={16} color={Colors.danger} />
            <Text style={[styles.librebannerText, { color: Colors.danger }]}>
              {dataError} Appuyez sur ↻ pour réessayer.
            </Text>
          </View>
        )}

        {/* ── Sélecteur d'activité (mode activité) ───────────────────────── */}
        {mode === 'activite' && (
          <View style={styles.activiteSection}>
            <Text style={styles.sectionLabel}>Activité concernée</Text>
            <TouchableOpacity
              style={[styles.activitePicker, activiteSelectionnee && styles.activitePickerSelected]}
              onPress={() => setShowActivitePicker(true)}
              activeOpacity={0.8}
            >
              {activiteSelectionnee ? (
                <View style={{ flex: 1 }}>
                  <Text style={styles.activitePickerValue} numberOfLines={1}>
                    {activiteSelectionnee.titre}
                  </Text>
                  <Text style={styles.activitePickerMeta}>
                    {formatDate(activiteSelectionnee.date)} · {activiteSelectionnee.heureDebut}–{activiteSelectionnee.heureFin}
                  </Text>
                </View>
              ) : (
                <Text style={styles.activitePickerPlaceholder}>Sélectionner une activité…</Text>
              )}
              <Ionicons
                name="chevron-down"
                size={16}
                color={activiteSelectionnee ? Colors.purple : Colors.textLight}
              />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Mode libre — info ───────────────────────────────────────────── */}
        {mode === 'libre' && (
          <View style={styles.librebanner}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.purple} />
            <Text style={styles.librebannerText}>
              Accueil libre — passage sans activité programmée
            </Text>
          </View>
        )}

        {/* ── Sélection rapide ─────────────────────────────────────────────── */}
        <View style={styles.searchSection}>
          <Text style={styles.sectionLabel}>
            Jeunes inscrits — {jeunesEspace.length} dans cet espace
          </Text>
          <TouchableOpacity
            style={styles.selectListBtn}
            onPress={() => { setPickerSearch(''); setShowJeunePicker(true); }}
            activeOpacity={0.8}
          >
            <View style={styles.selectListBtnLeft}>
              <View style={styles.selectListIcon}>
                <Ionicons name="people" size={18} color={Colors.purple} />
              </View>
              <View>
                <Text style={styles.selectListBtnText}>Sélectionner un jeune</Text>
                <Text style={styles.selectListBtnSub}>
                  {idsPresents.size > 0
                    ? `${idsPresents.size} déjà pointé${idsPresents.size > 1 ? 's' : ''} · ${jeunesEspace.length - idsPresents.size} restant${jeunesEspace.length - idsPresents.size > 1 ? 's' : ''}`
                    : 'Appuyez pour choisir dans la liste'
                  }
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.purple} />
          </TouchableOpacity>
        </View>

        {/* ── Fiche présences ─────────────────────────────────────────────── */}
        <View style={styles.ficheSection}>
          <View style={styles.ficheSectionHeader}>
            <Text style={styles.sectionLabel}>Présents aujourd'hui</Text>
            {presences.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{presences.length}</Text>
              </View>
            )}
          </View>

          {presences.length === 0 ? (
            <View style={styles.emptyFiche}>
              <Ionicons name="clipboard-outline" size={36} color={Colors.textLight} />
              <Text style={styles.emptyFicheText}>La fiche est vide</Text>
              <Text style={styles.emptyFicheHint}>
                Recherchez par nom de famille ou ajoutez manuellement
              </Text>
            </View>
          ) : (
            <>
              {presences.map((entry, index) => (
                <View
                  key={entry.id}
                  style={[styles.presenceRow, index > 0 && { marginTop: 8 }]}
                >
                  {/* Avatar + Nom */}
                  <View style={[
                    styles.presenceAvatar,
                    entry.manuel && styles.presenceAvatarManuel,
                  ]}>
                    <Text style={styles.presenceAvatarLetter}>{entry.prenom.charAt(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.presenceName}>
                        {entry.prenom}{' '}
                        <Text style={{ fontWeight: '800' }}>{entry.nom}</Text>
                      </Text>
                      {entry.manuel && (
                        <View style={styles.manuelBadge}>
                          <Text style={styles.manuelBadgeText}>Manuel</Text>
                        </View>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                      {entry.age ? <Text style={styles.presenceMeta}>{entry.age} ans</Text> : null}
                      {entry.secteur ? (
                        <Text style={styles.presenceMetaSecteur}>
                          <Ionicons name="location-outline" size={10} color={Colors.textMuted} />{' '}{entry.secteur}
                        </Text>
                      ) : null}
                    </View>
                    {/* Heures arrivée / départ */}
                    <View style={styles.heuresRow}>
                      <View style={styles.heureField}>
                        <Text style={styles.heureLabel}>↓ Arrivée</Text>
                        <TextInput
                          style={styles.heureInput}
                          value={entry.heureArrivee}
                          onChangeText={v => updateHeure(entry.id, 'heureArrivee', v)}
                          placeholder="HH:MM"
                          placeholderTextColor={Colors.textLight}
                          keyboardType="numbers-and-punctuation"
                          maxLength={5}
                          returnKeyType="done"
                        />
                      </View>
                      <View style={styles.heureField}>
                        <Text style={styles.heureLabel}>↑ Départ</Text>
                        {entry.heureSortie ? (
                          <View style={styles.departPointed}>
                            <Text style={styles.departPointedTime}>{entry.heureSortie}</Text>
                            <TouchableOpacity
                              onPress={() => setPresences(prev => prev.map(p =>
                                p.id === entry.id ? { ...p, heureSortie: '' } : p
                              ))}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Ionicons name="close-circle" size={14} color={Colors.textMuted} />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={styles.departBtn}
                            onPress={() => setPresences(prev => prev.map(p =>
                              p.id === entry.id ? { ...p, heureSortie: nowHHMM() } : p
                            ))}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.departBtnText}>🕐 Pointer</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() => retirerPresence(entry.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={16} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              ))}

              {/* Stats par secteur */}
              {statsSecteur.length > 0 && (
                <View style={styles.statsSection}>
                  <Text style={styles.statsSectionLabel}>Répartition par quartier</Text>
                  <View style={styles.statsGrid}>
                    {statsSecteur.map(([secteur, count]) => (
                      <View key={secteur} style={styles.statChip}>
                        <Text style={styles.statChipCount}>{count}</Text>
                        <Text style={styles.statChipLabel} numberOfLines={1}>{secteur}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Ajout manuel ────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.addManualBtn}
          onPress={() => setShowModal(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="person-add-outline" size={17} color={Colors.purple} />
          <Text style={styles.addManualBtnText}>Ajouter manuellement (jeune non inscrit)</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <View style={styles.bottomBar}>
        <View>
          <Text style={styles.bottomCount}>{presences.length} présent(s)</Text>
          {mode === 'activite' && activiteSelectionnee && (
            <Text style={styles.bottomActivite} numberOfLines={1}>
              {activiteSelectionnee.titre}
            </Text>
          )}
          {mode === 'libre' && (
            <Text style={styles.bottomMode}>Accueil libre</Text>
          )}
        </View>
        <TouchableOpacity
          style={[
            styles.validerBtn,
            (presences.length === 0 || (mode === 'activite' && !activiteId) || sending) && styles.validerBtnDisabled,
          ]}
          onPress={handleValider}
          disabled={presences.length === 0 || (mode === 'activite' && !activiteId) || sending}
          activeOpacity={0.85}
        >
          {sending
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <Ionicons name="checkmark" size={16} color={Colors.white} />
          }
          <Text style={styles.validerBtnText}>{sending ? 'Envoi…' : 'Valider'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Modal sélection activité ─────────────────────────────────────────── */}
      <Modal
        visible={showActivitePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowActivitePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.activiteSheet}>
            <View style={styles.activiteSheetHandle} />
            <Text style={styles.activiteSheetTitle}>Choisir une activité</Text>
            <Text style={styles.activiteSheetSub}>{espaceLabel}</Text>
            {activitesEspace.length === 0 ? (
              <Text style={styles.activiteSheetEmpty}>Aucune activité pour cet espace</Text>
            ) : (
              <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                {activitesEspace.map(a => (
                  <ActiviteRow
                    key={a.id}
                    activite={a}
                    selected={activiteId === a.id}
                    onSelect={() => {
                      setActiviteId(a.id);
                      setShowActivitePicker(false);
                    }}
                  />
                ))}
              </ScrollView>
            )}
            <TouchableOpacity
              style={styles.activiteSheetCancel}
              onPress={() => setShowActivitePicker(false)}
            >
              <Text style={styles.activiteSheetCancelText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Modal liste de jeunes ────────────────────────────────────────────── */}
      <Modal
        visible={showJeunePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowJeunePicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.activiteSheetHandle} />

            {/* Header picker */}
            <View style={styles.pickerHeader}>
              <View>
                <Text style={styles.pickerTitle}>Choisir un jeune</Text>
                <Text style={styles.pickerSub}>{espaceLabel} · {idsPresents.size}/{jeunesEspace.length} pointé{idsPresents.size > 1 ? 's' : ''}</Text>
              </View>
              <TouchableOpacity
                style={styles.pickerCloseBtn}
                onPress={() => setShowJeunePicker(false)}
              >
                <Text style={styles.pickerCloseBtnText}>Fermer</Text>
              </TouchableOpacity>
            </View>

            {/* Search in picker */}
            <View style={styles.pickerSearchWrap}>
              <Ionicons name="search" size={15} color={Colors.textMuted} />
              <TextInput
                style={styles.pickerSearchInput}
                placeholder="Rechercher par nom ou prénom…"
                placeholderTextColor={Colors.textLight}
                value={pickerSearch}
                onChangeText={setPickerSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {pickerSearch.length > 0 && (
                <TouchableOpacity onPress={() => setPickerSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={15} color={Colors.textLight} />
                </TouchableOpacity>
              )}
            </View>

            {/* List */}
            {jeunesPickerFiltered.length === 0 ? (
              <View style={styles.pickerEmpty}>
                <Text style={styles.pickerEmptyText}>Aucun jeune trouvé</Text>
              </View>
            ) : (
              <FlatList
                data={jeunesPickerFiltered}
                keyExtractor={j => j.id}
                style={{ maxHeight: 380 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                renderItem={({ item: j }) => {
                  const alreadyAdded = idsPresents.has(j.id);
                  return (
                    <TouchableOpacity
                      style={[styles.pickerRow, alreadyAdded && styles.pickerRowDone]}
                      onPress={() => {
                        if (!alreadyAdded) {
                          ajouterJeune(j);
                        }
                      }}
                      activeOpacity={alreadyAdded ? 1 : 0.7}
                    >
                      <View style={[styles.pickerAvatar, alreadyAdded && styles.pickerAvatarDone]}>
                        <Text style={[styles.pickerAvatarLetter, alreadyAdded && styles.pickerAvatarLetterDone]}>
                          {j.prenom.charAt(0)}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pickerName, alreadyAdded && styles.pickerNameDone]}>
                          {j.prenom}{' '}
                          <Text style={{ fontWeight: '800' }}>{j.nom.toUpperCase()}</Text>
                        </Text>
                        <Text style={styles.pickerMeta}>{calcAge(j.dateNaissance)} ans · {j.secteur}</Text>
                      </View>
                      {alreadyAdded ? (
                        <View style={styles.pickerDoneBadge}>
                          <Ionicons name="checkmark" size={14} color={Colors.purple} />
                          <Text style={styles.pickerDoneText}>Pointé</Text>
                        </View>
                      ) : (
                        <View style={styles.pickerAddBtn}>
                          <Ionicons name="add" size={16} color={Colors.purple} />
                          <Text style={styles.pickerAddText}>Présent</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            )}

            {/* Footer */}
            <TouchableOpacity
              style={styles.pickerValiderBtn}
              onPress={() => setShowJeunePicker(false)}
            >
              <Text style={styles.pickerValiderText}>
                Valider ({idsPresents.size} présent{idsPresents.size > 1 ? 's' : ''})
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Modal ajout manuel ──────────────────────────────────────────────── */}
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
            <View style={styles.activiteSheetHandle} />
            <Text style={styles.modalTitle}>Ajout manuel</Text>
            <Text style={styles.modalSubtitle}>Jeune non inscrit ou passage libre</Text>

            <View style={styles.modalFields}>
              <TextInput
                style={styles.modalInput}
                placeholder="Prénom *"
                placeholderTextColor={Colors.textLight}
                value={manualForm.prenom}
                onChangeText={v => setManualForm(f => ({ ...f, prenom: v }))}
                autoCapitalize="words"
                returnKeyType="next"
              />
              <TextInput
                style={styles.modalInput}
                placeholder="Nom de famille *"
                placeholderTextColor={Colors.textLight}
                value={manualForm.nom}
                onChangeText={v => setManualForm(f => ({ ...f, nom: v }))}
                autoCapitalize="characters"
                returnKeyType="done"
                onSubmitEditing={handleAjouter}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowModal(false);
                  setManualForm({ prenom: '', nom: '' });
                }}
              >
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirmBtn,
                  (!manualForm.prenom.trim() || !manualForm.nom.trim()) && styles.modalConfirmBtnDisabled,
                ]}
                onPress={handleAjouter}
                disabled={!manualForm.prenom.trim() || !manualForm.nom.trim()}
              >
                <Text style={styles.modalConfirmText}>Ajouter présent</Text>
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

  // Header
  header: {
    backgroundColor: Colors.purple,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 10,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerTextGroup: { flex: 1, gap: 2 },
  headerTitle:     { color: Colors.white, fontSize: 18, fontWeight: '800' },
  headerDate:      { color: Colors.white, fontSize: 13, opacity: 0.85, textTransform: 'capitalize' },
  espaceBadge: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 10,
    alignSelf: 'flex-start',
  },
  espaceBadgeText: { color: Colors.white, fontSize: 12, fontWeight: '700' },

  // Mode toggle
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    paddingVertical: 8,
  },
  modeBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  modeBtnText:       { color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: '600' },
  modeBtnTextActive: { color: Colors.white, fontWeight: '700' },

  // Counter
  headerCounter: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start',
  },
  headerCounterText: { color: Colors.white, fontSize: 12, fontWeight: '600', opacity: 0.9 },

  scrollContent: { paddingBottom: 28 },

  sectionLabel: {
    fontSize: 11, fontWeight: '800', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
  },

  // Activité section
  activiteSection: { paddingHorizontal: 16, paddingTop: 16 },
  activitePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 1.5, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  activitePickerSelected: { borderColor: Colors.purple },
  activitePickerValue:       { fontSize: 14, fontWeight: '600', color: Colors.text },
  activitePickerMeta:        { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  activitePickerPlaceholder: { fontSize: 14, color: Colors.textLight },

  // Libre banner
  librebanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 16,
    backgroundColor: Colors.purple + '10',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.purple + '30',
  },
  librebannerText: { flex: 1, fontSize: 12, color: Colors.purple, fontWeight: '500' },

  // Search
  searchSection: { paddingHorizontal: 16, paddingTop: 16 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 11,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },
  searchIcon:  { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },

  // Suggestions
  suggestionsBox: {
    backgroundColor: Colors.white, borderRadius: 12, marginTop: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.10, shadowRadius: 8, elevation: 6,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.background,
  },
  suggestionAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.purple + '20', alignItems: 'center', justifyContent: 'center',
  },
  suggestionAvatarLetter: { color: Colors.purple, fontSize: 15, fontWeight: '700' },
  suggestionName: { fontSize: 14, color: Colors.text },
  suggestionMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  suggestionAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.purple + '15', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  suggestionAddText: { color: Colors.purple, fontSize: 12, fontWeight: '700' },
  suggestionEmpty:      { paddingHorizontal: 14, paddingVertical: 14 },
  suggestionEmptyText:  { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },

  // Fiche présences
  ficheSection: { paddingHorizontal: 16, paddingTop: 20 },
  ficheSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  countBadge: {
    backgroundColor: Colors.purple, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2, minWidth: 22, alignItems: 'center',
  },
  countBadgeText: { color: Colors.white, fontSize: 11, fontWeight: '800' },

  emptyFiche: {
    alignItems: 'center', paddingVertical: 32, gap: 8,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.border,
  },
  emptyFicheText: { fontSize: 14, fontWeight: '600', color: Colors.textMuted },
  emptyFicheHint: { fontSize: 12, color: Colors.textLight, textAlign: 'center', paddingHorizontal: 20 },

  presenceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12, padding: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
    borderWidth: 1, borderColor: Colors.border,
  },
  presenceAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center',
  },
  presenceAvatarManuel: { backgroundColor: Colors.purple + '20' },
  presenceAvatarLetter: { fontSize: 16, fontWeight: '700', color: Colors.text },
  presenceName:  { fontSize: 14, color: Colors.text },
  presenceMeta:  { fontSize: 11, color: Colors.textMuted },
  presenceMetaSecteur: { fontSize: 11, color: Colors.textMuted },
  manuelBadge:   { backgroundColor: Colors.purple + '18', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  manuelBadgeText: { color: Colors.purple, fontSize: 10, fontWeight: '700' },
  removeBtn:     { padding: 4 },

  // Heures arrivée / départ
  heuresRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  heureField: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heureLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, minWidth: 42 },
  heureInput: {
    borderWidth: 1,
    borderColor: Colors.purple + '50',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.purple,
    backgroundColor: Colors.purple + '08',
    minWidth: 52,
    textAlign: 'center',
  },
  heureInputDepart: {
    borderColor: Colors.textMuted + '50',
    color: Colors.textMuted,
    backgroundColor: Colors.background,
  },
  departBtn: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.textMuted + '60',
    borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: Colors.background,
  },
  departBtnText: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },
  departPointed: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.textMuted + '50',
    borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: Colors.background,
  },
  departPointedTime: { fontSize: 13, fontWeight: '700', color: Colors.textMuted },

  // Stats secteur
  statsSection: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: Colors.border },
  statsSectionLabel: {
    fontSize: 10, fontWeight: '800', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 10,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statChip: {
    backgroundColor: Colors.white, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    alignItems: 'center', borderWidth: 1, borderColor: Colors.border, minWidth: 90,
  },
  statChipCount: { fontSize: 18, fontWeight: '800', color: Colors.purple },
  statChipLabel: { fontSize: 10, color: Colors.textMuted, marginTop: 2, textAlign: 'center' },

  // Add manual btn
  addManualBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 16,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.purple,
    borderRadius: 12, paddingVertical: 14,
  },
  addManualBtnText: { color: Colors.purple, fontSize: 13, fontWeight: '700' },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 8,
  },
  bottomCount:    { fontSize: 14, fontWeight: '700', color: Colors.text },
  bottomActivite: { fontSize: 11, color: Colors.purple, marginTop: 2, maxWidth: 180 },
  bottomMode:     { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  validerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.purple, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18,
  },
  validerBtnDisabled: { backgroundColor: Colors.textLight },
  validerBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },

  // Modal overlay
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },

  // Activité picker sheet
  activiteSheet: {
    backgroundColor: Colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  activiteSheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 16,
  },
  activiteSheetTitle: { fontSize: 17, fontWeight: '800', color: Colors.text, marginBottom: 2 },
  activiteSheetSub:   { fontSize: 12, color: Colors.textMuted, marginBottom: 14 },
  activiteSheetEmpty: { color: Colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  activiteSheetCancel: {
    marginTop: 12, borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  activiteSheetCancelText: { fontSize: 14, fontWeight: '600', color: Colors.textMuted },

  activiteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Colors.background,
  },
  activiteRowSelected: { backgroundColor: Colors.purple + '08', borderRadius: 10, paddingHorizontal: 8, marginHorizontal: -8 },
  activiteRadio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  activiteRadioSelected: { borderColor: Colors.purple },
  activiteRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.purple },
  activiteTitre:         { fontSize: 14, color: Colors.text, fontWeight: '500' },
  activiteTitreSelected: { fontWeight: '700', color: Colors.purple },
  activiteMeta:          { fontSize: 11, color: Colors.textMuted, marginTop: 2 },

  // Manual modal sheet
  modalSheet: {
    backgroundColor: Colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  modalTitle:    { fontSize: 18, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  modalSubtitle: { fontSize: 13, color: Colors.textMuted, marginBottom: 20 },
  modalFields:   { gap: 12 },
  modalInput: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    color: Colors.text, backgroundColor: Colors.background,
  },
  modalPickerValue:       { fontSize: 14, color: Colors.text },
  modalPickerPlaceholder: { fontSize: 14, color: Colors.textLight },
  modalActions:    { flexDirection: 'row', gap: 10, marginTop: 24 },
  modalCancelBtn:  { flex: 1, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: Colors.textMuted },
  modalConfirmBtn: { flex: 1, backgroundColor: Colors.purple, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  modalConfirmBtnDisabled: { backgroundColor: Colors.textLight },
  modalConfirmText: { fontSize: 14, fontWeight: '700', color: Colors.white },

  // Select list button (replaces autocomplete)
  selectListBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 2, borderColor: Colors.purple + '40',
    shadowColor: Colors.purple, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10, shadowRadius: 6, elevation: 3,
  },
  selectListBtnLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  selectListIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: Colors.purple + '15', alignItems: 'center', justifyContent: 'center',
  },
  selectListBtnText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  selectListBtnSub:  { fontSize: 11, color: Colors.textMuted, marginTop: 2 },

  // Jeune picker sheet
  pickerSheet: {
    backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '85%',
  },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginBottom: 14,
  },
  pickerTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  pickerSub:   { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  pickerCloseBtn: {
    backgroundColor: Colors.background, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  pickerCloseBtnText: { fontSize: 13, fontWeight: '700', color: Colors.textMuted },

  pickerSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: Colors.background, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  pickerSearchInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },

  pickerEmpty: { alignItems: 'center', paddingVertical: 32 },
  pickerEmptyText: { fontSize: 14, color: Colors.textMuted },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: Colors.background,
  },
  pickerRowDone: { opacity: 0.55 },

  pickerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.purple + '20', alignItems: 'center', justifyContent: 'center',
  },
  pickerAvatarDone: { backgroundColor: Colors.border },
  pickerAvatarLetter:     { fontSize: 16, fontWeight: '700', color: Colors.purple },
  pickerAvatarLetterDone: { color: Colors.textMuted },

  pickerName:     { fontSize: 14, color: Colors.text },
  pickerNameDone: { color: Colors.textMuted },
  pickerMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },

  pickerAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.purple + '15', borderRadius: 8,
    paddingHorizontal: 9, paddingVertical: 6,
  },
  pickerAddText: { color: Colors.purple, fontSize: 12, fontWeight: '700' },

  pickerDoneBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.purple + '10', borderRadius: 8,
    paddingHorizontal: 9, paddingVertical: 6,
  },
  pickerDoneText: { color: Colors.purple, fontSize: 12, fontWeight: '600' },

  pickerValiderBtn: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: Colors.purple, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  pickerValiderText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
