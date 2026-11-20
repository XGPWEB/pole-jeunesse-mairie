import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useEspaces } from '@/hooks/useEspaces';
import { useActualitesPubliques } from '@/hooks/useContenuPublic';
import EspaceCard from '@/components/EspaceCard';

function formatDateCourte(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export default function AccueilJeune() {
  const router = useRouter();
  const espaces = useEspaces();
  // Aucune API publique d'actualités : rien n'est affiché « à la une » tant
  // qu'un contenu réel n'est pas disponible (voir hooks/useContenuPublic.ts).
  const epinglees = (useActualitesPubliques().data ?? []).filter((a) => a.epingle);

  const CATEGORIE_COLORS: Record<string, string> = {
    evenement: Colors.blue,
    annonce: Colors.navy,
    sortie: Colors.lyceens,
    atelier: Colors.clas,
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroContent}>
            <Text style={styles.heroGreeting}>Bienvenue au</Text>
            <Text style={styles.heroTitre}>Pôle Jeunesse</Text>
            <Text style={styles.heroAdresse}>
              <Ionicons name="location" size={13} color={Colors.blueLight} />
              {' '}68 rue de Plaisance — 94130 Nogent-sur-Marne
            </Text>
          </View>
          <TouchableOpacity
            style={styles.heroContact}
            onPress={() => Linking.openURL('tel:0148727374')}
          >
            <Ionicons name="call" size={20} color={Colors.white} />
            <Text style={styles.heroContactText}>01 48 72 73 74</Text>
          </TouchableOpacity>
        </View>

        {/* Accès rapide */}
        <View style={styles.section}>
          <Text style={styles.sectionTitre}>Accès rapide</Text>
          <View style={styles.quickRow}>
            {[
              { label: 'Planning', icon: 'calendar', route: '/(jeune)/planning', color: Colors.purple },
              { label: "S'inscrire", icon: 'person-add', route: '/(jeune)/inscription', color: Colors.navy },
              { label: 'Actualités', icon: 'newspaper', route: '/(jeune)/actualites', color: Colors.cyan },
              { label: 'Contact', icon: 'mail', action: () => Linking.openURL('mailto:pole.jeunesse@ville-nogentsurmarne.fr'), color: Colors.green },
            ].map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.quickBtn}
                onPress={() => item.action ? item.action() : router.push(item.route as any)}
                activeOpacity={0.8}
              >
                <View style={[styles.quickIcon, { backgroundColor: item.color + '18' }]}>
                  <Ionicons name={item.icon as any} size={22} color={item.color} />
                </View>
                <Text style={styles.quickLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Annonces épinglées */}
        {epinglees.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitre}>À la une</Text>
            {epinglees.map((actu) => (
              <View key={actu.id} style={styles.pinCard}>
                <View style={[styles.pinBadge, { backgroundColor: CATEGORIE_COLORS[actu.categorie] }]}>
                  <Ionicons name="pin" size={12} color={Colors.white} />
                  <Text style={styles.pinBadgeText}>{actu.categorie.toUpperCase()}</Text>
                </View>
                <Text style={styles.pinTitre}>{actu.titre}</Text>
                <Text style={styles.pinContenu} numberOfLines={3}>{actu.contenu}</Text>
                <Text style={styles.pinDate}>{formatDateCourte(actu.date)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Espaces */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitre}>Nos espaces</Text>
            <TouchableOpacity onPress={() => router.push('/(jeune)/planning' as any)}>
              <Text style={styles.voirTout}>Voir les activités →</Text>
            </TouchableOpacity>
          </View>
          {espaces.map((espace) => (
            <EspaceCard
              key={espace.id}
              espace={espace}
              onPress={() => router.push({ pathname: '/(jeune)/planning', params: { espaceId: espace.id } } as any)}
            />
          ))}
        </View>

        {/* Horaires */}
        <View style={[styles.section, styles.horairesBox]}>
          <Text style={styles.horairesTitre}>
            <Ionicons name="time" size={16} color={Colors.navy} /> Horaires d'ouverture
          </Text>
          {[
            { jour: 'Collégiens & Lycéens', horaire: 'L/M/J/V 15h30–19h · Mer/Sam 13h30–19h' },
            { jour: 'PIJ : Lun – Ven', horaire: '10h–12h / 13h30–19h' },
            { jour: 'CLAS : Lun / Mar / Jeu', horaire: '17h00 – 19h00' },
            { jour: 'Dimanche & jours fériés', horaire: 'Fermé' },
          ].map((h) => (
            <View key={h.jour} style={styles.horaireRow}>
              <Text style={styles.horaireJour}>{h.jour}</Text>
              <Text style={[styles.horaireHeure, h.horaire === 'Fermé' && { color: Colors.danger }]}>
                {h.horaire}
              </Text>
            </View>
          ))}
        </View>

        {/* Changer de profil */}
        <TouchableOpacity
          style={styles.switchProfil}
          onPress={() => router.replace('/')}
        >
          <Ionicons name="swap-horizontal" size={16} color={Colors.textMuted} />
          <Text style={styles.switchProfilText}>Changer de profil</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  hero: {
    backgroundColor: Colors.purple,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
    gap: 16,
  },
  heroContent: { gap: 4 },
  heroGreeting: { color: Colors.skyBlue, fontSize: 14, opacity: 0.85 },
  heroTitre: { color: Colors.white, fontSize: 28, fontWeight: '800' },
  heroAdresse: { color: Colors.skyBlue, fontSize: 12, opacity: 0.8 },
  heroContact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.purpleLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  heroContactText: { color: Colors.white, fontSize: 14, fontWeight: '600' },

  section: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitre: { fontSize: 17, fontWeight: '800', color: Colors.text, marginBottom: 12 },
  voirTout: { fontSize: 13, color: Colors.blue, fontWeight: '600' },

  quickRow: { flexDirection: 'row', gap: 10 },
  quickBtn: { flex: 1, alignItems: 'center', gap: 6 },
  quickIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { fontSize: 11, fontWeight: '600', color: Colors.text, textAlign: 'center' },

  pinCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: Colors.navy,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    gap: 6,
  },
  pinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    marginBottom: 2,
  },
  pinBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  pinTitre: { fontSize: 14, fontWeight: '700', color: Colors.text },
  pinContenu: { fontSize: 13, color: Colors.textMuted, lineHeight: 19 },
  pinDate: { fontSize: 11, color: Colors.textLight, marginTop: 4 },

  horairesBox: {
    backgroundColor: Colors.purplePale,
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 16,
    marginTop: 20,
  },
  horairesTitre: { fontSize: 15, fontWeight: '700', color: Colors.purple, marginBottom: 12 },
  horaireRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '60',
  },
  horaireJour: { fontSize: 13, color: Colors.text },
  horaireHeure: { fontSize: 13, fontWeight: '600', color: Colors.purple },

  switchProfil: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 20,
    marginTop: 8,
  },
  switchProfilText: { fontSize: 13, color: Colors.textMuted },
});
