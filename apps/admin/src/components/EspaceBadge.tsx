const CONFIG: Record<string, { label: string; classes: string }> = {
  collegiens: { label: 'Collégiens', classes: 'bg-purple-100 text-purple-700 border-purple-200' },
  lyceens: { label: 'Lycéens', classes: 'bg-blue-100 text-[#1B3870] border-blue-200' },
  pij: { label: 'PIJ', classes: 'bg-sky-100 text-sky-600 border-sky-200' },
  clas: { label: 'CLAS', classes: 'bg-green-100 text-green-700 border-green-200' },
};

export default function EspaceBadge({ espaceId }: { espaceId: string }) {
  const cfg = CONFIG[espaceId] ?? { label: espaceId, classes: 'bg-gray-100 text-gray-600 border-gray-200' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}
