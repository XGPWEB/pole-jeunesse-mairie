import React, { useState } from 'react';
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
import { messageErreur } from '@/lib/api';
import { api } from '@/lib/client';
import { demanderReinitialisation } from '@/lib/services';

type ScreenState = 'form' | 'loading' | 'success';

export default function ForgotPasswordScreen() {
  const [username, setUsername] = useState('');
  const [screenState, setScreenState] = useState<ScreenState>('form');
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!username.trim()) {
      setError('Veuillez saisir votre identifiant.');
      return;
    }

    setError(null);
    setScreenState('loading');
    try {
      await demanderReinitialisation(api, username);
      setScreenState('success');
    } catch (e) {
      // Échec : on revient au formulaire, identifiant conservé.
      setError(messageErreur(e));
      setScreenState('form');
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
          <Text style={styles.headerTitle}>Mot de passe oublié</Text>
        </View>

        {/* Spacer to balance back button */}
        <View style={styles.headerSpacer} />
      </View>

      {/* ── Content ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {screenState === 'success' ? (
            /* ── Success state ── */
            <View style={styles.card}>
              <View style={styles.successIconWrapper}>
                <Ionicons
                  name="checkmark-circle"
                  size={64}
                  color={Colors.success}
                />
              </View>

              <Text style={styles.successTitle}>Demande enregistrée</Text>

              <Text style={styles.successMessage}>
                Si un compte correspond à cet identifiant, la demande de
                réinitialisation a été transmise. Pour des raisons de sécurité,
                l'application n'indique pas si le compte existe.
              </Text>

              <View style={styles.noteBox}>
                <Ionicons
                  name="call-outline"
                  size={15}
                  color={Colors.textMuted}
                  style={styles.noteIcon}
                />
                <Text style={styles.noteText}>
                  En attendant, contactez directement le Pôle Jeunesse :{' '}
                  <Text style={styles.notePhone}>01 48 72 73 74</Text>
                </Text>
              </View>

              <TouchableOpacity
                style={styles.button}
                onPress={() => router.replace('/login')}
                activeOpacity={0.8}
              >
                <Text style={styles.buttonText}>Retour à la connexion</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* ── Form state ── */
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Réinitialisation</Text>
              <Text style={styles.cardSubtitle}>
                Saisissez votre identifiant de connexion. La demande de
                réinitialisation sera transmise au Pôle Jeunesse.
              </Text>

              {/* Identifiant */}
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
                    returnKeyType="send"
                    value={username}
                    onChangeText={(t) => { setUsername(t); setError(null); }}
                    onSubmitEditing={handleSend}
                    editable={screenState === 'form'}
                  />
                </View>
              </View>

              {error ? (
                <View style={styles.noteBox}>
                  <Ionicons
                    name="alert-circle"
                    size={15}
                    color={Colors.danger}
                    style={styles.noteIcon}
                  />
                  <Text style={[styles.noteText, { color: Colors.danger }]}>{error}</Text>
                </View>
              ) : null}

              {/* Submit button */}
              <TouchableOpacity
                style={[
                  styles.button,
                  screenState === 'loading' && styles.buttonDisabled,
                ]}
                onPress={handleSend}
                disabled={screenState === 'loading'}
                activeOpacity={0.8}
              >
                {screenState === 'loading' ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Text style={styles.buttonText}>Envoyer la demande</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Footer info */}
          <View style={styles.footer}>
            <Ionicons
              name="information-circle-outline"
              size={14}
              color={Colors.textMuted}
            />
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
    marginBottom: 20,
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

  // Success state
  successIconWrapper: {
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  successMessage: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  notePhone: {
    fontWeight: '700',
    color: Colors.text,
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
