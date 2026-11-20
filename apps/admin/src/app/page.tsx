// Le middleware gère déjà la redirection de / vers /admin/dashboard ou /animateur/dashboard.
// Ce composant ne devrait jamais s'afficher, mais sert de fallback.
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/login');
}
