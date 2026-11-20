import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';

interface NumeroUrgence {
  numero: string;
  label: string;
  detail: string;
  couleur: string;
  icone: string;
}

const NUMEROS: NumeroUrgence[] = [
  { numero: '15', label: 'SAMU', detail: 'Urgences médicales', couleur: '#DC2626', icone: '🚑' },
  { numero: '17', label: 'Police', detail: 'Urgences police / sécurité', couleur: '#1D4ED8', icone: '🚔' },
  { numero: '18', label: 'Pompiers', detail: 'Incendie / accident', couleur: '#EA580C', icone: '🚒' },
  { numero: '112', label: 'Secours européen', detail: 'Numéro d\'urgence européen', couleur: '#7C3AED', icone: '🆘' },
  { numero: '3114', label: 'Prévention suicide', detail: 'Détresse psychologique, 24h/24', couleur: '#0891B2', icone: '💙' },
  { numero: '119', label: 'Enfance en danger', detail: 'Allô enfance en danger', couleur: '#16A34A', icone: '🛡️' },
];

const CONSEILS = [
  'Restez calme et parlez clairement',
  'Précisez l\'adresse exacte et le nombre de personnes concernées',
  'Ne raccrochez pas avant l\'accord du service appelé',
  'Dégagez l\'accès pour les secours',
];

function appelNumerro(numero: string) {
  const url = `tel:${numero}`;
  Alert.alert(
    `Appeler le ${numero}`,
    '',
    [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Appeler', style: 'destructive', onPress: () => Linking.openURL(url) },
    ],
  );
}

export default function UrgencesScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* En-tête d'alerte */}
        <View style={styles.alertBanner}>
          <Text style={styles.alertIcon}>🚨</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.alertTitle}>Numéros d'urgence</Text>
            <Text style={styles.alertSub}>Appuyez sur un numéro pour appeler immédiatement</Text>
          </View>
        </View>

        {/* Numéros */}
        <View style={styles.section}>
          {NUMEROS.map((n) => (
            <TouchableOpacity
              key={n.numero}
              style={[styles.card, { borderLeftColor: n.couleur }]}
              onPress={() => appelNumerro(n.numero)}
              activeOpacity={0.75}
            >
              <Text style={styles.cardIcon}>{n.icone}</Text>
              <View style={styles.cardBody}>
                <Text style={styles.cardLabel}>{n.label}</Text>
                <Text style={styles.cardDetail}>{n.detail}</Text>
              </View>
              <View style={[styles.numeroBadge, { backgroundColor: n.couleur }]}>
                <Text style={styles.numeroText}>{n.numero}</Text>
              </View>
              <Ionicons name="call" size={18} color={n.couleur} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Conseils */}
        <View style={styles.conseilsCard}>
          <Text style={styles.conseilsTitre}>En cas d'urgence</Text>
          {CONSEILS.map((c, i) => (
            <View key={i} style={styles.conseilRow}>
              <View style={[styles.conseilNum, { backgroundColor: Colors.purple + '20' }]}>
                <Text style={[styles.conseilNumText, { color: Colors.purple }]}>{i + 1}</Text>
              </View>
              <Text style={styles.conseilText}>{c}</Text>
            </View>
          ))}
        </View>

        {/* Adresse structure */}
        <View style={styles.adresseCard}>
          <Text style={styles.adresseTitre}>📍 Adresse de la structure</Text>
          <Text style={styles.adresseText}>Pôle Jeunesse — Nogent-sur-Marne</Text>
          <Text style={styles.adresseText}>Val-de-Marne (94)</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },

  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FEF2F2',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  alertIcon: { fontSize: 32 },
  alertTitle: { fontSize: 17, fontWeight: '800', color: '#991B1B' },
  alertSub: { fontSize: 12, color: '#B91C1C', marginTop: 2 },

  section: { gap: 10, marginBottom: 24 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardIcon: { fontSize: 24 },
  cardBody: { flex: 1 },
  cardLabel: { fontSize: 15, fontWeight: '800', color: Colors.text },
  cardDetail: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  numeroBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 44,
    alignItems: 'center',
  },
  numeroText: { fontSize: 16, fontWeight: '900', color: '#fff' },

  conseilsCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  conseilsTitre: { fontSize: 14, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  conseilRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  conseilNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  conseilNumText: { fontSize: 12, fontWeight: '800' },
  conseilText: { flex: 1, fontSize: 13, color: Colors.textMuted, lineHeight: 18 },

  adresseCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    gap: 4,
  },
  adresseTitre: { fontSize: 13, fontWeight: '800', color: '#166534', marginBottom: 4 },
  adresseText: { fontSize: 13, color: '#166534' },
});
