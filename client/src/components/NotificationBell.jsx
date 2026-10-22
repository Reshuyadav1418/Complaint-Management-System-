import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Zap, Check } from 'lucide-react';
import { inAppApi } from '../api/endpoints.js';

function formatRelativeTime(dateString) {
  if (!dateString) return 'just now';
  const diffSec = Math.floor((new Date() - new Date(dateString)) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} minutes ago •`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hours ago •`;
  return `${Math.floor(diffSec / 86400)} days ago •`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], unreadCount: 0 });
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  const fetchNotifications = async () => {
    try {
      const res = await inAppApi.list();
      setData(res.data || { notifications: [], unreadCount: 0 });
    } catch {
      // Ignore background fetch error
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleMarkAllRead = async () => {
    try {
      await inAppApi.markAllRead();
      setData((prev) => ({
        ...prev,
        unreadCount: 0,
        notifications: prev.notifications.map((n) => ({ ...n, read: true })),
      }));
    } catch {
      // Ignore
    }
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.read) {
      inAppApi.markRead(notif._id).catch(() => {});
      setData((prev) => ({
        ...prev,
        unreadCount: Math.max(0, prev.unreadCount - 1),
        notifications: prev.notifications.map((n) => (n._id === notif._id ? { ...n, read: true } : n)),
      }));
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus:outline-none"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {data.unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white shadow-sm">
            {data.unreadCount > 9 ? '9+' : data.unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 sm:w-96 rounded-md border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 bg-slate-50">
            <h3 className="text-sm font-semibold text-slate-800">Notifications</h3>
            {data.unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {data.notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">No new notifications</div>
            ) : (
              data.notifications.map((n) => (
                <Link
                  key={n._id}
                  to={n.link || '#'}
                  onClick={() => handleNotificationClick(n)}
                  className={`flex items-start gap-3 p-3 transition hover:bg-slate-50 ${!n.read ? 'bg-blue-50/50' : ''}`}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-blue-500 text-white shadow-sm">
                    <Zap className="h-4 w-4 fill-current" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs ${!n.read ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                      {n.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600 leading-relaxed line-clamp-2">
                      {n.message}
                    </p>
                    <span className="mt-1 block text-[11px] text-slate-400">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
