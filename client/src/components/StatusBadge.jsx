import { Badge } from './Badge.jsx';
import { STATUS_TONE } from '../lib/complaints.js';

export function StatusBadge({ status, label }) {
  return <Badge tone={STATUS_TONE[status] || 'neutral'}>{label || status}</Badge>;
}
