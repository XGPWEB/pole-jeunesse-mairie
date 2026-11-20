import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useJeunes } from '@/hooks/useJeunes';
import { useActivites } from '@/hooks/useActivites';
import { ajouterJours, dateCivileParis, formaterDateCivile, jourDuMois } from '@/lib/dates';
import Card from '@/components/ui/Card';

// ─── WMO code helpers ─────────────────────────────────────────────────────────
const WMO_ICONS: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '❄️', 73: '❄️', 75: '❄️', 77: '🌨️',
  80: '🌦️', 81: '🌦️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};
const WMO_LABELS: Record<number, string> = {
  0: 'Ensoleillé', 1: 'Peu nuageux', 2: 'Nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard',
  51: 'Bruine', 53: 'Bruine', 55: 'Bruine',
  61: 'Pluie légère', 63: 'Pluie', 65: 'Forte pluie',
  71: 'Neige légère', 73: 'Neige', 75: 'Forte neige', 77: 'Grésil',
  80: 'Averses', 81: 'Averses', 82: 'Fortes averses',
  95: 'Orage', 96: 'Orage', 99: 'Fort orage',
};
function wmoIcon(code: number) {
  if (WMO_ICONS[code]) return WMO_ICONS[code];
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}
function wmoLabel(code: number) { return WMO_LABELS[code] ?? 'Météo'; }

// ─── Météo Widget ──────────────────────────────────────────────────────────────
interface WeatherData { temp: number; code: number; wind: number; }

function WeatherBanner() {
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    // Service météo public tiers (Open-Meteo), sans rapport avec le backend :
    // aucune donnée de session ni jeton n'y est envoyé, d'où l'appel hors du
    // client API. Délai borné ; en cas d'échec le bandeau n'est pas affiché.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=48.8391&longitude=2.4802&current=temperature_2m,weather_code,wind_speed_10m&timezone=Europe%2FParis',
      { signal: controller.signal },
    )
      .then(r => r.json())
      .then(data => {
        const c = data?.current;
        if (c) setWeather({ temp: Math.round(c.temperature_2m), code: c.weather_code, wind: Math.round(c.wind_speed_10m) });
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

  if (!weather) return null;

  return (
    <View style={wxStyles.banner}>
      <Text style={wxStyles.icon}>{wmoIcon(weather.code)}</Text>
      <View>
        <Text style={wxStyles.temp}>{weather.temp}°C</Text>
        <Text style={wxStyles.label}>{wmoLabel(weather.code)}</Text>
      </View>
      <View style={wxStyles.right}>
        <Text style={wxStyles.city}>Nogent-sur-Marne</Text>
        <Text style={wxStyles.wind}>💨 {weather.wind} km/h</Text>
      </View>
    </View>
  );
}

const wxStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  icon: { fontSize: 28 },
  temp: { fontSize: 18, fontWeight: '800', color: Colors.text },
  label: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' },
  right: { flex: 1, alignItems: 'flex-end' },
  city: { fontSize: 11, fontWeight: '700', color: Colors.textMuted },
  wind: { fontSize: 11, color: Colors.textLight, marginTop: 2 },
});

const ESPACE_COLORS: Record<string, string> = {
  collegiens: Colors.collegiens,
  lyceens: Colors.lyceens,
  pij: Colors.pij,
  clas: Colors.clas,
};

const ESPACE_LABELS: Record<string, string> = {
  collegiens: 'Collégiens',
  lyceens: 'Lycéens',
  pij: 'PIJ',
  clas: 'CLAS',
};

