import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/colors';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  accentColor: '@pj_jeune_accentColor',
  fontSize: '@pj_jeune_fontSize',
  compactMode: '@pj_jeune_compactMode',
  displayName: '@pj_jeune_displayName',
  espacePreference: '@pj_jeune_espacePreference',
  notifActivites: '@pj_jeune_notifActivites',
  notifActualites: '@pj_jeune_notifActualites',
  notifRappels: '@pj_jeune_notifRappels',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type FontSize = 'small' | 'medium' | 'large';
type EspaceId = 'collegiens' | 'lyceens' | 'pij' | 'clas';

interface Prefs {
  accentColor: string;
  fontSize: FontSize;
  compactMode: boolean;
  displayName: string;
  espacePreference: EspaceId;
  notifActivites: boolean;
  notifActualites: boolean;
  notifRappels: boolean;
}

const DEFAULTS: Prefs = {
  accentColor: '#6B1A6E',
  fontSize: 'medium',
  compactMode: false,
  displayName: '',
  espacePreference: 'collegiens',
  notifActivites: true,
  notifActualites: true,
  notifRappels: false,
};

// ─── Static data ──────────────────────────────────────────────────────────────

const ACCENT_COLORS = [
  { value: '#6B1A6E', label: 'Violet' },
  { value: '#1B3870', label: 'Marine' },
  { value: '#29B5E8', label: 'Cyan' },
  { value: '#8DC63F', label: 'Vert' },
] as const;

const FONT_SIZES: { value: FontSize; label: string }[] = [
  { value: 'small', label: 'Petit' },
  { value: 'medium', label: 'Normal' },
  { value: 'large', label: 'Grand' },
];

