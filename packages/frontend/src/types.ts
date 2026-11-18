export interface UserProfile {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string;
  createdAt?: string;
}

export interface SharedUserSummary {
  id: string;
  email: string;
  displayName: string;
}

export type TaskFilter = 'all' | 'my' | 'shared';

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  isOwner: boolean;
  sharedWith: SharedUserSummary[];
  createdAt: string;
  updatedAt: string;
}
