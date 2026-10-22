import {
  LayoutDashboard,
  ClipboardList,
  UserCheck,
  CheckSquare,
  GitBranch,
  BarChart3,
  Users,
  Mail,
  Settings,
  MessageCircle,
} from 'lucide-react';

/**
 * Navigation and route access, keyed by the same permission strings the
 * server enforces. Hiding an item is a convenience; the API still refuses
 * anything the user is not allowed to do.
 *
 * `phase` marks screens whose features arrive in a later build phase.
 */
export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, any: [] },
  { to: '/complaints', label: 'Complaints', icon: ClipboardList, any: ['complaint.view.all'] },
  { to: '/my-complaints', label: 'My assigned complaints', icon: UserCheck, any: ['complaint.view.assigned', 'complaint.view.all'] },
  { to: '/reviews', label: 'Pending reviews', icon: CheckSquare, any: ['complaint.d1.acknowledge', 'complaint.d3.review'] },
  { to: '/rca-capa', label: 'Root cause and CAPA', icon: GitBranch, any: ['complaint.d3.edit', 'complaint.d3.review'], phase: 6 },
  { to: '/reports', label: 'Reports', icon: BarChart3, any: ['reports.view'] },
  { to: '/admin/users', label: 'Users and roles', icon: Users, any: ['users.manage', 'roles.manage', 'departments.manage'], group: 'admin' },
  { to: '/notifications', label: 'Notification logs', icon: Mail, any: ['notifications.view'], group: 'admin' },
  { to: '/whatsapp-simulator', label: 'WhatsApp simulator', icon: MessageCircle, any: ['settings.manage', 'complaint.create.manual'], group: 'admin' },
  { to: '/settings', label: 'Settings', icon: Settings, any: ['settings.manage'], group: 'admin' },
];

export function visibleNav(canAny) {
  return NAV.filter((item) => item.any.length === 0 || canAny(...item.any));
}
