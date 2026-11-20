import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/colors';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConsentState {
  notifications: boolean;
  photos: boolean;
}

// ─── Consent item component ───────────────────────────────────────────────────

function ConsentItem({
  icon,
  title,
  description,
  value,
  onValueChange,
  required,
  accentColor,
}: {
  icon: string;
  title: string;
  description: string;
  value: boolean;
  onValueChange?: (v: boolean) => void;
  required?: boolean;
  accentColor: string;
}) {
  return (
    <View style={styles.consentItem}>
      <View style={[styles.consentIconWrap, { backgroundColor: accentColor + '15' }]}>
        <Text style={styles.consentIcon}>{icon}</Text>
      </View>
      <View style={styles.consentTextWrap}>
        <View style={styles.consentTitleRow}>
          <Text style={styles.consentTitle}>{title}</Text>
          {required && (
            <View style={styles.requiredBadge}>
              <Text style={styles.requiredBadgeText}>Obligatoire</Text>
            </View>
          )}
        </View>
        <Text style={styles.consentDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={required ? undefined : onValueChange}
        disabled={required}
        trackColor={{ false: Colors.border, true: accentColor + '60' }}
        thumbColor={value ? accentColor : Colors.textLight}
        ios_backgroundColor={Colors.border}
      />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ConsentementScreen() {
  const router = useRouter();
  const [consent, setConsent] = useState<ConsentState>({
    notifications: true,
    photos: false,
  });

  const saveAndContinue = async (acceptAll: boolean) => {
    const finalConsent = {
      essential: true,
      notifications: acceptAll ? true : consent.notifications,
      photos: acceptAll ? true : consent.photos,
      acceptedAt: new Date().toISOString(),
    };
    try {
      await AsyncStorage.setItem('@pj_consent', JSON.stringify(finalConsent));
    } catch {
      // Silently ignore storage errors
    }
    router.replace('/(jeune)');
  };

  const handleAcceptAll = () => saveAndContinue(true);
  const handleAcceptSelection = () => {
    Alert.alert(
      'Confirmer votre sélection',
      'Vous pouvez modifier ces préférences à tout moment dans les Paramètres.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: () => saveAndContinue(false) },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Purple header */}
      <View style={styles.header}>
        <View style={styles.headerLogoWrap}>
          <Text style={styles.headerLogoIcon}>🏛</Text>
        </View>
        <View>
          <Text style={styles.headerCity}>Mairie de Nogent-sur-Marne</Text>
          <Text style={styles.headerTitle}>
            <Text style={styles.headerTitleAccent}>PÔLE</Text> JEUNESSE
          </Text>
        </View>
        {/* Nogent tricolor stripe */}
        <View style={styles.tricolor}>
          <View style={[styles.tricolorBand, { flex: 3, backgroundColor: Colors.navy }]} />
          <View style={[styles.tricolorBand, { flex: 1, backgroundColor: Colors.green }]} />
          <View style={[styles.tricolorBand, { flex: 1, backgroundColor: Colors.cyan }]} />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Title block */}
        <View style={styles.titleBlock}>
          <Text style={styles.shieldIcon}>🔒</Text>
          <Text style={styles.pageTitle}>Protection de vos données</Text>
          <Text style={styles.pageSubtitle}>
            Avant de continuer, veuillez lire et accepter notre politique de confidentialité
          </Text>
        </View>

        {/* Consent toggles */}
        <View style={styles.card}>
          <ConsentItem
            icon="📋"
            title="Données essentielles"
            description="Gestion des inscriptions et présences. Obligatoire pour utiliser l'application."
            value={true}
            required
            accentColor={Colors.purple}
          />
          <View style={styles.separator} />
          <ConsentItem
            icon="🔔"
            title="Notifications"
            description="Recevoir des alertes sur les nouvelles activités et rappels d'inscription"
            value={consent.notifications}
            onValueChange={(v) => setConsent((prev) => ({ ...prev, notifications: v }))}
            accentColor={Colors.purple}
          />
          <View style={styles.separator} />
          <ConsentItem
            icon="📸"
            title="Photos et médias"
            description="Utilisation de photos dans le cadre des activités (consentement parental requis pour les mineurs)"
            value={consent.photos}
            onValueChange={(v) => setConsent((prev) => ({ ...prev, photos: v }))}
            accentColor={Colors.purple}
          />
        </View>

        {/* Privacy policy link */}
        <TouchableOpacity
          style={styles.policyLink}
          onPress={() => router.push('/politique-confidentialite')}
          activeOpacity={0.7}
        >
          <Text style={styles.policyLinkText}>
            Lire la politique de confidentialité complète →
          </Text>
        </TouchableOpacity>

        {/* Buttons */}
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={handleAcceptAll}
          activeOpacity={0.85}
        >
          <Text style={styles.btnPrimaryText}>Tout accepter</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnOutline}
          onPress={handleAcceptSelection}
          activeOpacity={0.85}
        >
          <Text style={styles.btnOutlineText}>Accepter la sélection</Text>
        </TouchableOpacity>

        {/* RGPD notice */}
        <Text style={styles.notice}>
          Conformément au RGPD, vous pouvez modifier ces préférences à tout moment dans les
          Paramètres
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    backgroundColor: Colors.purple,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerLogoWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLogoIcon: { fontSize: 22 },
  headerCity: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  headerTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  headerTitleAccent: { color: Colors.skyBlue },
  tricolor: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    flexDirection: 'row',
  },
  tricolorBand: {},

  // Scroll
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 32 },

  // Title block
  titleBlock: { alignItems: 'center', marginBottom: 28 },
  shieldIcon: { fontSize: 48, marginBottom: 12 },
  pageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 16,
  },

  separator: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },

  // Consent item
  consentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  consentIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  consentIcon: { fontSize: 20 },
  consentTextWrap: { flex: 1 },
  consentTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  consentTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  consentDesc: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },
  requiredBadge: {
    backgroundColor: Colors.purple + '15',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  requiredBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.purple },

  // Policy link
  policyLink: { alignSelf: 'center', marginBottom: 24 },
  policyLinkText: { fontSize: 13, color: Colors.purple, fontWeight: '600', textDecorationLine: 'underline' },

  // Buttons
  btnPrimary: {
    backgroundColor: Colors.purple,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: Colors.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnPrimaryText: { color: Colors.white, fontWeight: '800', fontSize: 16 },
  btnOutline: {
    borderWidth: 2,
    borderColor: Colors.purple,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: Colors.white,
  },
  btnOutlineText: { color: Colors.purple, fontWeight: '700', fontSize: 15 },

  // Notice
  notice: {
    fontSize: 11,
    color: Colors.textLight,
    textAlign: 'center',
    lineHeight: 16,
  },
});
