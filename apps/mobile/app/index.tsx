import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';

export default function SelectionProfil() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* En-tête */}
        <View style={styles.header}>
          <View style={styles.nogentStripe}>
            <View style={[styles.stripeSegment, { backgroundColor: Colors.navy, flex: 3 }]} />
            <View style={[styles.stripeSegment, { backgroundColor: Colors.green, flex: 1 }]} />
            <View style={[styles.stripeSegment, { backgroundColor: Colors.cyan, flex: 1 }]} />
          </View>

          <View style={styles.logoRow}>
            <View style={styles.logoImageWrapper}>
              <Image
                source={require('../assets/logo.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <View style={styles.logoMeta}>
              <Text style={styles.logoVille}>Mairie de Nogent-sur-Marne</Text>
              <Text style={styles.adresseInline}>
                <Ionicons name="location" size={11} color={Colors.skyBlue} />
                {' '}68 rue de Plaisance — 94130
              </Text>
            </View>
            {/* Bouton connexion animateur */}
            <TouchableOpacity
              onPress={() => router.push('/login' as any)}
              activeOpacity={0.75}
              style={styles.animateurBtn}
            >
              <Ionicons name="lock-closed" size={13} color={Colors.white} />
              <Text style={styles.animateurBtnText}>Animateur</Text>
            </TouchableOpacity>
          </View>

          {/* Pastilles espaces */}
          <View style={styles.nogentBadges}>
            {[
              { label: 'Collégiens', color: Colors.purple },
              { label: 'Lycéens', color: Colors.navy },
              { label: 'PIJ', color: Colors.cyan },
              { label: 'CLAS', color: Colors.green },
            ].map((b) => (
              <View key={b.label} style={[styles.nogentBadge, { backgroundColor: b.color + '30', borderColor: b.color + '60' }]}>
                <Text style={[styles.nogentBadgeText, { color: b.color === Colors.purple || b.color === Colors.navy ? Colors.white : b.color }]}>
                  {b.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Bienvenue — carte Jeune/Famille pleine largeur */}
        <View style={styles.sectionWrapper}>
          <Text style={styles.sectionLabel}>Bienvenue !</Text>
          <TouchableOpacity
            onPress={() => router.replace('/(jeune)' as any)}
            activeOpacity={0.88}
            style={[styles.profileCard, { borderColor: Colors.purple + '50' }]}
          >
            <View style={[styles.profileIcon, { backgroundColor: Colors.purple + '18' }]}>
              <Ionicons name="people-circle" size={52} color={Colors.purple} />
            </View>
            <Text style={[styles.profileTitre, { color: Colors.purple }]}>Jeune / Famille</Text>
            <Text style={styles.profileSousTitre}>Espace public</Text>
            <Text style={styles.profileDescription}>
              Découvrez les espaces, les horaires et les contacts du Pôle Jeunesse.
            </Text>
            <View style={[styles.profileBtn, { backgroundColor: Colors.purple }]}>
              <Text style={styles.profileBtnText}>Accéder</Text>
              <Ionicons name="arrow-forward" size={16} color={Colors.white} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Espaces */}
        <View style={styles.sectionWrapper}>
          <Text style={styles.sectionLabel}>Nos 4 espaces</Text>
          <View style={styles.espacesGrid}>
            {[
              { label: 'Collégiens', age: '11–15 ans', color: Colors.purple, icon: 'school' },
              { label: 'Lycéens', age: '15–18 ans', color: Colors.navy, icon: 'book' },
              { label: 'PIJ', age: '15–30 ans', color: Colors.cyan, icon: 'information-circle' },
              { label: 'CLAS', age: '6–17 ans', color: Colors.green, icon: 'library' },
            ].map((e) => (
              <View key={e.label} style={[styles.espacePill, { borderColor: e.color + '50', borderLeftColor: e.color, borderLeftWidth: 3 }]}>
                <View style={[styles.espaceIconWrapper, { backgroundColor: e.color + '18' }]}>
                  <Ionicons name={e.icon as any} size={18} color={e.color} />
                </View>
                <View>
                  <Text style={[styles.espaceLabel, { color: e.color }]}>{e.label}</Text>
                  <Text style={styles.espaceAge}>{e.age}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Contact */}
        <View style={styles.contactBox}>
          <Ionicons name="call" size={16} color={Colors.purple} />
          <Text style={styles.contactText}>01 48 72 73 74</Text>
          <View style={styles.contactDot} />
          <Ionicons name="mail" size={16} color={Colors.navy} />
          <Text style={styles.contactText}>pole.jeunesse@ville-nogentsurmarne.fr</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.purple },
  scroll: { flex: 1, backgroundColor: Colors.background },
  container: { paddingBottom: 40 },

  header: {
    backgroundColor: Colors.purple,
    paddingBottom: 28,
    overflow: 'hidden',
  },
  nogentStripe: { flexDirection: 'row', height: 5 },
  stripeSegment: { height: '100%' },

  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
  },
  logoImageWrapper: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  logoImage: {
    width: 90,
    height: 72,
  },
  logoMeta: {
    flex: 1,
    gap: 4,
  },
  logoVille: { color: Colors.skyBlue, fontSize: 11, fontWeight: '600', opacity: 0.9 },
  adresseInline: { color: Colors.skyBlue, fontSize: 10, opacity: 0.75 },

  animateurBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  animateurBtnText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.9,
  },

  nogentBadges: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, flexWrap: 'wrap' },
  nogentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  nogentBadgeText: { fontSize: 11, fontWeight: '700' },

  sectionWrapper: { paddingHorizontal: 16, paddingTop: 24 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 14,
  },

  profileCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  profileIcon: {
    width: 88,
    height: 88,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  profileTitre: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  profileSousTitre: { fontSize: 12, color: Colors.textLight, fontWeight: '500' },
  profileDescription: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19 },
  profileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 6,
  },
  profileBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },

  espacesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  espacePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.white,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    minWidth: '45%',
    flex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  espaceIconWrapper: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  espaceLabel: { fontSize: 13, fontWeight: '800' },
  espaceAge: { fontSize: 11, color: Colors.textMuted },

  contactBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    flexWrap: 'wrap',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  contactText: { fontSize: 12, color: Colors.text, fontWeight: '500' },
  contactDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.border },
});