export default function DashboardAnimateur() {
  const router = useRouter();
  // Données du backend pour la session courante ; aucune donnée de repli.
  const jeunesRes = useJeunes();
  const activitesRes = useActivites();
  const jeunesTotal = jeunesRes.data ?? [];
  const activitesTout = activitesRes.data ?? [];
  const erreurDonnees = jeunesRes.error ?? activitesRes.error;
  const chargementDonnees = jeunesRes.loading || activitesRes.loading;

  // Jour civil de la structure (Europe/Paris), pas la date UTC.
  const today = dateCivileParis();
  const dansSeptJours = ajouterJours(today, 7);
  const activitesProchaines = activitesTout
    .filter((a) => a.date >= today && a.date <= dansSeptJours)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.heureDebut.localeCompare(b.heureDebut)));

  const statsEspaces = ['collegiens', 'lyceens', 'pij', 'clas'].map((id) => ({
    id,
    count: jeunesTotal.filter((j) => j.espaceId === id).length,
  }));

  const activitesAujourdHui = activitesTout.filter((a) => a.date === today);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* Bonjour */}
        <View style={styles.greeting}>
          <View>
            <Text style={styles.greetingSub}>Bonjour 👋</Text>
            <Text style={styles.greetingNom}>Équipe Pôle Jeunesse</Text>
            <Text style={styles.greetingDate}>
              {formaterDateCivile(today, { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </View>
          <View style={styles.greetingActions}>
            <TouchableOpacity
              style={[styles.switchBtn, styles.urgenceBtn]}
              onPress={() => router.push('/(animateur)/urgences' as any)}
              accessibilityLabel="Numéros d'urgence"
            >
              <Text style={{ fontSize: 16 }}>🚨</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.switchBtn}
              onPress={() => router.replace('/')}
            >
              <Ionicons name="swap-horizontal" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Météo */}
        <WeatherBanner />

        {/* Données serveur indisponibles : erreur visible, pas de chiffres inventés */}
        {erreurDonnees && !chargementDonnees && (
          <Card padding={16} style={{ marginBottom: 16 }}>
            <View style={styles.emptyDay}>
              <Ionicons name="alert-circle" size={24} color={Colors.danger} />
              <Text style={[styles.emptyDayText, { color: Colors.danger }]}>{erreurDonnees}</Text>
              <TouchableOpacity onPress={() => { jeunesRes.reload(); activitesRes.reload(); }}>
                <Text style={styles.voirTout}>Réessayer →</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {/* Stats globales */}
        <View style={styles.statsRow}>
          {[
            { label: 'Jeunes inscrits', value: jeunesRes.data ? jeunesTotal.length : '—', icon: 'people', color: Colors.purple },
            { label: 'Activités prévues', value: activitesRes.data ? activitesTout.length : '—', icon: 'calendar', color: Colors.navy },
            { label: 'Cette semaine', value: activitesRes.data ? activitesProchaines.length : '—', icon: 'today', color: Colors.green },
          ].map((s) => (
            <Card key={s.label} style={styles.statCard} padding={12}>
              <View style={[styles.statIcon, { backgroundColor: s.color + '15' }]}>
                <Ionicons name={s.icon as any} size={20} color={s.color} />
              </View>
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </Card>
          ))}
        </View>

        {/* Activités aujourd'hui */}
        <View style={styles.section}>
          <Text style={styles.sectionTitre}>Aujourd'hui</Text>
          {activitesAujourdHui.length === 0 ? (
            <Card padding={16}>
              <View style={styles.emptyDay}>
                <Ionicons name="sunny-outline" size={24} color={Colors.textLight} />
                <Text style={styles.emptyDayText}>Aucune activité planifiée aujourd'hui</Text>
              </View>
            </Card>
          ) : (
            activitesAujourdHui.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[styles.todayCard, { borderLeftColor: ESPACE_COLORS[a.espaceId] }]}
                onPress={() => router.push('/(animateur)/presences' as any)}
                activeOpacity={0.85}
              >
                <View>
                  <Text style={styles.todayCardTitre}>{a.titre}</Text>
                  <Text style={styles.todayCardMeta}>
                    {a.heureDebut} – {a.heureFin} · {ESPACE_LABELS[a.espaceId] ?? a.espaceId}
                  </Text>
                </View>
                <View style={styles.todayCardAction}>
                  <Text style={[styles.todayCardActionText, { color: ESPACE_COLORS[a.espaceId] }]}>Pointer</Text>
                  <Ionicons name="chevron-forward" size={16} color={ESPACE_COLORS[a.espaceId]} />
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Jeunes par espace */}
        <View style={styles.section}>
          <Text style={styles.sectionTitre}>Jeunes par espace</Text>
          <View style={styles.espacesGrid}>
            {statsEspaces.map((e) => (
              <TouchableOpacity
                key={e.id}
                style={[styles.espaceCard, { borderColor: ESPACE_COLORS[e.id] + '40' }]}
                onPress={() => router.push('/(animateur)/fiches' as any)}
                activeOpacity={0.85}
              >
                <Text style={[styles.espaceCount, { color: ESPACE_COLORS[e.id] }]}>{e.count}</Text>
                <Text style={styles.espaceLabel}>{ESPACE_LABELS[e.id]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Prochaines activités */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitre}>7 prochains jours</Text>
            <TouchableOpacity onPress={() => router.push('/(animateur)/presences' as any)}>
              <Text style={styles.voirTout}>Tout voir →</Text>
            </TouchableOpacity>
          </View>
          {activitesProchaines.slice(0, 4).map((a) => (
            <View key={a.id} style={styles.prochainRow}>
              <View style={[styles.prochainDate, { backgroundColor: ESPACE_COLORS[a.espaceId] + '18' }]}>
                <Text style={[styles.prochainDateNum, { color: ESPACE_COLORS[a.espaceId] }]}>
                  {jourDuMois(a.date)}
                </Text>
                <Text style={[styles.prochainDateMois, { color: ESPACE_COLORS[a.espaceId] }]}>
                  {formaterDateCivile(a.date, { month: 'short' })}
                </Text>
              </View>
              <View style={styles.prochainInfo}>
                <Text style={styles.prochainTitre} numberOfLines={1}>{a.titre}</Text>
                <Text style={styles.prochainMeta}>{a.heureDebut} · {ESPACE_LABELS[a.espaceId] ?? a.espaceId}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Accès rapides animateur */}
        <View style={styles.section}>
          <Text style={styles.sectionTitre}>Accès rapide</Text>
          <View style={styles.quickGrid}>
            {[
              { label: 'Pointer les présences', icon: 'checkmark-circle', route: '/(animateur)/presences', color: Colors.success },
              { label: 'Fiches de liaison', icon: 'people', route: '/(animateur)/fiches', color: Colors.purple },
              { label: 'Message à l\'admin', icon: 'chatbubbles', route: '/(animateur)/communication', color: Colors.cyan },
              { label: 'Actualités', icon: 'newspaper', route: '/(animateur)/communication', color: Colors.navy },
            ].map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.quickCard}
                onPress={() => router.push(item.route as any)}
                activeOpacity={0.85}
              >
                <View style={[styles.quickIcon, { backgroundColor: item.color + '18' }]}>
                  <Ionicons name={item.icon as any} size={24} color={item.color} />
                </View>
                <Text style={styles.quickLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },

  greeting: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingTop: 8,
  },
  greetingActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  urgenceBtn: { borderColor: '#FFE0E0', backgroundColor: '#FFF5F5' },
  greetingSub: { fontSize: 13, color: Colors.textMuted },
  greetingNom: { fontSize: 22, fontWeight: '800', color: Colors.text, marginTop: 2 },
  greetingDate: { fontSize: 13, color: Colors.textMuted, marginTop: 3, textTransform: 'capitalize' },
  switchBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: { flex: 1, alignItems: 'center', gap: 6 },
  statIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 10, color: Colors.textMuted, textAlign: 'center', fontWeight: '500' },

  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitre: { fontSize: 17, fontWeight: '800', color: Colors.text, marginBottom: 12 },
  voirTout: { fontSize: 13, color: Colors.blue, fontWeight: '600' },

  emptyDay: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center', paddingVertical: 4 },
  emptyDayText: { fontSize: 13, color: Colors.textMuted },

  todayCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  todayCardTitre: { fontSize: 14, fontWeight: '700', color: Colors.text },
  todayCardMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  todayCardAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  todayCardActionText: { fontSize: 13, fontWeight: '700' },

  espacesGrid: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  espaceCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    gap: 4,
  },
  espaceCount: { fontSize: 28, fontWeight: '800' },
  espaceLabel: { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },

  prochainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  prochainDate: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  prochainDateNum: { fontSize: 18, fontWeight: '800' },
  prochainDateMois: { fontSize: 10, textTransform: 'uppercase', fontWeight: '600' },
  prochainInfo: { flex: 1 },
  prochainTitre: { fontSize: 13, fontWeight: '700', color: Colors.text },
  prochainMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  prochainPlaces: { fontSize: 12, fontWeight: '700' },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickCard: {
    width: '47%',
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  quickIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 12, fontWeight: '700', color: Colors.text, lineHeight: 17 },
});
