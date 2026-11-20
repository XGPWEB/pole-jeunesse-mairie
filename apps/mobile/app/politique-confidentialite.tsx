import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/colors';

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

function TableRow({
  label,
  value,
  header,
}: {
  label: string;
  value?: string;
  header?: boolean;
}) {
  return (
    <View style={[styles.tableRow, header && styles.tableRowHeader]}>
      <Text style={[styles.tableCell, styles.tableCellLabel, header && styles.tableCellHeaderText]}>
        {label}
      </Text>
      {value !== undefined && (
        <Text style={[styles.tableCell, header && styles.tableCellHeaderText]}>{value}</Text>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PolitiqueConfidentialiteScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backBtnText}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Politique de confidentialité</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Pôle Jeunesse — Mairie de Nogent-sur-Marne{'\n'}
          <Text style={styles.introDate}>Dernière mise à jour : janvier 2026</Text>
        </Text>

        {/* 1. Responsable du traitement */}
        <SectionTitle>1. Responsable du traitement</SectionTitle>
        <View style={styles.card}>
          <Paragraph>
            Le responsable du traitement de vos données personnelles est :
          </Paragraph>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Organisme : </Text>
              Mairie de Nogent-sur-Marne
            </Text>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Adresse : </Text>
              68 rue de Plaisance, 94130 Nogent-sur-Marne
            </Text>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Contact : </Text>
              pole.jeunesse@ville-nogentsurmarne.fr
            </Text>
          </View>
        </View>

        {/* 2. Données collectées */}
        <SectionTitle>2. Données collectées</SectionTitle>
        <View style={styles.card}>
          <Paragraph>
            Dans le cadre du fonctionnement du Pôle Jeunesse, nous collectons les données suivantes :
          </Paragraph>
          <BulletItem>Nom et prénom du jeune et de ses responsables légaux</BulletItem>
          <BulletItem>Date de naissance</BulletItem>
          <BulletItem>Coordonnées des familles (adresse, téléphone, email)</BulletItem>
          <BulletItem>Informations de santé (allergies, régimes alimentaires, informations médicales)</BulletItem>
          <BulletItem>Inscriptions aux activités et ateliers</BulletItem>
          <BulletItem>Données de présences et absences</BulletItem>
          <BulletItem>Photos dans le cadre des activités (avec consentement)</BulletItem>
        </View>

        {/* 3. Finalités */}
        <SectionTitle>3. Finalités du traitement</SectionTitle>
        <View style={styles.card}>
          <Paragraph>Vos données sont collectées et traitées pour :</Paragraph>
          <BulletItem>
            Assurer le service public d'accueil et d'accompagnement des jeunes de 6 à 30 ans
          </BulletItem>
          <BulletItem>Gérer les inscriptions aux activités et les présences</BulletItem>
          <BulletItem>Garantir la sécurité des jeunes accueillis</BulletItem>
          <BulletItem>Communiquer avec les familles sur les activités et événements (avec consentement)</BulletItem>
          <BulletItem>Satisfaire aux obligations légales liées à l'accueil de mineurs</BulletItem>
        </View>

        {/* 4. Base juridique */}
        <SectionTitle>4. Base juridique</SectionTitle>
        <View style={styles.card}>
          <BulletItem>
            <Text style={styles.bold}>Mission de service public</Text> (art. 6.1.e RGPD) — pour les inscriptions, présences et sécurité
          </BulletItem>
          <BulletItem>
            <Text style={styles.bold}>Obligation légale</Text> (art. 6.1.c RGPD) — pour le registre des présences (accueil de mineurs)
          </BulletItem>
          <BulletItem>
            <Text style={styles.bold}>Consentement</Text> (art. 6.1.a RGPD) — pour les communications non essentielles et l'utilisation de photos
          </BulletItem>
          <BulletItem>
            <Text style={styles.bold}>Relation contractuelle</Text> (art. 6.1.b RGPD) — pour les comptes du personnel animateur
          </BulletItem>
        </View>

        {/* 5. Durée de conservation */}
        <SectionTitle>5. Durée de conservation</SectionTitle>
        <View style={styles.card}>
          <View style={styles.table}>
            <TableRow label="Type de données" value="Durée de conservation" header />
            <TableRow label="Données d'inscription" value="3 ans après la dernière inscription" />
            <TableRow label="Données de présence" value="5 ans (obligation légale)" />
            <TableRow label="Communications marketing" value="Jusqu'au retrait du consentement" />
            <TableRow label="Données animateurs" value="Durée du contrat + 5 ans" />
            <TableRow label="Données de santé" value="3 ans après la dernière activité" />
          </View>
        </View>

        {/* 6. Vos droits */}
        <SectionTitle>6. Vos droits</SectionTitle>
        <View style={styles.card}>
          <Paragraph>
            Conformément au RGPD, vous disposez des droits suivants concernant vos données :
          </Paragraph>
          <BulletItem>
            <Text style={styles.bold}>Droit d'accès</Text> — Obtenir une copie de vos données personnelles
          </BulletItem>
          <BulletItem>
            <Text style={styles.bold}>Droit de rectification</Text> — Corriger des données inexactes ou incomplètes
          </BulletItem>
          <BulletItem>
            <Text style={styles.bold}>Droit à l'effacement</Text> — Demander la suppression de vos données
          </BulletItem>
          <BulletItem>
            <Text style={styles.bold}>Droit à la portabilité</Text> — Recevoir vos données dans un format structuré
          </BulletItem>
          <BulletItem>
            <Text style={styles.bold}>Droit d'opposition</Text> — Vous opposer au traitement de vos données
          </BulletItem>
          <View style={styles.contactBox}>
            <Text style={styles.contactBoxTitle}>Pour exercer vos droits :</Text>
            <Text style={styles.contactBoxEmail}>dpo@ville-nogentsurmarne.fr</Text>
          </View>
        </View>

        {/* 7. DPO */}
        <SectionTitle>7. Délégué à la Protection des Données (DPO)</SectionTitle>
        <View style={styles.card}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Service : </Text>
              Service Juridique — Mairie de Nogent-sur-Marne
            </Text>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Email : </Text>
              dpo@ville-nogentsurmarne.fr
            </Text>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Téléphone : </Text>
              01 48 72 73 00
            </Text>
            <Text style={styles.infoLine}>
              <Text style={styles.infoLabel}>Adresse : </Text>
              68 rue de Plaisance, 94130 Nogent-sur-Marne
            </Text>
          </View>
        </View>

        {/* 8. Sécurité */}
        <SectionTitle>8. Sécurité des données</SectionTitle>
        <View style={styles.card}>
          <Paragraph>
            Nous mettons en œuvre les mesures techniques et organisationnelles suivantes pour protéger vos données :
          </Paragraph>
          <BulletItem>Accès restreint par authentification et gestion des rôles</BulletItem>
          <BulletItem>Chiffrement des données sensibles (santé, mots de passe)</BulletItem>
          <BulletItem>Journalisation des accès aux données</BulletItem>
          <BulletItem>Sauvegardes régulières sécurisées</BulletItem>
          <BulletItem>Formation du personnel aux bonnes pratiques RGPD</BulletItem>
        </View>

        {/* 9. Mineurs */}
        <SectionTitle>9. Protection des mineurs</SectionTitle>
        <View style={[styles.card, styles.cardHighlight]}>
          <View style={styles.mineurIconRow}>
            <Text style={styles.mineurIcon}>👶</Text>
            <Text style={styles.mineurTitle}>Mention spéciale — Mineurs</Text>
          </View>
          <Paragraph>
            Le Pôle Jeunesse accueille des jeunes dès l'âge de 6 ans. Pour tout mineur, le consentement au traitement des données doit être fourni par le ou les titulaires de l'autorité parentale.
          </Paragraph>
          <Paragraph>
            Les données de santé des mineurs (allergies, informations médicales) sont traitées avec une protection renforcée et accessibles uniquement au personnel habilité.
          </Paragraph>
          <Paragraph>
            L'utilisation de photos ou vidéos impliquant des mineurs nécessite une autorisation parentale explicite et écrite.
          </Paragraph>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Pour toute réclamation, vous pouvez également contacter la CNIL :{' '}
            <Text style={styles.footerLink}>www.cnil.fr</Text>
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { minWidth: 70 },
  backBtnText: { fontSize: 14, fontWeight: '600', color: Colors.purple },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  headerSpacer: { minWidth: 70 },

  // Scroll
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40 },

  // Intro
  intro: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.purple,
    marginBottom: 20,
    textAlign: 'center',
  },
  introDate: { fontWeight: '400', color: Colors.textMuted },

  // Section title
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.purple,
    marginTop: 20,
    marginBottom: 8,
    letterSpacing: 0.2,
  },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 4,
  },
  cardHighlight: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.purple,
  },

  // Paragraph
  paragraph: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 20,
    marginBottom: 10,
  },
  bold: { fontWeight: '700' },

  // Bullet
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.purple,
    marginTop: 6,
    flexShrink: 0,
  },
  bulletText: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 20 },

  // Info block
  infoBlock: {
    backgroundColor: Colors.purplePale,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  infoLine: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  infoLabel: { fontWeight: '700', color: Colors.purple },

  // Table
  table: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tableRowHeader: { backgroundColor: Colors.purplePale },
  tableCell: {
    flex: 1,
    fontSize: 12,
    color: Colors.text,
    padding: 10,
    lineHeight: 17,
  },
  tableCellLabel: { fontWeight: '600' },
  tableCellHeaderText: { fontWeight: '700', color: Colors.purple },

  // Contact box
  contactBox: {
    marginTop: 12,
    backgroundColor: Colors.purplePale,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  contactBoxTitle: { fontSize: 12, color: Colors.textMuted, marginBottom: 4 },
  contactBoxEmail: { fontSize: 15, fontWeight: '800', color: Colors.purple },

  // Mineur section
  mineurIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  mineurIcon: { fontSize: 22 },
  mineurTitle: { fontSize: 14, fontWeight: '800', color: Colors.purple },

  // Footer
  footer: { marginTop: 24, alignItems: 'center' },
  footerText: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', lineHeight: 17 },
  footerLink: { color: Colors.purple, fontWeight: '600' },
});
