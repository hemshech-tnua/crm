import { lazy, Suspense, type ReactNode } from 'react';
import { createHashRouter, Navigate } from 'react-router';
import { PublicLayout } from '@/layout/PublicLayout';
import { StaffLayout } from '@/layout/StaffLayout';
import { RequireStaff, useRole } from '@/lib/auth';
import { Skeleton } from '@/ui/kit';
import { NotFound } from './NotFound';

const page = (loader: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(async () => ({ default: (await loader())[name] as () => ReactNode }));

// public (participants)
const PublicHome = page(() => import('@/features/public/PublicHome'), 'PublicHome');
const RegisterPage = page(() => import('@/features/public/RegisterPage'), 'RegisterPage');
const ManagePage = page(() => import('@/features/public/ManagePage'), 'ManagePage');
const CheckinPage = page(() => import('@/features/public/CheckinPage'), 'CheckinPage');
const FeedbackPage = page(() => import('@/features/public/FeedbackPage'), 'FeedbackPage');
const ProposePage = page(() => import('@/features/public/ProposePage'), 'ProposePage');
const PrivacyPage = page(() => import('@/features/public/PrivacyPage'), 'PrivacyPage');
// auth
const LoginPage = page(() => import('@/features/auth/LoginPage'), 'LoginPage');
const PasswordPage = page(() => import('@/features/auth/PasswordPage'), 'PasswordPage');
// staff
const DashboardPage = page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage');
const EventsPage = page(() => import('@/features/events/EventsPage'), 'EventsPage');
const EventEditPage = page(() => import('@/features/events/EventEditPage'), 'EventEditPage');
const EventPage = page(() => import('@/features/events/EventPage'), 'EventPage');
const DoorPage = page(() => import('@/features/events/DoorPage'), 'DoorPage');
const DoorHome = page(() => import('@/features/events/DoorHome'), 'DoorHome');
const ParticipantsPage = page(() => import('@/features/participants/ParticipantsPage'), 'ParticipantsPage');
const ParticipantPage = page(() => import('@/features/participants/ParticipantPage'), 'ParticipantPage');
const ParticipantNewPage = page(() => import('@/features/participants/ParticipantNewPage'), 'ParticipantNewPage');
const DuplicatesPage = page(() => import('@/features/participants/DuplicatesPage'), 'DuplicatesPage');
const FollowUpsPage = page(() => import('@/features/followups/FollowUpsPage'), 'FollowUpsPage');
const SpeakersPage = page(() => import('@/features/speakers/SpeakersPage'), 'SpeakersPage');
const ReportsPage = page(() => import('@/features/reports/ReportsPage'), 'ReportsPage');
const SettingsPage = page(() => import('@/features/settings/SettingsPage'), 'SettingsPage');

const wait = (el: ReactNode) => (
  <Suspense fallback={<div className="py-8"><Skeleton lines={6} /></div>}>{el}</Suspense>
);
const MANAGE = ['admin', 'coordinator'] as const;

/** /app → each role's home: the door team goes straight to today's attendance. */
function StaffHome() {
  const role = useRole();
  return <Navigate to={role === 'volunteer' ? '/app/door' : '/app/dashboard'} replace />;
}

export const router = createHashRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: wait(<PublicHome />) },
      { path: '/r/:code', element: wait(<RegisterPage />) },
      { path: '/m/:token', element: wait(<ManagePage />) },
      { path: '/c/:code', element: wait(<CheckinPage />) },
      { path: '/f/:code', element: wait(<FeedbackPage />) },
      { path: '/join', element: wait(<ProposePage />) },
      { path: '/privacy', element: wait(<PrivacyPage />) },
      { path: '/login', element: wait(<LoginPage />) },
      { path: '/password', element: wait(<PasswordPage />) },
    ],
  },
  {
    path: '/app',
    element: <RequireStaff><StaffLayout /></RequireStaff>,
    children: [
      { index: true, element: <StaffHome /> },
      { path: 'door', element: wait(<DoorHome />) },
      { path: 'events/:id/door', element: wait(<DoorPage />) },
      { path: 'dashboard', element: <RequireStaff roles={[...MANAGE]}>{wait(<DashboardPage />)}</RequireStaff> },
      { path: 'events', element: <RequireStaff roles={[...MANAGE]}>{wait(<EventsPage />)}</RequireStaff> },
      { path: 'events/new', element: <RequireStaff roles={[...MANAGE]}>{wait(<EventEditPage />)}</RequireStaff> },
      { path: 'events/:id/edit', element: <RequireStaff roles={[...MANAGE]}>{wait(<EventEditPage />)}</RequireStaff> },
      { path: 'events/:id', element: <RequireStaff roles={[...MANAGE]}>{wait(<EventPage />)}</RequireStaff> },
      { path: 'participants', element: <RequireStaff roles={[...MANAGE]}>{wait(<ParticipantsPage />)}</RequireStaff> },
      { path: 'participants/new', element: <RequireStaff roles={[...MANAGE]}>{wait(<ParticipantNewPage />)}</RequireStaff> },
      { path: 'participants/duplicates', element: <RequireStaff roles={[...MANAGE]}>{wait(<DuplicatesPage />)}</RequireStaff> },
      { path: 'participants/:id', element: <RequireStaff roles={[...MANAGE]}>{wait(<ParticipantPage />)}</RequireStaff> },
      { path: 'followups', element: <RequireStaff roles={[...MANAGE]}>{wait(<FollowUpsPage />)}</RequireStaff> },
      { path: 'speakers', element: <RequireStaff roles={[...MANAGE]}>{wait(<SpeakersPage />)}</RequireStaff> },
      { path: 'reports', element: <RequireStaff roles={[...MANAGE]}>{wait(<ReportsPage />)}</RequireStaff> },
      { path: 'settings', element: <RequireStaff roles={[...MANAGE]}>{wait(<SettingsPage />)}</RequireStaff> },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <PublicLayout />, children: [{ path: '*', element: <NotFound /> }] },
]);
