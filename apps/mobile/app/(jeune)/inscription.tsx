import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useActivitesPubliques, useInscriptionEnLigne } from '@/hooks/useContenuPublic';
import IndisponibleNotice from '@/components/IndisponibleNotice';
import { useEspaces } from '@/hooks/useEspaces';
import { EspaceId, Activite } from '@/types';

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export default function Inscription() {
  const espaces = useEspaces();
  const activitesTout = useActivitesPubliques().data ?? [];
  const enLigne = useInscriptionEnLigne();

  const [etape, setEtape] = useState<1 | 2 | 3>(1);
  const [espaceChoisi, setEspaceChoisi] = useState<EspaceId | null>(null);
  const [activiteChoisie, setActiviteChoisie] = useState<Activite | null>(null);
  const [form, setForm] = useState({
    prenom: '',
    nom: '',
    age: '',
    telephone: '',
    email: '',
    etablissement: '',
  });

  const activitesDisponibles = espaceChoisi
    ? activitesTout.filter((a) => a.espaceId === espaceChoisi && a.statut === 'ouvert')
    : [];

  function handleSubmit() {
    if (!form.prenom || !form.nom || !form.telephone) {
      Alert.alert('Champs manquants', 'Veuillez renseigner prénom, nom et téléphone.');
      return;
    }
    // Aucun service ne reçoit les demandes : rien n'est transmis, rien n'est
    // annoncé comme transmis, et la saisie n'est pas effacée.
    Alert.alert(
      'Demande non envoyée',
      "L'inscription en ligne n'est pas disponible. Votre demande n'a pas été transmise : contactez le Pôle Jeunesse au 01 48 72 73 74.",
      [{ text: 'OK' }]
    );
  }

  // Annoncé AVANT toute saisie : le formulaire n'est pas proposé tant que
  // l'envoi d'une demande n'existe pas côté serveur.
  if (!enLigne.disponible) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <IndisponibleNotice
          titre="Inscription en ligne non disponible"
          message="Les demandes d'inscription ne peuvent pas encore être envoyées depuis l'application. Pour inscrire un jeune à une activité, contactez directement le Pôle Jeunesse."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Étapes */}
      <View style={styles.stepsRow}>
        {[1, 2, 3].map((s) => (
          <React.Fragment key={s}>
            <View style={[styles.step, etape >= s && styles.stepActive]}>
              <Text style={[styles.stepNum, etape >= s && styles.stepNumActive]}>{s}</Text>
            </View>
            {s < 3 && <View style={[styles.stepLine, etape > s && styles.stepLineActive]} />}
          </React.Fragment>
        ))}
      </View>
      <View style={styles.stepsLabels}>
        {['Espace', 'Activité', 'Mes infos'].map((l, i) => (
          <Text key={l} style={[styles.stepLabel, etape >= i + 1 && styles.stepLabelActive]}>{l}</Text>
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* ÉTAPE 1 : Choix de l'espace */}
        {etape === 1 && (
          <View>
            <Text style={styles.etapeTitre}>Choisissez un espace</Text>
            <Text style={styles.etapeSousTitre}>Sélectionnez l'espace correspondant à votre tranche d'âge.</Text>
            {espaces.map((e) => (
              <TouchableOpacity
                key={e.id}
                style={[
                  styles.optionCard,
                  espaceChoisi === e.id && { borderColor: e.couleur, backgroundColor: e.couleur + '08' },
                ]}
                onPress={() => setEspaceChoisi(e.id as EspaceId)}
                activeOpacity={0.8}
              >
                <View style={[styles.optionIcon, { backgroundColor: e.couleur + '20' }]}>
                  <Ionicons name={e.icon as any} size={24} color={e.couleur} />
                </View>
                <View style={styles.optionInfo}>
                  <Text style={styles.optionNom}>{e.nom}</Text>
                  <Text style={styles.optionAge}>{e.trancheAge}</Text>
                </View>
                <View style={[styles.radio, espaceChoisi === e.id && { backgroundColor: e.couleur, borderColor: e.couleur }]}>
                  {espaceChoisi === e.id && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.nextBtn, !espaceChoisi && styles.nextBtnDisabled]}
              disabled={!espaceChoisi}
              onPress={() => setEtape(2)}
            >
              <Text style={styles.nextBtnText}>Suivant</Text>
              <Ionicons name="arrow-forward" size={18} color={Colors.white} />
            </TouchableOpacity>
          </View>
        )}

        {/* ÉTAPE 2 : Choix de l'activité */}
        {etape === 2 && (
          <View>
            <Text style={styles.etapeTitre}>Choisissez une activité</Text>
            <Text style={styles.etapeSousTitre}>
              Activités disponibles pour l'espace {espaceChoisi ? ESPACE_LABELS[espaceChoisi] : ''}.
            </Text>

            {activitesDisponibles.length === 0 && (
              <View style={styles.emptyBox}>
                <Ionicons name="calendar-outline" size={36} color={Colors.textLight} />
                <Text style={styles.emptyText}>Aucune activité disponible pour cet espace.</Text>
              </View>
            )}

            {activitesDisponibles.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[
                  styles.actCard,
                  activiteChoisie?.id === a.id && {
                    borderColor: ESPACE_COLORS[a.espaceId],
                    backgroundColor: ESPACE_COLORS[a.espaceId] + '08',
                  },
                ]}
                onPress={() => setActiviteChoisie(a)}
                activeOpacity={0.8}
              >
                <View style={styles.actDate}>
                  <Text style={[styles.actDateNum, { color: ESPACE_COLORS[a.espaceId] }]}>
                    {new Date(a.date).getDate()}
                  </Text>
                  <Text style={styles.actDateMois}>
                    {new Date(a.date).toLocaleDateString('fr-FR', { month: 'short' })}
                  </Text>
                </View>
                <View style={styles.actInfo}>
                  <Text style={styles.actTitre}>{a.titre}</Text>
                  <Text style={styles.actMeta}>{a.heureDebut} – {a.heureFin} · {a.lieu.split(' — ')[0]}</Text>
                  <Text style={styles.actPlaces}>
                    {a.placesDisponibles} place{a.placesDisponibles > 1 ? 's' : ''} disponible{a.placesDisponibles > 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={[styles.radio, activiteChoisie?.id === a.id && { backgroundColor: ESPACE_COLORS[a.espaceId], borderColor: ESPACE_COLORS[a.espaceId] }]}>
                  {activiteChoisie?.id === a.id && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            ))}

            <View style={styles.navBtns}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setEtape(1)}>
                <Ionicons name="arrow-back" size={18} color={Colors.navy} />
                <Text style={styles.backBtnText}>Retour</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.nextBtn, styles.nextBtnFlex, !activiteChoisie && styles.nextBtnDisabled]}
                disabled={!activiteChoisie}
                onPress={() => setEtape(3)}
              >
                <Text style={styles.nextBtnText}>Suivant</Text>
                <Ionicons name="arrow-forward" size={18} color={Colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ÉTAPE 3 : Informations */}
        {etape === 3 && (
          <View>
            <Text style={styles.etapeTitre}>Vos informations</Text>
            {activiteChoisie && (
              <View style={[styles.resumeBox, { borderColor: ESPACE_COLORS[activiteChoisie.espaceId] + '60' }]}>
                <Ionicons name="checkmark-circle" size={18} color={ESPACE_COLORS[activiteChoisie.espaceId]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.resumeTitre}>{activiteChoisie.titre}</Text>
                  <Text style={styles.resumeMeta}>{formatDate(activiteChoisie.date)} · {activiteChoisie.heureDebut} – {activiteChoisie.heureFin}</Text>
                </View>
              </View>
            )}

            {[
              { key: 'prenom', label: 'Prénom *', placeholder: 'ex: Lucas', keyboard: 'default' as const },
              { key: 'nom', label: 'Nom *', placeholder: 'ex: Marchand', keyboard: 'default' as const },
              { key: 'age', label: 'Âge', placeholder: 'ex: 14', keyboard: 'numeric' as const },
              { key: 'telephone', label: 'Téléphone du parent/tuteur *', placeholder: 'ex: 06 12 34 56 78', keyboard: 'phone-pad' as const },
              { key: 'email', label: 'Email (optionnel)', placeholder: 'ex: parent@email.fr', keyboard: 'email-address' as const },
              { key: 'etablissement', label: 'Établissement scolaire', placeholder: 'ex: Collège Albert Camus', keyboard: 'default' as const },
            ].map((field) => (
              <View key={field.key} style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={field.placeholder}
                  placeholderTextColor={Colors.textLight}
                  keyboardType={field.keyboard}
                  value={form[field.key as keyof typeof form]}
                  onChangeText={(v) => setForm({ ...form, [field.key]: v })}
                />
              </View>
            ))}

            <Text style={styles.rgpdNote}>
              <Ionicons name="lock-closed" size={11} /> Vos données sont utilisées uniquement pour la gestion de l'inscription et ne sont pas transmises à des tiers.
            </Text>

            <View style={styles.navBtns}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setEtape(2)}>
                <Ionicons name="arrow-back" size={18} color={Colors.navy} />
                <Text style={styles.backBtnText}>Retour</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.nextBtn, styles.nextBtnFlex]} onPress={handleSubmit}>
                <Ionicons name="send" size={16} color={Colors.white} />
                <Text style={styles.nextBtnText}>Envoyer</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },

  stepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 16,
    paddingBottom: 4,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  step: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepActive: { borderColor: Colors.purple, backgroundColor: Colors.purple },
  stepNum: { fontSize: 13, fontWeight: '700', color: Colors.textLight },
  stepNumActive: { color: Colors.white },
  stepLine: { flex: 1, height: 2, backgroundColor: Colors.border },
  stepLineActive: { backgroundColor: Colors.purple },
  stepsLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingBottom: 8,
    backgroundColor: Colors.white,
  },
  stepLabel: { fontSize: 11, color: Colors.textLight, fontWeight: '500', textAlign: 'center', flex: 1 },
  stepLabelActive: { color: Colors.purple, fontWeight: '700' },

  etapeTitre: { fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 6 },
  etapeSousTitre: { fontSize: 13, color: Colors.textMuted, marginBottom: 20, lineHeight: 19 },

  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  optionIcon: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionInfo: { flex: 1 },
  optionNom: { fontSize: 14, fontWeight: '700', color: Colors.text },
  optionAge: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.white },

  actCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 12,
  },
  actDate: { width: 40, alignItems: 'center' },
  actDateNum: { fontSize: 22, fontWeight: '800' },
  actDateMois: { fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase', fontWeight: '600' },
  actInfo: { flex: 1, gap: 2 },
  actTitre: { fontSize: 14, fontWeight: '700', color: Colors.text },
  actMeta: { fontSize: 12, color: Colors.textMuted },
  actPlaces: { fontSize: 11, color: Colors.success, fontWeight: '600' },

  nextBtn: {
    backgroundColor: Colors.purple,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 20,
  },
  nextBtnFlex: { flex: 1 },
  nextBtnDisabled: { backgroundColor: Colors.textLight },
  nextBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
  navBtns: { flexDirection: 'row', gap: 10, marginTop: 20 },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.purple,
  },
  backBtnText: { color: Colors.purple, fontWeight: '600', fontSize: 14 },

  resumeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.blueLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1.5,
  },
  resumeTitre: { fontSize: 13, fontWeight: '700', color: Colors.text },
  resumeMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  fieldGroup: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 6 },
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: Colors.text,
  },
  rgpdNote: { fontSize: 11, color: Colors.textLight, lineHeight: 16, marginVertical: 12 },

  emptyBox: { alignItems: 'center', paddingVertical: 30, gap: 10 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
});