const ESPACES: { value: EspaceId; label: string }[] = [
  { value: 'collegiens', label: 'Collégiens' },
  { value: 'lyceens', label: 'Lycéens' },
  { value: 'pij', label: 'PIJ' },
  { value: 'clas', label: 'CLAS' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadPrefs(): Promise<Prefs> {
  try {
    const entries = await AsyncStorage.multiGet(Object.values(KEYS));
    const map: Record<string, string | null> = {};
    // Re-key by our short key name using KEYS object
    (Object.keys(KEYS) as (keyof typeof KEYS)[]).forEach((k, i) => {
      map[k] = entries[i][1];
    });

    return {
      accentColor: map.accentColor ?? DEFAULTS.accentColor,
      fontSize: (map.fontSize as FontSize) ?? DEFAULTS.fontSize,
      compactMode: map.compactMode === 'true',
      displayName: map.displayName ?? DEFAULTS.displayName,
      espacePreference: (map.espacePreference as EspaceId) ?? DEFAULTS.espacePreference,
      notifActivites: map.notifActivites !== 'false',
      notifActualites: map.notifActualites !== 'false',
      notifRappels: map.notifRappels === 'true',
    };
  } catch {
    return DEFAULTS;
  }
}

async function savePref(key: keyof typeof KEYS, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS[key], value);
  } catch {
    // Silently ignore
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return <Text style={styles.sectionHeader}>{label}</Text>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function RowSeparator() {
  return <View style={styles.rowSeparator} />;
}

function ToggleRow({
  label,
  value,
  onValueChange,
  accentColor,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  accentColor: string;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: Colors.border, true: accentColor + '60' }}
        thumbColor={value ? accentColor : Colors.textLight}
        ios_backgroundColor={Colors.border}
      />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ParametresJeune() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadPrefs().then((p) => {
      setPrefs(p);
      setLoaded(true);
    });
  }, []);

  const update = useCallback(
    <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
      setPrefs((prev) => ({ ...prev, [key]: value }));
      savePref(key as keyof typeof KEYS, String(value));
    },
    [],
  );

  if (!loaded) return null;

  const accent = prefs.accentColor;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Apparence ── */}
        <SectionHeader label="APPARENCE" />
        <Card>
          {/* Color swatches */}
          <Text style={styles.rowLabel}>Couleur principale</Text>
          <View style={styles.swatchRow}>
            {ACCENT_COLORS.map((c) => (
              <TouchableOpacity
                key={c.value}
                style={[
                  styles.swatch,
                  { backgroundColor: c.value },
                  prefs.accentColor === c.value && styles.swatchActive,
                ]}
                onPress={() => update('accentColor', c.value)}
                activeOpacity={0.8}
              >
                {prefs.accentColor === c.value && (
                  <View style={styles.swatchCheck} />
                )}
              </TouchableOpacity>
            ))}
          </View>

          <RowSeparator />

          {/* Font size pills */}
          <Text style={styles.rowLabel}>Taille du texte</Text>
          <View style={styles.pillRow}>
            {FONT_SIZES.map((f) => (
              <TouchableOpacity
                key={f.value}
                style={[
                  styles.pill,
                  prefs.fontSize === f.value && {
                    backgroundColor: accent,
                    borderColor: accent,
                  },
                ]}
                onPress={() => update('fontSize', f.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.pillText,
                    prefs.fontSize === f.value && styles.pillTextActive,
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <RowSeparator />

          <ToggleRow
            label="Mode compact"
            value={prefs.compactMode}
            onValueChange={(v) => update('compactMode', v)}
            accentColor={accent}
          />
        </Card>

        {/* ── Mon profil ── */}
        <SectionHeader label="MON PROFIL" />
        <Card>
          <Text style={styles.rowLabel}>Nom affiché</Text>
          <TextInput
            style={[styles.textInput, { borderColor: accent + '60' }]}
            value={prefs.displayName}
            onChangeText={(t) => update('displayName', t)}
            placeholder="Ton prénom ou pseudo"
            placeholderTextColor={Colors.textLight}
            returnKeyType="done"
          />

          <RowSeparator />

          <Text style={styles.rowLabel}>Espace préféré</Text>
          <View style={styles.pillRow}>
            {ESPACES.map((e) => (
              <TouchableOpacity
                key={e.value}
                style={[
                  styles.pill,
                  prefs.espacePreference === e.value && {
                    backgroundColor: accent,
                    borderColor: accent,
                  },
                ]}
                onPress={() => update('espacePreference', e.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.pillText,
                    prefs.espacePreference === e.value && styles.pillTextActive,
                  ]}
                >
                  {e.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {/* ── Notifications ── */}
        <SectionHeader label="NOTIFICATIONS" />
        <Card>
          <ToggleRow
            label="Activités à venir"
            value={prefs.notifActivites}
            onValueChange={(v) => update('notifActivites', v)}
            accentColor={accent}
          />
          <RowSeparator />
          <ToggleRow
            label="Actualités du pôle"
            value={prefs.notifActualites}
            onValueChange={(v) => update('notifActualites', v)}
            accentColor={accent}
          />
          <RowSeparator />
          <ToggleRow
            label="Rappels d'inscription"
            value={prefs.notifRappels}
            onValueChange={(v) => update('notifRappels', v)}
            accentColor={accent}
          />
        </Card>

        {/* ── Données personnelles (RGPD) ── */}
        <SectionHeader label="DONNÉES PERSONNELLES" />
        <Card>
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/politique-confidentialite')}
            activeOpacity={0.7}
          >
            <Text style={styles.rowLabel}>Politique de confidentialité</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <RowSeparator />
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() => router.push('/consentement')}
            activeOpacity={0.7}
          >
            <Text style={styles.rowLabel}>Gérer mes consentements</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <RowSeparator />
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() =>
              Alert.alert(
                'Demander mes données',
                'Pour exercer votre droit d\'accès à vos données personnelles, contactez notre Délégué à la Protection des Données :\n\ndpo@ville-nogentsurmarne.fr\n01 48 72 73 00',
                [{ text: 'Fermer' }],
              )
            }
            activeOpacity={0.7}
          >
            <Text style={styles.rowLabel}>Demander mes données</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <RowSeparator />
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() =>
              Alert.alert(
                'Demander la suppression',
                'Pour exercer votre droit à l\'effacement de vos données personnelles, contactez notre DPO :\n\ndpo@ville-nogentsurmarne.fr\n\nNous traiterons votre demande dans un délai d\'un mois conformément au RGPD.',
                [{ text: 'Fermer' }],
              )
            }
            activeOpacity={0.7}
          >
            <Text style={[styles.rowLabel, { color: Colors.danger }]}>Demander la suppression</Text>
            <Text style={[styles.chevron, { color: Colors.danger }]}>›</Text>
          </TouchableOpacity>
        </Card>

        {/* ── À propos ── */}
        <SectionHeader label="À PROPOS" />
        <Card>
          <View style={styles.aboutRow}>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.aboutValue}>v1.0.0 — Prototype 2026</Text>
          </View>
          <RowSeparator />
          <TouchableOpacity
            style={styles.aboutRow}
            onPress={() =>
              Linking.openURL('mailto:pole.jeunesse@ville-nogentsurmarne.fr')
            }
            activeOpacity={0.7}
          >
            <Text style={styles.rowLabel}>Contact</Text>
            <Text style={[styles.aboutValue, { color: accent }]}>
              pole.jeunesse@ville-nogentsurmarne.fr
            </Text>
          </TouchableOpacity>
        </Card>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12 },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
  },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },

  rowSeparator: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
  },

  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 10,
  },

  // Swatches
  swatchRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchActive: {
    borderWidth: 3,
    borderColor: Colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  swatchCheck: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.white,
  },

  // Pills
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  pillTextActive: { color: Colors.white },

  // Toggle row
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // Text input
  textInput: {
    height: 44,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.background,
    marginBottom: 4,
  },

  // About
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aboutValue: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '500',
  },

  // Chevron
  chevron: {
    fontSize: 20,
    color: Colors.textLight,
    fontWeight: '400',
    lineHeight: 22,
  },

  bottomSpacer: { height: 32 },
});
