import { exigerAdminPage } from '@/lib/session';
import SecuriteClient from './SecuriteClient';

export const metadata = {
  title: 'Sécurité — Pôle Jeunesse Nogent',
};

export default async function SecuritePage() {
  await exigerAdminPage();
  return <SecuriteClient />;
}
