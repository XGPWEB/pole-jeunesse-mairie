import React, { useCallback, useEffect, useState } from 'react';
import {
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
import { Colors } from '@/constants/colors';
import { messageErreur } from '@/lib/api';
import { api, baseApi } from '@/lib/client';
import { testerServeur } from '@/lib/services';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  accentColor: '@pj_anim_accentColor',
  fontSize: '@pj_anim_fontSize',
  compactMode: '@pj_anim_compactMode',
  displayName: '@pj_anim_displayName',
  espaceAssigne: '@pj_anim_espaceAssigne',
  badgeVisible: '@pj_anim_badgeVisible',
  alertePresences: '@pj_anim_alertePresences',
  rappelPointage: '@pj_anim_rappelPointage',
  nouvellesInscriptions: '@pj_anim_nouvellesInscriptions',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type FontSize = 'small' | 'medium' | 'large';
type EspaceId = 'collegiens' | 'lyceens' | 'pij' | 'clas';

interface Prefs {
  accentColor: string;
  fontSize: FontSize;
  compactMode: boolean;
  displayName: string;
  espaceAssigne: EspaceId;
  badgeVisible: boolean;
  alertePresences: boolean;
  rappelPointage: boolean;
  nouvellesInscriptions: boolean;
}

const DEFAULTS: Prefs = {
  accentColor: '#6B1A6E',
  fontSize: 'medium',
  compactMode: false,
  displayName: '',
  espaceAssigne: 'collegiens',
  badgeVisible: true,
  alertePresences: true,
  rappelPointage: true,
  nouvellesInscriptions: false,
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
    (Object.keys(KEYS) as (keyof typeof KEYS)[]).forEach((k, i) => {
      map[k] = entries[i][1];
    });

    return {
      accentColor: map.accentColor ?? DEFAULTS.accentColor,
      fontSize: (map.fontSize as FontSize) ?? DEFAULTS.fontSize,
      compactMode: map.compactMode === 'true',
      displayName: map.displayName ?? DEFAULTS.displayName,
      espaceAssigne: (map.espaceAssigne as EspaceId) ?? DEFAULTS.espaceAssigne,
      badgeVisible: map.badgeVisible !== 'false',
      alertePresences: map.alertePresences !== 'false',
      rappelPointage: map.rappelPointage !== 'false',
      nouvellesInscriptions: map.nouvellesInscriptions === 'true',
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

export default function ParametresAnimateur() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [connErreur, setConnErreur] = useState<string | null>(null);

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

  // Le serveur est fixé par la configuration de build (EXPO_PUBLIC_API_URL) :
  // il n'est pas modifiable ici, car le jeton de session y est envoyé.
  async function testConnection() {
    setConnStatus('testing');
    setConnErreur(null);
    try {
      await testerServeur(api);
      setConnStatus('ok');
    } catch (e) {
      setConnErreur(messageErreur(e));
      setConnStatus('error');
    }
  }

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

        {/* ── Mon profil animateur ── */}
        <SectionHeader label="MON PROFIL ANIMATEUR" />
        <Card>
          <Text style={styles.rowLabel}>Nom affiché</Text>
          <TextInput
            style={[styles.textInput, { borderColor: accent + '60' }]}
            value={prefs.displayName}
            onChangeText={(t) => update('displayName', t)}
            placeholder="Votre prénom ou pseudo"
            placeholderTextColor={Colors.textLight}
            returnKeyType="done"
          />

          <RowSeparator />

          <Text style={styles.rowLabel}>Espace assigné</Text>
          <View style={styles.pillRow}>
            {ESPACES.map((e) => (
              <TouchableOpacity
                key={e.value}
                style={[
                  styles.pill,
                  prefs.espaceAssigne === e.value && {
                    backgroundColor: accent,
                    borderColor: accent,
                  },
                ]}
                onPress={() => update('espaceAssigne', e.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.pillText,
                    prefs.espaceAssigne === e.value && styles.pillTextActive,
                  ]}
                >
                  {e.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <RowSeparator />

          <ToggleRow
            label="Badge animateur visible"
            value={prefs.badgeVisible}
            onValueChange={(v) => update('badgeVisible', v)}
            accentColor={accent}
          />
        </Card>

        {/* ── Tableau de bord ── */}
        <SectionHeader label="TABLEAU DE BORD" />
        <Card>
          <ToggleRow
            label="Alertes présences manquantes"
            value={prefs.alertePresences}
            onValueChange={(v) => update('alertePresences', v)}
            accentColor={accent}
          />
          <RowSeparator />
          <ToggleRow
            label="Rappels pointage"
            value={prefs.rappelPointage}
            onValueChange={(v) => update('rappelPointage', v)}
            accentColor={accent}
          />
          <RowSeparator />
          <ToggleRow
            label="Nouvelles inscriptions"
            value={prefs.nouvellesInscriptions}
            onValueChange={(v) => update('nouvellesInscriptions', v)}
            accentColor={accent}
          />
        </Card>

        {/* ── Connexion admin ── */}
        <SectionHeader label="CONNEXION ADMIN" />
        <Card>
          <Text style={styles.rowLabel}>Serveur</Text>
          <Text style={{ fontSize: 13, color: Colors.text, marginTop: 4 }}>
            {baseApi.ok ? baseApi.baseUrl : baseApi.erreur}
          </Text>
          <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 4, marginBottom: 10 }}>
            Adresse définie à l'installation de l'application ; elle ne peut pas être modifiée ici.
          </Text>

          <TouchableOpacity
            style={[
              styles.testBtn,
              connStatus === 'ok' && styles.testBtnOk,
              connStatus === 'error' && styles.testBtnError,
              connStatus === 'testing' && { opacity: 0.6 },
            ]}
            onPress={testConnection}
            disabled={connStatus === 'testing'}
            activeOpacity={0.8}
          >
            <Text style={[
              styles.testBtnText,
              connStatus === 'ok' && styles.testBtnTextOk,
              connStatus === 'error' && styles.testBtnTextError,
            ]}>
              {connStatus === 'idle'    && '🔌 Tester la connexion'}
              {connStatus === 'testing' && '⏳ Test en cours…'}
              {connStatus === 'ok'      && '✅ Serveur accessible !'}
              {connStatus === 'error'   && `❌ ${connErreur ?? 'Serveur inaccessible'}`}
            </Text>
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

  // Test connection button
  testBtn: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  testBtnOk: { borderColor: '#22c55e', backgroundColor: '#f0fdf4' },
  testBtnError: { borderColor: '#ef4444', backgroundColor: '#fef2f2' },
  testBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  testBtnTextOk: { color: '#16a34a' },
  testBtnTextError: { color: '#dc2626' },

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

  bottomSpacer: { height: 32 },
});
