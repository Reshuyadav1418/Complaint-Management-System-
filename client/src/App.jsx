import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { NAV } from './auth/navigation.js';
import { AppShell } from './layout/AppShell.jsx';
import { Loading } from './components/States.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { ChangePasswordPage } from './pages/ChangePasswordPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { PlannedPage } from './pages/PlannedPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { UsersRolesPage } from './pages/admin/UsersRolesPage.jsx';
import { ComplaintsPage } from './pages/complaints/ComplaintsPage.jsx';
import { ComplaintDetailPage } from './pages/complaints/ComplaintDetailPage.jsx';
import { NotificationLogsPage } from './pages/notifications/NotificationLogsPage.jsx';
import { PendingReviewsPage } from './pages/reviews/PendingReviewsPage.jsx';
import { SettingsPage } from './pages/settings/SettingsPage.jsx';
import { ReportsPage } from './pages/reports/ReportsPage.jsx';
import { SimulatorPage } from './pages/whatsapp/SimulatorPage.jsx';

/** Render children only if the user has one of the permissions. */
function Guard({ any, children }) {
  const { canAny } = useAuth();
  if (any.length && !canAny(...any)) return <NotFoundPage forbidden />;
  return children;
}

const navFor = (to) => NAV.find((n) => n.to === to);

export default function App() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading label="Checking your session" />
      </div>
    );
  }

  if (status === 'signedOut') {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  if (user.mustChangePassword) return <ChangePasswordPage forced />;

  const planned = NAV.filter((n) => n.phase);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route
          path="admin/users"
          element={
            <Guard any={navFor('/admin/users').any}>
              <UsersRolesPage />
            </Guard>
          }
        />
        <Route path="complaints" element={<Guard any={['complaint.view.all', 'complaint.view.assigned']}><ComplaintsPage key="all" /></Guard>} />
        <Route path="complaints/:id" element={<Guard any={['complaint.view.all', 'complaint.view.assigned']}><ComplaintDetailPage /></Guard>} />
        <Route path="my-complaints" element={<Guard any={navFor('/my-complaints').any}><ComplaintsPage key="mine" mine /></Guard>} />
        <Route path="reviews" element={<Guard any={navFor('/reviews').any}><PendingReviewsPage /></Guard>} />
        <Route path="reports" element={<Guard any={navFor('/reports').any}><ReportsPage /></Guard>} />
        <Route path="whatsapp-simulator" element={<Guard any={navFor('/whatsapp-simulator').any}><SimulatorPage /></Guard>} />
        <Route path="settings" element={<Guard any={navFor('/settings').any}><SettingsPage /></Guard>} />
        <Route path="notifications" element={<Guard any={navFor('/notifications').any}><NotificationLogsPage /></Guard>} />
        {planned.map((n) => (
          <Route
            key={n.to}
            path={n.to.slice(1)}
            element={
              <Guard any={n.any}>
                <PlannedPage title={n.label} phase={n.phase} />
              </Guard>
            }
          />
        ))}
        <Route path="account/password" element={<ChangePasswordPage />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
