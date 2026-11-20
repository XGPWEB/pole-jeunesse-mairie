import { exigerAdminPage } from '@/lib/session';
import PageHeader from '@/components/PageHeader';

export default async function CommunicationPage() {
  await exigerAdminPage();
  return (
    <div>
      <PageHeader
        titre="Communication"
        sousTitre="Notifications push et messagerie"
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-2 gap-6">
          {/* Envoyer une notification */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              🔔 Envoyer une notification push
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Destinataires</label>
                <select className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]">
                  <option>Tous les espaces</option>
                  <option>Collégiens</option>
                  <option>Lycéens</option>
                  <option>PIJ</option>
                  <option>CLAS</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Titre *</label>
                <input type="text" placeholder="ex: Atelier annulé ce soir" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Message *</label>
                <textarea rows={4} placeholder="Rédigez votre message…" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E] resize-none" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="urgent" className="rounded" />
                <label htmlFor="urgent" className="text-sm text-gray-700">Message urgent (alerte sonore)</label>
              </div>
              <button className="w-full bg-[#6B1A6E] text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-[#551558] transition-colors">
                Envoyer la notification
              </button>
            </div>
          </div>

          {/* Historique */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-bold text-gray-800 mb-4">📋 Dernières notifications</h2>
            <div className="space-y-3">
              {[
                { titre: 'Programme vacances disponible', cible: 'Tous', date: '25 mars', urgent: false },
                { titre: 'Gymnase fermé vendredi', cible: 'Collégiens', date: '22 mars', urgent: true },
                { titre: "Forum Jobs d'Été", cible: 'PIJ', date: '20 mars', urgent: false },
                { titre: 'Nouveaux horaires CLAS avril', cible: 'CLAS', date: '18 mars', urgent: false },
              ].map((n, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${n.urgent ? 'bg-red-100' : 'bg-purple-100'}`}>
                    {n.urgent ? '🚨' : '🔔'}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-gray-800">{n.titre}</div>
                    <div className="text-xs text-gray-400">{n.cible} · {n.date}</div>
                  </div>
                  {n.urgent && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">URGENT</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats communication */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="font-bold text-gray-800 mb-4">📈 Statistiques de communication</h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Notifs envoyées ce mois', value: '12', icon: '📤' },
              { label: 'Familles abonnées', value: '34', icon: '👨‍👩‍👧' },
              { label: 'Taux d\'ouverture', value: '78%', icon: '👁' },
              { label: 'Messages urgents', value: '2', icon: '🚨' },
            ].map(s => (
              <div key={s.label} className="text-center p-4 bg-gray-50 rounded-xl">
                <div className="text-2xl mb-2">{s.icon}</div>
                <div className="text-xl font-extrabold text-[#6B1A6E]">{s.value}</div>
                <div className="text-xs text-gray-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
