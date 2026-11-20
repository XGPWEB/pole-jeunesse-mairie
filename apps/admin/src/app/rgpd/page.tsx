import { exigerAdminPage } from '@/lib/session';
import RgpdClient from './RgpdClient';
import rgpdData from '@/data/rgpd.json';

export default async function RgpdPage() {
  await exigerAdminPage();
  return <RgpdClient data={rgpdData} />;
}
