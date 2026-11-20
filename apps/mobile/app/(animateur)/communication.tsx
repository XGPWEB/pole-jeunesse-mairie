import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useActualites } from '@/hooks/useActualites';
import { useAuth } from '@/hooks/useAuth';
import { messageErreur } from '@/lib/api';
import { api } from '@/lib/client';
import { formaterDateCivile } from '@/lib/dates';
import { envoyerMessageAdmin, publierActualite } from '@/lib/services';
import { EspaceId } from '@/types';

const ESPACE_OPTIONS: { id: EspaceId | 'tous'; label: string; color: string }[] = [
  { id: 'tous', label: 'Tous les espaces', color: Colors.navy },
  { id: 'collegiens', label: 'Collégiens', color: Colors.collegiens },
  { id: 'lyceens', label: 'Lycéens', color: Colors.lyceens },
  { id: 'pij', label: 'PIJ', color: Colors.pij },
  { id: 'clas', label: 'CLAS', color: Colors.clas },
];

const CATEGORIE_OPTIONS = [
  { id: 'annonce', label: 'Annonce', icon: 'megaphone', color: Colors.navy },
  { id: 'evenement', label: 'Événement', icon: 'star', color: Colors.blue },
  { id: 'sortie', label: 'Sortie', icon: 'bus', color: Colors.lyceens },
  { id: 'atelier', label: 'Atelier', icon: 'color-palette', color: Colors.clas },
];

type TabType = 'notif' | 'actu';

