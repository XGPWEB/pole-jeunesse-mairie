import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  TextInput,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/hooks/useAuth';
import { useJeunes } from '@/hooks/useJeunes';
import { ApiError, messageErreur } from '@/lib/api';
import { api } from '@/lib/client';
import {
  calculerAge,
  dateCivileParis,
  formaterDateCivile,
  heureParis,
  JourSemaine,
  joursDeLaSemaine,
} from '@/lib/dates';
import { espaceIdAssigne, filtrerParEspace, libelleEspaceAssigne, TOUS_ESPACES } from '@/lib/espaces';
import {
  celluleServeur,
  construireRegistre,
  idLigneManuelle,
  LigneManuelle,
  pointageASupprimer,
  PointageServeur,
  Registre,
} from '@/lib/pointages';
import { demarrerEnvoi, EtatSaisie, executerEnvoi, modifierBrouillon, saisieInitiale } from '@/lib/saisie';
import { chargerPointages, creerPointages, EntreeArrivee, JeuneResume, supprimerPointage } from '@/lib/services';

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Cet écran ne lit et n'écrit que le registre d'accueil libre. */
const REGISTRE_ACCUEIL: Registre = { type: 'accueil' };

const INTERVALLE_SYNC_MS = 10_000;

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function SaisieSeamaine() {
  const { animateur } = useAuth();

  const [weekOffset,    setWeekOffset]    = useState(0);
  const [search,        setSearch]        = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [lastSync,      setLastSync]      = useState<Date | null>(null);
  const [syncErreur,    setSyncErreur]    = useState<string | null>(null);

  // ── État serveur : pointages reçus, par date civile ───────────────────────
  // Seule source des cases « enregistrées » et des ids utilisés pour supprimer.
  const [pointagesParDate, setPointagesParDate] = useState<Record<string, PointageServeur[]>>({});

  // ── État local non enregistré ─────────────────────────────────────────────
  // Lignes ajoutées à la main (pas encore de pointage serveur) et brouillon :
  // identifiants des lignes cochées « présent » aujourd'hui.
  const [lignesAjoutees, setLignesAjoutees] = useState<string[]>([]);
  const [manuelsLocaux,  setManuelsLocaux]  = useState<LigneManuelle[]>([]);
  const [saisie,         setSaisie]         = useState<EtatSaisie<string[]>>(saisieInitiale<string[]>([]));
  const [retraitEnCours, setRetraitEnCours] = useState<string | null>(null);

  const jeunesRes = useJeunes();

  const espaceId    = espaceIdAssigne(animateur?.espace);
  const espaceLabel = libelleEspaceAssigne(animateur?.espace);

  const weekDays = useMemo(() => joursDeLaSemaine(weekOffset), [weekOffset]);
  const todayDay = weekDays.find(d => d.isToday) ?? null;

  // ── Chargement serveur ────────────────────────────────────────────────────

  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => { monte.current = false; };
  }, []);

  /** Recharge les dates données ; rend les pointages reçus, ou lève une ApiError. */
  const chargerDates = useCallback(async (dates: string[]) => {
    const recus = await Promise.all(dates.map(date => chargerPointages(api, { date })));
    const parDate: Record<string, PointageServeur[]> = {};
    dates.forEach((date, i) => { parDate[date] = recus[i]; });
    if (monte.current) {
      setPointagesParDate(prev => ({ ...prev, ...parDate }));
      setLastSync(new Date());
      setSyncErreur(null);
    }
    return parDate;
  }, []);

  /** Synchronisation d'arrière-plan : l'erreur est affichée, l'état est conservé. */
  const synchroniser = useCallback(async (dates: string[]) => {
    try {
      await chargerDates(dates);
    } catch (e) {
      if (monte.current) setSyncErreur(messageErreur(e));
    }
  }, [chargerDates]);

  // Semaine affichée : chargée à l'ouverture et à chaque changement de semaine.
  const datesSemaine = useMemo(
    () => weekDays.filter(d => !d.isFuture).map(d => d.dateStr),
    [weekDays],
  );
  useEffect(() => {
    if (datesSemaine.length > 0) synchroniser(datesSemaine);
  }, [datesSemaine, synchroniser]);

  // Aujourd'hui : rafraîchi périodiquement (pointages faits depuis un autre poste).
  useEffect(() => {
    const interval = setInterval(() => synchroniser([dateCivileParis()]), INTERVALLE_SYNC_MS);
    return () => clearInterval(interval);
  }, [synchroniser]);

  const serveur = useMemo(() => {
    const tous = weekDays.flatMap(d => pointagesParDate[d.dateStr] ?? []);
    return construireRegistre(tous, REGISTRE_ACCUEIL);
  }, [pointagesParDate, weekDays]);

  // ── Lignes affichées ──────────────────────────────────────────────────────

  const jeunes = useMemo(
    () => filtrerParEspace(jeunesRes.data ?? [], espaceId),
    [jeunesRes.data, espaceId],
  );

  // Jeunes inscrits présents dans le registre serveur ou ajoutés localement
  const addedJeuneIds = useMemo(
    () => new Set([...serveur.jeuneIds, ...lignesAjoutees]),
    [serveur, lignesAjoutees],
  );

  const addedRegisteredJeunes = useMemo(() =>
    jeunes.filter(j => addedJeuneIds.has(j.id)),
    [jeunes, addedJeuneIds]
  );

  // Lignes manuelles : même identifiant stable (dérivé du nom) avant et après
  // enregistrement, donc aucune duplication quand le serveur les renvoie.
  const manualEntries = useMemo(() => {
    const vus = new Set(serveur.manuels.map(m => m.rowId));
    return [...serveur.manuels, ...manuelsLocaux.filter(m => !vus.has(m.rowId))];
  }, [serveur, manuelsLocaux]);

  // Suggestions de recherche : inscrits PAS encore ajoutés
  const searchSuggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return jeunes.filter(j =>
      !addedJeuneIds.has(j.id) &&
      (j.prenom.toLowerCase().includes(q) || j.nom.toLowerCase().includes(q))
    );
  }, [jeunes, search, addedJeuneIds]);

  // ── Cell toggle ────────────────────────────────────────────────────────────
  // Seule la présence d'aujourd'hui est saisissable : c'est la seule que
  // « Valider » enregistre. Les autres jours reflètent le serveur, en lecture.

  function toggleCell(rowId: string) {
    setSaisie(prev => modifierBrouillon(
      prev,
      prev.brouillon.includes(rowId)
        ? prev.brouillon.filter(id => id !== rowId)
        : [...prev.brouillon, rowId],
    ));
  }

  // ── Ajouter un jeune inscrit depuis les suggestions ───────────────────────

  function handleAddRegisteredJeune(j: JeuneResume) {
    setLignesAjoutees(prev => (prev.includes(j.id) ? prev : [...prev, j.id]));
    setSearch('');
    setSearchFocused(false);
    Keyboard.dismiss();
  }

  // ── Ajouter un jeune non inscrit depuis la recherche ─────────────────────

  function handleAddFromSearch(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parts  = trimmed.split(/\s+/);
    const prenom = parts.length > 1 ? parts[0] : '';
    const nom    = parts.length > 1 ? parts.slice(1).join(' ').toUpperCase() : parts[0].toUpperCase();
    const rowId  = idLigneManuelle(prenom, nom);
    setManuelsLocaux(prev => (prev.some(m => m.rowId === rowId) ? prev : [...prev, { rowId, prenom, nom }]));
    setSearch('');
    setSearchFocused(false);
    Keyboard.dismiss();
  }

  // ── Validation : sauvegarde uniquement les présences d'aujourd'hui ─────────

  async function handleValider() {
    if (saisie.enCours) return;
    if (!todayDay) {
      Alert.alert('Attention', "La semaine affichée ne contient pas aujourd'hui.\nNaviguez vers la semaine courante.");
      return;
    }
    if (saisie.brouillon.length === 0) {
      Alert.alert('Aucune présence', "Marquez au moins un jeune comme présent aujourd'hui avant de valider.");
      return;
    }

    const date           = todayDay.dateStr;
    const animateurLogin = animateur?.username ?? 'animateur';
    const heureArrivee   = heureParis();
    const jeunesParId    = new Map(jeunes.map(j => [j.id, j]));
    const manuelsParId   = new Map(manualEntries.map(m => [m.rowId, m]));

    const depart = saisie;
    setSaisie(demarrerEnvoi(depart));

    const suivant = await executerEnvoi(depart, async (brouillon) => {
      // 1. État serveur frais : ce qui y figure déjà n'est jamais renvoyé
      //    (pas de doublon si un envoi précédent a abouti sans confirmation).
      const avant = construireRegistre((await chargerDates([date]))[date], REGISTRE_ACCUEIL);

      const payload: EntreeArrivee[] = [];
      for (const rowId of brouillon) {
        if (celluleServeur(avant, rowId, date)) continue;
        const j = jeunesParId.get(rowId);
        const m = manuelsParId.get(rowId);
        if (j) {
          payload.push({
            jeuneId:      j.id,
            // espaceId du jeune ; à défaut (fiche sans espace), celui de l'animateur
            espaceId:     j.espaceId || (espaceId !== TOUS_ESPACES ? espaceId : ''),
            date,
            heureArrivee,
            type:         'accueil-libre',
            activiteId:   null,
            manuel:       false,
            animateur:    animateurLogin,
          });
        } else if (m) {
          payload.push({
            jeuneId:      null,
            prenomManuel: m.prenom,
            nomManuel:    m.nom,
            // Pour les manuels : utiliser l'espace de l'animateur s'il est défini, sinon 'collegiens'
            espaceId:     espaceId !== TOUS_ESPACES ? espaceId : 'collegiens',
            date,
            heureArrivee,
            type:         'accueil-libre',
            activiteId:   null,
            manuel:       true,
            animateur:    animateurLogin,
          });
        }
      }

      // 2. Envoi.
      await creerPointages(api, payload);

      // 3. Relecture : seule la présence relue sur le serveur est confirmée.
      let apres;
      try {
        apres = construireRegistre((await chargerDates([date]))[date], REGISTRE_ACCUEIL);
      } catch {
        throw new ApiError(
          'network',
          "Présences envoyées, mais leur enregistrement n'a pas pu être relu. Appuyez de nouveau sur Valider pour vérifier.",
        );
      }
      const brouillonRestant = brouillon.filter(rowId => !celluleServeur(apres, rowId, date));
      if (brouillonRestant.length > 0) {
        throw new ApiError(
          'invalid_response',
          `${brouillonRestant.length} présence(s) n'apparaissent pas sur le serveur après l'envoi. Elles restent cochées : réessayez.`,
        );
      }
      const n = brouillon.length;
      return {
        brouillonRestant,
        confirmation: `${n} présence${n > 1 ? 's' : ''} enregistrée${n > 1 ? 's' : ''} pour aujourd'hui.`,
      };
    });

    if (!monte.current) return;
    setSaisie(suivant);
    if (suivant.erreur) {
      Alert.alert('⚠️ Présences non enregistrées', `${suivant.erreur}\n\nVotre saisie est conservée.`, [{ text: 'OK' }]);
    } else if (suivant.confirmation) {
      Alert.alert('✅ Validé', suivant.confirmation, [{ text: 'OK' }]);
    }
  }

  // ── Compteur présences aujourd'hui (pour la bottom bar) ───────────────────

  const todayPresenceCount = useMemo(() => {
    const todayStr = todayDay?.dateStr;
    if (!todayStr) return 0;
    let count = 0;
    const allIds = [
      ...addedRegisteredJeunes.map((j) => j.id),
      ...manualEntries.map((e) => e.rowId),
    ];
    for (const id of allIds) {
      const enregistree = celluleServeur(serveur, id, todayStr);
      if (enregistree ? enregistree.statut === 'present' : saisie.brouillon.includes(id)) count++;
    }
    return count;
  }, [serveur, saisie.brouillon, addedRegisteredJeunes, manualEntries, todayDay]);

  // ─────────────────────────────────────────────────────────────────────────────

  const ROW_LEFT_WIDTH = 130;
  const CELL_SIZE      = 44;
  const CELL_MARGIN    = 4;
  const COL_WIDTH      = CELL_SIZE + CELL_MARGIN * 2;

  function renderCell(rowId: string, day: JourSemaine) {
    // Une case enregistrée affiche le statut réel du serveur (présent, absent
    // ou excusé) et n'est pas modifiable ; sinon, brouillon du jour.
    const enregistree = celluleServeur(serveur, rowId, day.dateStr);
    const isSaved     = enregistree !== null;
    const status      = enregistree
      ? enregistree.statut
      : day.isToday && saisie.brouillon.includes(rowId) ? 'present' : null;
    const disabled    = !day.isToday || isSaved || saisie.enCours;

    const cellStyle = [
      styles.cell,
      status === 'present' && styles.cellPresent,
      status === 'absent'  && styles.cellAbsent,
      status === 'excuse'  && styles.cellExcuse,
      isSaved && status === 'present' && styles.cellSaved,
      !day.isToday && !isSaved && styles.cellFuture,
    ];

    return (
      <TouchableOpacity
        key={day.dateStr}
        style={cellStyle}
        onPress={() => !disabled && toggleCell(rowId)}
        activeOpacity={disabled ? 1 : 0.7}
        disabled={disabled}
      >
        {status === 'present' && !isSaved && <Text style={styles.cellSymbol}>✓</Text>}
        {status === 'absent'              && <Text style={styles.cellSymbol}>✗</Text>}
        {status === 'excuse'              && <Text style={styles.cellSymbol}>E</Text>}
        {isSaved && status === 'present' && (
          <View style={styles.cellSavedContent}>
            <Text style={styles.cellSymbol}>✓</Text>
            <Text style={styles.cellSavedDot}>●</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  // ── Retirer un jeune (droit à l'erreur) ──────────────────────────────────

  function retirerLocalement(rowId: string) {
    setLignesAjoutees(prev => prev.filter(id => id !== rowId));
    setManuelsLocaux(prev => prev.filter(m => m.rowId !== rowId));
    setSaisie(prev => modifierBrouillon(prev, prev.brouillon.filter(id => id !== rowId)));
  }

  async function supprimerSurServeur(rowId: string, pointageId: string, date: string) {
    setRetraitEnCours(rowId);
    try {
      // Suppression de CE pointage d'accueil uniquement, par son id serveur :
      // les pointages d'activité du même jour ne sont pas concernés.
      await supprimerPointage(api, pointageId);
      await chargerDates([date]);
      // Retrait local seulement après confirmation du serveur.
      if (monte.current) retirerLocalement(rowId);
    } catch (e) {
      if (monte.current) {
        Alert.alert(
          '⚠️ Retrait impossible',
          `${messageErreur(e)}\n\nLa présence est toujours enregistrée.`,
          [{ text: 'OK' }],
        );
      }
    } finally {
      if (monte.current) setRetraitEnCours(null);
    }
  }

  function handleRetirerJeune(rowId: string, prenom: string, nom: string) {
    if (retraitEnCours || saisie.enCours) return;
    const pointageId = todayDay ? pointageASupprimer(serveur, rowId, todayDay.dateStr) : null;
    if (!todayDay || !pointageId) {
      // Rien d'enregistré aujourd'hui pour cette ligne : simple retrait local.
      retirerLocalement(rowId);
      return;
    }
    Alert.alert(
      'Retirer la présence',
      `Supprimer la présence d'aujourd'hui de ${prenom} ${nom.toUpperCase()} à l'accueil ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => { supprimerSurServeur(rowId, pointageId, todayDay.dateStr); },
        },
      ],
    );
  }

  /** Le bouton de retrait n'apparaît que s'il a un effet sur cette ligne. */
  function peutRetirer(rowId: string): boolean {
    if (todayDay && pointageASupprimer(serveur, rowId, todayDay.dateStr)) return true;
    return lignesAjoutees.includes(rowId) || manuelsLocaux.some(m => m.rowId === rowId);
  }

  function renderRow(
    id: string,
    prenom: string,
    nom: string,
    age: number | string,
    isManual?: boolean,
  ) {
    return (
      <View key={id} style={styles.tableRow}>
        {/* Fixed left info */}
        <View style={[styles.rowLeft, { width: ROW_LEFT_WIDTH }]}>
          <View style={styles.rowAvatar}>
            <Text style={styles.rowAvatarLetter}>{(prenom || nom).charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.rowInfo}>
            <Text style={styles.rowName} numberOfLines={1}>
              {prenom} <Text style={styles.rowNameBold}>{nom.toUpperCase()}</Text>
            </Text>
            <View style={styles.rowMeta}>
              <Text style={styles.rowAge}>{age} ans</Text>
              {isManual && (
                <View style={styles.manualBadge}>
                  <Text style={styles.manualBadgeText}>Manuel</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        {/* Day cells */}
        <View style={styles.rowCells}>
          {weekDays.map((day) => renderCell(id, day))}
        </View>
        {/* Bouton retirer — droit à l'erreur */}
        {retraitEnCours === id ? (
          <View style={styles.removeBtn}>
            <ActivityIndicator size="small" color="#EF4444" />
          </View>
        ) : peutRetirer(id) ? (
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => handleRetirerJeune(id, prenom, nom)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={15} color="#EF4444" />
          </TouchableOpacity>
        ) : (
          <View style={[styles.removeBtn, { width: 27 }]} />
        )}
      </View>
    );
  }

  const erreurAffichee = saisie.erreur ?? syncErreur ?? jeunesRes.error;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerTextGroup}>
            <Text style={styles.headerTitle}>Pointage accueil</Text>
            <Text style={styles.headerSub}>
              Semaine du {formaterDateCivile(weekDays[0].dateStr)} au {formaterDateCivile(weekDays[5].dateStr)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => { jeunesRes.reload(); synchroniser(datesSemaine); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ alignItems: 'center' }}
            >
              <Ionicons name="refresh" size={16} color="rgba(255,255,255,0.7)" />
              {lastSync && (
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 8, marginTop: 1 }}>
                  {lastSync.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              )}
            </TouchableOpacity>
            <View style={styles.espaceBadge}>
              <Text style={styles.espaceBadgeText}>{espaceLabel}</Text>
            </View>
          </View>
        </View>

        {/* Week navigation */}
        <View style={styles.weekNav}>
          <TouchableOpacity
            style={styles.weekNavBtn}
            onPress={() => setWeekOffset((o) => o - 1)}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={14} color={Colors.white} />
            <Text style={styles.weekNavText}>Semaine précédente</Text>
          </TouchableOpacity>
          {weekOffset !== 0 && (
            <TouchableOpacity
              style={styles.weekNavBtn}
              onPress={() => setWeekOffset(0)}
              activeOpacity={0.7}
            >
              <Text style={styles.weekNavTextCenter}>Aujourd'hui</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.weekNavBtn}
            onPress={() => setWeekOffset((o) => o + 1)}
            activeOpacity={0.7}
          >
            <Text style={styles.weekNavText}>Semaine suivante</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.white} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Search + floating suggestions ──────────────────────────────────── */}
      <View style={styles.searchContainer}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={Colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher ou ajouter un jeune…"
            placeholderTextColor={Colors.textLight}
            value={search}
            onChangeText={setSearch}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            autoCorrect={false}
            autoCapitalize="words"
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => { setSearch(''); setSearchFocused(false); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={16} color={Colors.textLight} />
            </TouchableOpacity>
          )}
        </View>

        {/* Floating suggestions panel */}
        {searchFocused && search.trim().length > 0 && (
          <View style={styles.suggestionsPanel}>

            {/* Jeunes inscrits non encore ajoutés */}
            {searchSuggestions.length > 0 && (
              <>
                <View style={styles.suggestionSection}>
                  <Text style={styles.suggestionSectionLabel}>Inscrits — tap pour ajouter</Text>
                </View>
                {searchSuggestions.slice(0, 5).map(j => (
                  <TouchableOpacity
                    key={j.id}
                    style={styles.suggestionRow}
                    onPress={() => handleAddRegisteredJeune(j)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.suggestionAvatar}>
                      <Text style={styles.suggestionAvatarLetter}>{j.prenom.charAt(0)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestionName}>
                        {j.prenom} <Text style={{ fontWeight: '800' }}>{j.nom.toUpperCase()}</Text>
                      </Text>
                      <Text style={styles.suggestionMeta}>{calculerAge(j.dateNaissance) ?? '—'} ans · inscrit</Text>
                    </View>
                    <View style={styles.suggestionAddBtn}>
                      <Ionicons name="add" size={14} color={Colors.purple} />
                      <Text style={styles.suggestionAddBtnText}>Ajouter</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Option : non inscrit */}
            <TouchableOpacity
              style={styles.suggestionAddRow}
              onPress={() => handleAddFromSearch(search)}
              activeOpacity={0.8}
            >
              <View style={styles.suggestionAddIcon}>
                <Ionicons name="person-add" size={15} color={Colors.purple} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestionAddText}>
                  Ajouter <Text style={{ fontWeight: '800' }}>"{search.trim()}"</Text> manuellement
                </Text>
                <Text style={styles.suggestionAddMeta}>Jeune non inscrit</Text>
              </View>
              <Ionicons name="add-circle" size={22} color={Colors.purple} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── Erreur de synchronisation / d'enregistrement ───────────────────── */}
      {erreurAffichee && (
        <View style={styles.erreurBanner}>
          <Ionicons name="alert-circle" size={16} color={Colors.danger} />
          <Text style={styles.erreurBannerText}>{erreurAffichee}</Text>
        </View>
      )}

      {/* ── Grid ───────────────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.scrollOuter}
        contentContainerStyle={styles.scrollOuterContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Sticky column header row */}
        <View style={styles.tableHeaderRow}>
          {/* Top-left blank cell */}
          <View style={[styles.headerLeftCell, { width: ROW_LEFT_WIDTH }]}>
            <Text style={styles.headerLeftText}>Jeune</Text>
          </View>

          {/* Day headers */}
          {weekDays.map((day) => (
            <View
              key={day.dateStr}
              style={[
                styles.dayHeaderCell,
                { width: COL_WIDTH },
                day.isToday && styles.dayHeaderCellToday,
              ]}
            >
              <Text style={[styles.dayShort, day.isFuture && styles.textMuted]}>
                {day.shortLabel}
              </Text>
              <View style={[styles.dayNumWrap, day.isToday && styles.dayNumWrapToday]}>
                <Text style={[styles.dayNum, day.isToday && styles.dayNumToday, day.isFuture && styles.textMuted]}>
                  {day.jourDuMois}
                </Text>
              </View>
              {day.isToday && <Text style={styles.dayAuj}>Auj.</Text>}
            </View>
          ))}
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Jeune rows — seulement ceux ajoutés manuellement au fur et à mesure */}
        {addedRegisteredJeunes.length === 0 && manualEntries.length === 0 ? (
          <View style={styles.emptyBox}>
            {jeunesRes.loading ? (
              <>
                <ActivityIndicator size="large" color={Colors.purple} />
                <Text style={styles.emptyTitle}>Chargement des inscrits…</Text>
              </>
            ) : jeunesRes.data === null ? (
              <>
                <Ionicons name="wifi-outline" size={36} color={Colors.textLight} />
                <Text style={styles.emptyTitle}>Liste des inscrits indisponible</Text>
                <Text style={styles.emptyText}>
                  {jeunesRes.error ?? 'Le serveur n\'a pas répondu.'} Appuyez sur ↻ pour réessayer.
                </Text>
                <TouchableOpacity onPress={jeunesRes.reload} style={{ marginTop: 12, backgroundColor: Colors.purple, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 }}>
                  <Text style={{ color: Colors.white, fontWeight: '700', fontSize: 13 }}>↻ Réessayer</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Ionicons name="search" size={36} color={Colors.textLight} />
                <Text style={styles.emptyTitle}>Pointage vide</Text>
                <Text style={styles.emptyText}>
                  Tapez le nom d'un jeune dans la barre de recherche pour l'ajouter au fur et à mesure de son arrivée
                </Text>
              </>
            )}
          </View>
        ) : (
          addedRegisteredJeunes.map((j) =>
            renderRow(j.id, j.prenom, j.nom, calculerAge(j.dateNaissance) ?? '—', false),
          )
        )}

        {/* Manual entries section */}
        {manualEntries.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>Ajoutés manuellement</Text>
            </View>
            {manualEntries.map((e) =>
              renderRow(e.rowId, e.prenom, e.nom, '—', true),
            )}
          </>
        )}


        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomLeft}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.present} />
          <Text style={styles.bottomCount}>
            {todayPresenceCount} présence{todayPresenceCount > 1 ? 's' : ''} aujourd'hui
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.validerBtn, saisie.enCours && { opacity: 0.6 }]}
          onPress={handleValider}
          disabled={saisie.enCours}
          activeOpacity={0.85}
        >
          <Text style={styles.validerBtnText}>{saisie.enCours ? 'Envoi…' : 'Valider'}</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CELL_SIZE      = 44;
const CELL_MARGIN    = 4;
const COL_WIDTH      = CELL_SIZE + CELL_MARGIN * 2;
const ROW_LEFT_WIDTH = 130;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    backgroundColor: Colors.purple,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 10,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerTextGroup: { flex: 1, gap: 2 },
  headerTitle:     { color: Colors.white, fontSize: 18, fontWeight: '800' },
  headerSub:       { color: Colors.white, fontSize: 12, opacity: 0.85 },
  espaceBadge: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 10,
    alignSelf: 'flex-start',
  },
  espaceBadgeText: { color: Colors.white, fontSize: 12, fontWeight: '700' },

  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  weekNavText:       { color: 'rgba(255,255,255,0.80)', fontSize: 12, fontWeight: '600' },
  weekNavTextCenter: { color: 'rgba(255,255,255,0.95)', fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },

  // ── Search ─────────────────────────────────────────────────────────────────
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  searchIcon:  { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },

  // ── Bandeau d'erreur ────────────────────────────────────────────────────────
  erreurBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.dangerLight,
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  erreurBannerText: { flex: 1, fontSize: 12, color: Colors.danger, fontWeight: '600' },

  // ── Grid outer ──────────────────────────────────────────────────────────────
  scrollOuter:        { flex: 1 },
  scrollOuterContent: { paddingHorizontal: 16 },

  divider: { height: 1, backgroundColor: Colors.border, marginBottom: 4 },

  // ── Table header row ────────────────────────────────────────────────────────
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingBottom: 6,
    paddingTop: 4,
  },
  headerLeftCell: {
    justifyContent: 'flex-end',
    paddingBottom: 4,
  },
  headerLeftText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dayHeaderCell: {
    width: COL_WIDTH,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 2,
  },
  dayHeaderCellToday: {
    // subtle purple tint behind today column header
  },
  dayShort:     { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase' },
  dayNumWrap:   { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  dayNumWrapToday: { backgroundColor: Colors.purple },
  dayNum:       { fontSize: 14, fontWeight: '700', color: Colors.text },
  dayNumToday:  { color: Colors.white },
  dayAuj:       { fontSize: 9, fontWeight: '800', color: Colors.purple, textTransform: 'uppercase' },
  textMuted:    { color: Colors.textLight },

  // ── Table rows ──────────────────────────────────────────────────────────────
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 6,
  },
  rowAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowAvatarLetter: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  rowInfo:   { flex: 1, gap: 2 },
  rowName:   { fontSize: 11, fontWeight: '400', color: Colors.text },
  rowNameBold: { fontWeight: '700' },
  rowMeta:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowAge:    { fontSize: 10, color: Colors.textMuted },

  manualBadge: {
    backgroundColor: Colors.purplePale,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  manualBadgeText: { color: Colors.purple, fontSize: 9, fontWeight: '700' },

  rowCells: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  removeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginLeft: 4,
  },

  // ── Cells ──────────────────────────────────────────────────────────────────
  cell: {
    width:         CELL_SIZE,
    height:        CELL_SIZE,
    borderRadius:  8,
    borderWidth:   1.5,
    borderColor:   Colors.border,
    backgroundColor: Colors.white,
    alignItems:    'center',
    justifyContent: 'center',
    marginHorizontal: CELL_MARGIN,
  },
  cellPresent: {
    backgroundColor: Colors.present,
    borderColor:     Colors.present,
  },
  cellAbsent: {
    backgroundColor: Colors.absent,
    borderColor:     Colors.absent,
  },
  cellExcuse: {
    backgroundColor: Colors.excuse,
    borderColor:     Colors.excuse,
  },
  cellFuture: {
    backgroundColor: Colors.background,
    borderColor:     Colors.border,
    borderStyle:     'dashed',
    opacity:         0.5,
  },
  cellSaved: {
    backgroundColor: '#1a7a3c', // vert foncé = synchronisé
    borderColor:     '#1a7a3c',
  },
  cellSavedContent: {
    alignItems:  'center',
    justifyContent: 'center',
  },
  cellSavedDot: {
    color:    'rgba(255,255,255,0.6)',
    fontSize: 5,
    marginTop: -2,
  },
  cellSymbol: { color: Colors.white, fontSize: 16, fontWeight: '800' },

  // ── Section header ─────────────────────────────────────────────────────────
  sectionHeader: { marginTop: 16, marginBottom: 4 },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // ── Search container (for z-index stacking) ───────────────────────────────
  searchContainer: {
    zIndex: 50,
    elevation: 50,
    marginBottom: 8,
  },

  // ── Floating suggestions panel ─────────────────────────────────────────────
  suggestionsPanel: {
    position: 'absolute',
    top: 54,
    left: 16,
    right: 16,
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 20,
    zIndex: 100,
    overflow: 'hidden',
  },
  suggestionSection: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  suggestionSectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.background,
  },
  suggestionAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.purple + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionAvatarLetter: { fontSize: 14, fontWeight: '700', color: Colors.purple },
  suggestionName: { fontSize: 13, color: Colors.text },
  suggestionMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  suggestionAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.purple + '15',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  suggestionAddBtnText: { fontSize: 12, fontWeight: '700', color: Colors.purple },

  // Add manually row (bottom of suggestions)
  suggestionAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: Colors.purple + '08',
  },
  suggestionAddIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.purple + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionAddText: { fontSize: 13, color: Colors.purple },
  suggestionAddMeta: { fontSize: 10, color: Colors.purple, opacity: 0.65, marginTop: 1 },


  // ── Empty state ────────────────────────────────────────────────────────────
  emptyBox:   { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: Colors.textMuted },
  emptyText:  { fontSize: 13, color: Colors.textLight, textAlign: 'center', lineHeight: 19 },

  // ── Bottom bar ─────────────────────────────────────────────────────────────
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 8,
  },
  bottomLeft:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bottomCount:  { fontSize: 13, fontWeight: '600', color: Colors.text },
  validerBtn:   { backgroundColor: Colors.purple, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18 },
  validerBtnText: { color: Colors.white, fontSize: 13, fontWeight: '700' },

});
