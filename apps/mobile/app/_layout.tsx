import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, DevSettings } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '@/hooks/useAuth';

SplashScreen.preventAutoHideAsync();

// ─── Error Boundary ──────────────────────────────────────────────────────────
// Filet de sécurité : sans ça, une exception de rendu n'importe où dans l'app
// (jeune, animateur...) faisait planter l'app entière sur un écran blanc.
// Ici on affiche un écran de repli lisible avec un bouton pour retenter.

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Erreur non interceptée :', error, errorInfo);
  }

  handleReload = () => {
    // En dev, on tente un vrai reload du bundle JS. En production,
    // DevSettings.reload() n'est pas garanti : on retombe alors sur un
    // simple reset du boundary, qui retente le rendu de l'app.
    try {
      DevSettings.reload();
    } catch {
      this.setState({ hasError: false, error: null });
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Une erreur est survenue</Text>
          <Text style={styles.message}>
            {this.state.error?.message ?? "L'application a rencontré un problème inattendu."}
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.handleReload} accessibilityRole="button">
            <Text style={styles.buttonText}>Recharger l'application</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F5F7FA',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#1B3870',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});

// ─── Root layout ──────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [loaded] = useFonts({});

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) return null;

  return (
    <ErrorBoundary>
      <AuthProvider>
        <StatusBar style="light" backgroundColor="#1B3A6B" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="(jeune)" />
          <Stack.Screen name="(animateur)" />
          <Stack.Screen name="consentement" />
          <Stack.Screen name="politique-confidentialite" />
        </Stack>
      </AuthProvider>
    </ErrorBoundary>
  );
}
