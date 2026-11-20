import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/hooks/useAuth';

export default function LoginScreen() {
  const { login, statut, messageSession, effacerMessageSession, reessayerRestauration } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpRequis, setTotpRequis] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session restaurée et validée par le serveur (démarrage, ou nouvel essai
  // après une coupure réseau) : inutile de redemander les identifiants.
  useEffect(() => {
    if (statut === 'connecte') router.replace('/(animateur)');
  }, [statut]);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Veuillez renseigner votre identifiant et votre mot de passe.');
      return;
    }
    if (totpRequis && !totpCode.trim()) {
      setError('Veuillez saisir votre code de vérification.');
      return;
    }

    setError(null);
    effacerMessageSession();
    setLoading(true);

    const result = await login(username, password, totpRequis ? totpCode : undefined);

    setLoading(false);

    // Succès : la session passe à « connecte » et l'effet ci-dessus redirige.
    if (!result.success) {
      // La saisie est conservée ; seul le code à usage unique est à ressaisir.
      setTotpRequis(result.totpRequis);
      if (result.totpRequis) setTotpCode('');
      setError(result.error);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* ── Purple header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel="Retour"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={Colors.white} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={styles.shieldWrapper}>
            <Ionicons name="shield-checkmark" size={28} color={Colors.white} />
          </View>
          <Text style={styles.headerTitle}>Espace Animateur</Text>
        </View>

        {/* Spacer to balance back button */}
        <View style={styles.headerSpacer} />
      </View>

      {/* ── Form ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Connexion</Text>
            <Text style={styles.cardSubtitle}>
              Entrez vos identifiants pour accéder à l'espace animateur.
            </Text>

            {/* Username */}
            <View style={styles.fieldWrapper}>
              <Text style={styles.label}>Identifiant</Text>
              <View style={styles.inputRow}>
                <Ionicons
                  name="person-outline"
                  size={18}
                  color={Colors.textLight}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="ex: marie.dupont"
                  placeholderTextColor={Colors.textLight}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  value={username}
                  onChangeText={(t) => { setUsername(t); setError(null); setTotpRequis(false); }}
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.fieldWrapper}>
              <Text style={styles.label}>Mot de passe</Text>
              <View style={styles.inputRow}>
                <Ionicons
                  name="lock-closed-outline"
                  size={18}
                  color={Colors.textLight}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor={Colors.textLight}
                  secureTextEntry
                  returnKeyType="done"
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(null); setTotpRequis(false); }}
                  onSubmitEditing={handleLogin}
                />
              </View>
            </View>

            {/* Code de vérification (comptes avec double authentification) */}
            {totpRequis ? (
              <View style={styles.fieldWrapper}>
                <Text style={styles.label}>Code de vérification</Text>
                <View style={styles.inputRow}>
                  <Ionicons
                    name="keypad-outline"
                    size={18}
                    color={Colors.textLight}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="123456"
                    placeholderTextColor={Colors.textLight}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    maxLength={6}
                    returnKeyType="done"
                    value={totpCode}
                    onChangeText={(t) => { setTotpCode(t.replace(/\D/g, '')); setError(null); }}
                    onSubmitEditing={handleLogin}
                  />
                </View>
              </View>
            ) : null}

            {/* Forgot password */}
            <TouchableOpacity
              onPress={() => router.push('/forgot-password')}
              style={styles.forgotWrapper}
              activeOpacity={0.7}
            >
              <Text style={styles.forgotText}>Mot de passe oublié ?</Text>
            </TouchableOpacity>

            {/* Message de session (expirée, non vérifiable) */}
            {messageSession && !error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                <Text style={styles.errorText}>{messageSession}</Text>
              </View>
            ) : null}
            {statut === 'non-verifie' && !error ? (
              <TouchableOpacity
                onPress={reessayerRestauration}
                style={styles.forgotWrapper}
                activeOpacity={0.7}
              >
                <Text style={styles.forgotText}>Réessayer la vérification</Text>
              </TouchableOpacity>
            ) : null}

            {/* Error */}
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Submit */}
            <TouchableOpacity
              style={[styles.button, (loading || statut === 'chargement') && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading || statut === 'chargement'}
              activeOpacity={0.8}
            >
              {loading || statut === 'chargement' ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <Text style={styles.buttonText}>Se connecter</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Footer info */}
          <View style={styles.footer}>
            <Ionicons name="information-circle-outline" size={14} color={Colors.textMuted} />
            <Text style={styles.footerText}>
              Accès réservé au personnel du Pôle Jeunesse
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.purple,
  },
  flex: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Header
  header: {
    backgroundColor: Colors.purple,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  shieldWrapper: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSpacer: {
    width: 36,
  },

  // Scroll
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 32,
  },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: 24,
    lineHeight: 20,
  },

  // Field
  fieldWrapper: {
    marginBottom: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    backgroundColor: Colors.background,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: 46,
    fontSize: 15,
    color: Colors.text,
  },

  // Forgot password
  forgotWrapper: {
    alignItems: 'center',
    marginBottom: 16,
    marginTop: -4,
  },
  forgotText: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
  },

  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.dangerLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.danger,
    lineHeight: 18,
  },

  // Button
  button: {
    backgroundColor: Colors.purple,
    borderRadius: 10,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '700',
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 28,
  },
  footerText: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
