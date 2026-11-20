interface PageHeaderProps {
  titre: string;
  sousTitre?: string;
  action?: React.ReactNode;
}

export default function PageHeader({ titre, sousTitre, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between px-8 py-6 border-b border-gray-200 bg-white">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">{titre}</h1>
        {sousTitre && <p className="text-sm text-gray-500 mt-1">{sousTitre}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
