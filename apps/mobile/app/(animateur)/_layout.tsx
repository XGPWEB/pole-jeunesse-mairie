import React, { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { Platform, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '@/hooks/useAuth';

// ─── Header components ───────────────────────────────────────────────────────

function HeaderBadge() {
  return (
    <View style={styles.headerTitle}>
      <View style={styles.badge}>
        <Ionicons name="shield-checkmark" size={14} color={Colors.white} />
        <Text style={styles.badgeText}>Animateur</Text>
      </View>
    </View>
  );
}

function LogoutButton() {
  const { logout } = useAuth();

  // La redirection vers /login est faite par le layout dès que la session
  // est purgée (déconnexion volontaire comme session expirée).
  const handleLogout = () => {
    logout();
  };

  return (
    <TouchableOpacity
      onPress={handleLogout}
      style={styles.logoutButton}
      accessibilityLabel="Déconnexion"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="log-out-outline" size={20} color={Colors.white} />
      <Text style={styles.logoutText}>Déconnexion</Text>
    </TouchableOpacity>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function AnimateurLayout() {
  const { isAuthenticated, statut } = useAuth();

  // Tant que la session stockée n'a pas été vérifiée auprès du serveur, on
  // n'affiche ni l'espace animateur ni l'écran de connexion.
  useEffect(() => {
    if (statut !== 'chargement' && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, statut]);

  if (statut === 'chargement') {
    return (
      <View style={styles.chargement}>
        <ActivityIndicator size="large" color={Colors.purple} />
      </View>
    );
  }
  if (!isAuthenticated) return null;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.purple },
        headerTintColor: Colors.white,
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
        tabBarActiveTintColor: Colors.purple,
        tabBarInactiveTintColor: Colors.textLight,
        tabBarStyle: {
          borderTopColor: Colors.border,
          backgroundColor: Colors.white,
          height: Platform.OS === 'ios' ? 85 : 65,
          paddingBottom: Platform.OS === 'ios' ? 24 : 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid" size={size} color={color} />
          ),
          headerTitle: 'Tableau de bord',
          headerRight: () => (
            <View style={styles.headerRightRow}>
              <HeaderBadge />
              <LogoutButton />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="pointage"
        options={{
          title: 'Pointage',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-circle-outline" size={size} color={color} />
          ),
          headerTitle: 'Pointage',
        }}
      />
      <Tabs.Screen
        name="presences"
        options={{
          href: null,
          headerTitle: 'Présences',
        }}
      />
      <Tabs.Screen
        name="saisie-semaine"
        options={{
          href: null,
          headerTitle: 'Pointage hebdomadaire',
        }}
      />
      <Tabs.Screen
        name="fiches"
        options={{
          title: 'Fiches',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
          headerTitle: 'Fiches de liaison',
        }}
      />
      <Tabs.Screen
        name="communication"
        options={{
          title: 'Comm.',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
          headerTitle: 'Communication',
        }}
      />
      <Tabs.Screen
        name="parametres"
        options={{
          title: 'Réglages',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
          headerTitle: 'Paramètres',
        }}
      />
      <Tabs.Screen
        name="urgences"
        options={{
          href: null,
          headerTitle: '🚨 Numéros d\'urgence',
          headerStyle: { backgroundColor: '#DC2626' },
        }}
      />
    </Tabs>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  chargement: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  headerTitle: { marginRight: 4 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.purpleLight,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.skyBlue + '80',
  },
  badgeText: { color: Colors.white, fontSize: 11, fontWeight: '700' },

  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
    gap: 8,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  logoutText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
});
