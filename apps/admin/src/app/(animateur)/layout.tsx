import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import AnimateurSidebar from '@/components/AnimateurSidebar';
import DateTimeWeatherWidget from '@/components/DateTimeWeatherWidget';
import AutoRefresh from '@/components/AutoRefresh';
import { queryOne } from '@/lib/db';
import { rubriquesEffectives } from '@/lib/rubriques';

export default async function AnimateurLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin/dashboard');

  const tenant_id = session.tenant_id ?? 'nogent';
  const themeRow = await queryOne<any>(`SELECT data FROM theme WHERE id = $1`, [tenant_id]);
  const theme = themeRow?.data ?? {};
  const c = theme.couleurs ?? {};
  const id = theme.identiteWeb ?? {};
  const typo = theme.typographie ?? {};
  const navConfig: { id: string; label: string; icon: string; visible: boolean }[] = theme.navigationAnimateur?.items ?? [];

  // Préférences personnelles de menu de l'animateur (ordre + visibilité).
  const prefsRow = await queryOne<{ navPrefs: { id: string; visible: boolean }[] | null }>(
    'SELECT nav_prefs AS "navPrefs" FROM animateurs WHERE id = $1',
    [session.id],
  );
  const navPrefs = prefsRow?.navPrefs ?? null;
  const cssVars = {
    '--color-admin':     c.primaire   ?? '#6B1A6E',
    '--color-animateur': c.secondaire ?? '#1B3870',
    '--color-green':     c.accent     ?? '#8DC63F',
    '--color-cyan':      c.cyan       ?? '#29B5E8',
    '--font-family':     typo.famille ? `"${typo.famille}", sans-serif` : 'Inter, sans-serif',
  } as React.CSSProperties;

  return (
    <div className="flex h-screen overflow-hidden" style={{ ...cssVars, fontFamily: 'var(--font-family)' }}>
      <AnimateurSidebar nomPlateforme={id.nomPlateforme} sousTitre={id.sousTitre} logo={id.logo} navConfig={navConfig} navPrefs={navPrefs} rubriques={[...rubriquesEffectives(session)]} utilisateur={[session.prenom, session.nom].filter(Boolean).join(' ')} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#1B3870] flex items-center justify-center text-white text-sm font-bold">
              {session.prenom?.[0]}{session.nom?.[0]}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {session.prenom} {session.nom}
              </p>
              <p className="text-xs text-gray-400">{session.espaceAssigne}</p>
            </div>
          </div>
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
