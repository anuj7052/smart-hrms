import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppLayout from './layouts/AppLayout';
import AuthLayout from './layouts/AuthLayout';
import type { UserRole } from './types';
import React, { lazy, Suspense } from 'react';

// Route-level code splitting: each page is a separate chunk so the initial
// bundle stays small and the dashboard paints quickly.
const LoginPage = lazy(() => import('./pages/Login'));
const RegisterPage = lazy(() => import('./pages/Register'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmail'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPassword'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPassword'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const AttendancePage = lazy(() => import('./pages/Attendance'));
const AttendanceHubPage = lazy(() => import('./pages/AttendanceHub'));
const EsslAttendancePage = lazy(() => import('./pages/EsslAttendance'));
const EmployeesPage = lazy(() => import('./pages/Employees'));
const EmployeeProfilePage = lazy(() => import('./pages/EmployeeProfile'));
const DevicesPage = lazy(() => import('./pages/Devices'));
const ReportsPage = lazy(() => import('./pages/Reports'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const LeavesPage = lazy(() => import('./pages/Leaves'));
const WFHRequestsPage = lazy(() => import('./pages/WFHRequests'));
const HolidaysPage = lazy(() => import('./pages/Holidays'));
const ProfilePage = lazy(() => import('./pages/Profile'));
const AttendanceCalendarPage = lazy(() => import('./pages/AttendanceCalendar'));
const EsslManagementPage = lazy(() => import('./pages/EsslManagement'));
const VirtualLoginPage = lazy(() => import('./pages/VirtualLogin'));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function PrivateRoute({ children, roles }: { children: React.ReactElement; roles?: UserRole[] }) {
  const { user, isLoading, isAuthenticated } = useAuth();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
      {/* Auth (unauthenticated) routes */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      {/* Protected app routes */}
      <Route
        element={
          <PrivateRoute>
            <AppLayout />
          </PrivateRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/attendance" element={<AttendanceHubPage />} />
        <Route path="/attendance/today" element={<AttendancePage />} />
        <Route path="/leaves" element={<LeavesPage />} />
        <Route path="/wfh" element={<WFHRequestsPage />} />
        <Route path="/holidays" element={<HolidaysPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/essl-live"
          element={
            <PrivateRoute roles={['Admin', 'HR']}>
              <EsslAttendancePage />
            </PrivateRoute>
          }
        />
        <Route
          path="/attendance-calendar"
          element={
            <PrivateRoute roles={['Admin', 'HR']}>
              <AttendanceCalendarPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/essl-manage"
          element={
            <PrivateRoute roles={['Admin', 'HR']}>
              <EsslManagementPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/virtual-login"
          element={
            <PrivateRoute roles={['Admin', 'HR']}>
              <VirtualLoginPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/employees"
          element={
            <PrivateRoute roles={['Admin', 'HR']}>
              <EmployeesPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/employees/:id"
          element={
            <PrivateRoute roles={['Admin', 'HR']}>
              <EmployeeProfilePage />
            </PrivateRoute>
          }
        />
        <Route
          path="/devices"
          element={
            <PrivateRoute roles={['Admin', 'HR']}>
              <DevicesPage />
            </PrivateRoute>
          }
        />
        <Route path="/approvals" element={<Navigate to="/leaves?tab=approvals" replace />} />
        <Route
          path="/reports"
          element={
            <PrivateRoute roles={['Admin', 'HR']}>
              <ReportsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <PrivateRoute roles={['Admin']}>
              <SettingsPage />
            </PrivateRoute>
          }
        />
        <Route index element={<Navigate to="/dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
