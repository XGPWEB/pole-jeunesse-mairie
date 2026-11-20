'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Rond rouge avec compteur — affiché dans la sidebar si des notifications non lues existent.
 * isAdmin=true → compte toutes les notifs non supprimées (reset-requests incluses)
 * isAdmin=false → compte les notifs non lues par l'animateur connecté
 */
export default function NotificationBadge({ isAdmin = false }: { isAdmin?: boolean }) {
  const [count, setCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/animateurs/me', { credentials: 'include', signal: controller.signal })
      .then(r => r.json())
      .then(d => setUserId(d.id ?? d.animateur?.id ?? null))
      .catch(e => { if (e.name !== 'AbortError') console.error(e); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let controller = new AbortController();

    const fetchCount = async () => {
      controller.abort();
      controller = new AbortController();
      try {
        const res  = await fetch('/api/notifications', { credentials: 'include', signal: controller.signal });
        const data = await res.json();
        const notifs: any[] = data.notifications ?? [];
        if (isAdmin) {
          setCount(notifs.filter(n => n.type === 'reset-request').length);
        } else {
          const unread = notifs.filter(n => userId ? !n.luPar?.includes(userId) : n.luPar?.length === 0);
          setCount(unread.length);
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setCount(0);
      }
    };

    fetchCount();
    const interval = setInterval(fetchCount, 10_000);

    function onRead() { setCount(0); }
    window.addEventListener('notifications-read', onRead);

    return () => {
      clearInterval(interval);
      controller.abort();
      window.removeEventListener('notifications-read', onRead);
    };
  }, [isAdmin, userId]);

  if (count === 0) return null;

  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}
