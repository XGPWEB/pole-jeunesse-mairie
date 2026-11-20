import type { Metadata } from 'next';
import './globals.css';
import MonitoringReporter from '@/components/MonitoringReporter';

export const metadata: Metadata = {
  title: 'Pôle Jeunesse Nogent',
  description: 'Plateforme de gestion du Pôle Jeunesse de Nogent-sur-Marne',
};

// Layout racine minimal — sans Sidebar ni chrome.
// Chaque route group ((admin) et (animateur)) gère son propre layout.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        {/* Signale au journal de monitoring les erreurs survenues dans le navigateur. */}
        <MonitoringReporter />
        {children}
      </body>
    </html>
  );
}
