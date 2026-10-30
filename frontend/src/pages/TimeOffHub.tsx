import HubTabs from '../components/HubTabs';
import { usePermissions } from '../hooks/usePermissions';
import LeavesPage from './Leaves';
import WFHRequestsPage from './WFHRequests';
import ApprovalsPage from './Approvals';

/**
 * Unified Time-Off workspace. Replaces the confusing pair of "Leaves" and
 * "Approvals" sidebar items — they were the two sides of the same workflow.
 *
 *   • Everyone gets "My Leaves" + "Work From Home" (request + history).
 *   • Approvers (Manager / HR / Admin) get the "Approvals" tab.
 */
export default function TimeOffHub() {
  const { hasRole } = usePermissions();
  const canApprove = hasRole('Admin', 'HR', 'Manager');

  return (
    <HubTabs
      tabs={[
        { key: 'leaves',    label: 'My Leaves',     icon: 'event_busy', render: () => <LeavesPage /> },
        { key: 'wfh',       label: 'Work From Home', icon: 'home_work',  render: () => <WFHRequestsPage /> },
        {
          key: 'approvals',
          label: 'Approvals',
          icon: 'task_alt',
          visible: canApprove,
          render: () => <ApprovalsPage />,
        },
      ]}
      defaultTab="leaves"
    />
  );
}
