import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import AdminSidebar from '@/components/AdminSidebar';
import DateTimeWeatherWidget from '@/components/DateTimeWeatherWidget';
import AutoRefresh from '@/components/AutoRefresh';
import { queryOne } from '@/lib/db';
import { rubriquesEffectives } from '@/lib/rubriques';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/animateur/dashboard');

  const tenant_id = session.tenant_id ?? 'nogent';
  const [themeRow, prefsRow] = await Promise.all([
    queryOne<any>(`SELECT data FROM theme WHERE id = $1`, [tenant_id]),
    // Préférences personnelles de menu de l'admin (ordre + visibilité).
    queryOne<{ navPrefs: { id: string; visible: boolean }[] | null }>(
      'SELECT nav_prefs AS "navPrefs" FROM animateurs WHERE id = $1',
      [session.id],
    ),
  ]);
  const theme = themeRow?.data ?? {};
  const navPrefs = prefsRow?.navPrefs ?? null;
  const c = theme.couleurs ?? {};
  const id = theme.identiteWeb ?? {};
  const typo = theme.typographie ?? {};

  const cssVars = {
    '--color-admin':     c.primaire   ?? '#6B1A6E',
    '--color-animateur': c.secondaire ?? '#1B3870',
    '--color-green':     c.accent     ?? '#8DC63F',
    '--color-cyan':      c.cyan       ?? '#29B5E8',
    '--color-bg':        c.fond       ?? '#f5f3ff',
    '--color-texte':     c.texte      ?? '#1e1b4b',
    '--font-family':     typo.famille ? `"${typo.famille}", sans-serif` : 'Inter, sans-serif',
    '--font-size-base':  typo.tailleBase ?? '16px',
  } as React.CSSProperties;

  return (
    <div className="flex h-screen overflow-hidden" style={{ ...cssVars, fontFamily: 'var(--font-family)', fontSize: 'var(--font-size-base)' }}>
      {id.favicon && (
        <link rel="icon" href={id.favicon} />
      )}
      <AdminSidebar
        nomPlateforme={id.nomPlateforme}
        sousTitre={id.sousTitre}
        logo={id.logo}
        navPrefs={navPrefs}
        rubriques={[...rubriquesEffectives(session)]}
        gereDroits={session.gereDroits === true}
        utilisateur={[session.prenom, session.nom].filter(Boolean).join(' ')}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center justify-between gap-4 shrink-0">
          <span className="text-xs text-gray-400">
            Connecté en tant que <strong className="text-[var(--color-admin)]">{session.prenom} {session.nom}</strong>
          </span>
          <DateTimeWeatherWidget theme="light" />
        </div>
        <main className="flex-1 overflow-y-auto bg-gray-50">
          <AutoRefresh intervalMs={10_000} />
          {children}
        </main>
      </div>
    </div>
  );
}
