import Link from 'next/link';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: string;
  color: 'purple' | 'navy' | 'green' | 'cyan' | 'amber';
  delta?: string;
  /** Si fourni, la carte devient cliquable et mène à cette route. */
  href?: string;
}

const COLOR_MAP = {
  purple: { bg: 'bg-purple-50', text: 'text-purple-600', iconBg: 'bg-purple-100' },
  navy: { bg: 'bg-blue-50', text: 'text-[#1B3870]', iconBg: 'bg-blue-100' },
  green: { bg: 'bg-green-50', text: 'text-green-600', iconBg: 'bg-green-100' },
  cyan: { bg: 'bg-sky-50', text: 'text-sky-500', iconBg: 'bg-sky-100' },
  amber: { bg: 'bg-orange-50', text: 'text-orange-600', iconBg: 'bg-orange-100' },
};

export default function StatCard({ label, value, icon, color, delta, href }: StatCardProps) {
  const c = COLOR_MAP[color];
  const inner = (
    <>
      <div className={`w-12 h-12 rounded-xl ${c.iconBg} flex items-center justify-center text-2xl`}>
        {icon}
      </div>
      <div className="flex-1">
        <div className={`text-3xl font-extrabold ${c.text}`}>{value}</div>
        <div className="text-sm text-gray-500 font-medium mt-0.5">{label}</div>
      </div>
      {delta && (
        <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full">{delta}</span>
      )}
    </>
  );

  const base = 'bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex items-center gap-4';

  if (href) {
    return (
      <Link href={href} className={`${base} transition-all hover:shadow-md hover:border-gray-200 hover:-translate-y-0.5`}>
        {inner}
      </Link>
    );
  }

  return <div className={base}>{inner}</div>;
}
