import { Badge } from './Badge.jsx';
import { NOTIFICATION_STATUS } from '../lib/notifications.js';

export function NotificationStatus({ status }) {
  const s = NOTIFICATION_STATUS[status] || { label: status, tone: 'neutral' };
  return (
    <span title={s.help}>
      <Badge tone={s.tone}>{s.label}</Badge>
    </span>
  );
}