export default function Communication() {
  const { animateur } = useAuth();
  const actualitesRes = useActualites();
  const actualites = actualitesRes.data ?? [];
  const [tab, setTab] = useState<TabType>('notif');

  // Le serveur réserve la publication d'actualités au rôle admin.
  const peutPublier = animateur?.role === 'admin';

  // Formulaire message à l'administration (POST /api/messages-admin)
  const [notifTitre, setNotifTitre] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifEnvoi, setNotifEnvoi] = useState(false);
  const [notifErreur, setNotifErreur] = useState<string | null>(null);
  const [notifConfirmation, setNotifConfirmation] = useState<string | null>(null);

  // Formulaire actualité (POST /api/actualites)
  const [actuTitre, setActuTitre] = useState('');
  const [actuContenu, setActuContenu] = useState('');
  const [actuEspace, setActuEspace] = useState<EspaceId | 'tous'>('tous');
  const [actuCategorie, setActuCategorie] = useState('annonce');
  const [actuEpingle, setActuEpingle] = useState(false);
  const [actuEnvoi, setActuEnvoi] = useState(false);
  const [actuErreur, setActuErreur] = useState<string | null>(null);
  const [actuConfirmation, setActuConfirmation] = useState<string | null>(null);

  async function sendNotif() {
    if (notifEnvoi) return;
    if (!notifMessage.trim()) {
      Alert.alert('Champs manquants', 'Le message est obligatoire.');
      return;
    }
    setNotifEnvoi(true);
    setNotifErreur(null);
    setNotifConfirmation(null);
    try {
      await envoyerMessageAdmin(api, { objet: notifTitre, message: notifMessage });
      // Champs vidés uniquement après confirmation du serveur.
      setNotifTitre('');
      setNotifMessage('');
      setNotifConfirmation("Message transmis à l'administration.");
    } catch (e) {
      // Échec : la saisie est conservée et l'erreur reste affichée.
      setNotifErreur(messageErreur(e));
    } finally {
      setNotifEnvoi(false);
    }
  }

  async function publishActu() {
    if (actuEnvoi || !peutPublier) return;
    if (!actuTitre.trim() || !actuContenu.trim()) {
      Alert.alert('Champs manquants', 'Titre et contenu sont obligatoires.');
      return;
    }
    setActuEnvoi(true);
    setActuErreur(null);
    setActuConfirmation(null);
    try {
      const publiee = await publierActualite(api, {
        titre: actuTitre.trim(),
        contenu: actuContenu.trim(),
        categorie: actuCategorie,
        espaceId: actuEspace === 'tous' ? null : actuEspace,
        epingle: actuEpingle,
        auteur: `${animateur?.prenom ?? ''} ${animateur?.nom ?? ''}`.trim() || (animateur?.username ?? ''),
      });
      setActuTitre('');
      setActuContenu('');
      setActuEpingle(false);
      setActuConfirmation(`« ${publiee.titre} » est publiée.`);
      actualitesRes.reload();
    } catch (e) {
      setActuErreur(messageErreur(e));
    } finally {
      setActuEnvoi(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Onglets */}
      <View style={styles.tabs}>
        {([
          { key: 'notif', label: "Message à l'admin", icon: 'chatbubbles' },
          { key: 'actu', label: 'Actualités', icon: 'newspaper' },
        ] as { key: TabType; label: string; icon: string }[]).map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Ionicons
              name={t.icon as any}
              size={16}
              color={tab === t.key ? Colors.navy : Colors.textMuted}
            />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>

        {/* ─── NOTIFICATIONS ─── */}
        {tab === 'notif' && (
          <View>
            <View style={styles.infoBox}>
              <Ionicons name="information-circle" size={18} color={Colors.blue} />
              <Text style={styles.infoText}>
                L'envoi de notifications push aux familles n'est pas disponible dans l'application.
                Ce formulaire transmet un message à l'administration du Pôle Jeunesse.
              </Text>
            </View>

            <Text style={styles.fieldLabel}>Objet</Text>
            <TextInput
              style={styles.input}
              placeholder="ex: Atelier annulé ce soir"
              placeholderTextColor={Colors.textLight}
              value={notifTitre}
              onChangeText={setNotifTitre}
              maxLength={80}
            />
            <Text style={styles.charCount}>{notifTitre.length}/80</Text>

            <Text style={styles.fieldLabel}>Message *</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Rédigez votre message…"
              placeholderTextColor={Colors.textLight}
              multiline
              numberOfLines={4}
              value={notifMessage}
              onChangeText={setNotifMessage}
              maxLength={300}
            />
            <Text style={styles.charCount}>{notifMessage.length}/300</Text>

            {notifErreur && (
              <View style={[styles.infoBox, { backgroundColor: Colors.dangerLight }]}>
                <Ionicons name="alert-circle" size={18} color={Colors.danger} />
                <Text style={[styles.infoText, { color: Colors.danger }]}>
                  {notifErreur} Votre message n'a pas été envoyé ; il est conservé ci-dessus.
                </Text>
              </View>
            )}
            {notifConfirmation && (
              <View style={[styles.infoBox, { backgroundColor: Colors.successLight }]}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                <Text style={[styles.infoText, { color: Colors.success }]}>{notifConfirmation}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.sendBtn, notifEnvoi && { opacity: 0.6 }]}
              onPress={sendNotif}
              disabled={notifEnvoi}
              activeOpacity={0.85}
            >
              {notifEnvoi
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Ionicons name="send" size={18} color={Colors.white} />}
              <Text style={styles.sendBtnText}>{notifEnvoi ? 'Envoi…' : 'Envoyer le message'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ─── ACTUALITÉS ─── */}
        {tab === 'actu' && (
          <View>
            {!peutPublier && (
              <View style={styles.infoBox}>
                <Ionicons name="information-circle" size={18} color={Colors.blue} />
                <Text style={styles.infoText}>
                  La publication d'actualités est réservée aux administrateurs. Vous pouvez
                  consulter le fil ci-dessous.
                </Text>
              </View>
            )}

            {peutPublier && (
            <View>
            {/* Catégorie */}
            <Text style={styles.fieldLabel}>Catégorie</Text>
            <View style={styles.optionsRow}>
              {CATEGORIE_OPTIONS.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.optionPill,
                    actuCategorie === c.id && { backgroundColor: c.color, borderColor: c.color },
                  ]}
                  onPress={() => setActuCategorie(c.id)}
                >
                  <Ionicons
                    name={c.icon as any}
                    size={13}
                    color={actuCategorie === c.id ? Colors.white : c.color}
                  />
                  <Text style={[
                    styles.optionPillText,
                    actuCategorie === c.id && { color: Colors.white },
                  ]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Espace */}
            <Text style={styles.fieldLabel}>Espace concerné</Text>
            <View style={styles.optionsRow}>
              {ESPACE_OPTIONS.map((e) => (
                <TouchableOpacity
                  key={e.id}
                  style={[
                    styles.optionPill,
                    actuEspace === e.id && { backgroundColor: e.color, borderColor: e.color },
                  ]}
                  onPress={() => setActuEspace(e.id)}
                >
                  <Text style={[
                    styles.optionPillText,
                    actuEspace === e.id && { color: Colors.white },
                  ]}>
                    {e.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Épingler */}
            <View style={styles.switchRow}>
              <View style={styles.switchInfo}>
                <Text style={styles.switchLabel}>Épingler en tête de fil</Text>
                <Text style={styles.switchDesc}>L'actualité apparaîtra dans "À la une"</Text>
              </View>
              <Switch
                value={actuEpingle}
                onValueChange={setActuEpingle}
                trackColor={{ true: Colors.purple, false: Colors.border }}
                thumbColor={Colors.white}
              />
            </View>

            <Text style={styles.fieldLabel}>Titre *</Text>
            <TextInput
              style={styles.input}
              placeholder="ex: Résultats tournoi football"
              placeholderTextColor={Colors.textLight}
              value={actuTitre}
              onChangeText={setActuTitre}
              maxLength={120}
            />

            <Text style={styles.fieldLabel}>Contenu *</Text>
            <TextInput
              style={[styles.input, styles.inputLarge]}
              placeholder="Rédigez votre actualité en détail…"
              placeholderTextColor={Colors.textLight}
              multiline
              numberOfLines={6}
              value={actuContenu}
              onChangeText={setActuContenu}
            />

            {actuErreur && (
              <View style={[styles.infoBox, { backgroundColor: Colors.dangerLight }]}>
                <Ionicons name="alert-circle" size={18} color={Colors.danger} />
                <Text style={[styles.infoText, { color: Colors.danger }]}>
                  {actuErreur} L'actualité n'a pas été publiée ; votre saisie est conservée.
                </Text>
              </View>
            )}
            {actuConfirmation && (
              <View style={[styles.infoBox, { backgroundColor: Colors.successLight }]}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                <Text style={[styles.infoText, { color: Colors.success }]}>{actuConfirmation}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.sendBtn, actuEnvoi && { opacity: 0.6 }]}
              onPress={publishActu}
              disabled={actuEnvoi}
              activeOpacity={0.85}
            >
              {actuEnvoi
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Ionicons name="checkmark-circle" size={18} color={Colors.white} />}
              <Text style={styles.sendBtnText}>{actuEnvoi ? 'Publication…' : "Publier l'actualité"}</Text>
            </TouchableOpacity>
            </View>
            )}

            {/* Dernières actualités */}
            <View style={styles.historiqueSection}>
              <Text style={styles.historiqueTitre}>Fil d'actualités récent</Text>
              {actualitesRes.loading && (
                <Text style={styles.historiqueMeta}>Chargement…</Text>
              )}
              {!actualitesRes.loading && actualitesRes.data === null && (
                <TouchableOpacity onPress={actualitesRes.reload}>
                  <Text style={[styles.historiqueMeta, { color: Colors.danger }]}>
                    {actualitesRes.error ?? 'Actualités indisponibles.'} Appuyer pour réessayer.
                  </Text>
                </TouchableOpacity>
              )}
              {!actualitesRes.loading && actualitesRes.data !== null && actualites.length === 0 && (
                <Text style={styles.historiqueMeta}>Aucune actualité publiée.</Text>
              )}
              {actualites.slice(0, 4).map((a) => (
                <View key={a.id} style={styles.historiqueItem}>
                  <View style={[styles.historiqueIcon, { backgroundColor: Colors.blueLight }]}>
                    <Ionicons name="newspaper-outline" size={14} color={Colors.blue} />
                  </View>
                  <View style={styles.historiqueInfo}>
                    <Text style={styles.historiqueTitreItem} numberOfLines={1}>{a.titre}</Text>
                    <Text style={styles.historiqueMeta}>
                      {a.auteur}{a.date ? ` · ${formaterDateCivile(a.date)}` : ''}
                    </Text>
                  </View>
                  {a.epingle && (
                    <Ionicons name="pin" size={14} color={Colors.navy} />
                  )}
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },

  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: Colors.purple },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  tabTextActive: { color: Colors.purple },

  infoBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: Colors.blueLight,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.navy, lineHeight: 18 },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  switchInfo: { flex: 1 },
  switchLabel: { fontSize: 14, fontWeight: '700', color: Colors.text },
  switchDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  fieldLabel: { fontSize: 13, fontWeight: '700', color: Colors.text, marginBottom: 8, marginTop: 4 },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  optionPill: {
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
  optionPillText: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },

  input: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.text,
    marginBottom: 4,
  },
  inputMultiline: { height: 100, textAlignVertical: 'top', paddingTop: 11 },
  inputLarge: { height: 140, textAlignVertical: 'top', paddingTop: 11 },
  charCount: { fontSize: 11, color: Colors.textLight, textAlign: 'right', marginBottom: 12 },

  preview: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 14,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  previewUrgent: { borderColor: Colors.danger + '60', backgroundColor: Colors.dangerLight },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  previewLabel: { fontSize: 11, color: Colors.textMuted, flex: 1 },
  urgentBadge: { backgroundColor: Colors.danger, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  urgentBadgeText: { color: Colors.white, fontSize: 9, fontWeight: '800' },
  previewApp: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  previewTitre: { fontSize: 14, fontWeight: '800', color: Colors.text },
  previewMessage: { fontSize: 13, color: Colors.textMuted },

  sendBtn: {
    backgroundColor: Colors.purple,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 8,
  },
  sendBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },

  historiqueSection: { marginTop: 28 },
  historiqueTitre: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  historiqueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.white,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  historiqueIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historiqueInfo: { flex: 1 },
  historiqueTitreItem: { fontSize: 13, fontWeight: '700', color: Colors.text },
  historiqueMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
});
