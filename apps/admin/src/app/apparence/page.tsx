import ApparenceClient from './ApparenceClient';
import theme from '@/data/theme.json';

export default function ApparencePage() {
  return <ApparenceClient initialTheme={theme} />;
}
